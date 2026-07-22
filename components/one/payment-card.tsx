"use client";

import bs58 from "bs58";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Loader2,
  ExternalLink,
  Check,
  CircleHelp,
  ChevronDown,
  Settings2,
  ShieldCheck,
  User,
  AlertTriangle,
} from "lucide-react";
import { useConnection } from "@solana/wallet-adapter-react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { getPrimaryDomain, resolve } from "@bonfida/spl-name-service";
import {
  type AggregatorToken,
  FALLBACK_TOKENS,
  SOL_MINT,
  findTokenByMint,
} from "@/lib/tokens";
import { usePrices } from "@/hooks/use-sol-price";
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
  MAX_PRIVATE_DELAY_MS,
  clampPrivateSplit,
  formatPrivateRoutingSummary,
} from "@/lib/private-routing";
import { PrivateRoutingControls } from "./private-routing-controls";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TokenSelectModal } from "./token-select-modal";
import { useUnifiedWallet } from "@/app/wallet/solana-wallet-provider";

type PaymentStatus =
  | "idle"
  | "building"
  | "signing"
  | "sending"
  | "confirmed"
  | "error";

type BalanceLocation = "base" | "ephemeral";

interface UnsignedPaymentTransaction {
  kind: string;
  version?: "legacy" | "v0" | 0 | "0";
  transactionBase64: string;
  sendTo: "base" | "ephemeral";
  from?: "base" | "ephemeral";
  recentBlockhash: string;
  lastValidBlockHeight: number;
  instructionCount: number;
  requiredSigners: string[];
  validator?: string;
  sendRpcEndpoint?: string;
}

interface SignedPaymentTransactionResponse {
  confirmationRequiresAuthToken?: boolean;
  confirmationRpcEndpoint?: string;
  error?: string;
  signature?: string;
}

interface MintInitializationResponse {
  initialized: boolean;
}

interface TokenBalance {
  raw: string;
  formatted: string;
}

interface EataValidatorMismatchFix {
  owner: string;
  mint: string;
  currentValidator?: string;
  selectedValidator?: string;
}

const SWAP_QUERY_PARAMS = ["buy", "sell", "amt"] as const;
const REQUEST_QUERY_PARAMS = ["prd", "ramt", "rmint"] as const;
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

