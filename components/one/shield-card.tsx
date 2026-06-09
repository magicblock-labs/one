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
  type AccountInfo,
  Connection,
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
  sendRpcEndpoint?: string;
}

interface SignedShieldTransactionResponse {
  confirmationRequiresAuthToken?: boolean;
  confirmationRpcEndpoint?: string;
  error?: string;
  signature?: string;
}

interface EataValidatorMismatchFix {
  owner: string;
  mint: string;
  currentValidator?: string;
  selectedValidator?: string;
}

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const TOKEN_PROGRAM_IDS = [
  new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
];
const SHIELD_TOKEN_SELECTION_ENABLED = true;
const SHIELD_BALANCE_RECHECK_DELAY_MS = 2_500;
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

function uint8ArrayToBase64(bytes: Uint8Array) {
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return globalThis.btoa(binary);
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

function prepareShieldTransactionForSigning(
  transaction: Transaction | VersionedTransaction,
  recentBlockhash: string
) {
  if (transaction instanceof VersionedTransaction) {
    transaction.message.recentBlockhash = recentBlockhash;
    return;
  }

  transaction.recentBlockhash = recentBlockhash;
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
  if (!SHIELD_TOKEN_SELECTION_ENABLED) return PAYMENTS_DEFAULT_USDC_MINT;

  const mint = searchParams.get(SHIELD_MINT_QUERY_PARAM)?.trim();
  if (!mint) return PAYMENTS_DEFAULT_USDC_MINT;

  try {
    new PublicKey(mint);
    return mint;
  } catch {
    return PAYMENTS_DEFAULT_USDC_MINT;
  }
}

function shortenAddress(value: string) {
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function getStringField(record: Record<string, unknown>, field: string) {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value : null;
}

function getEataValidatorMismatchFix(
  responseBody: unknown,
  fallback?: Pick<EataValidatorMismatchFix, "owner" | "mint">
): EataValidatorMismatchFix | null {
  const localBody = getRecord(responseBody);
  if (!localBody) return null;

  const upstreamBody = getRecord(localBody.details) ?? localBody;
  const error = getRecord(upstreamBody.error);
  const errorMessage =
    getStringField(localBody, "error") ??
    getStringField(upstreamBody, "error") ??
    getStringField(upstreamBody, "message") ??
    getStringField(error ?? {}, "message") ??
    "";
  const normalizedErrorMessage = errorMessage.toLowerCase();
  const isValidatorMismatch =
    getStringField(error ?? {}, "code") === "EATA_VALIDATOR_MISMATCH" ||
    normalizedErrorMessage.includes("eata is delegated to a different validator") ||
    normalizedErrorMessage.includes("ephemeral ata is already delegated");
  if (!isValidatorMismatch) {
    return null;
  }

  const details = getRecord(error?.details);
  const accounts = Array.isArray(details?.accounts) ? details.accounts : [];
  const account =
    accounts
      .map(getRecord)
      .find(row => row && getStringField(row, "role") === "source")
    ?? accounts.map(getRecord).find(Boolean);

  const owner = account ? getStringField(account, "owner") : fallback?.owner;
  const mint = account ? getStringField(account, "mint") : fallback?.mint;
  if (!owner || !mint) return null;

  return {
    owner,
    mint,
    currentValidator: account
      ? getStringField(account, "currentValidator") ?? undefined
      : undefined,
    selectedValidator: account
      ? getStringField(account, "selectedValidator") ?? undefined
      : undefined,
  };
}

function getTransactionEataValidatorMismatchFix(
  error: unknown,
  fallback: Pick<EataValidatorMismatchFix, "owner" | "mint">
): EataValidatorMismatchFix | null {
  const record = getRecord(error);
  const instructionError = record?.InstructionError;
  if (!Array.isArray(instructionError)) return null;

  const instructionDetails = getRecord(instructionError[1]);
  const customError = instructionDetails?.Custom ?? instructionDetails?.custom;
  return customError === 7 ? fallback : null;
}

function formatEataValidatorMismatchMessage(fix: EataValidatorMismatchFix) {
  if (fix.currentValidator && fix.selectedValidator) {
    return `Shielded account is delegated to ${shortenAddress(fix.currentValidator)}, not ${shortenAddress(fix.selectedValidator)}.`;
  }

  return "Shielded account is delegated to another validator.";
}

function getAuthenticatedConfirmationWsEndpoint(
  rpcEndpoint: string,
  authToken: string
) {
  const wsEndpoint = new URL(rpcEndpoint);

  if (wsEndpoint.protocol === "https:") {
    wsEndpoint.protocol = "wss:";
  } else if (wsEndpoint.protocol === "http:") {
    wsEndpoint.protocol = "ws:";
  } else if (wsEndpoint.protocol !== "wss:" && wsEndpoint.protocol !== "ws:") {
    throw new Error("Unsupported confirmation RPC endpoint protocol");
  }

  wsEndpoint.searchParams.set("token", authToken);
  return wsEndpoint.toString();
}

function getErrorTransactionSignature(message: string | null) {
  if (!message) return null;

  const failedMatch = message.match(
    /^Transaction failed on-chain:\s*([1-9A-HJ-NP-Za-km-z]{64,})/
  );
  if (failedMatch) return failedMatch[1];

  const expiredMatch = message.match(
    /^Signature\s+([1-9A-HJ-NP-Za-km-z]{64,})\s+has expired:/
  );
  if (expiredMatch) return expiredMatch[1];

  return null;
}

function getErrorTransactionLabel(message: string | null) {
  const expiredMatch = message?.match(
    /^Signature\s+[1-9A-HJ-NP-Za-km-z]{64,}\s+has expired:\s*(.+)$/
  );
  if (expiredMatch) {
    return `Signature expired: ${expiredMatch[1]}`;
  }

  return "Transaction failed on-chain";
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

function readTokenAccountAmount(data: Uint8Array) {
  if (
    data.byteLength <
    SPL_TOKEN_ACCOUNT_AMOUNT_OFFSET + SPL_TOKEN_ACCOUNT_AMOUNT_LENGTH
  ) {
    return BigInt(0);
  }

  return new DataView(
    data.buffer,
    data.byteOffset + SPL_TOKEN_ACCOUNT_AMOUNT_OFFSET,
    SPL_TOKEN_ACCOUNT_AMOUNT_LENGTH
  ).getBigUint64(0, true);
}

async function fetchTokenBalanceBaseUnits(
  connection: Connection,
  owner: PublicKey,
  tokenMint: string
) {
  if (tokenMint === SOL_MINT) {
    const lamports = await connection.getBalance(owner, "processed");
    return String(lamports);
  }

  const tokenAccounts = await connection.getTokenAccountsByOwner(
    owner,
    { mint: new PublicKey(tokenMint) },
    "processed"
  );

  return tokenAccounts.value
    .reduce((total, account) => {
      return total + readTokenAccountAmount(account.account.data);
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
  const [validatorMismatchFix, setValidatorMismatchFix] =
    useState<EataValidatorMismatchFix | null>(null);
  const [isUndelegatingEata, setIsUndelegatingEata] = useState(false);
  const [undelegateEataError, setUndelegateEataError] = useState<string | null>(null);
  const [status, setStatus] = useState<ShieldStatus>("idle");
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const publicBalanceRequestIdRef = useRef(0);
  const loadPublicBalanceRef = useRef<() => Promise<void>>(async () => {});
  const balanceChangeUnsubscribeRef = useRef<(() => void) | null>(null);
  const publicBalanceRecheckTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const privateBalanceRecheckTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

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
    setValidatorMismatchFix(null);
    setUndelegateEataError(null);
    setTxSignature(null);
    if (status === "confirmed" || status === "error") {
      setStatus("idle");
    }
  }, [status]);

  const loadPublicBalance = useCallback(async () => {
    const requestId = publicBalanceRequestIdRef.current + 1;
    publicBalanceRequestIdRef.current = requestId;

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
      if (publicBalanceRequestIdRef.current !== requestId) return;
      setPublicBalanceRaw(raw);
    } catch {
      if (publicBalanceRequestIdRef.current !== requestId) return;
      setPublicBalanceRaw(null);
      setPublicBalanceError("Failed to load wallet balance");
    } finally {
      if (publicBalanceRequestIdRef.current !== requestId) return;
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
        const message =
          e instanceof Error ? e.message : "Failed to load shielded balance";
        const mismatchFix = getEataValidatorMismatchFix(
          { error: message },
          { owner, mint: tokenMint }
        );
        if (mismatchFix) {
          setValidatorMismatchFix(mismatchFix);
          setUndelegateEataError(null);
          setError(formatEataValidatorMismatchMessage(mismatchFix));
          setStatus("error");
        }
        setPrivateBalanceRaw(null);
        setPrivateBalanceError(mismatchFix ? null : message);
        clearStoredPrivateAuthToken(owner);
        setAuthToken(null);
      } finally {
        setPrivateBalanceLoading(false);
      }
    },
    [owner, tokenMint]
  );

  const refreshPrivateBalance = useCallback(() => {
    if (authToken) {
      void loadPrivateBalance(authToken);
    }
  }, [authToken, loadPrivateBalance]);

  useEffect(() => {
    loadPublicBalanceRef.current = loadPublicBalance;
  }, [loadPublicBalance]);

  const schedulePublicBalanceRecheck = useCallback(() => {
    if (publicBalanceRecheckTimeoutRef.current) {
      clearTimeout(publicBalanceRecheckTimeoutRef.current);
    }

    publicBalanceRecheckTimeoutRef.current = setTimeout(() => {
      publicBalanceRecheckTimeoutRef.current = null;
      void loadPublicBalanceRef.current();
    }, SHIELD_BALANCE_RECHECK_DELAY_MS);
  }, []);

  const schedulePrivateBalanceRecheck = useCallback(() => {
    if (privateBalanceRecheckTimeoutRef.current) {
      clearTimeout(privateBalanceRecheckTimeoutRef.current);
    }

    privateBalanceRecheckTimeoutRef.current = setTimeout(() => {
      privateBalanceRecheckTimeoutRef.current = null;
      dispatchPrivateBalanceRefresh();
    }, SHIELD_BALANCE_RECHECK_DELAY_MS);
  }, []);

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

  const subscribeOnceToWalletBalanceChange = useCallback(() => {
    if (!publicKey) return;

    balanceChangeUnsubscribeRef.current?.();

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

    const onAccountChange = (accountInfo: AccountInfo<Buffer>) => {
      if (closed) return;
      publicBalanceRequestIdRef.current += 1;
      setPublicBalanceError(null);
      setPublicBalanceLoading(false);
      setPublicBalanceRaw(
        tokenMint === SOL_MINT
          ? String(accountInfo.lamports)
          : readTokenAccountAmount(accountInfo.data).toString()
      );
      dispatchPrivateBalanceRefresh();
      unsubscribe();
    };

    const accounts =
      tokenMint === SOL_MINT
        ? [publicKey]
        : getAssociatedTokenAccounts(publicKey, new PublicKey(tokenMint));

    accounts.forEach((account) => {
      subscriptionIds.push(
        connection.onAccountChange(account, onAccountChange, "processed")
      );
    });

    timeoutId = setTimeout(unsubscribe, 30_000);
    balanceChangeUnsubscribeRef.current = unsubscribe;
  }, [connection, publicKey, tokenMint]);

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
      if (publicBalanceRecheckTimeoutRef.current) {
        clearTimeout(publicBalanceRecheckTimeoutRef.current);
        publicBalanceRecheckTimeoutRef.current = null;
      }
      if (privateBalanceRecheckTimeoutRef.current) {
        clearTimeout(privateBalanceRecheckTimeoutRef.current);
        privateBalanceRecheckTimeoutRef.current = null;
      }
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
    const onRefresh = () => {
      refreshPrivateBalance();
    };
    window.addEventListener(PRIVATE_BALANCE_REFRESH_EVENT, onRefresh);
    return () =>
      window.removeEventListener(PRIVATE_BALANCE_REFRESH_EVENT, onRefresh);
  }, [refreshPrivateBalance]);

  const signAndSendUnsignedTransaction = useCallback(
    async (
      unsignedTransaction: UnsignedShieldTransaction,
      onBeforeSend?: () => void,
      options?: { authToken?: string | null; submitViaPaymentsApi?: boolean }
    ) => {
      if (!publicKey || !signTransaction || !connected) {
        throw new Error("Wallet not connected");
      }

      const shouldSubmitViaPaymentsApi =
        options?.submitViaPaymentsApi ||
        unsignedTransaction.sendTo === "ephemeral";
      if (unsignedTransaction.sendTo !== "base" && !shouldSubmitViaPaymentsApi) {
        throw new Error("Unsupported send target");
      }

      if (!unsignedTransaction.requiredSigners.includes(publicKey.toBase58())) {
        throw new Error("Wallet is not listed as a required signer");
      }

      const transaction = deserializeUnsignedShieldTransaction(
        unsignedTransaction
      );
      if (shouldSubmitViaPaymentsApi) {
        prepareShieldTransactionForSigning(
          transaction,
          unsignedTransaction.recentBlockhash
        );
      }
      const signedTransaction = await signTransaction(transaction);

      if (!shouldSubmitViaPaymentsApi) {
        subscribeOnceToWalletBalanceChange();
      }
      onBeforeSend?.();

      if (shouldSubmitViaPaymentsApi) {
        const signedTransactionBase64 = uint8ArrayToBase64(
          signedTransaction.serialize()
        );
        const sendRes = await fetch("/api/payments/transaction/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(options?.authToken
              ? { Authorization: `Bearer ${options.authToken}` }
              : {}),
          },
          body: JSON.stringify({
            transactionBase64: signedTransactionBase64,
            sendTo: unsignedTransaction.sendTo,
            ...(unsignedTransaction.sendRpcEndpoint
              ? { sendRpcEndpoint: unsignedTransaction.sendRpcEndpoint }
              : {}),
          }),
        });

        const sendJson = (await sendRes.json().catch(
          () => ({})
        )) as SignedShieldTransactionResponse;
        if (!sendRes.ok) {
          const mismatchFix = getEataValidatorMismatchFix(sendJson, {
            owner: publicKey.toBase58(),
            mint: tokenMint,
          });
          if (mismatchFix) {
            setValidatorMismatchFix(mismatchFix);
            throw new Error(formatEataValidatorMismatchMessage(mismatchFix));
          }
          throw new Error(
            sendJson.error ? sendJson.error : `Send failed: ${sendRes.status}`
          );
        }
        if (!sendJson.signature) {
          throw new Error("Send response did not include a signature");
        }
        if (!sendJson.confirmationRpcEndpoint) {
          throw new Error("Send response did not include a confirmation RPC endpoint");
        }

        setTxSignature(sendJson.signature);
        const confirmationAuthToken = options?.authToken?.trim() ?? "";
        if (sendJson.confirmationRequiresAuthToken && !confirmationAuthToken) {
          throw new Error("Transaction confirmation requires authentication");
        }
        const shouldAuthenticateConfirmation =
          sendJson.confirmationRequiresAuthToken &&
          Boolean(confirmationAuthToken);
        const confirmationConnection = new Connection(
          sendJson.confirmationRpcEndpoint,
          {
            commitment: "confirmed",
            ...(shouldAuthenticateConfirmation
              ? {
                  wsEndpoint: getAuthenticatedConfirmationWsEndpoint(
                    sendJson.confirmationRpcEndpoint,
                    confirmationAuthToken
                  ),
                  httpHeaders: {
                    Authorization: `Bearer ${confirmationAuthToken}`,
                  },
                }
              : {}),
          }
        );
        const confirmation = await confirmationConnection.confirmTransaction(
          {
            signature: sendJson.signature,
            blockhash: unsignedTransaction.recentBlockhash,
            lastValidBlockHeight: unsignedTransaction.lastValidBlockHeight,
          },
          "confirmed"
        );

        if (confirmation.value.err) {
          const mismatchFix = getTransactionEataValidatorMismatchFix(
            confirmation.value.err,
            { owner: publicKey.toBase58(), mint: tokenMint }
          );
          if (mismatchFix) {
            setValidatorMismatchFix(mismatchFix);
            throw new Error(formatEataValidatorMismatchMessage(mismatchFix));
          }
          throw new Error(`Transaction failed on-chain: ${sendJson.signature}`);
        }

        return sendJson.signature;
      }

      const signature = await connection.sendRawTransaction(
        signedTransaction.serialize(),
        {
          skipPreflight: true,
          maxRetries: 10,
        }
      );

      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: unsignedTransaction.recentBlockhash,
          lastValidBlockHeight: unsignedTransaction.lastValidBlockHeight,
        },
        "confirmed"
      );

      if (confirmation.value.err) {
        const mismatchFix = getTransactionEataValidatorMismatchFix(
          confirmation.value.err,
          { owner: publicKey.toBase58(), mint: tokenMint }
        );
        if (mismatchFix) {
          setValidatorMismatchFix(mismatchFix);
          throw new Error(formatEataValidatorMismatchMessage(mismatchFix));
        }
        throw new Error(`Transaction failed on-chain: ${signature}`);
      }

      return signature;
    },
    [
      publicKey,
      signTransaction,
      connected,
      connection,
      subscribeOnceToWalletBalanceChange,
      tokenMint,
    ]
  );

  const authenticatePrivateAccess = useCallback(async () => {
    if (!owner || !signMessage) {
      throw new Error("Wallet does not support shielded authentication");
    }

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
    return token;
  }, [owner, signMessage]);

  const ensurePrivateAuthToken = useCallback(async () => {
    if (authToken) return authToken;
    return authenticatePrivateAccess();
  }, [authenticatePrivateAccess, authToken]);

  const handleAuthenticate = useCallback(async () => {
    if (!owner || !signMessage) return;

    setAuthBusy(true);
    setAuthError(null);
    try {
      const token = await authenticatePrivateAccess();
      await loadPrivateBalance(token);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setAuthBusy(false);
    }
  }, [authenticatePrivateAccess, loadPrivateBalance, owner, signMessage]);

  const handleModeChange = useCallback(
    (nextMode: ShieldMode) => {
      setMode(nextMode);
      resetResultState();
    },
    [resetResultState]
  );

  const handleTokenSelect = useCallback(
    (token: AggregatorToken) => {
      if (!SHIELD_TOKEN_SELECTION_ENABLED) return;

      setTokenMint(token.address);
      resetResultState();
    },
    [resetResultState]
  );

  const handleUndelegateEata = useCallback(async () => {
    if (!publicKey || !signTransaction || !connected || !validatorMismatchFix) {
      return;
    }

    setIsUndelegatingEata(true);
    setUndelegateEataError(null);
    setTxSignature(null);

    try {
      const token = await ensurePrivateAuthToken();
      const buildRes = await fetch("/api/payments/undelegate-ephemeral-ata", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          payer: validatorMismatchFix.owner,
          mint: validatorMismatchFix.mint,
        }),
      });

      const responseBody = await buildRes.json().catch(() => ({}));
      if (!buildRes.ok) {
        throw new Error(
          responseBody.error || `Undelegate failed: ${buildRes.status}`
        );
      }

      await signAndSendUnsignedTransaction(
        responseBody as UnsignedShieldTransaction,
        undefined,
        { authToken: token, submitViaPaymentsApi: true }
      );

      setValidatorMismatchFix(null);
      setError("Delegation fixed. Retry the shield action.");
      setStatus("error");
      dispatchPrivateBalanceRefresh();
      void loadPublicBalance();
      void loadPrivateBalance(token);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Undelegation failed";
      setUndelegateEataError(
        message.includes("User rejected")
          ? "Transaction rejected by user"
          : message
      );
    } finally {
      setIsUndelegatingEata(false);
    }
  }, [
    connected,
    ensurePrivateAuthToken,
    loadPrivateBalance,
    loadPublicBalance,
    publicKey,
    signAndSendUnsignedTransaction,
    signTransaction,
    validatorMismatchFix,
  ]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!connected || !publicKey || !signTransaction) {
        openConnectModal();
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
      setValidatorMismatchFix(null);
      setUndelegateEataError(null);
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
          const mismatchFix = getEataValidatorMismatchFix(errData, {
            owner: publicKey.toBase58(),
            mint: tokenMint,
          });
          if (mismatchFix) {
            setValidatorMismatchFix(mismatchFix);
            throw new Error(formatEataValidatorMismatchMessage(mismatchFix));
          }
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
          if (mode === "shield") {
            schedulePrivateBalanceRecheck();
          }
        }
        if (mode === "unshield") {
          schedulePublicBalanceRecheck();
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
      schedulePublicBalanceRecheck,
      schedulePrivateBalanceRecheck,
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
    mode === "shield" ? "Current shielded balance" : "Current wallet balance";
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
  const errorTransactionSignature = getErrorTransactionSignature(error);
  const errorTxSignature = txSignature ?? errorTransactionSignature;

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
                    onClick={() => {
                      if (SHIELD_TOKEN_SELECTION_ENABLED) {
                        setModalOpen(true);
                      }
                    }}
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
                    {SHIELD_TOKEN_SELECTION_ENABLED && (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
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
                <div className="flex items-center justify-between gap-3">
                  {errorTransactionSignature ? (
                    <a
                      href={`/api/explorer/tx?signature=${encodeURIComponent(errorTransactionSignature)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 inline-flex items-center gap-1 hover:underline"
                    >
                      <span>{getErrorTransactionLabel(error)}:</span>
                      <span className="font-mono">
                        {shortenAddress(errorTransactionSignature)}
                      </span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  ) : (
                    <span>{error}</span>
                  )}
                  {errorTxSignature && !errorTransactionSignature && (
                    <a
                      href={`/api/explorer/tx?signature=${encodeURIComponent(errorTxSignature)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 hover:underline"
                    >
                      View tx
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                {validatorMismatchFix && (
                  <div className="mt-2 flex flex-col gap-2 border-t border-destructive/15 pt-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-destructive/90">
                      Undelegate from the current validator, then retry.
                    </span>
                    <button
                      type="button"
                      onClick={handleUndelegateEata}
                      disabled={isUndelegatingEata}
                      className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-destructive/30 bg-background px-3 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isUndelegatingEata ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      )}
                      {isUndelegatingEata ? "Fixing..." : "Fix delegation"}
                    </button>
                  </div>
                )}
                {validatorMismatchFix && undelegateEataError && (
                  <div className="mt-2 text-destructive">
                    {undelegateEataError}
                  </div>
                )}
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
        open={SHIELD_TOKEN_SELECTION_ENABLED && modalOpen}
        onOpenChange={(open) => {
          if (SHIELD_TOKEN_SELECTION_ENABLED) {
            setModalOpen(open);
          }
        }}
        onSelect={handleTokenSelect}
      />
    </>
  );
}
