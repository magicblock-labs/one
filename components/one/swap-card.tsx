"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  ArrowDownUp,
  ChevronDown,
  Copy,
  Loader2,
  ExternalLink,
  AlertTriangle,
  Settings2,
  Check,
  ShieldCheck,
  User,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getPrimaryDomain, resolve } from "@bonfida/spl-name-service";
import {
  type Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  type AggregatorToken,
  DEFAULT_SELL_MINT,
  DEFAULT_BUY_MINT,
  FALLBACK_TOKENS,
  SOL_MINT,
  findTokenByMint,
} from "@/lib/tokens";
import { usePrices } from "@/hooks/use-sol-price";
import { useAggregatorTokens } from "@/hooks/use-aggregator-tokens";
import { useSwap, type SwapStatus } from "@/hooks/use-swap";
import {
  MAX_PRIVATE_DELAY_MS,
  clampPrivateSplit,
  formatPrivateRoutingSummary,
} from "@/lib/private-routing";
import { PrivateRoutingControls } from "./private-routing-controls";
import { TokenSelectModal } from "./token-select-modal";
import { useUnifiedWallet } from "@/app/wallet/solana-wallet-provider";

const tabs = [
  "Market",
  // "Limit",
  // "Recurring",
];
const SLIPPAGE_PRESETS = [50, 100, 300]; // 0.5%, 1%, 3%
const SWAP_PRIVATE_QUERY_PARAM = "sprivate";
const SWAP_DESTINATION_QUERY_PARAM = "dst";
const SWAP_MIN_DELAY_QUERY_PARAM = "smin";
const SWAP_MAX_DELAY_QUERY_PARAM = "smax";
const SWAP_SPLIT_QUERY_PARAM = "ssplit";

interface SwapCardProps {
  initialBuyMint?: string;
  initialSellMint?: string;
  initialAmount?: string;
}

interface UnsignedPaymentTransaction {
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

interface MintInitializationResponse {
  initialized: boolean;
}

function getInitialMint(mint: string | undefined, fallbackMint: string) {
  return mint && findTokenByMint(mint) ? mint : fallbackMint;
}

function getInitialAmount(amount: string | undefined) {
  return amount && /^\d*\.?\d*$/.test(amount) ? amount : "";
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

function buildSwapUrlSelectionKey({
  sellMint,
  buyMint,
  sellAmount,
  isPrivate,
  destination,
  minDelayMs,
  maxDelayMs,
  split,
}: {
  sellMint: string;
  buyMint: string;
  sellAmount: string;
  isPrivate: boolean;
  destination: string;
  minDelayMs: number;
  maxDelayMs: number;
  split: number;
}) {
  return JSON.stringify([
    sellMint,
    buyMint,
    sellAmount,
    isPrivate,
    destination,
    minDelayMs,
    maxDelayMs,
    split,
  ]);
}

function base64ToUint8Array(base64: string) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
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

function formatTokenBalance(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";

  return value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 1_000 ? 2 : value >= 1 ? 4 : 6,
  });
}

async function fetchFormattedTokenBalance(
  connection: Connection,
  owner: PublicKey,
  tokenMint: string,
  decimals: number
) {
  if (tokenMint === SOL_MINT) {
    const lamports = await connection.getBalance(owner, "confirmed");
    return formatTokenBalance(lamports / Math.pow(10, decimals));
  }

  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
    owner,
    { mint: new PublicKey(tokenMint) },
    "confirmed"
  );

  const uiAmount = tokenAccounts.value.reduce((total, account) => {
    const tokenAmount = account.account.data.parsed.info.tokenAmount;
    return total + Number(tokenAmount.uiAmountString ?? tokenAmount.uiAmount ?? 0);
  }, 0);

  return formatTokenBalance(uiAmount);
}

const TOKEN_PROGRAM_IDS = [
  new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
];

