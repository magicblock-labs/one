"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

import { useUnifiedWallet } from "@/app/wallet/solana-wallet-provider";
import {
  PaymentTransactionSubmissionError,
  type UnsignedPaymentTransaction,
  deserializeUnsignedPaymentTransaction,
  isPaymentBlockhashExpiredError,
  submitSignedPaymentTransaction,
} from "@/lib/payment-transactions";
import {
  clearStoredPrivateAuthToken,
  fetchSplChallenge,
  getStoredPrivateAuthToken,
  loginSplPrivate,
  setStoredPrivateAuthToken,
} from "@/lib/spl-private-balance";
import {
  STEALTH_HANDLE_MAX_BYTES,
  STEALTH_POOL_MAX_DESTINATIONS,
  getExactStealthHandleInput,
  getStealthHandleByteLength,
  getStoredStealthHandle,
  isStealthHandleInput,
  setStoredStealthHandle,
} from "@/lib/stealth-handles";

type SaveStatus = "idle" | "checking" | "building" | "signing" | "sending" | "confirmed" | "error";

interface StealthPoolStatusResponse {
  stealthPool: string;
  exists: boolean;
}

type StealthPoolBuildResponse = Partial<UnsignedPaymentTransaction> &
  Pick<StealthPoolStatusResponse, "stealthPool"> & {
    exists?: boolean;
    ensureStealthPoolDelegatedTransaction?: UnsignedPaymentTransaction;
    updateStealthPoolTransaction?: UnsignedPaymentTransaction;
    setupTransaction?: UnsignedPaymentTransaction;
    transactions?: UnsignedPaymentTransaction[];
  };

function isUnsignedPaymentTransaction(
  value: unknown
): value is UnsignedPaymentTransaction {
  if (!value || typeof value !== "object") return false;

  const transaction = value as Partial<UnsignedPaymentTransaction>;
  return (
    typeof transaction.kind === "string" &&
    typeof transaction.transactionBase64 === "string" &&
    (transaction.sendTo === "base" || transaction.sendTo === "ephemeral") &&
    typeof transaction.recentBlockhash === "string" &&
    typeof transaction.lastValidBlockHeight === "number" &&
    Array.isArray(transaction.requiredSigners)
  );
}

function normalizeTransactionKind(transaction: UnsignedPaymentTransaction) {
  return transaction.kind.toLowerCase().replace(/[\s_-]/g, "");
}

function findTransactionByKind(
  transactions: UnsignedPaymentTransaction[] | undefined,
  kind: string
) {
  return transactions?.find((transaction) =>
    normalizeTransactionKind(transaction).includes(kind)
  );
}

function getStealthPoolSaveTransactions(response: StealthPoolBuildResponse) {
  const record = response as unknown as Record<string, unknown>;
  const ensureTransaction =
    response.ensureStealthPoolDelegatedTransaction ??
    (isUnsignedPaymentTransaction(record.ensureStealthPoolDelegated)
      ? record.ensureStealthPoolDelegated
      : undefined) ??
    (isUnsignedPaymentTransaction(record.ensureDelegatedTransaction)
      ? record.ensureDelegatedTransaction
      : undefined) ??
    (isUnsignedPaymentTransaction(record.ensureTransaction)
      ? record.ensureTransaction
      : undefined) ??
    response.setupTransaction ??
    (isUnsignedPaymentTransaction(record.baseTransaction)
      ? record.baseTransaction
      : undefined) ??
    findTransactionByKind(response.transactions, "ensurestealthpooldelegated");

  const updateTransaction =
    response.updateStealthPoolTransaction ??
    (isUnsignedPaymentTransaction(record.updateStealthPool)
      ? record.updateStealthPool
      : undefined) ??
    (isUnsignedPaymentTransaction(record.updateTransaction)
      ? record.updateTransaction
      : undefined) ??
    (isUnsignedPaymentTransaction(record.ephemeralTransaction)
      ? record.ephemeralTransaction
      : undefined) ??
    findTransactionByKind(response.transactions, "updatestealthpool") ??
    (isUnsignedPaymentTransaction(response) ? response : undefined);

  if (!ensureTransaction) {
    throw new Error("Backend did not return EnsureStealthPoolDelegated transaction");
  }
  if (!updateTransaction) {
    throw new Error("Backend did not return UpdateStealthPool transaction");
  }
  if (ensureTransaction.sendTo !== "base") {
    throw new Error("EnsureStealthPoolDelegated transaction must target base");
  }
  if (updateTransaction.sendTo !== "ephemeral") {
    throw new Error("UpdateStealthPool transaction must target ER");
  }

  return { ensureTransaction, updateTransaction };
}

