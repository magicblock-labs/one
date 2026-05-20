"use client";

import bs58 from "bs58";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  type Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  Shield,
  ShieldCheck,
} from "lucide-react";
import { useUnifiedWallet } from "@/app/wallet/solana-wallet-provider";
import { useAggregatorTokens } from "@/hooks/use-aggregator-tokens";
import {
  PRIVATE_BALANCE_REFRESH_EVENT,
  dispatchPrivateBalanceRefresh,
} from "@/lib/private-balance-refresh";
import { PAYMENTS_DEFAULT_USDC_MINT } from "@/lib/payments";
import {
  clearStoredPrivateAuthToken,
  fetchPrivateBalance,
  fetchSplChallenge,
  formatBaseUnits,
  getStoredPrivateAuthToken,
  loginSplPrivate,
  PRIVATE_AUTH_TOKEN_EVENT,
  setStoredPrivateAuthToken,
} from "@/lib/spl-private-balance";
import {
  type AggregatorToken,
  FALLBACK_TOKENS,
  SOL_MINT,
  findTokenByMint,
} from "@/lib/tokens";
import { TokenSelectModal } from "./token-select-modal";

type ShieldMode = "shield" | "unshield";
type ShieldStatus =
  | "idle"
  | "building"
  | "signing"
  | "sending"
  | "confirmed"
  | "error";

interface UnsignedShieldTransaction {
  kind: string;
  version?: "legacy" | "v0" | 0 | "0";
  transactionBase64: string;
  sendTo: "base" | "ephemeral";
  recentBlockhash: string;
  lastValidBlockHeight: number;
  instructionCount: number;
  requiredSigners: string[];
  validator?: string;
}

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const TOKEN_PROGRAM_IDS = [
  new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
];
const SHIELD_AMOUNT_QUERY_PARAM = "shamt";
const SHIELD_MINT_QUERY_PARAM = "shmint";
const SPL_TOKEN_ACCOUNT_AMOUNT_OFFSET = 64;
const SPL_TOKEN_ACCOUNT_AMOUNT_LENGTH = 8;

function base64ToUint8Array(base64: string) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function deserializeUnsignedShieldTransaction(
  unsignedTransaction: UnsignedShieldTransaction
) {
  const transactionBytes = base64ToUint8Array(
    unsignedTransaction.transactionBase64
  );

  if (
    unsignedTransaction.version === undefined ||
    unsignedTransaction.version === null
  ) {
    try {
      return Transaction.from(transactionBytes);
    } catch {
      return VersionedTransaction.deserialize(transactionBytes);
    }
  }

  if (unsignedTransaction.version === "legacy") {
    return Transaction.from(transactionBytes);
  }

  if (
    unsignedTransaction.version === "v0" ||
    unsignedTransaction.version === 0 ||
    unsignedTransaction.version === "0"
  ) {
    return VersionedTransaction.deserialize(transactionBytes);
  }

  throw new Error(
    `Unsupported transaction version: ${unsignedTransaction.version}`
  );
}

function decimalAmountToBaseUnits(value: string, decimals: number) {
  if (!value.trim() || !/^\d*\.?\d*$/.test(value)) return null;

  const [wholePart, fractionPart = ""] = value.split(".");
  if (fractionPart.length > decimals) return null;

  const normalizedWholePart = wholePart || "0";
  const normalizedFractionPart = fractionPart.padEnd(decimals, "0");
  const combined = `${normalizedWholePart}${normalizedFractionPart}`.replace(
    /^0+(?=\d)/,
    ""
  );

  return combined || "0";
}

function getInitialShieldAmount(searchParams: ReadonlyURLSearchParams) {
  const amount = searchParams.get(SHIELD_AMOUNT_QUERY_PARAM)?.trim() ?? "";
  return /^\d*\.?\d*$/.test(amount) ? amount : "";
}