export function SwapCard({
  initialBuyMint,
  initialSellMint,
  initialAmount,
}: SwapCardProps) {
  const { connection } = useConnection();
  const { connected, openConnectModal, publicKey, sendTransaction } =
    useUnifiedWallet();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSelectionKeyRef = useRef<string | null>(null);
  const isSearchPrivate = searchParams.has(SWAP_PRIVATE_QUERY_PARAM);
  const searchDestination = searchParams.get(SWAP_DESTINATION_QUERY_PARAM) ?? "";
  const searchMinDelayMs = isSearchPrivate
    ? parseIntegerParam(
        searchParams.get(SWAP_MIN_DELAY_QUERY_PARAM),
        0,
        0,
        MAX_PRIVATE_DELAY_MS
      )
    : 0;
  const searchMaxDelayMs = isSearchPrivate
    ? Math.max(
        searchMinDelayMs,
        parseIntegerParam(
          searchParams.get(SWAP_MAX_DELAY_QUERY_PARAM),
          0,
          0,
          MAX_PRIVATE_DELAY_MS
        )
      )
    : 0;
  const searchSplit = isSearchPrivate
    ? clampPrivateSplit(
        parseIntegerParam(searchParams.get(SWAP_SPLIT_QUERY_PARAM), 1, 1, 10)
      )
    : 1;
  const searchTab = searchParams.get("tab") ?? "";

  const [activeTab, setActiveTab] = useState("Market");
  const [sellMint, setSellMint] = useState(() =>
    getInitialMint(initialSellMint, DEFAULT_SELL_MINT)
  );
  const [buyMint, setBuyMint] = useState(() =>
    getInitialMint(initialBuyMint, DEFAULT_BUY_MINT)
  );
  const [sellAmount, setSellAmount] = useState(() =>
    getInitialAmount(initialAmount)
  );
  const [modalSide, setModalSide] = useState<"sell" | "buy" | null>(null);
  const [slippageBps, setSlippageBps] = useState(50);
  const [customSlippage, setCustomSlippage] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [destination, setDestination] = useState("");
  const [minDelayMs, setMinDelayMs] = useState(0);
  const [maxDelayMs, setMaxDelayMs] = useState(0);
  const [split, setSplit] = useState(1);
  const [resolvedDomainAddress, setResolvedDomainAddress] = useState<string | null>(null);
  const [recipientPrimaryDomain, setRecipientPrimaryDomain] = useState<string | null>(null);
  const [isResolvingRecipient, setIsResolvingRecipient] = useState(false);
  const [recipientTokenBalance, setRecipientTokenBalance] = useState<string | null>(null);
  const [isRecipientTokenBalanceLoading, setIsRecipientTokenBalanceLoading] = useState(false);
  const [isMintInitialized, setIsMintInitialized] = useState<boolean | null>(null);
  const [isMintInitializationLoading, setIsMintInitializationLoading] = useState(false);
  const [isSettingUpMint, setIsSettingUpMint] = useState(false);
  const [mintSetupError, setMintSetupError] = useState<string | null>(null);

  const { tokens, isLoading: tokensLoading } = useAggregatorTokens();

  const sellToken = useMemo(
    () => findTokenByMint(sellMint, tokens) ?? FALLBACK_TOKENS[1],
    [sellMint, tokens]
  );
  const buyToken = useMemo(
    () => findTokenByMint(buyMint, tokens) ?? FALLBACK_TOKENS[0],
    [buyMint, tokens]
  );

  const { prices } = usePrices([sellMint, buyMint]);
  const sellPrice = prices[sellMint]?.usd ?? 0;

  // Convert human sell amount to lamports/smallest unit
  const rawAmount = useMemo(() => {
    const amt = parseFloat(sellAmount);
    if (isNaN(amt) || amt <= 0) return "0";
    return Math.floor(amt * Math.pow(10, sellToken.decimals)).toString();
  }, [sellAmount, sellToken.decimals]);

  const sellUsd = useMemo(() => {
    const amt = parseFloat(sellAmount);
    if (isNaN(amt) || amt <= 0) return 0;
    return amt * sellPrice;
  }, [sellAmount, sellPrice]);

  const trimmedDestination = destination.trim();
  const directDestinationAddress = useMemo(
    () => getRecipientAddress(trimmedDestination),
    [trimmedDestination]
  );
  const isDomainDestination = Boolean(
    trimmedDestination &&
      !directDestinationAddress &&
      looksLikeDomain(trimmedDestination)
  );
  const resolvedDestination = directDestinationAddress ?? resolvedDomainAddress;
  const isValidDestination = Boolean(resolvedDestination);
  const routingSummary = useMemo(
    () => formatPrivateRoutingSummary(split, minDelayMs, maxDelayMs),
    [split, minDelayMs, maxDelayMs]
  );

  // Real swap hook
  const {
    status,
    outputAmount,
    minimumReceived,
    priceImpact,
    routeLabel,
    txSignature,
    error: swapError,
    executeSwap,
    fetchQuote,
    reset: resetSwap,
  } = useSwap({
    inputMint: sellMint,
    outputMint: buyMint,
    amount: rawAmount,
    inputDecimals: sellToken.decimals,
    outputDecimals: buyToken.decimals,
    slippageBps,
    visibility: isPrivate ? "private" : "public",
    destination: isPrivate ? resolvedDestination : null,
    destinationPending: isPrivate && isResolvingRecipient,
    minDelayMs,
    maxDelayMs,
    split,
    enabled: rawAmount !== "0" && sellMint !== buyMint,
  });

  useEffect(() => {
    const hasSwapUrlState = Boolean(
      initialSellMint ||
        initialBuyMint ||
        initialAmount ||
        searchTab === "swap" ||
        isSearchPrivate ||
        searchDestination ||
        searchMinDelayMs !== 0 ||
        searchMaxDelayMs !== 0 ||
        searchSplit !== 1
    );

    if (!hasSwapUrlState) {
      urlSelectionKeyRef.current = null;
      return;
    }

    const nextAmount = getInitialAmount(initialAmount);
    const nextKey = buildSwapUrlSelectionKey({
      sellMint: initialSellMint ?? DEFAULT_SELL_MINT,
      buyMint: initialBuyMint ?? DEFAULT_BUY_MINT,
      sellAmount: nextAmount,
      isPrivate: isSearchPrivate,
      destination: searchDestination,
      minDelayMs: searchMinDelayMs,
      maxDelayMs: searchMaxDelayMs,
      split: searchSplit,
    });
    if (urlSelectionKeyRef.current === nextKey) return;

    const nextSellMint =
      initialSellMint && findTokenByMint(initialSellMint, tokens)
        ? initialSellMint
        : undefined;
    const nextBuyMint =
      initialBuyMint && findTokenByMint(initialBuyMint, tokens)
        ? initialBuyMint
        : undefined;

    if (
      tokensLoading &&
      ((initialSellMint && !nextSellMint) || (initialBuyMint && !nextBuyMint))
    ) {
      return;
    }

    setActiveTab("Market");
    setSellMint(nextSellMint ?? DEFAULT_SELL_MINT);
    setBuyMint(nextBuyMint ?? DEFAULT_BUY_MINT);
    setSellAmount(nextAmount);
    setIsPrivate(isSearchPrivate);
    setDestination(searchDestination);
    setMinDelayMs(searchMinDelayMs);
    setMaxDelayMs(searchMaxDelayMs);
    setSplit(searchSplit);
    resetSwap();
    urlSelectionKeyRef.current = nextKey;
  }, [
    initialSellMint,
    initialBuyMint,
    initialAmount,
    isSearchPrivate,
    searchDestination,
    searchMinDelayMs,
    searchMaxDelayMs,
    searchSplit,
    searchTab,
    tokens,
    tokensLoading,
    resetSwap,
  ]);

  const buyUsd = useMemo(() => {
    const buyPrice = prices[buyMint]?.usd ?? 0;
    return outputAmount * buyPrice;
  }, [outputAmount, prices, buyMint]);

  useEffect(() => {
    let cancelled = false;

    setResolvedDomainAddress(null);

    if (!trimmedDestination || directDestinationAddress || !isDomainDestination) {
      setIsResolvingRecipient(false);
      return () => {
        cancelled = true;
      };
    }

    setIsResolvingRecipient(true);

    void resolve(connection, trimmedDestination.toLowerCase())
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
  }, [
    connection,
    trimmedDestination,
    directDestinationAddress,
    isDomainDestination,
  ]);

  useEffect(() => {
    let cancelled = false;

    setRecipientPrimaryDomain(null);

    if (!directDestinationAddress) {
      return () => {
        cancelled = true;
      };
    }

    void getPrimaryDomain(connection, new PublicKey(directDestinationAddress))
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
  }, [connection, directDestinationAddress]);

  useEffect(() => {
    let cancelled = false;

    if (!resolvedDestination || isResolvingRecipient || !isPrivate) {
      setRecipientTokenBalance(null);
      setIsRecipientTokenBalanceLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsRecipientTokenBalanceLoading(true);
    const recipientPublicKey = new PublicKey(resolvedDestination);

    const refreshRecipientTokenBalance = async () => {
      try {
        const nextBalance = await fetchFormattedTokenBalance(
          connection,
          recipientPublicKey,
          buyMint,
          buyToken.decimals
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

    if (buyMint === SOL_MINT) {
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
            { memcmp: { offset: 0, bytes: buyMint } },
            { memcmp: { offset: 32, bytes: resolvedDestination } },
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
    resolvedDestination,
    isResolvingRecipient,
    isPrivate,
    buyMint,
    buyToken.decimals,
  ]);

  useEffect(() => {
    const controller = new AbortController();

    if (!isPrivate) {
      setIsMintInitializationLoading(false);
      setIsMintInitialized(null);
      setMintSetupError(null);
      return () => {
        controller.abort();
      };
    }

    setIsMintInitializationLoading(true);
    setIsMintInitialized(null);
    setMintSetupError(null);

    void fetch(`/api/payments/mint?mint=${encodeURIComponent(buyMint)}`, {
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
  }, [buyMint, isPrivate]);

  const signAndSendUnsignedTransaction = useCallback(
    async (
      unsignedTransaction: UnsignedPaymentTransaction,
      onBeforeSend?: () => void
    ) => {
      if (!publicKey || !connected) {
        throw new Error("Wallet not connected");
      }

      if (!unsignedTransaction.requiredSigners.includes(publicKey.toBase58())) {
        throw new Error("Wallet is not listed as a required signer");
      }

      const transaction = deserializeUnsignedPaymentTransaction(unsignedTransaction);

      onBeforeSend?.();

      const signature = await sendTransaction(transaction, connection, {
        skipPreflight: true,
        maxRetries: 10,
      });

      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: unsignedTransaction.recentBlockhash,
          lastValidBlockHeight: unsignedTransaction.lastValidBlockHeight,
        },
        "confirmed"
      );

      if (confirmation.value.err) {
        throw new Error("Transaction failed on-chain");
      }

      return signature;
    },
    [publicKey, connected, sendTransaction, connection]
  );

  const handleSetupMint = useCallback(async () => {
    if (!publicKey || !connected) return;

    setIsSettingUpMint(true);
    setMintSetupError(null);

    try {
      const buildRes = await fetch("/api/payments/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payer: publicKey.toBase58(),
          mint: buyMint,
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
  }, [publicKey, connected, buyMint, signAndSendUnsignedTransaction]);

  const updateSwapUrl = useCallback(
    (
      overrides?: Partial<{
        sellMint: string;
        buyMint: string;
        sellAmount: string;
        isPrivate: boolean;
        destination: string;
        minDelayMs: number;
        maxDelayMs: number;
        split: number;
      }>
    ) => {
      const nextSellMint = overrides?.sellMint ?? sellMint;
      const nextBuyMint = overrides?.buyMint ?? buyMint;
      const nextSellAmount = overrides?.sellAmount ?? sellAmount;
      const nextIsPrivate = overrides?.isPrivate ?? isPrivate;
      const nextDestination = overrides?.destination ?? destination;
      const nextMinDelayMs = overrides?.minDelayMs ?? minDelayMs;
      const nextMaxDelayMs = overrides?.maxDelayMs ?? maxDelayMs;
      const nextSplit = overrides?.split ?? split;

      urlSelectionKeyRef.current = buildSwapUrlSelectionKey({
        sellMint: nextSellMint,
        buyMint: nextBuyMint,
        sellAmount: nextSellAmount,
        isPrivate: nextIsPrivate,
        destination: nextDestination,
        minDelayMs: nextMinDelayMs,
        maxDelayMs: nextMaxDelayMs,
        split: nextSplit,
      });

      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", "swap");
      if (nextSellMint !== DEFAULT_SELL_MINT) {
        params.set("sell", nextSellMint);
      } else {
        params.delete("sell");
      }
      if (nextBuyMint !== DEFAULT_BUY_MINT) {
        params.set("buy", nextBuyMint);
      } else {
        params.delete("buy");
      }
      if (nextSellAmount) {
        params.set("amt", nextSellAmount);
      } else {
        params.delete("amt");
      }

      if (nextIsPrivate) {
        params.set(SWAP_PRIVATE_QUERY_PARAM, "true");
        if (nextDestination) {
          params.set(SWAP_DESTINATION_QUERY_PARAM, nextDestination);
        } else {
          params.delete(SWAP_DESTINATION_QUERY_PARAM);
        }
        params.set(SWAP_MIN_DELAY_QUERY_PARAM, String(nextMinDelayMs));
        params.set(SWAP_MAX_DELAY_QUERY_PARAM, String(nextMaxDelayMs));
        params.set(SWAP_SPLIT_QUERY_PARAM, String(nextSplit));
      } else {
        params.delete(SWAP_PRIVATE_QUERY_PARAM);
        params.delete(SWAP_DESTINATION_QUERY_PARAM);
        params.delete(SWAP_MIN_DELAY_QUERY_PARAM);
        params.delete(SWAP_MAX_DELAY_QUERY_PARAM);
        params.delete(SWAP_SPLIT_QUERY_PARAM);
      }

      const query = params.toString();
      if (query === searchParams.toString()) return;
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [
      pathname,
      router,
      searchParams,
      sellMint,
      buyMint,
      sellAmount,
      isPrivate,
      destination,
      minDelayMs,
      maxDelayMs,
      split,
    ]
  );

  const handleSwapTokens = useCallback(() => {
    const nextSellMint = buyMint;
    const nextBuyMint = sellMint;
    setSellMint(nextSellMint);
    setBuyMint(nextBuyMint);
    setSellAmount("");
    resetSwap();
    updateSwapUrl({
      sellMint: nextSellMint,
      buyMint: nextBuyMint,
      sellAmount: "",
    });
  }, [sellMint, buyMint, resetSwap, updateSwapUrl]);

  const handleTokenSelect = useCallback(
    (token: AggregatorToken) => {
      let nextSellMint = sellMint;
      let nextBuyMint = buyMint;

      if (modalSide === "sell") {
        if (token.address === buyMint) {
          nextBuyMint = sellMint;
        }
        nextSellMint = token.address;
      } else {
        if (token.address === sellMint) {
          nextSellMint = buyMint;
        }
        nextBuyMint = token.address;
      }

      setSellMint(nextSellMint);
      setBuyMint(nextBuyMint);
      resetSwap();
      updateSwapUrl({
        sellMint: nextSellMint,
        buyMint: nextBuyMint,
        sellAmount,
      });
    },
    [modalSide, sellMint, buyMint, sellAmount, resetSwap, updateSwapUrl]
  );

  const handlePasteCa = useCallback(async () => {
    try {
      const clipboardText = (await navigator.clipboard.readText()).trim();
      if (!clipboardText) return;

      let pastedMint: string;
      try {
        pastedMint = new PublicKey(clipboardText).toBase58();
      } catch {
        return;
      }

      const pastedToken = findTokenByMint(pastedMint, tokens);
      if (!pastedToken) return;

      let nextSellMint = sellMint;
      let nextBuyMint = pastedToken.address;

      if (pastedToken.address === sellMint) {
        nextSellMint = buyMint;
      }

      setSellMint(nextSellMint);
      setBuyMint(nextBuyMint);
      resetSwap();
      updateSwapUrl({
        sellMint: nextSellMint,
        buyMint: nextBuyMint,
        sellAmount,
      });
    } catch {
      // Clipboard access can fail due to browser permissions; ignore silently.
    }
  }, [tokens, sellMint, buyMint, sellAmount, resetSwap, updateSwapUrl]);

  const resetSwapIfTerminal = useCallback(() => {
    if (status === "confirmed" || status === "error") {
      resetSwap();
    }
  }, [status, resetSwap]);

  const handleDelayRangeChange = useCallback(
    (values: number[]) => {
      const [nextMin = 0, nextMax = nextMin] = values;
      const clampedMinDelayMs = Math.min(MAX_PRIVATE_DELAY_MS, Math.max(0, nextMin));
      const clampedMaxDelayMs = Math.min(MAX_PRIVATE_DELAY_MS, Math.max(0, nextMax));
      resetSwapIfTerminal();
      setMinDelayMs(clampedMinDelayMs);
      setMaxDelayMs(clampedMaxDelayMs);
      updateSwapUrl({
        minDelayMs: clampedMinDelayMs,
        maxDelayMs: clampedMaxDelayMs,
      });
    },
    [resetSwapIfTerminal, updateSwapUrl]
  );

  const handleSplitChange = useCallback(
    (nextSplit: number) => {
      const clampedSplit = clampPrivateSplit(nextSplit);
      resetSwapIfTerminal();
      setSplit(clampedSplit);
      updateSwapUrl({ split: clampedSplit });
    },
    [resetSwapIfTerminal, updateSwapUrl]
  );

  const handleSlippageChange = (bps: number) => {
    setSlippageBps(bps);
    setCustomSlippage("");
  };

  const handleCustomSlippage = (val: string) => {
    setCustomSlippage(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 50) {
      setSlippageBps(Math.round(parsed * 100));
    }
  };

  return (
    <>
      <div className="w-full max-w-[480px] mx-auto">
        <div className="rounded-2xl bg-[var(--surface-container)] border border-border/40 shadow-xl shadow-black/30 overflow-hidden">
          {/* Tabs & Actions */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <div className="flex items-center gap-1">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                    activeTab === tab
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePasteCa}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-muted-foreground border border-border/50 hover:bg-secondary transition-colors cursor-pointer"
              >
                <Copy className="w-3 h-3" />
                Paste CA
              </button>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  showSettings
                    ? "bg-secondary text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Settings2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Slippage Settings */}
          {showSettings && (
            <div className="mx-3 mb-2 p-3 rounded-xl bg-secondary/60 border border-border/30">
              <div className="text-xs text-muted-foreground mb-2">
                Slippage Tolerance
              </div>
              <div className="flex items-center gap-2">
                {SLIPPAGE_PRESETS.map((bps) => (
                  <button
                    key={bps}
                    onClick={() => handleSlippageChange(bps)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      slippageBps === bps && !customSlippage
                        ? "bg-primary text-primary-foreground"
                        : "bg-accent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {bps / 100}%
                  </button>
                ))}
                <div className="flex items-center gap-1 flex-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Custom"
                    value={customSlippage}
                    onChange={(e) => handleCustomSlippage(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-accent text-xs text-foreground placeholder:text-muted-foreground outline-none border border-border/30 focus:border-primary/50"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              </div>
            </div>
          )}

          {/* Sell Section */}
          <div className="mx-3 mb-1">
            <div className="rounded-xl bg-[var(--surface-inner)] border border-border/50 p-4">
              <div className="text-xs text-muted-foreground mb-3">Sell</div>
              <div className="flex items-center justify-between">
                <TokenSelector
                  token={sellToken}
                  onClick={() => setModalSide("sell")}
                />
                <div className="text-right">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={sellAmount}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (/^\d*\.?\d*$/.test(v)) {
                        setSellAmount(v);
                        if (status === "confirmed" || status === "error") {
                          resetSwap();
                        }
                        updateSwapUrl({ sellAmount: v });
                      }
                    }}
                    placeholder="0.00"
                    className="bg-transparent text-right text-2xl font-light text-muted-foreground/50 placeholder:text-muted-foreground/30 outline-none w-32 focus:text-foreground"
                  />
                  <div className="text-xs text-muted-foreground mt-1">
                    ${sellUsd > 0 ? sellUsd.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "0"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Swap Toggle */}
          <div className="flex items-center justify-center -my-2 relative z-10">
            <button
              onClick={handleSwapTokens}
              className="w-9 h-9 rounded-full bg-[var(--surface-container)] border-2 border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-all group cursor-pointer"
            >
              <ArrowDownUp className="w-3.5 h-3.5 group-hover:rotate-180 transition-transform duration-300" />
            </button>
          </div>

          {/* Buy Section */}
          <div className="mx-3 mt-1">
            <div className="rounded-xl bg-[var(--surface-inner)] border border-border/50 p-4">
              <div className="text-xs text-muted-foreground mb-3">Buy</div>
              <div className="flex items-center justify-between">
                <TokenSelector
                  token={buyToken}
                  onClick={() => setModalSide("buy")}
                />
                <div className="text-right">
                  {status === "quoting" ? (
                    <div className="flex items-center gap-2 justify-end">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Finding route...
                      </span>
                    </div>
                  ) : outputAmount > 0 ? (
                    <>
                      <div className="text-2xl font-light text-foreground">
                        {outputAmount.toLocaleString(undefined, {
                          maximumFractionDigits:
                            buyToken.decimals > 6 ? 6 : buyToken.decimals,
                        })}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        ~${buyUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">$0</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mx-3 mt-2">
            <PrivateRoutingControls
              id="private-swap-toggle"
              label="Private swap"
              compact
              enabled={isPrivate}
              onEnabledChange={(enabled) => {
                setIsPrivate(enabled);
                resetSwapIfTerminal();
                updateSwapUrl({ isPrivate: enabled });
              }}
              summary={routingSummary}
              disabledDescription="Send swap output through MagicBlock private routing"
              minDelayMs={minDelayMs}
              maxDelayMs={maxDelayMs}
              onDelayRangeChange={handleDelayRangeChange}
              split={split}
              onSplitChange={handleSplitChange}
            >
              <div>
                <div className="mb-2 text-xs text-muted-foreground">Destination</div>
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/80">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <input
                    type="text"
                    value={destination}
                    onChange={(event) => {
                      const nextDestination = event.target.value;
                      setDestination(nextDestination);
                      resetSwapIfTerminal();
                      updateSwapUrl({ destination: nextDestination });
                    }}
                    placeholder="Solana wallet address or .sol domain"
                    className="flex-1 bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/40"
                  />
                </div>
                {destination && isResolvingRecipient && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Resolving domain...
                  </div>
                )}
                {destination &&
                  directDestinationAddress &&
                  recipientPrimaryDomain && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Primary domain:{" "}
                      <span className="text-foreground">{recipientPrimaryDomain}</span>
                    </div>
                  )}
                {destination &&
                  isDomainDestination &&
                  resolvedDestination &&
                  !isResolvingRecipient && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Resolves to{" "}
                      <span className="font-mono text-foreground">
                        {shortenAddress(resolvedDestination)}
                      </span>
                    </div>
                  )}
                {destination && !isResolvingRecipient && isValidDestination && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Balance:{" "}
                    {isRecipientTokenBalanceLoading
                      ? "..."
                      : `${recipientTokenBalance ?? "0"} ${buyToken.symbol}`}
                  </div>
                )}
                {destination &&
                  !isResolvingRecipient &&
                  !isValidDestination &&
                  !isDomainDestination && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                      <AlertTriangle className="h-3 w-3" />
                      Invalid Solana address
                    </div>
                  )}
              </div>
            </PrivateRoutingControls>
          </div>

          {/* Quote Details */}
          {(status === "ready" || status === "building" || status === "signing" || status === "sending" || status === "confirming") && outputAmount > 0 && (
            <div className="mx-3 mt-2 px-4 py-3 rounded-xl bg-secondary/30 border border-border/20 space-y-1.5">
              {routeLabel && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Route</span>
                  <span className="text-foreground/80 font-mono truncate max-w-48">
                    {routeLabel}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Min. received</span>
                <span className="text-foreground/80 font-mono">
                  {minimumReceived.toLocaleString(undefined, {
                    maximumFractionDigits: buyToken.decimals > 6 ? 6 : buyToken.decimals,
                  })}{" "}
                  {buyToken.symbol}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Price impact</span>
                <span
                  className={`font-mono ${
                    priceImpact > 3
                      ? "text-destructive"
                      : priceImpact > 1
                        ? "text-yellow-400"
                        : "text-success"
                  }`}
                >
                  {priceImpact.toFixed(4)}%
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Slippage</span>
                <span className="text-foreground/80 font-mono">
                  {slippageBps / 100}%
                </span>
              </div>
            </div>
          )}

          {/* Price Impact Warning */}
          {priceImpact > 3 && status === "ready" && (
            <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
              <span className="text-xs text-destructive">
                High price impact! You may receive significantly fewer tokens.
              </span>
            </div>
          )}

          {/* Swap Error */}
          {swapError && status === "error" && (
            <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
              <span className="text-xs text-destructive">{swapError}</span>
            </div>
          )}

          {isPrivate && isMintInitialized === false && (
            <div className="mx-3 mt-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
              <div className="min-w-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">
                        Private payments are not enabled for this mint yet.
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
                      {isSettingUpMint && <Loader2 className="h-4 w-4 animate-spin" />}
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

          {/* Success */}
          {status === "confirmed" && txSignature && (
            <div className="mx-3 mt-2 flex items-center justify-between px-3 py-2 rounded-lg bg-success/10 border border-success/20">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-success" />
                <span className="text-xs text-success">Swap successful!</span>
              </div>
              <a
                href={`/api/explorer/tx?signature=${encodeURIComponent(txSignature)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-success hover:underline"
              >
                View tx
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          {/* Action Button */}
          <div className="p-3 pt-3">
            <SwapActionButton
              connected={connected}
              status={status}
              sellAmount={sellAmount}
              sellSymbol={sellToken.symbol}
              buySymbol={buyToken.symbol}
              priceImpact={priceImpact}
              isPrivate={isPrivate}
              destination={destination}
              isResolvingDestination={isResolvingRecipient}
              isValidDestination={isValidDestination}
              isMintInitializationLoading={isMintInitializationLoading}
              requiresMintSetup={isPrivate && isMintInitialized === false}
              onConnect={openConnectModal}
              onSwap={executeSwap}
              onRetry={() => {
                resetSwap();
                void fetchQuote();
              }}
              onReset={() => {
                resetSwap();
                setSellAmount("");
              }}
            />
          </div>
        </div>
      </div>

      <TokenSelectModal
        open={modalSide !== null}
        onOpenChange={(open) => {
          if (!open) setModalSide(null);
        }}
        onSelect={handleTokenSelect}
        disabledMint={modalSide === "sell" ? buyMint : sellMint}
      />
    </>
  );
}

/* ---------- Token Selector Button ---------- */
function TokenSelector({
  token,
  onClick,
}: {
  token: AggregatorToken;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-accent/60 hover:bg-accent transition-colors cursor-pointer"
    >
      {token.logoURI ? (
        <img
          src={token.logoURI}
          alt={token.symbol}
          className="w-7 h-7 rounded-full"
          crossOrigin="anonymous"
        />
      ) : (
        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
          {token.symbol.charAt(0)}
        </div>
      )}
      <span className="text-foreground font-semibold text-sm">
        {token.symbol}
      </span>
      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
    </button>
  );
}

/* ---------- Swap Action Button ---------- */
function SwapActionButton({
  connected,
  status,
  sellAmount,
  sellSymbol,
  buySymbol,
  priceImpact,
  isPrivate,
  destination,
  isResolvingDestination,
  isValidDestination,
  isMintInitializationLoading,
  requiresMintSetup,
  onConnect,
  onSwap,
  onRetry,
  onReset,
}: {
  connected: boolean;
  status: SwapStatus;
  sellAmount: string;
  sellSymbol: string;
  buySymbol: string;
  priceImpact: number;
  isPrivate: boolean;
  destination: string;
  isResolvingDestination: boolean;
  isValidDestination: boolean;
  isMintInitializationLoading: boolean;
  requiresMintSetup: boolean;
  onConnect: () => void;
  onSwap: () => void;
  onRetry: () => void;
  onReset: () => void;
}) {
  // Not connected
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

  // No amount entered
  if (!sellAmount || parseFloat(sellAmount) <= 0) {
    return (
      <button
        disabled
        className="w-full py-4 rounded-xl bg-secondary text-muted-foreground font-semibold text-base cursor-not-allowed"
      >
        Enter an amount
      </button>
    );
  }

  if (isPrivate && !destination.trim()) {
    return (
      <button
        disabled
        className="w-full py-4 rounded-xl bg-secondary text-muted-foreground font-semibold text-base cursor-not-allowed"
      >
        Enter destination address
      </button>
    );
  }

  if (isPrivate && isResolvingDestination) {
    return (
      <button
        disabled
        className="w-full py-4 rounded-xl bg-secondary text-muted-foreground font-semibold text-base cursor-not-allowed"
      >
        Resolving destination...
      </button>
    );
  }

  if (isPrivate && !isValidDestination) {
    return (
      <button
        disabled
        className="w-full py-4 rounded-xl bg-secondary text-muted-foreground font-semibold text-base cursor-not-allowed"
      >
        Invalid destination address
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

  // Quoting
  if (status === "quoting") {
    return (
      <button
        disabled
        className="w-full py-4 rounded-xl bg-secondary text-muted-foreground font-semibold text-base flex items-center justify-center gap-2 cursor-not-allowed"
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        Finding best route...
      </button>
    );
  }

  // Building / Signing / Sending / Confirming
  if (
    status === "building" ||
    status === "signing" ||
    status === "sending" ||
    status === "confirming"
  ) {
    const labels: Record<string, string> = {
      building: "Preparing transaction...",
      signing: "Waiting for wallet...",
      sending: "Sending transaction...",
      confirming: "Confirming...",
    };
    return (
      <button
        disabled
        className="w-full py-4 rounded-xl bg-primary/60 text-primary-foreground font-semibold text-base flex items-center justify-center gap-2 cursor-not-allowed"
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        {labels[status]}
      </button>
    );
  }

  // Error
  if (status === "error") {
    return (
      <button
        onClick={onRetry}
        className="w-full py-4 rounded-xl bg-destructive/80 text-destructive-foreground font-semibold text-base hover:bg-destructive transition-colors cursor-pointer"
      >
        Retry Swap
      </button>
    );
  }

  // Confirmed
  if (status === "confirmed") {
    return (
      <button
        onClick={onReset}
        className="w-full py-4 rounded-xl bg-success text-primary-foreground font-semibold text-base hover:brightness-110 transition-all cursor-pointer"
      >
        New Swap
      </button>
    );
  }

  // Ready to swap
  if (status === "ready") {
    const isHighImpact = priceImpact > 3;
    return (
      <button
        onClick={onSwap}
        className={`w-full py-4 rounded-xl font-semibold text-base hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer ${
          isHighImpact
            ? "bg-destructive/80 text-destructive-foreground hover:bg-destructive"
            : "bg-primary text-primary-foreground"
        }`}
      >
        {isHighImpact ? (
          `Swap Anyway (${priceImpact.toFixed(2)}% impact)`
        ) : isPrivate ? (
          <span className="inline-flex items-center justify-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Swap {sellSymbol} for {buySymbol}
          </span>
        ) : (
          `Swap ${sellSymbol} for ${buySymbol}`
        )}
      </button>
    );
  }

  // Idle (waiting for amount or quote)
  return (
    <button
      disabled
      className="w-full py-4 rounded-xl bg-secondary text-muted-foreground font-semibold text-base cursor-not-allowed"
    >
      Enter an amount
    </button>
  );
}