function requireWalletSigner(
  transaction: UnsignedPaymentTransaction,
  owner: string,
  label: string
) {
  if (!transaction.requiredSigners.includes(owner)) {
    throw new Error(`Wallet is not listed as a required ${label} signer`);
  }
}

export function HandleCard() {
  const { connected, openConnectModal, publicKey, signMessage, signTransaction } =
    useUnifiedWallet();
  const owner = publicKey?.toBase58() ?? "";

  const [handle, setHandle] = useState("");
  const [destinations, setDestinations] = useState<string[]>([]);
  const [splitAcrossKeys, setSplitAcrossKeys] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [poolStatus, setPoolStatus] = useState<StealthPoolStatusResponse | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exactHandle = getExactStealthHandleInput(handle);
  const isValidHandle = isStealthHandleInput(exactHandle);
  const handleByteLength = getStealthHandleByteLength(exactHandle);

  const destinationErrors = useMemo(() => {
    return destinations.map((destination) => {
      try {
        new PublicKey(destination.trim());
        return null;
      } catch {
        return "Invalid owner key";
      }
    });
  }, [destinations]);

  const hasValidDestinations =
    destinations.length >= 1 &&
    destinations.length <= STEALTH_POOL_MAX_DESTINATIONS &&
    destinationErrors.every((destinationError) => destinationError === null);

  useEffect(() => {
    if (!owner) {
      setDestinations([]);
      return;
    }

    setHandle(getStoredStealthHandle(owner) ?? "");
    setDestinations([owner]);
    setPoolStatus(null);
    setSignature(null);
    setError(null);
    setStatus("idle");
  }, [owner]);

  const resetResultState = useCallback(() => {
    setPoolStatus(null);
    setSignature(null);
    setError(null);
    setStatus((currentStatus) =>
      currentStatus === "confirmed" || currentStatus === "error"
        ? "idle"
        : currentStatus
    );
  }, []);

  const checkPoolStatus = useCallback(async () => {
    if (!isValidHandle) return;

    setStatus("checking");
    setError(null);
    setPoolStatus(null);

    try {
      const res = await fetch(
        `/api/payments/stealth-pool?handle=${encodeURIComponent(exactHandle)}`,
        { cache: "no-store" }
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error || `Status check failed: ${res.status}`);
      }
      setPoolStatus(body as StealthPoolStatusResponse);
      setStatus("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Status check failed";
      setError(message);
      setStatus("error");
    }
  }, [exactHandle, isValidHandle]);

  const saveHandle = useCallback(async () => {
    if (!owner || !publicKey || !signTransaction || !signMessage || !connected) {
      return;
    }
    if (!isValidHandle || !hasValidDestinations) return;

    setError(null);
    setSignature(null);

    try {
      const getAuthToken = async () => {
        const storedToken = getStoredPrivateAuthToken(owner);
        if (storedToken) return storedToken;

        const challenge = await fetchSplChallenge(owner);
        const message = new TextEncoder().encode(challenge);
        const sigBytes = await signMessage(message);
        const token = await loginSplPrivate({
          pubkey: owner,
          challenge,
          signature: bs58.encode(sigBytes),
        });
        setStoredPrivateAuthToken(owner, token);
        return token;
      };

      let body: StealthPoolBuildResponse | null = null;
      let nextSignature = "";

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          setStatus("building");
          const authToken = await getAuthToken();

          const res = await fetch("/api/payments/stealth-pool", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({
              payer: owner,
              authority: owner,
              handle: exactHandle,
              destinations: destinations.map((destination) => destination.trim()),
              splitAcrossKeys,
            }),
          });
          const responseBody = await res.json().catch(() => null);
          if (!res.ok) {
            throw new Error(responseBody?.error || `Build failed: ${res.status}`);
          }

          const buildResponse = responseBody as StealthPoolBuildResponse;
          const { ensureTransaction, updateTransaction } =
            getStealthPoolSaveTransactions(buildResponse);
          console.log("Save handle stealth pool", {
            handle: exactHandle,
            stealthPool: buildResponse.stealthPool,
            ensureKind: ensureTransaction.kind,
            updateKind: updateTransaction.kind,
          });

          requireWalletSigner(ensureTransaction, owner, "ensure delegation");
          requireWalletSigner(updateTransaction, owner, "update pool");

          setStatus("signing");
          const setupTransaction = deserializeUnsignedPaymentTransaction(
            ensureTransaction
          );
          const signedSetupTransaction = await signTransaction(setupTransaction);
          const updatePoolTransaction =
            deserializeUnsignedPaymentTransaction(updateTransaction);
          const signedUpdatePoolTransaction =
            await signTransaction(updatePoolTransaction);

          setStatus("sending");
          const ensureSignature = await submitSignedPaymentTransaction(
            ensureTransaction,
            signedSetupTransaction
          );
          setSignature(ensureSignature);
          nextSignature = await submitSignedPaymentTransaction(
            updateTransaction,
            signedUpdatePoolTransaction,
            authToken
          );
          body = buildResponse;
          break;
        } catch (err) {
          if (
            err instanceof PaymentTransactionSubmissionError &&
            err.status === 401
          ) {
            clearStoredPrivateAuthToken(owner);
          }
          if (attempt === 0 && isPaymentBlockhashExpiredError(err)) {
            setSignature(null);
            continue;
          }

          throw err;
        }
      }

      if (!body) {
        throw new Error("Failed to save handle");
      }

      setStoredStealthHandle(owner, exactHandle);
      setSignature(nextSignature);
      setPoolStatus({
        stealthPool: body.stealthPool,
        exists: true,
      });
      setStatus("confirmed");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save handle";
      if (err instanceof PaymentTransactionSubmissionError && err.signature) {
        setSignature(err.signature);
      }
      if (message.includes("User rejected")) {
        setError("Transaction rejected by user");
      } else {
        setError(message);
      }
      setStatus("error");
    }
  }, [
    connected,
    destinations,
    exactHandle,
    hasValidDestinations,
    isValidHandle,
    owner,
    publicKey,
    signMessage,
    signTransaction,
    splitAcrossKeys,
  ]);

  const addDestination = useCallback(() => {
    if (destinations.length >= STEALTH_POOL_MAX_DESTINATIONS) return;
    setDestinations((current) => [...current, owner]);
    resetResultState();
  }, [destinations.length, owner, resetResultState]);

  const removeDestination = useCallback(
    (index: number) => {
      setDestinations((current) => current.filter((_, i) => i !== index));
      resetResultState();
    },
    [resetResultState]
  );

  const updateDestination = useCallback(
    (index: number, value: string) => {
      setDestinations((current) =>
        current.map((destination, i) => (i === index ? value : destination))
      );
      resetResultState();
    },
    [resetResultState]
  );

  const isBusy =
    status === "checking" ||
    status === "building" ||
    status === "signing" ||
    status === "sending";

  const saveLabel =
    status === "building"
      ? "Preparing..."
      : status === "signing"
        ? "Waiting for wallet..."
        : status === "sending"
          ? "Saving..."
          : "Save handle";

  return (
    <div className="w-full max-w-[480px] mx-auto">
      <div className="rounded-2xl bg-[var(--surface-container)] border border-border/40 shadow-xl shadow-black/30 overflow-hidden">
        <div className="mx-3 mt-3 mb-1">
          <div className="rounded-xl bg-[var(--surface-inner)] border border-border/50 p-4">
            <div className="text-xs text-muted-foreground mb-3">Stealth handle</div>
            <input
              type="text"
              value={handle}
              onChange={(event) => {
                setHandle(event.target.value);
                resetResultState();
              }}
              placeholder="e.g satoshi.block, nakamoto.block, etc"
              className="w-full bg-transparent font-mono text-lg text-foreground placeholder:text-muted-foreground/40 outline-none"
            />
            {handle && !isValidHandle && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3 w-3" />
                Use a lowercase .block handle up to {STEALTH_HANDLE_MAX_BYTES} bytes
              </div>
            )}
            {handleByteLength > STEALTH_HANDLE_MAX_BYTES && (
              <div className="mt-1 text-[11px] text-destructive/80">
                {handleByteLength}/{STEALTH_HANDLE_MAX_BYTES} bytes
              </div>
            )}
            {poolStatus && (
              <div className="mt-2 text-xs text-muted-foreground">
                {poolStatus.exists ? "Existing pool" : "New pool"}{" "}
                <span className="font-mono text-foreground">
                  {poolStatus.stealthPool.slice(0, 4)}...
                  {poolStatus.stealthPool.slice(-4)}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="mx-3 mt-2">
          <div className="rounded-xl bg-[var(--surface-inner)] border border-border/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-muted-foreground">
                  Backing owner keys
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {destinations.length}/{STEALTH_POOL_MAX_DESTINATIONS}
                </div>
              </div>
              <button
                type="button"
                onClick={addDestination}
                disabled={!owner || destinations.length >= STEALTH_POOL_MAX_DESTINATIONS}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Add backing owner key"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {destinations.map((destination, index) => (
                <div key={index} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={destination}
                      onChange={(event) =>
                        updateDestination(index, event.target.value)
                      }
                      className="min-w-0 flex-1 rounded-lg border border-border/40 bg-secondary/20 px-3 py-2 font-mono text-xs text-foreground outline-none transition-colors focus:border-border"
                    />
                    <button
                      type="button"
                      onClick={() => removeDestination(index)}
                      disabled={destinations.length <= 1}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground transition-colors hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Remove backing owner key"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {destinationErrors[index] && (
                    <div className="text-xs text-destructive">
                      {destinationErrors[index]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mx-3 mt-2">
          <div className="rounded-xl bg-secondary/30 px-4 py-3">
            <label className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">
                  Split across keys
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Let split payments rotate independently across backing keys.
                </div>
              </div>
              <input
                type="checkbox"
                checked={splitAcrossKeys}
                onChange={(event) => {
                  setSplitAcrossKeys(event.target.checked);
                  resetResultState();
                }}
                className="h-4 w-4 accent-primary"
              />
            </label>
          </div>
        </div>

        {error && (
          <div className="mx-3 mt-2 flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2">
            <span className="min-w-0 break-all text-xs text-destructive">
              {error}
            </span>
            {signature && (
              <a
                href={`/api/explorer/tx?signature=${encodeURIComponent(signature)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-xs text-destructive hover:underline"
              >
                View tx
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}

        {status === "confirmed" && signature && (
          <div className="mx-3 mt-2 flex items-center justify-between gap-3 rounded-lg border border-success/20 bg-success/10 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-success">
              <Check className="h-4 w-4" />
              Handle saved
            </div>
            <a
              href={`/api/explorer/tx?signature=${encodeURIComponent(signature)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-success hover:underline"
            >
              View tx
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        <div className="grid grid-cols-[auto_1fr] gap-2 p-3 pt-3">
          <button
            type="button"
            onClick={connected ? checkPoolStatus : openConnectModal}
            disabled={isBusy || (connected && !isValidHandle)}
            className="inline-flex items-center justify-center rounded-xl bg-secondary px-4 py-4 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "checking" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Check"
            )}
          </button>
          <button
            type="button"
            onClick={connected ? saveHandle : openConnectModal}
            disabled={
              connected &&
              (isBusy || !isValidHandle || !hasValidDestinations || !signMessage)
            }
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-4 text-base font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy && status !== "checking" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            {connected ? saveLabel : "Connect Wallet"}
          </button>
        </div>
      </div>
    </div>
  );
}