function getInitialShieldMint(searchParams: ReadonlyURLSearchParams) {
  const mint = searchParams.get(SHIELD_MINT_QUERY_PARAM)?.trim();
  if (!mint || mint === SOL_MINT) return PAYMENTS_DEFAULT_USDC_MINT;

  try {
    new PublicKey(mint);
    return mint;
  } catch {
    return PAYMENTS_DEFAULT_USDC_MINT;
  }
}

function getAssociatedTokenAccounts(owner: PublicKey, mint: PublicKey) {
  return TOKEN_PROGRAM_IDS.map(
    (tokenProgramId) =>
      PublicKey.findProgramAddressSync(
        [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      )[0]
  );
}

async function fetchTokenBalanceBaseUnits(
  connection: Connection,
  owner: PublicKey,
  tokenMint: string
) {
  if (tokenMint === SOL_MINT) {
    const lamports = await connection.getBalance(owner, "confirmed");
    return String(lamports);
  }

  const tokenAccounts = await connection.getTokenAccountsByOwner(
    owner,
    { mint: new PublicKey(tokenMint) },
    "confirmed"
  );

  return tokenAccounts.value
    .reduce((total, account) => {
      const data = account.account.data;
      if (
        data.byteLength <
        SPL_TOKEN_ACCOUNT_AMOUNT_OFFSET + SPL_TOKEN_ACCOUNT_AMOUNT_LENGTH
      ) {
        return total;
      }

      const amount = new DataView(
        data.buffer,
        data.byteOffset + SPL_TOKEN_ACCOUNT_AMOUNT_OFFSET,
        SPL_TOKEN_ACCOUNT_AMOUNT_LENGTH
      ).getBigUint64(0, true);

      return total + amount;
    }, BigInt(0))
    .toString();
}

function formatBalanceLabel(
  raw: string | null,
  decimals: number,
  symbol: string,
  isLoading: boolean,
  error: string | null,
  errorLabel = "Unavailable"
) {
  if (isLoading) return "...";
  if (error) return errorLabel;
  return `${formatBaseUnits(raw ?? "0", decimals)} ${symbol}`;
}

function getStatusLabel(status: ShieldStatus, mode: ShieldMode, symbol: string) {
  if (status === "building") return "Preparing transaction...";
  if (status === "signing") return "Confirm in wallet";
  if (status === "sending") return "Submitting transaction...";
  if (status === "confirmed") {
    return mode === "shield" ? `${symbol} shielded` : `${symbol} unshielded`;
  }
  return mode === "shield" ? `Shield ${symbol}` : `Unshield ${symbol}`;
}

export function ShieldCard() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { connection } = useConnection();
  const {
    connected,
    openConnectModal,
    publicKey,
    signMessage,
    signTransaction,
  } = useUnifiedWallet();
  const { tokens } = useAggregatorTokens();

  const owner = publicKey?.toBase58() ?? null;
  const [mode, setMode] = useState<ShieldMode>("shield");
  const [tokenMint, setTokenMint] = useState(() =>
    getInitialShieldMint(searchParams)
  );
  const [amount, setAmount] = useState(() =>
    getInitialShieldAmount(searchParams)
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [publicBalanceRaw, setPublicBalanceRaw] = useState<string | null>(null);
  const [privateBalanceRaw, setPrivateBalanceRaw] = useState<string | null>(null);
  const [publicBalanceLoading, setPublicBalanceLoading] = useState(false);
  const [privateBalanceLoading, setPrivateBalanceLoading] = useState(false);
  const [publicBalanceError, setPublicBalanceError] = useState<string | null>(null);
  const [privateBalanceError, setPrivateBalanceError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ShieldStatus>("idle");
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const balanceChangeUnsubscribeRef = useRef<(() => void) | null>(null);

  const defaultToken = useMemo(
    () => ({ ...FALLBACK_TOKENS[1], address: PAYMENTS_DEFAULT_USDC_MINT }),
    []
  );
  const selectedToken = useMemo(
    () => findTokenByMint(tokenMint, tokens) ?? defaultToken,
    [tokenMint, tokens, defaultToken]
  );
  const isBusy =
    status === "building" || status === "signing" || status === "sending";
  const sourceBalanceRaw =
    mode === "shield" ? publicBalanceRaw : privateBalanceRaw;

  const resetResultState = useCallback(() => {
    setError(null);
    setAmountError(null);
    setTxSignature(null);
    if (status === "confirmed" || status === "error") {
      setStatus("idle");
    }
  }, [status]);

  const loadPublicBalance = useCallback(async () => {
    if (!publicKey) {
      setPublicBalanceRaw(null);
      setPublicBalanceError(null);
      return;
    }

    setPublicBalanceLoading(true);
    setPublicBalanceError(null);
    try {
      const raw = await fetchTokenBalanceBaseUnits(
        connection,
        publicKey,
        tokenMint
      );
      setPublicBalanceRaw(raw);
    } catch {
      setPublicBalanceRaw(null);
      setPublicBalanceError("Failed to load wallet balance");
    } finally {
      setPublicBalanceLoading(false);
    }
  }, [connection, publicKey, tokenMint]);

  const loadPrivateBalance = useCallback(
    async (token: string) => {
      if (!owner) {
        setPrivateBalanceRaw(null);
        setPrivateBalanceError(null);
        return;
      }

      setPrivateBalanceLoading(true);
      setPrivateBalanceError(null);
      try {
        const row = await fetchPrivateBalance(owner, tokenMint, token);
        setPrivateBalanceRaw(row.balance);
      } catch (e) {
        setPrivateBalanceRaw(null);
        setPrivateBalanceError(
          e instanceof Error ? e.message : "Failed to load shielded balance"
        );
        clearStoredPrivateAuthToken(owner);
        setAuthToken(null);
      } finally {
        setPrivateBalanceLoading(false);
      }
    },
    [owner, tokenMint]
  );

  const refreshBalances = useCallback(() => {
    void loadPublicBalance();
    if (authToken) {
      void loadPrivateBalance(authToken);
    }
  }, [authToken, loadPrivateBalance, loadPublicBalance]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const shouldPersistMint = tokenMint !== PAYMENTS_DEFAULT_USDC_MINT;
    const nextMint = shouldPersistMint ? tokenMint : "";
    const currentAmount = params.get(SHIELD_AMOUNT_QUERY_PARAM) ?? "";
    const currentMint = params.get(SHIELD_MINT_QUERY_PARAM) ?? "";
    const currentTab = params.get("tab") ?? "";

    if (
      currentAmount === amount &&
      currentMint === nextMint &&
      currentTab === "shield"
    ) {
      return;
    }

    params.set("tab", "shield");

    if (amount) {
      params.set(SHIELD_AMOUNT_QUERY_PARAM, amount);
    } else {
      params.delete(SHIELD_AMOUNT_QUERY_PARAM);
    }

    if (nextMint) {
      params.set(SHIELD_MINT_QUERY_PARAM, nextMint);
    } else {
      params.delete(SHIELD_MINT_QUERY_PARAM);
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [amount, pathname, router, searchParams, tokenMint]);

  const subscribeOnceToWalletAtaChange = useCallback(() => {
    if (!publicKey || tokenMint === SOL_MINT) return;

    balanceChangeUnsubscribeRef.current?.();

    const mint = new PublicKey(tokenMint);
    const atas = getAssociatedTokenAccounts(publicKey, mint);
    const subscriptionIds: number[] = [];
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const unsubscribe = () => {
      if (closed) return;
      closed = true;

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      subscriptionIds.forEach((subscriptionId) => {
        void connection.removeAccountChangeListener(subscriptionId);
      });

      if (balanceChangeUnsubscribeRef.current === unsubscribe) {
        balanceChangeUnsubscribeRef.current = null;
      }
    };

    const onAccountChange = () => {
      if (closed) return;
      refreshBalances();
      unsubscribe();
    };

    atas.forEach((ata) => {
      subscriptionIds.push(
        connection.onAccountChange(ata, onAccountChange, "confirmed")
      );
    });

    timeoutId = setTimeout(unsubscribe, 30_000);
    balanceChangeUnsubscribeRef.current = unsubscribe;
  }, [connection, publicKey, refreshBalances, tokenMint]);

  useEffect(() => {
    if (!owner) {
      setAuthToken(null);
      setPrivateBalanceRaw(null);
      return;
    }

    const syncAuthToken = () => {
      setAuthToken(getStoredPrivateAuthToken(owner));
    };

    syncAuthToken();
    window.addEventListener(PRIVATE_AUTH_TOKEN_EVENT, syncAuthToken);
    window.addEventListener("storage", syncAuthToken);

    return () => {
      window.removeEventListener(PRIVATE_AUTH_TOKEN_EVENT, syncAuthToken);
      window.removeEventListener("storage", syncAuthToken);
    };
  }, [owner]);

  useEffect(() => {
    return () => {
      balanceChangeUnsubscribeRef.current?.();
      balanceChangeUnsubscribeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!connected || !publicKey) {
      setPublicBalanceRaw(null);
      setPublicBalanceError(null);
      return;
    }

    void loadPublicBalance();
  }, [connected, publicKey, loadPublicBalance, status]);

  useEffect(() => {
    if (!owner || !authToken) {
      setPrivateBalanceRaw(null);
      setPrivateBalanceError(null);
      return;
    }

    void loadPrivateBalance(authToken);
  }, [owner, authToken, loadPrivateBalance, status]);

  useEffect(() => {
    if (!authToken) return;

    const onRefresh = () => {
      void loadPrivateBalance(authToken);
    };
    window.addEventListener(PRIVATE_BALANCE_REFRESH_EVENT, onRefresh);
    return () =>
      window.removeEventListener(PRIVATE_BALANCE_REFRESH_EVENT, onRefresh);
  }, [authToken, loadPrivateBalance]);

  const signAndSendUnsignedTransaction = useCallback(
    async (
      unsignedTransaction: UnsignedShieldTransaction,
      onBeforeSend?: () => void
    ) => {
      if (!publicKey || !signTransaction || !connected) {
        throw new Error("Wallet not connected");
      }

      if (unsignedTransaction.sendTo !== "base") {
        throw new Error("Unsupported send target");
      }

      if (!unsignedTransaction.requiredSigners.includes(publicKey.toBase58())) {
        throw new Error("Wallet is not listed as a required signer");
      }

      const transaction = deserializeUnsignedShieldTransaction(
        unsignedTransaction
      );
      const signedTransaction = await signTransaction(transaction);

      onBeforeSend?.();

      const signature = await connection.sendRawTransaction(
        signedTransaction.serialize(),
        {
          skipPreflight: true,
          maxRetries: 10,
        }
      );

      subscribeOnceToWalletAtaChange();

      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: unsignedTransaction.recentBlockhash,
          lastValidBlockHeight: unsignedTransaction.lastValidBlockHeight,
        },
        "confirmed"
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed on-chain: ${signature}`);
      }

      return signature;
    },
    [
      publicKey,
      signTransaction,
      connected,
      connection,
      subscribeOnceToWalletAtaChange,
    ]
  );

  const handleAuthenticate = useCallback(async () => {
    if (!owner || !signMessage) return;

    setAuthBusy(true);
    setAuthError(null);
    try {
      const challenge = await fetchSplChallenge(owner);
      const message = new TextEncoder().encode(challenge);
      const sigBytes = await signMessage(message);
      const token = await loginSplPrivate({
        pubkey: owner,
        challenge,
        signature: bs58.encode(sigBytes),
      });
      setStoredPrivateAuthToken(owner, token);
      setAuthToken(token);
      await loadPrivateBalance(token);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setAuthBusy(false);
    }
  }, [owner, signMessage, loadPrivateBalance]);

  const handleModeChange = useCallback(
    (nextMode: ShieldMode) => {
      setMode(nextMode);
      resetResultState();
    },
    [resetResultState]
  );

  const handleTokenSelect = useCallback(
    (token: AggregatorToken) => {
      if (token.address === SOL_MINT) return;
      setTokenMint(token.address);
      resetResultState();
    },
    [resetResultState]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!connected || !publicKey || !signTransaction) {
        openConnectModal();
        return;
      }

      if (tokenMint === SOL_MINT) {
        setAmountError("Shield supports SPL tokens. Select USDC or another SPL token.");
        return;
      }

      if (mode === "unshield" && !authToken) {
        setAuthError("Authenticate to unshield from your shielded balance.");
        return;
      }

      const rawAmount = decimalAmountToBaseUnits(
        amount,
        selectedToken.decimals
      );
      if (!rawAmount || BigInt(rawAmount) <= BigInt(0)) {
        setAmountError("Enter an amount greater than 0.");
        return;
      }

      if (sourceBalanceRaw !== null && BigInt(rawAmount) > BigInt(sourceBalanceRaw)) {
        setAmountError(
          mode === "shield"
            ? "Amount exceeds wallet balance."
            : "Amount exceeds shielded balance."
        );
        return;
      }

      setStatus("building");
      setError(null);
      setAmountError(null);
      setTxSignature(null);

      try {
        const buildRes = await fetch("/api/payments/shield", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            owner: publicKey.toBase58(),
            mint: tokenMint,
            amount: rawAmount,
          }),
        });

        if (!buildRes.ok) {
          const errData = await buildRes.json().catch(() => ({}));
          throw new Error(errData.error || `Build failed: ${buildRes.status}`);
        }

        const unsignedTransaction =
          (await buildRes.json()) as UnsignedShieldTransaction;

        setStatus("signing");
        const signature = await signAndSendUnsignedTransaction(
          unsignedTransaction,
          () => setStatus("sending")
        );

        setTxSignature(signature);
        setStatus("confirmed");
        setAmount("");
        dispatchPrivateBalanceRefresh();
        void loadPublicBalance();
        if (authToken) {
          void loadPrivateBalance(authToken);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Shield action failed";
        setError(
          message.includes("User rejected")
            ? "Transaction rejected by user"
            : message
        );
        setStatus("error");
      }
    },
    [
      amount,
      authToken,
      connected,
      loadPrivateBalance,
      loadPublicBalance,
      mode,
      openConnectModal,
      publicKey,
      selectedToken.decimals,
      signAndSendUnsignedTransaction,
      signTransaction,
      sourceBalanceRaw,
      tokenMint,
    ]
  );

  const primaryLabel = connected
    ? getStatusLabel(status, mode, selectedToken.symbol)
    : "Connect wallet";
  const walletBalanceLabel = formatBalanceLabel(
    publicBalanceRaw,
    selectedToken.decimals,
    selectedToken.symbol,
    publicBalanceLoading,
    publicBalanceError
  );
  const privateBalanceLabel = authToken
    ? formatBalanceLabel(
        privateBalanceRaw,
        selectedToken.decimals,
        selectedToken.symbol,
        privateBalanceLoading,
        privateBalanceError,
        `${formatBaseUnits("0", selectedToken.decimals)} ${
          selectedToken.symbol
        }`
      )
    : "Authenticate";
  const sourceBalanceLabel =
    mode === "shield" ? walletBalanceLabel : privateBalanceLabel;
  const destinationLabel =
    mode === "shield" ? "Current private balance" : "Current wallet balance";
  const destinationBalanceLabel =
    mode === "shield" ? privateBalanceLabel : walletBalanceLabel;
  const needsPrivateBalance =
    mode === "unshield" &&
    (privateBalanceLoading ||
      privateBalanceRaw === null ||
      Boolean(privateBalanceError));
  const isPrimaryDisabled = connected
    ? isBusy ||
      (mode === "unshield" && !authToken) ||
      needsPrivateBalance ||
      Boolean(amountError) ||
      !amount.trim()
    : false;

  return (
    <>
      <div className="w-full max-w-[480px] mx-auto">
        <div className="rounded-2xl bg-[var(--surface-container)] border border-border/40 shadow-xl shadow-black/30 overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {mode === "shield" ? "Shield" : "Unshield"}
              </span>
            </div>
            <fieldset className="flex items-center gap-1 rounded-xl bg-secondary/70 p-1">
              <legend className="sr-only">Shield mode</legend>
              {(["shield", "unshield"] as const).map((nextMode) => (
                <button
                  key={nextMode}
                  type="button"
                  onClick={() => handleModeChange(nextMode)}
                  disabled={isBusy}
                  className={`min-h-9 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                    mode === nextMode
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {nextMode === "shield" ? "Shield" : "Unshield"}
                </button>
              ))}
            </fieldset>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3 px-3 pb-3">
            <div className="rounded-xl bg-[var(--surface-inner)] border border-border/50 p-4">
              <label
                htmlFor="shield-amount"
                className="block text-xs text-muted-foreground mb-3"
              >
                You send
              </label>
              <div className="flex items-center justify-between">
                <div>
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    disabled={isBusy}
                    className="flex min-h-10 items-center gap-2.5 rounded-xl bg-accent/60 px-3 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {selectedToken.logoURI ? (
                      <img
                        src={selectedToken.logoURI}
                        alt={selectedToken.symbol}
                        className="w-7 h-7 rounded-full"
                        crossOrigin="anonymous"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                        {selectedToken.symbol.charAt(0)}
                      </div>
                    )}
                    <span className="text-sm font-semibold text-foreground">
                      {selectedToken.symbol}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  <div className="mt-1 px-1 text-xs text-muted-foreground">
                    Balance: {sourceBalanceLabel}
                  </div>
                </div>
                <div className="text-right">
                  <input
                    id="shield-amount"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={amount}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (/^\d*\.?\d*$/.test(value)) {
                        setAmount(value);
                        resetResultState();
                      }
                    }}
                    aria-invalid={amountError ? "true" : undefined}
                    aria-describedby={
                      amountError ? "shield-amount-error" : undefined
                    }
                    placeholder="0.00"
                    className="w-32 bg-transparent text-right text-2xl font-light text-muted-foreground/50 placeholder:text-muted-foreground/30 outline-none focus:text-foreground"
                  />
                </div>
              </div>
              {amountError && (
                <p
                  id="shield-amount-error"
                  className="mt-3 flex items-center gap-1.5 text-xs text-destructive"
                >
                  <AlertTriangle className="w-3 h-3" />
                  {amountError}
                </p>
              )}
            </div>

            <div className="rounded-xl bg-[var(--surface-inner)] border border-border/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">
                    {destinationLabel}
                  </span>
                </div>
                <span className="font-mono text-sm tabular-nums text-foreground">
                  {destinationBalanceLabel}
                </span>
              </div>
            </div>

            {!authToken && (
              <button
                type="button"
                onClick={() => void handleAuthenticate()}
                disabled={!connected || !signMessage || authBusy}
                className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-border/50 bg-secondary/60 px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {authBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
                {!signMessage
                  ? "Message signing unavailable"
                  : authBusy
                    ? "Signing..."
                    : "Authenticate shielded balance"}
              </button>
            )}

            {authError && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="w-3 h-3" />
                {authError}
              </p>
            )}

            {error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                {error}
              </div>
            )}

            {status === "confirmed" && txSignature && (
              <div className="rounded-xl border border-success/30 bg-success/10 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-success">
                    <Check className="w-3.5 h-3.5" />
                    {mode === "shield" ? "Shielded" : "Unshielded"}{" "}
                    {selectedToken.symbol}
                  </div>
                  <a
                    href={`/api/explorer/tx?signature=${encodeURIComponent(
                      txSignature
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-success hover:underline"
                  >
                    View
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isPrimaryDisabled}
              aria-busy={isBusy}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBusy && <Loader2 className="w-4 h-4 animate-spin" />}
              {primaryLabel}
            </button>
          </form>
        </div>
      </div>

      <TokenSelectModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSelect={handleTokenSelect}
        disabledMint={SOL_MINT}
      />
    </>
  );
}