function deserializeUnsignedPaymentTransaction(
  unsignedTransaction: UnsignedPaymentTransaction
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

function preparePaymentTransactionForSigning(
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

function getInitialPaymentMint(searchParams: ReadonlyURLSearchParams) {
  const mint = searchParams.get("mint")?.trim();
  return mint && findTokenByMint(mint) ? mint : PAYMENTS_DEFAULT_USDC_MINT;
}

function getInitialRecipientBalance(searchParams: ReadonlyURLSearchParams) {
  return searchParams.get("toBalance") === "ephemeral"
    ? "ephemeral"
    : "base";
}

function getInitialSourceBalance(searchParams: ReadonlyURLSearchParams) {
  return searchParams.get("fromBalance") === "ephemeral"
    ? "ephemeral"
    : "base";
}

function parseIntegerParam(
  value: string | null,
  fallback: number,
  min: number,
  max: number
) {
  if (!value || !/^\d+$/.test(value)) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;

  return Math.min(max, Math.max(min, parsed));
}

function getRecipientAddress(value: string) {
  if (!value) return null;

  try {
    return new PublicKey(value).toBase58();
  } catch {
    return null;
  }
}

function looksLikeDomain(value: string) {
  return value.includes(".") && !/\s/.test(value);
}

function formatDomainLabel(value: string) {
  return value.includes(".") ? value : `${value}.sol`;
}

function shortenAddress(value: string) {
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
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

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
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

  const isValidatorMismatch =
    getStringField(error ?? {}, "code") === "EATA_VALIDATOR_MISMATCH" ||
    errorMessage
      .toLowerCase()
      .includes("eata is delegated to a different validator");

  if (!isValidatorMismatch) {
    return null;
  }

  const details = getRecord(error?.details);
  const accounts = Array.isArray(details?.accounts) ? details.accounts : [];
  const account =
    accounts
      .map(getRecord)
      .find((row) => row && getStringField(row, "role") === "source") ??
    accounts.map(getRecord).find(Boolean);

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

function formatEataValidatorMismatchMessage(fix: EataValidatorMismatchFix) {
  if (fix.currentValidator && fix.selectedValidator) {
    return `Shielded account is delegated to ${shortenAddress(fix.currentValidator)}, not ${shortenAddress(fix.selectedValidator)}.`;
  }

  return "Shielded account is delegated to another validator.";
}

function isPrivateAuthFailure(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("auth") ||
    normalized.includes("unauthorized") ||
    normalized.includes("invalid token") ||
    normalized.includes("missing token") ||
    normalized.includes("access denied") ||
    normalized.includes("401") ||
    normalized.includes("403");
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

function getExplorerTransactionHref(
  signature: string,
  customRpcEndpoint?: string | null
) {
  const params = new URLSearchParams({ signature });

  if (customRpcEndpoint) {
    params.set("customUrl", customRpcEndpoint);
  }

  return `/api/explorer/tx?${params.toString()}`;
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

function formatTokenBalance(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";

  return value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 1_000 ? 2 : value >= 1 ? 4 : 6,
  });
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

function hasPositiveBaseUnits(raw: string | null) {
  if (!raw) return false;

  try {
    return BigInt(raw) > BigInt(0);
  } catch {
    return false;
  }
}

function isSameBaseUnitAmount(left: string | null, right: string | null) {
  if (!left || !right) return false;

  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
}

async function fetchTokenBalance(
  connection: Connection,
  owner: PublicKey,
  tokenMint: string,
  decimals: number
): Promise<TokenBalance> {
  if (tokenMint === SOL_MINT) {
    const lamports = await connection.getBalance(owner, "confirmed");
    return {
      raw: String(lamports),
      formatted: formatTokenBalance(lamports / Math.pow(10, decimals)),
    };
  }

  const tokenAccounts = await connection.getTokenAccountsByOwner(
    owner,
    { mint: new PublicKey(tokenMint) },
    "confirmed"
  );

  const rawAmount = tokenAccounts.value.reduce(
    (total, account) => total + readTokenAccountAmount(account.account.data),
    BigInt(0)
  );
  const uiAmount = Number(rawAmount) / Math.pow(10, decimals);

  return {
    raw: rawAmount.toString(),
    formatted: formatTokenBalance(uiAmount),
  };
}

async function fetchFormattedTokenBalance(
  connection: Connection,
  owner: PublicKey,
  tokenMint: string,
  decimals: number
) {
  return (await fetchTokenBalance(connection, owner, tokenMint, decimals))
    .formatted;
}

const TOKEN_PROGRAM_IDS = [
  new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
];

const DEFAULT_MIN_DELAY_MS = 3_000;
const DEFAULT_MAX_DELAY_MS = 30_000;

export function PaymentCard() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRecipientBalance = getInitialRecipientBalance(searchParams);
  const initialSourceBalance = getInitialSourceBalance(searchParams);
  const isInitiallyPrivate =
    initialSourceBalance === "ephemeral" ||
    initialRecipientBalance === "ephemeral" ||
    !searchParams.has("public");
  const searchMint = searchParams.get("mint")?.trim() ?? "";
  const initialMinDelayMs = isInitiallyPrivate
    ? parseIntegerParam(
        searchParams.get("min"),
        DEFAULT_MIN_DELAY_MS,
        0,
        MAX_PRIVATE_DELAY_MS
      )
    : 0;
  const initialMaxDelayMs = isInitiallyPrivate
    ? Math.max(
        initialMinDelayMs,
        parseIntegerParam(
          searchParams.get("max"),
          DEFAULT_MAX_DELAY_MS,
          0,
          MAX_PRIVATE_DELAY_MS
        )
      )
    : 0;
  const initialSplit = isInitiallyPrivate
    ? clampPrivateSplit(parseIntegerParam(searchParams.get("split"), 1, 1, 10))
    : 1;
  const initialGasless = searchParams.get("gasless") === "1";
  const { connection } = useConnection();
  const {
    connected,
    openConnectModal,
    publicKey,
    signMessage,
    signTransaction,
  } = useUnifiedWallet();
  const owner = publicKey?.toBase58() ?? null;

  const [tokenMint, setTokenMint] = useState(() =>
    getInitialPaymentMint(searchParams)
  );
  const [amount, setAmount] = useState("");
  const [receiver, setReceiver] = useState(() => searchParams.get("rcv") ?? "");
  const [memo, setMemo] = useState(() => searchParams.get("memo") ?? "");
  const [sourceBalance, setSourceBalance] =
    useState<BalanceLocation>(() => initialSourceBalance);
  const [recipientBalance, setRecipientBalance] =
    useState<BalanceLocation>(() => initialRecipientBalance);
  const [isPrivate, setIsPrivate] = useState(() => isInitiallyPrivate);
  const [isGasless, setIsGasless] = useState(() => initialGasless);
  const [minDelayMs, setMinDelayMs] = useState(() => initialMinDelayMs);
  const [maxDelayMs, setMaxDelayMs] = useState(() => initialMaxDelayMs);
  const [split, setSplit] = useState(() => initialSplit);
  const [exactOut, setExactOut] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(
    () => initialGasless || Boolean(searchParams.get("memo"))
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [resolvedDomainAddress, setResolvedDomainAddress] = useState<
    string | null
  >(null);
  const [recipientPrimaryDomain, setRecipientPrimaryDomain] = useState<
    string | null
  >(null);
  const [isResolvingRecipient, setIsResolvingRecipient] = useState(false);
  const [walletTokenBalance, setWalletTokenBalance] = useState<string | null>(
    null
  );
  const [walletTokenBalanceRaw, setWalletTokenBalanceRaw] = useState<
    string | null
  >(null);
  const [isWalletTokenBalanceLoading, setIsWalletTokenBalanceLoading] =
    useState(false);
  const [privateAuthToken, setPrivateAuthToken] = useState<string | null>(null);
  const [privateBalanceRaw, setPrivateBalanceRaw] = useState<string | null>(
    null
  );
  const [isPrivateBalanceLoading, setIsPrivateBalanceLoading] = useState(false);
  const [privateBalanceError, setPrivateBalanceError] = useState<string | null>(
    null
  );
  const [privateAuthBusy, setPrivateAuthBusy] = useState(false);
  const [privateAuthChecked, setPrivateAuthChecked] = useState(false);
  const [privateAuthError, setPrivateAuthError] = useState<string | null>(null);
  const [walletSolLamports, setWalletSolLamports] = useState<number | null>(
    null
  );
  const [recipientTokenBalance, setRecipientTokenBalance] = useState<
    string | null
  >(null);
  const [
    isRecipientTokenBalanceLoading,
    setIsRecipientTokenBalanceLoading,
  ] = useState(false);
  const [isMintInitialized, setIsMintInitialized] = useState<boolean | null>(
    null
  );
  const [isMintInitializationLoading, setIsMintInitializationLoading] =
    useState(false);
  const [isSettingUpMint, setIsSettingUpMint] = useState(false);
  const [mintSetupError, setMintSetupError] = useState<string | null>(null);

  const [status, setStatus] = useState<PaymentStatus>("idle");
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [txExplorerRpcEndpoint, setTxExplorerRpcEndpoint] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [validatorMismatchFix, setValidatorMismatchFix] =
    useState<EataValidatorMismatchFix | null>(null);
  const [isUndelegatingEata, setIsUndelegatingEata] = useState(false);
  const [undelegateEataError, setUndelegateEataError] = useState<string | null>(
    null
  );

  const gaslessAutoOptOutRef = useRef(false);

  const { tokens } = useAggregatorTokens();

  const defaultPaymentToken = useMemo(
    () => ({ ...FALLBACK_TOKENS[1], address: PAYMENTS_DEFAULT_USDC_MINT }),
    []
  );

  const selectedToken = useMemo(
    () => findTokenByMint(tokenMint, tokens) ?? defaultPaymentToken,
    [tokenMint, tokens, defaultPaymentToken]
  );

  const { prices } = usePrices([tokenMint]);
  const tokenPrice = prices[tokenMint]?.usd ?? 0;

  const amountUsd = useMemo(() => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return 0;
    return amt * tokenPrice;
  }, [amount, tokenPrice]);

  const rawAmount = useMemo(
    () => decimalAmountToBaseUnits(amount, selectedToken.decimals),
    [amount, selectedToken.decimals]
  );

  const trimmedReceiver = receiver.trim();
  const directReceiverAddress = useMemo(
    () => getRecipientAddress(trimmedReceiver),
    [trimmedReceiver]
  );
  const isDomainReceiver = Boolean(
    trimmedReceiver && !directReceiverAddress && looksLikeDomain(trimmedReceiver)
  );
  const resolvedReceiver = directReceiverAddress ?? resolvedDomainAddress;

  const isValidReceiver = useMemo(() => {
    return Boolean(resolvedReceiver);
  }, [resolvedReceiver]);

  const routingSummary = useMemo(() => {
    return formatPrivateRoutingSummary(split, minDelayMs, maxDelayMs);
  }, [split, minDelayMs, maxDelayMs]);

  const isGaslessDisabledForSource = sourceBalance === "ephemeral";
  const effectiveGasless = isGasless && !isGaslessDisabledForSource;

  const resetResultState = useCallback(() => {
    setStatus((currentStatus) => {
      if (currentStatus !== "confirmed" && currentStatus !== "error") {
        return currentStatus;
      }

      return "idle";
    });
    setError(null);
    setValidatorMismatchFix(null);
    setUndelegateEataError(null);
    setTxSignature(null);
    setTxExplorerRpcEndpoint(null);
  }, []);

  useEffect(() => {
    if (!searchMint) return;

    const nextMint = findTokenByMint(searchMint, tokens)?.address;
    if (!nextMint) return;

    setTokenMint((currentMint: string) =>
      currentMint === nextMint ? currentMint : nextMint
    );
  }, [searchMint, tokens]);

  useEffect(() => {
    let cancelled = false;

    setResolvedDomainAddress(null);

    if (!trimmedReceiver || directReceiverAddress || !isDomainReceiver) {
      setIsResolvingRecipient(false);
      return () => {
        cancelled = true;
      };
    }

    setIsResolvingRecipient(true);

    void resolve(connection, trimmedReceiver.toLowerCase())
      .then((publicKey) => {
        if (cancelled) return;
        setResolvedDomainAddress(publicKey.toBase58());
      })
      .catch(() => {
        if (cancelled) return;
      })
      .finally(() => {
        if (cancelled) return;
        setIsResolvingRecipient(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connection, trimmedReceiver, directReceiverAddress, isDomainReceiver]);

  useEffect(() => {
    let cancelled = false;

    setRecipientPrimaryDomain(null);

    if (!directReceiverAddress) {
      return () => {
        cancelled = true;
      };
    }

    void getPrimaryDomain(connection, new PublicKey(directReceiverAddress))
      .then((result) => {
        if (cancelled || result.stale) return;
        setRecipientPrimaryDomain(formatDomainLabel(result.reverse));
      })
      .catch(() => {
        if (cancelled) return;
      });

    return () => {
      cancelled = true;
    };
  }, [connection, directReceiverAddress]);

  useEffect(() => {
    let cancelled = false;

    if (!connected || !publicKey) {
      setWalletSolLamports(null);
      return () => {
        cancelled = true;
      };
    }

    const refreshWalletSolBalance = async () => {
      try {
        const lamports = await connection.getBalance(publicKey, "confirmed");
        if (cancelled) return;
        setWalletSolLamports(lamports);
      } catch {
        if (cancelled) return;
        setWalletSolLamports(null);
      }
    };

    void refreshWalletSolBalance();

    const subscriptionId = connection.onAccountChange(
      publicKey,
      (accountInfo) => {
        if (cancelled) return;
        setWalletSolLamports(accountInfo.lamports);
      },
      "confirmed"
    );

    return () => {
      cancelled = true;
      void connection.removeAccountChangeListener(subscriptionId);
    };
  }, [connection, connected, publicKey]);

  useEffect(() => {
    if (isGaslessDisabledForSource) {
      gaslessAutoOptOutRef.current = false;
      return;
    }

    if (walletSolLamports === null || walletSolLamports > 0) {
      gaslessAutoOptOutRef.current = false;
      return;
    }

    if (walletSolLamports === 0 && !isGasless && !gaslessAutoOptOutRef.current) {
      setIsGasless(true);
      setAdvancedOpen(true);
    }
  }, [walletSolLamports, isGasless, isGaslessDisabledForSource]);

  useEffect(() => {
    if (!isGaslessDisabledForSource || !isGasless) return;

    gaslessAutoOptOutRef.current = false;
    setIsGasless(false);
  }, [isGasless, isGaslessDisabledForSource]);

  useEffect(() => {
    gaslessAutoOptOutRef.current = false;
  }, [publicKey?.toBase58()]);

  useEffect(() => {
    let cancelled = false;

    if (!connected || !publicKey) {
      setWalletTokenBalance(null);
      setWalletTokenBalanceRaw(null);
      setIsWalletTokenBalanceLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsWalletTokenBalanceLoading(true);

    const fetchWalletTokenBalance = async () => {
      try {
        const nextBalance = await fetchTokenBalance(
          connection,
          publicKey,
          tokenMint,
          selectedToken.decimals
        );
        if (cancelled) return;
        setWalletTokenBalance(nextBalance.formatted);
        setWalletTokenBalanceRaw(nextBalance.raw);
      } catch {
        if (cancelled) return;
        setWalletTokenBalance(null);
        setWalletTokenBalanceRaw(null);
      } finally {
        if (cancelled) return;
        setIsWalletTokenBalanceLoading(false);
      }
    };

    void fetchWalletTokenBalance();

    return () => {
      cancelled = true;
    };
  }, [connection, connected, publicKey, tokenMint, selectedToken.decimals, status]);

  const loadPrivateBalance = useCallback(
    async (token: string) => {
      if (!owner) {
        setPrivateBalanceRaw(null);
        setPrivateBalanceError(null);
        setIsPrivateBalanceLoading(false);
        return;
      }

      setIsPrivateBalanceLoading(true);
      setPrivateBalanceError(null);
      try {
        const row = await fetchPrivateBalance(owner, tokenMint, token);
        setPrivateBalanceRaw(row.balance);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load shielded balance";
        const mismatchFix = getEataValidatorMismatchFix(
          { error: message },
          { owner, mint: tokenMint }
        );
        if (mismatchFix) {
          setValidatorMismatchFix(mismatchFix);
          setUndelegateEataError(null);
          setError(formatEataValidatorMismatchMessage(mismatchFix));
          setStatus("error");
        } else if (isPrivateAuthFailure(message)) {
          clearStoredPrivateAuthToken(owner);
          setPrivateAuthToken(null);
        }
        setPrivateBalanceRaw(null);
        setPrivateBalanceError(mismatchFix ? null : message);
        setSourceBalance("base");
      } finally {
        setIsPrivateBalanceLoading(false);
      }
    },
    [owner, tokenMint]
  );

  useEffect(() => {
    if (!owner) {
      setPrivateAuthChecked(false);
      setPrivateAuthToken(null);
      setPrivateBalanceRaw(null);
      setPrivateBalanceError(null);
      return;
    }

    const syncAuthToken = () => {
      setPrivateAuthToken(getStoredPrivateAuthToken(owner));
      setPrivateAuthChecked(true);
    };

    setPrivateAuthChecked(false);
    syncAuthToken();
    window.addEventListener(PRIVATE_AUTH_TOKEN_EVENT, syncAuthToken);
    window.addEventListener("storage", syncAuthToken);

    return () => {
      window.removeEventListener(PRIVATE_AUTH_TOKEN_EVENT, syncAuthToken);
      window.removeEventListener("storage", syncAuthToken);
    };
  }, [owner]);

  useEffect(() => {
    if (!owner || !privateAuthToken) {
      setPrivateBalanceRaw(null);
      setPrivateBalanceError(null);
      setIsPrivateBalanceLoading(false);
      return;
    }

    void loadPrivateBalance(privateAuthToken);
  }, [owner, privateAuthToken, loadPrivateBalance, status]);

  useEffect(() => {
    if (!privateAuthToken) return;

    const onRefresh = () => {
      void loadPrivateBalance(privateAuthToken);
    };

    window.addEventListener(PRIVATE_BALANCE_REFRESH_EVENT, onRefresh);
    return () =>
      window.removeEventListener(PRIVATE_BALANCE_REFRESH_EVENT, onRefresh);
  }, [privateAuthToken, loadPrivateBalance]);

  useEffect(() => {
    let cancelled = false;

    if (!resolvedReceiver || isResolvingRecipient) {
      setRecipientTokenBalance(null);
      setIsRecipientTokenBalanceLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsRecipientTokenBalanceLoading(true);
    const recipientPublicKey = new PublicKey(resolvedReceiver);

    const refreshRecipientTokenBalance = async () => {
      try {
        const nextBalance = await fetchFormattedTokenBalance(
          connection,
          recipientPublicKey,
          tokenMint,
          selectedToken.decimals
        );
        if (cancelled) return;
        setRecipientTokenBalance(nextBalance);
      } catch {
        if (cancelled) return;
        setRecipientTokenBalance(null);
      } finally {
        if (cancelled) return;
        setIsRecipientTokenBalanceLoading(false);
      }
    };

    void refreshRecipientTokenBalance();

    if (tokenMint === SOL_MINT) {
      const subscriptionId = connection.onAccountChange(
        recipientPublicKey,
        () => {
          void refreshRecipientTokenBalance();
        },
        "confirmed"
      );

      return () => {
        cancelled = true;
        void connection.removeAccountChangeListener(subscriptionId);
      };
    }

    const subscriptionIds = TOKEN_PROGRAM_IDS.map((programId) =>
      connection.onProgramAccountChange(
        programId,
        () => {
          void refreshRecipientTokenBalance();
        },
        {
          commitment: "confirmed",
          filters: [
            { memcmp: { offset: 0, bytes: tokenMint } },
            { memcmp: { offset: 32, bytes: resolvedReceiver } },
          ],
        }
      )
    );

    return () => {
      cancelled = true;
      subscriptionIds.forEach((subscriptionId) => {
        void connection.removeProgramAccountChangeListener(subscriptionId);
      });
    };
  }, [
    connection,
    resolvedReceiver,
    isResolvingRecipient,
    tokenMint,
    selectedToken.decimals,
  ]);

  useEffect(() => {
    const controller = new AbortController();

    setIsMintInitializationLoading(true);
    setIsMintInitialized(null);
    setMintSetupError(null);

    void fetch(`/api/payments/mint?mint=${encodeURIComponent(tokenMint)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Mint check failed: ${response.status}`);
        }

        const data = (await response.json()) as MintInitializationResponse;
        setIsMintInitialized(Boolean(data.initialized));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setIsMintInitialized(null);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setIsMintInitializationLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [tokenMint]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const shouldPersistMint = tokenMint !== PAYMENTS_DEFAULT_USDC_MINT;
    const shouldPersistRoutingParams =
      isPrivate && (minDelayMs !== 0 || maxDelayMs !== 0 || split !== 1);
    const nextMint = shouldPersistMint ? tokenMint : "";
    const currentReceiver = params.get("rcv") ?? "";
    const currentMint = params.get("mint") ?? "";
    const currentMemo = params.get("memo") ?? "";
    const currentFromBalance = params.get("fromBalance") ?? "";
    const currentToBalance = params.get("toBalance") ?? "";
    const currentPublic = params.has("public");
    const currentMinDelayMs = params.get("min") ?? "";
    const currentMaxDelayMs = params.get("max") ?? "";
    const currentSplit = params.get("split") ?? "";
    const currentGasless = params.get("gasless") ?? "";
    const currentTab = params.get("tab") ?? "";
    const nextMinDelayMs = shouldPersistRoutingParams ? String(minDelayMs) : "";
    const nextMaxDelayMs = shouldPersistRoutingParams ? String(maxDelayMs) : "";
    const nextSplit = shouldPersistRoutingParams ? String(split) : "";
    const nextGasless = effectiveGasless ? "1" : "";
    const nextFromBalance =
      sourceBalance === "ephemeral" ? "ephemeral" : "";
    const nextToBalance =
      recipientBalance === "ephemeral" ? "ephemeral" : "";
    const hasForeignParams =
      SWAP_QUERY_PARAMS.some((key) => params.has(key)) ||
      REQUEST_QUERY_PARAMS.some((key) => params.has(key));

    if (
      currentReceiver === receiver &&
      currentMint === nextMint &&
      currentMemo === memo &&
      currentFromBalance === nextFromBalance &&
      currentToBalance === nextToBalance &&
      currentPublic === !isPrivate &&
      currentMinDelayMs === nextMinDelayMs &&
      currentMaxDelayMs === nextMaxDelayMs &&
      currentSplit === nextSplit &&
      currentGasless === nextGasless &&
      !currentTab &&
      !hasForeignParams
    ) {
      return;
    }

    SWAP_QUERY_PARAMS.forEach((key) => params.delete(key));
    REQUEST_QUERY_PARAMS.forEach((key) => params.delete(key));
    params.delete("tab");

    if (receiver) {
      params.set("rcv", receiver);
    } else {
      params.delete("rcv");
    }

    if (nextMint) {
      params.set("mint", nextMint);
    } else {
      params.delete("mint");
    }

    if (memo) {
      params.set("memo", memo);
    } else {
      params.delete("memo");
    }

    if (nextToBalance) {
      params.set("toBalance", nextToBalance);
    } else {
      params.delete("toBalance");
    }

    if (nextFromBalance) {
      params.set("fromBalance", nextFromBalance);
    } else {
      params.delete("fromBalance");
    }

    if (!isPrivate) {
      params.set("public", "true");
    } else {
      params.delete("public");
    }

    if (shouldPersistRoutingParams) {
      params.set("min", String(minDelayMs));
      params.set("max", String(maxDelayMs));
      params.set("split", String(split));
    } else {
      params.delete("min");
      params.delete("max");
      params.delete("split");
    }

    if (effectiveGasless) {
      params.set("gasless", "1");
    } else {
      params.delete("gasless");
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [
    receiver,
    tokenMint,
    memo,
    sourceBalance,
    recipientBalance,
    isPrivate,
    effectiveGasless,
    minDelayMs,
    maxDelayMs,
    split,
    pathname,
    router,
    searchParams,
  ]);

  const handleTokenSelect = useCallback(
    (token: AggregatorToken) => {
      resetResultState();
      setTokenMint(token.address);
    },
    [resetResultState]
  );

  const handleDelayRangeChange = useCallback(
    (values: number[]) => {
      const [nextMin = 0, nextMax = nextMin] = values;
      resetResultState();
      setMinDelayMs(Math.min(MAX_PRIVATE_DELAY_MS, Math.max(0, nextMin)));
      setMaxDelayMs(Math.min(MAX_PRIVATE_DELAY_MS, Math.max(0, nextMax)));
    },
    [resetResultState]
  );

  const handleSplitChange = useCallback(
    (nextSplit: number) => {
      resetResultState();
      setSplit(clampPrivateSplit(nextSplit));
    },
    [resetResultState]
  );

  const handleGaslessChange = useCallback(
    (checked: boolean) => {
      if (isGaslessDisabledForSource) {
        gaslessAutoOptOutRef.current = false;
        setIsGasless(false);
        return;
      }

      resetResultState();
      gaslessAutoOptOutRef.current = walletSolLamports === 0 && !checked;
      setIsGasless(checked);
    },
    [isGaslessDisabledForSource, resetResultState, walletSolLamports]
  );

  const ensurePrivateRoutingDefaults = useCallback(() => {
    if (minDelayMs === 0 && maxDelayMs === 0) {
      setMinDelayMs(DEFAULT_MIN_DELAY_MS);
      setMaxDelayMs(DEFAULT_MAX_DELAY_MS);
    }
  }, [maxDelayMs, minDelayMs]);

  const handlePrivateRoutingChange = useCallback(
    (enabled: boolean) => {
      resetResultState();
      if (!enabled && recipientBalance === "ephemeral") {
        setRecipientBalance("base");
      }
      if (!enabled && sourceBalance === "ephemeral") {
        setSourceBalance("base");
      }
      if (enabled) {
        ensurePrivateRoutingDefaults();
      }
      setIsPrivate(enabled);
    },
    [
      ensurePrivateRoutingDefaults,
      recipientBalance,
      resetResultState,
      sourceBalance,
    ]
  );

  const handleSourceBalanceChange = useCallback(
    (nextBalance: BalanceLocation) => {
      resetResultState();
      setSourceBalance(nextBalance);
      if (nextBalance === "ephemeral") {
        gaslessAutoOptOutRef.current = false;
        setIsGasless(false);
        setIsPrivate(true);
      }
    },
    [resetResultState]
  );

  const handleRecipientBalanceChange = useCallback(
    (nextBalance: BalanceLocation) => {
      resetResultState();
      setRecipientBalance(nextBalance);
      if (nextBalance === "ephemeral") {
        ensurePrivateRoutingDefaults();
        setIsPrivate(true);
      }
    },
    [ensurePrivateRoutingDefaults, resetResultState]
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
    setPrivateAuthToken(token);
    return token;
  }, [owner, signMessage]);

  const ensurePrivateAuthToken = useCallback(async () => {
    if (privateAuthToken) return privateAuthToken;
    return authenticatePrivateAccess();
  }, [authenticatePrivateAccess, privateAuthToken]);

  const handlePrivateBalanceAuthenticate = useCallback(async () => {
    if (!owner || !signMessage) return;

    setPrivateAuthBusy(true);
    setPrivateAuthError(null);
    try {
      const token = await authenticatePrivateAccess();
      await loadPrivateBalance(token);
    } catch (error) {
      setPrivateAuthError(
        error instanceof Error ? error.message : "Authentication failed"
      );
    } finally {
      setPrivateAuthBusy(false);
    }
  }, [authenticatePrivateAccess, loadPrivateBalance, owner, signMessage]);

  const sourceBalanceRaw =
    sourceBalance === "ephemeral" ? privateBalanceRaw : walletTokenBalanceRaw;
  const isSendingMaxSourceBalance =
    hasPositiveBaseUnits(rawAmount) &&
    isSameBaseUnitAmount(rawAmount, sourceBalanceRaw);
  const effectiveExactOut = isSendingMaxSourceBalance ? false : exactOut;

  useEffect(() => {
    if (!isSendingMaxSourceBalance || !exactOut) return;

    resetResultState();
    setExactOut(false);
  }, [exactOut, isSendingMaxSourceBalance, resetResultState]);

  const signAndSendUnsignedTransaction = useCallback(
    async (
      unsignedTransaction: UnsignedPaymentTransaction,
      onBeforeSend?: () => void,
      options?: { authToken?: string | null; submitViaPaymentsApi?: boolean }
    ) => {
      if (!publicKey || !signTransaction || !connected) {
        throw new Error("Wallet not connected");
      }

      if (!unsignedTransaction.requiredSigners.includes(publicKey.toBase58())) {
        throw new Error("Wallet is not listed as a required signer");
      }

      const shouldSubmitViaPaymentsApi =
        options?.submitViaPaymentsApi ||
        unsignedTransaction.sendTo === "ephemeral";
      const transaction =
        deserializeUnsignedPaymentTransaction(unsignedTransaction);

      if (shouldSubmitViaPaymentsApi) {
        preparePaymentTransactionForSigning(
          transaction,
          unsignedTransaction.recentBlockhash
        );
      }

      const signedTransaction = await signTransaction(transaction);

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
        )) as SignedPaymentTransactionResponse;

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
          throw new Error(
            "Send response did not include a confirmation RPC endpoint"
          );
        }

        setTxSignature(sendJson.signature);
        setTxExplorerRpcEndpoint(sendJson.confirmationRpcEndpoint);

        const confirmationAuthToken = options?.authToken?.trim() ?? "";
        if (sendJson.confirmationRequiresAuthToken && !confirmationAuthToken) {
          throw new Error("Transaction confirmation requires authentication");
        }

        const shouldAuthenticateConfirmation = Boolean(confirmationAuthToken);
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

      setTxSignature(signature);
      setTxExplorerRpcEndpoint(null);

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
    [publicKey, signTransaction, connected, connection, tokenMint]
  );

  const handleSetupMint = useCallback(async () => {
    if (!publicKey || !signTransaction || !connected) return;

    setIsSettingUpMint(true);
    setMintSetupError(null);

    try {
      const buildRes = await fetch("/api/payments/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payer: publicKey.toBase58(),
          mint: tokenMint,
        }),
      });

      if (!buildRes.ok) {
        const errData = await buildRes.json().catch(() => ({}));
        throw new Error(errData.error || `Setup failed: ${buildRes.status}`);
      }

      const unsignedTransaction =
        (await buildRes.json()) as UnsignedPaymentTransaction;

      await signAndSendUnsignedTransaction(unsignedTransaction);
      setIsMintInitialized(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Mint setup failed";
      setMintSetupError(
        message.includes("User rejected")
          ? "Transaction rejected by user"
          : message
      );
    } finally {
      setIsSettingUpMint(false);
    }
  }, [
    publicKey,
    signTransaction,
    connected,
    tokenMint,
    signAndSendUnsignedTransaction,
  ]);

  const handleUndelegateEata = useCallback(async () => {
    if (!publicKey || !signTransaction || !connected || !validatorMismatchFix) {
      return;
    }

    setIsUndelegatingEata(true);
    setUndelegateEataError(null);
    setTxSignature(null);
    setTxExplorerRpcEndpoint(null);

    try {
      const authToken = await ensurePrivateAuthToken();
      const buildRes = await fetch("/api/payments/undelegate-ephemeral-ata", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
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
        responseBody as UnsignedPaymentTransaction,
        undefined,
        { authToken, submitViaPaymentsApi: true }
      );

      setValidatorMismatchFix(null);
      setError("Delegation fixed. Retry the payment.");
      setStatus("error");
      dispatchPrivateBalanceRefresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Undelegation failed";
      setUndelegateEataError(
        message.includes("User rejected")
          ? "Transaction rejected by user"
          : message
      );
    } finally {
      setIsUndelegatingEata(false);
    }
  }, [
    publicKey,
    signTransaction,
    connected,
    validatorMismatchFix,
    ensurePrivateAuthToken,
    signAndSendUnsignedTransaction,
  ]);

  const handleSend = useCallback(async () => {
    if (!publicKey || !signTransaction || !connected) return;
    if (!resolvedReceiver || isResolvingRecipient) return;
    if (!rawAmount || rawAmount === "0") return;

    setStatus("building");
    setError(null);
    setValidatorMismatchFix(null);
    setUndelegateEataError(null);
    setTxSignature(null);
    setTxExplorerRpcEndpoint(null);

    try {
      const buildRes = await fetch("/api/payments/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: publicKey.toBase58(),
          to: resolvedReceiver,
          mint: tokenMint,
          amount: rawAmount,
          visibility:
            isPrivate ||
            sourceBalance === "ephemeral" ||
            recipientBalance === "ephemeral"
              ? "private"
              : "public",
          fromBalance: sourceBalance,
          toBalance: recipientBalance,
          ...(sourceBalance === "ephemeral" && privateAuthToken
            ? { authToken: privateAuthToken }
            : {}),
          ...(effectiveGasless ? { gasless: true } : {}),
          ...(memo ? { memo } : {}),
          exactOut: effectiveExactOut,
          ...(isPrivate
            ? {
                minDelayMs: String(minDelayMs),
                maxDelayMs: String(maxDelayMs),
                split,
              }
            : {}),
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

      const jsonResponse = await buildRes.json();
      const unsignedTransaction = jsonResponse as UnsignedPaymentTransaction;

      setStatus("signing");
      const signature = await signAndSendUnsignedTransaction(
        unsignedTransaction,
        () => setStatus("sending"),
        {
          authToken: privateAuthToken,
          submitViaPaymentsApi: sourceBalance === "ephemeral",
        }
      );

      setTxSignature(signature);
      setStatus("confirmed");
      dispatchPrivateBalanceRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Payment failed";
      if (message.includes("User rejected")) {
        setError("Transaction rejected by user");
      } else {
        setError(message);
      }
      setStatus("error");
    }
  }, [
    publicKey,
    signTransaction,
    connected,
    rawAmount,
    resolvedReceiver,
    tokenMint,
    isPrivate,
    sourceBalance,
    privateAuthToken,
    recipientBalance,
    effectiveGasless,
    memo,
    effectiveExactOut,
    minDelayMs,
    maxDelayMs,
    split,
    isResolvingRecipient,
    signAndSendUnsignedTransaction,
  ]);

  const handleReset = useCallback(() => {
    setStatus("idle");
    setTxSignature(null);
    setTxExplorerRpcEndpoint(null);
    setError(null);
    setValidatorMismatchFix(null);
    setUndelegateEataError(null);
    setAmount("");
    setMemo("");
  }, []);

  const privateBalanceLabel = isPrivateBalanceLoading
    ? "..."
    : formatBaseUnits(privateBalanceRaw ?? "0", selectedToken.decimals);
  const publicBalanceLabel = isWalletTokenBalanceLoading
    ? "..."
    : walletTokenBalance ?? "0";
  const shouldShowPrivateBalance =
    Boolean(privateAuthToken) &&
    (isPrivateBalanceLoading ||
      Boolean(privateAuthError || privateBalanceError) ||
      hasPositiveBaseUnits(privateBalanceRaw));
  const canSendFromPrivateBalance =
    Boolean(privateAuthToken) && hasPositiveBaseUnits(privateBalanceRaw);
  const errorTransactionSignature = getErrorTransactionSignature(error);
  const errorTxSignature = txSignature ?? errorTransactionSignature;

  useEffect(() => {
    const hasLoadedPrivateBalance =
      privateBalanceRaw !== null || Boolean(privateBalanceError);

    if (
      sourceBalance === "ephemeral" &&
      privateAuthChecked &&
      !privateAuthToken
    ) {
      setSourceBalance("base");
      return;
    }

    if (
      sourceBalance === "ephemeral" &&
      privateAuthToken &&
      !isPrivateBalanceLoading &&
      hasLoadedPrivateBalance &&
      !canSendFromPrivateBalance
    ) {
      setSourceBalance("base");
    }
  }, [
    canSendFromPrivateBalance,
    isPrivateBalanceLoading,
    privateAuthChecked,
    privateAuthToken,
    privateBalanceError,
    privateBalanceRaw,
    sourceBalance,
  ]);

  return (
    <>
      <div className="w-full max-w-[480px] mx-auto">
        <div className="rounded-2xl bg-[var(--surface-container)] border border-border/40 shadow-xl shadow-black/30 overflow-hidden">
          <div className="mx-3 mt-3 mb-1">
            <div className="rounded-xl bg-[var(--surface-inner)] border border-border/50 p-4">
              <div className="relative mb-3 h-4">
                <div className="text-xs leading-4 text-muted-foreground">
                  You send
                </div>
                {canSendFromPrivateBalance && (
                  <fieldset className="absolute right-0 top-1/2 grid -translate-y-1/2 grid-cols-2 gap-0.5 rounded-md bg-secondary/60 p-px">
                    <legend className="sr-only">Payment source balance</legend>
                    <button
                      type="button"
                      onClick={() => handleSourceBalanceChange("base")}
                      aria-pressed={sourceBalance === "base"}
                      className={`h-5 rounded px-1.5 text-[10px] font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        sourceBalance === "base"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Wallet
                    </button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() =>
                            handleSourceBalanceChange("ephemeral")
                          }
                          aria-pressed={sourceBalance === "ephemeral"}
                          className={`h-5 rounded px-1.5 text-[10px] font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            sourceBalance === "ephemeral"
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Shielded
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[220px]">
                        Send instantly from your shielded balance with no gas and zero fees.
                      </TooltipContent>
                    </Tooltip>
                  </fieldset>
                )}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <button
                    disabled
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-accent/60 transition-colors cursor-default"
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
                    <span className="text-foreground font-semibold text-sm">
                      {selectedToken.symbol}
                    </span>
                  </button>
                  {connected && publicKey && (
                    <div className="mt-1 px-1 text-xs text-muted-foreground">
                      <span
                        className={
                          canSendFromPrivateBalance && sourceBalance === "base"
                            ? "font-medium text-foreground"
                            : undefined
                        }
                      >
                        {canSendFromPrivateBalance && sourceBalance === "base"
                          ? "From public"
                          : "Public"}
                        : {publicBalanceLabel}
                      </span>
                      {shouldShowPrivateBalance && (
                        <>
                          <span className="px-1.5 text-muted-foreground/60">
                            |
                          </span>
                          <span
                            className={
                              sourceBalance === "ephemeral"
                                ? "font-medium text-foreground"
                                : undefined
                            }
                          >
                            {sourceBalance === "ephemeral"
                              ? "From shielded"
                              : "Shielded"}
                            : {privateBalanceLabel}
                          </span>
                        </>
                      )}
                      {(privateAuthError || privateBalanceError) && (
                        <div className="text-destructive">
                          {privateAuthError || privateBalanceError}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (/^\d*\.?\d*$/.test(v)) {
                        setAmount(v);
                        resetResultState();
                      }
                    }}
                    placeholder="0.00"
                    className="bg-transparent text-right text-2xl font-light text-muted-foreground/50 placeholder:text-muted-foreground/30 outline-none w-32 focus:text-foreground"
                  />
                  <div className="text-xs text-muted-foreground mt-1">
                    $
                    {amountUsd > 0
                      ? amountUsd.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })
                      : "0"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mx-3 mt-2">
            <div className="rounded-xl bg-[var(--surface-inner)] border border-border/50 p-4">
              <div className="text-xs text-muted-foreground mb-3">
                Recipient
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-accent/80 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-muted-foreground" />
                </div>
                <input
                  type="text"
                  value={receiver}
                  onChange={(e) => {
                    setReceiver(e.target.value);
                    resetResultState();
                  }}
                  placeholder="Solana wallet address or .sol domain"
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none font-mono"
                />
              </div>
              {receiver && isResolvingRecipient && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Resolving domain...
                </div>
              )}
              {receiver && directReceiverAddress && recipientPrimaryDomain && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Primary domain:{" "}
                  <span className="text-foreground">
                    {recipientPrimaryDomain}
                  </span>
                </div>
              )}
              {receiver &&
                isDomainReceiver &&
                resolvedReceiver &&
                !isResolvingRecipient && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Resolves to{" "}
                    <span className="font-mono text-foreground">
                      {shortenAddress(resolvedReceiver)}
                    </span>
                  </div>
                )}
              {receiver && !isResolvingRecipient && isValidReceiver && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Public:{" "}
                  {isRecipientTokenBalanceLoading
                    ? "..."
                    : `${recipientTokenBalance ?? "0"} ${selectedToken.symbol}`}
                  <span className="px-1.5 text-muted-foreground/60">|</span>
                  Shielded: ***
                </div>
              )}
              {receiver &&
                !isResolvingRecipient &&
                !isValidReceiver &&
                !isDomainReceiver && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="w-3 h-3" />
                    Invalid Solana address
                  </div>
                )}
              <fieldset className="mt-3">
                <legend className="mb-2 text-xs text-muted-foreground">
                  Send to:
                </legend>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary/60 p-1">
                  {([
                    [
                      "base",
                      "Wallet",
                      "Destination receives tokens in the main wallet after anonymization.",
                    ],
                    [
                      "ephemeral",
                      "Shielded balance",
                      "Destination receives tokens in their shielded balance, claimable later.",
                    ],
                  ] as const).map(([value, label, hint]) => {
                    const isSelected = recipientBalance === value;

                    return (
                      <Tooltip key={value}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => handleRecipientBalanceChange(value)}
                            className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              isSelected
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <span>{label}</span>
                            <CircleHelp className="h-3 w-3 opacity-80" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[220px]">
                          {hint}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          </div>

          <div className="mx-3 mt-2">
            <PrivateRoutingControls
              id="private-transfer-toggle"
              label="Shielded transfer"
              enabled={isPrivate}
              onEnabledChange={handlePrivateRoutingChange}
              summary={
                recipientBalance === "ephemeral"
                  ? "Shielded balance delivery"
                  : routingSummary
              }
              disabledDescription="Enable MagicBlock shielded transactions"
              minDelayMs={minDelayMs}
              maxDelayMs={maxDelayMs}
              onDelayRangeChange={handleDelayRangeChange}
              split={split}
              onSplitChange={handleSplitChange}
              showRoutingControls={recipientBalance !== "ephemeral"}
            />
          </div>

          <div className="mx-3 mt-2">
            <div className="rounded-xl bg-secondary/30">
              <button
                type="button"
                onClick={() => setAdvancedOpen((open) => !open)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50 rounded-xl cursor-pointer"
                aria-expanded={advancedOpen}
                aria-controls="advanced-settings-panel"
              >
                <div className="flex items-center gap-2">
                  <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-foreground">
                    Advanced
                  </span>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${
                    advancedOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {advancedOpen && (
                <div
                  id="advanced-settings-panel"
                  className="border-t border-border/40 px-4 py-3 space-y-4"
                >
                  <div className="space-y-2">
                    <label
                      htmlFor="payment-memo"
                      className="text-xs font-medium text-foreground"
                    >
                      Memo
                    </label>
                    <input
                      id="payment-memo"
                      type="text"
                      value={memo}
                      onChange={(e) => {
                        setMemo(e.target.value);
                        resetResultState();
                      }}
                      placeholder="Add a memo (optional)"
                      maxLength={140}
                      autoComplete="off"
                      className="min-h-10 w-full rounded-lg border border-border/30 bg-[var(--surface-inner)] px-3 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground">
                        Exact out
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {isSendingMaxSourceBalance
                          ? "Exact out is disabled when sending the full source balance."
                          : effectiveExactOut
                            ? "Recipient gets the entered amount. Fees are charged to sender."
                            : "Fees may be deducted from the recipient amount."}
                      </div>
                    </div>
                    <Switch
                      checked={effectiveExactOut}
                      disabled={isSendingMaxSourceBalance}
                      onCheckedChange={(enabled) => {
                        setExactOut(enabled);
                        resetResultState();
                      }}
                      aria-label="Enable exact out transfer"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <span>Gasless sponsor</span>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                              aria-label="What does gasless sponsor mean?"
                            >
                              <CircleHelp className="h-3.5 w-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            className="w-72 rounded-xl border-border/60 bg-[var(--surface-inner)] p-3"
                          >
                            <div className="text-sm font-semibold text-foreground">
                              No more &quot;insufficient SOL&quot;
                            </div>
                            <div className="mt-2 text-xs leading-5 text-muted-foreground">
                              Use this if you do not have enough SOL, or if you just want a sponsor to cover the network fees for you.
                            </div>
                            <div className="mt-2 text-xs leading-5 text-muted-foreground">
                              A sponsor wallet pays the SOL needed to submit this payment.
                            </div>
                            <div className="mt-2 text-xs leading-5 text-muted-foreground">
                              The payment still charges token fees in the token you are sending, such as USDC.
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {isGaslessDisabledForSource
                          ? "Gasless sponsor is disabled when paying from shielded balance."
                          : walletSolLamports === 0 && effectiveGasless
                          ? "Enabled automatically because your wallet has no SOL."
                          : walletSolLamports === 0
                            ? "Your wallet has no SOL. Turn this on if you want a sponsor to cover the network fees."
                            : "Sponsor pays SOL. The transfer still charges token fees."}
                      </div>
                    </div>
                    <Switch
                      checked={effectiveGasless}
                      disabled={isGaslessDisabledForSource}
                      onCheckedChange={handleGaslessChange}
                      aria-label="Enable gasless transfer"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {error && status === "error" && (
            <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
              <div className="flex items-center justify-between gap-3">
                {errorTransactionSignature ? (
                  <a
                    href={getExplorerTransactionHref(
                      errorTransactionSignature,
                      txExplorerRpcEndpoint
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 inline-flex items-center gap-1 text-xs text-destructive hover:underline"
                  >
                    <span>{getErrorTransactionLabel(error)}:</span>
                    <span className="font-mono">
                      {shortenAddress(errorTransactionSignature)}
                    </span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : (
                  <span className="text-xs text-destructive">{error}</span>
                )}
                {errorTxSignature && !errorTransactionSignature && (
                  <a
                    href={getExplorerTransactionHref(
                      errorTxSignature,
                      txExplorerRpcEndpoint
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 flex items-center gap-1 text-xs text-destructive hover:underline"
                  >
                    View tx
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              {validatorMismatchFix && (
                <div className="mt-2 flex flex-col gap-2 border-t border-destructive/15 pt-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-xs text-destructive/90">
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
              {undelegateEataError && (
                <div className="mt-2 text-xs text-destructive">
                  {undelegateEataError}
                </div>
              )}
            </div>
          )}

          {isMintInitialized === false && (
            <div className="mx-3 mt-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
              <div className="min-w-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">
                        Shielded payments are not enabled for this mint yet.
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Pay the fees (~0.2 SOL) and set it up permissionlessly.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={connected ? handleSetupMint : openConnectModal}
                      disabled={isSettingUpMint}
                      className="mt-0.5 inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSettingUpMint && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      {connected ? "Set Up" : "Connect Wallet to Set Up"}
                    </button>
                  </div>
                  {mintSetupError && (
                    <div className="mt-2 text-xs text-destructive">
                      {mintSetupError}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {status === "confirmed" && txSignature && (
            <div className="mx-3 mt-2 flex items-center justify-between px-3 py-2 rounded-lg bg-success/10 border border-success/20">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-success" />
                <span className="text-xs text-success">Payment sent!</span>
              </div>
              <a
                href={getExplorerTransactionHref(
                  txSignature,
                  txExplorerRpcEndpoint
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-success hover:underline"
              >
                View tx
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          <div className="p-3 pt-3">
            <PaymentActionButton
              connected={connected}
              status={status}
              amount={amount}
              hasValidAmount={rawAmount !== null && rawAmount !== "0"}
              isValidReceiver={isValidReceiver}
              isResolvingReceiver={isResolvingRecipient}
              receiver={receiver}
              tokenSymbol={selectedToken.symbol}
              isPrivate={isPrivate}
              onConnect={openConnectModal}
              isMintInitializationLoading={isMintInitializationLoading}
              requiresMintSetup={isPrivate && isMintInitialized === false}
              onSend={handleSend}
              onRetry={() => {
                setStatus("idle");
                setError(null);
              }}
              onReset={handleReset}
            />
          </div>
        </div>
      </div>

      <TokenSelectModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSelect={handleTokenSelect}
        disabledMint=""
      />
    </>
  );
}

function PaymentActionButton({
  connected,
  status,
  amount,
  hasValidAmount,
  isValidReceiver,
  isResolvingReceiver,
  receiver,
  tokenSymbol,
  isPrivate,
  isMintInitializationLoading,
  requiresMintSetup,
  onConnect,
  onSend,
  onRetry,
  onReset,
}: {
  connected: boolean;
  status: PaymentStatus;
  amount: string;
  hasValidAmount: boolean;
  isValidReceiver: boolean;
  isResolvingReceiver: boolean;
  receiver: string;
  tokenSymbol: string;
  isPrivate: boolean;
  isMintInitializationLoading: boolean;
  requiresMintSetup: boolean;
  onConnect: () => void;
  onSend: () => void;
  onRetry: () => void;
  onReset: () => void;
}) {
  if (!connected) {
    return (
      <button
        onClick={onConnect}
        className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-semibold text-base hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer"
      >
        Connect Wallet
      </button>
    );
  }

  if (!amount || parseFloat(amount) <= 0) {
    return (
      <button
        disabled
        className="w-full py-4 rounded-xl bg-secondary text-muted-foreground font-semibold text-base cursor-not-allowed"
      >
        Enter an amount
      </button>
    );
  }

  if (!hasValidAmount) {
    return (
      <button
        disabled
        className="w-full py-4 rounded-xl bg-secondary text-muted-foreground font-semibold text-base cursor-not-allowed"
      >
        Invalid amount
      </button>
    );
  }

  if (!receiver.trim()) {
    return (
      <button
        disabled
        className="w-full py-4 rounded-xl bg-secondary text-muted-foreground font-semibold text-base cursor-not-allowed"
      >
        Enter recipient address
      </button>
    );
  }

  if (isResolvingReceiver) {
    return (
      <button
        disabled
        className="w-full py-4 rounded-xl bg-secondary text-muted-foreground font-semibold text-base cursor-not-allowed"
      >
        Resolving recipient...
      </button>
    );
  }

  if (!isValidReceiver) {
    return (
      <button
        disabled
        className="w-full py-4 rounded-xl bg-secondary text-muted-foreground font-semibold text-base cursor-not-allowed"
      >
        Invalid recipient address
      </button>
    );
  }

  if (isPrivate && isMintInitializationLoading) {
    return (
      <button
        disabled
        className="w-full py-4 rounded-xl bg-secondary text-muted-foreground font-semibold text-base cursor-not-allowed"
      >
        Checking mint setup...
      </button>
    );
  }

  if (requiresMintSetup) {
    return (
      <button
        disabled
        className="w-full py-4 rounded-xl bg-secondary text-muted-foreground font-semibold text-base cursor-not-allowed"
      >
        Set up this mint to continue
      </button>
    );
  }

  if (status === "building" || status === "signing" || status === "sending") {
    const label =
      status === "building"
        ? "Preparing payment..."
        : status === "signing"
          ? "Waiting for wallet..."
          : "Sending payment...";

    return (
      <button
        disabled
        className="w-full py-4 rounded-xl bg-primary/60 text-primary-foreground font-semibold text-base flex items-center justify-center gap-2 cursor-not-allowed"
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        {label}
      </button>
    );
  }

  if (status === "error") {
    return (
      <button
        onClick={onRetry}
        className="w-full py-4 rounded-xl bg-destructive/80 text-destructive-foreground font-semibold text-base hover:bg-destructive transition-colors cursor-pointer"
      >
        Retry Payment
      </button>
    );
  }

  if (status === "confirmed") {
    return (
      <button
        onClick={onReset}
        className="w-full py-4 rounded-xl bg-success text-primary-foreground font-semibold text-base hover:brightness-110 transition-all cursor-pointer"
      >
        New Payment
      </button>
    );
  }

  return (
    <button
      onClick={onSend}
      className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-semibold text-base hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-2"
    >
      {isPrivate && <ShieldCheck className="w-4 h-4" />}
      Send {amount} {tokenSymbol}
    </button>
  );
}
