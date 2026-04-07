"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Loader2,
  ExternalLink,
  Check,
  Shield,
  ShieldCheck,
  User,
  Copy,
  AlertTriangle,
} from "lucide-react";
import { useConnection } from "@solana/wallet-adapter-react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type Connection, PublicKey, Transaction } from "@solana/web3.js";
import { getPrimaryDomain, resolve } from "@bonfida/spl-name-service";
import {
  type AggregatorToken,
  FALLBACK_TOKENS,
  SOL_MINT,
  findTokenByMint,
} from "@/lib/tokens";
import { usePrices } from "@/hooks/use-sol-price";
import { useAggregatorTokens } from "@/hooks/use-aggregator-tokens";
import { PAYMENTS_DEFAULT_USDC_MINT } from "@/lib/payments";
import { Slider } from "@/components/ui/slider";
import { TokenSelectModal } from "./token-select-modal";
import { useUnifiedWallet } from "@/app/wallet/solana-wallet-provider";

type PaymentStatus =
  | "idle"
  | "building"
  | "signing"
  | "sending"
  | "confirmed"
  | "error";

interface UnsignedPaymentTransaction {
  kind: string;
  version: "legacy";
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

const SWAP_QUERY_PARAMS = ["buy", "sell", "amt"] as const;
const REQUEST_QUERY_PARAMS = ["prd", "ramt", "rmint"] as const;

function base64ToUint8Array(base64: string) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
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

function clampSplit(value: number) {
  return Math.min(10, Math.max(1, value));
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

const MAX_PRIVATE_DELAY_MS = 5 * 60 * 1000;
const TOKEN_PROGRAM_IDS = [
  new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
];

function formatDelayValue(delayMs: number) {
  if (delayMs >= 60_000) {
    const minutes = delayMs / 60_000;
    const roundedMinutes = Number.isInteger(minutes)
      ? minutes.toString()
      : minutes.toFixed(1).replace(/\.0$/, "");

    return `${roundedMinutes} min`;
  }

  if (delayMs >= 1_000) {
    const seconds = delayMs / 1_000;
    const roundedSeconds = Number.isInteger(seconds)
      ? seconds.toString()
      : seconds.toFixed(1).replace(/\.0$/, "");

    return `${roundedSeconds} sec`;
  }

  return `${delayMs} ms`;
}

export function PaymentCard() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isInitiallyPrivate = !searchParams.has("public");
  const searchMint = searchParams.get("mint")?.trim() ?? "";
  const initialMinDelayMs = isInitiallyPrivate
    ? parseIntegerParam(searchParams.get("min"), 0, 0, MAX_PRIVATE_DELAY_MS)
    : 0;
  const initialMaxDelayMs = isInitiallyPrivate
    ? Math.max(
        initialMinDelayMs,
        parseIntegerParam(searchParams.get("max"), 0, 0, MAX_PRIVATE_DELAY_MS)
      )
    : 0;
  const initialSplit = isInitiallyPrivate
    ? clampSplit(parseIntegerParam(searchParams.get("split"), 1, 1, 10))
    : 1;
  const { connection } = useConnection();
  const { connected, openConnectModal, publicKey, signTransaction } =
    useUnifiedWallet();

  const [tokenMint, setTokenMint] = useState(() =>
    getInitialPaymentMint(searchParams)
  );
  const [amount, setAmount] = useState("");
  const [receiver, setReceiver] = useState(() => searchParams.get("rcv") ?? "");
  const [memo, setMemo] = useState(() => searchParams.get("memo") ?? "");
  const [isPrivate, setIsPrivate] = useState(() => isInitiallyPrivate);
  const [minDelayMs, setMinDelayMs] = useState(() => initialMinDelayMs);
  const [maxDelayMs, setMaxDelayMs] = useState(() => initialMaxDelayMs);
  const [split, setSplit] = useState(() => initialSplit);
  const [modalOpen, setModalOpen] = useState(false);
  const [resolvedDomainAddress, setResolvedDomainAddress] = useState<string | null>(null);
  const [recipientPrimaryDomain, setRecipientPrimaryDomain] = useState<string | null>(null);
  const [isResolvingRecipient, setIsResolvingRecipient] = useState(false);
  const [walletTokenBalance, setWalletTokenBalance] = useState<string | null>(null);
  const [isWalletTokenBalanceLoading, setIsWalletTokenBalanceLoading] = useState(false);
  const [recipientTokenBalance, setRecipientTokenBalance] = useState<string | null>(null);
  const [isRecipientTokenBalanceLoading, setIsRecipientTokenBalanceLoading] = useState(false);
  const [isMintInitialized, setIsMintInitialized] = useState<boolean | null>(null);
  const [isMintInitializationLoading, setIsMintInitializationLoading] = useState(false);
  const [isSettingUpMint, setIsSettingUpMint] = useState(false);
  const [mintSetupError, setMintSetupError] = useState<string | null>(null);

  const [status, setStatus] = useState<PaymentStatus>("idle");
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    const splitLabel = split === 1 ? "1 split" : `${split} splits`;
    if (minDelayMs === 0 && maxDelayMs === 0) {
      return split === 1
        ? "Immediate transfer"
        : `${splitLabel}. Immediate transfer`;
    }

    if (minDelayMs === maxDelayMs) {
      return `${splitLabel} scheduled at ${formatDelayValue(minDelayMs)}`;
    }

    return `${splitLabel} across ${formatDelayValue(minDelayMs)}-${formatDelayValue(maxDelayMs)}`;
  }, [split, minDelayMs, maxDelayMs]);

  const resetResultState = useCallback(() => {
    setStatus((currentStatus) => {
      if (currentStatus !== "confirmed" && currentStatus !== "error") {
        return currentStatus;
      }

      return "idle";
    });
    setError(null);
    setTxSignature(null);
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
  }, [
    connection,
    trimmedReceiver,
    directReceiverAddress,
    isDomainReceiver,
  ]);

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
      setWalletTokenBalance(null);
      setIsWalletTokenBalanceLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsWalletTokenBalanceLoading(true);

    const fetchWalletTokenBalance = async () => {
      try {
        const nextBalance = await fetchFormattedTokenBalance(
          connection,
          publicKey,
          tokenMint,
          selectedToken.decimals
        );
        if (cancelled) return;
        setWalletTokenBalance(nextBalance);
      } catch {
        if (cancelled) return;
        setWalletTokenBalance(null);
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
    const currentPublic = params.has("public");
    const currentMinDelayMs = params.get("min") ?? "";
    const currentMaxDelayMs = params.get("max") ?? "";
    const currentSplit = params.get("split") ?? "";
    const currentTab = params.get("tab") ?? "";
    const nextMinDelayMs = shouldPersistRoutingParams ? String(minDelayMs) : "";
    const nextMaxDelayMs = shouldPersistRoutingParams ? String(maxDelayMs) : "";
    const nextSplit = shouldPersistRoutingParams ? String(split) : "";
    const hasForeignParams =
      SWAP_QUERY_PARAMS.some((key) => params.has(key)) ||
      REQUEST_QUERY_PARAMS.some((key) => params.has(key));

    if (
      currentReceiver === receiver &&
      currentMint === nextMint &&
      currentMemo === memo &&
      currentPublic === !isPrivate &&
      currentMinDelayMs === nextMinDelayMs &&
      currentMaxDelayMs === nextMaxDelayMs &&
      currentSplit === nextSplit &&
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

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [
    receiver,
    tokenMint,
    memo,
    isPrivate,
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

  const handleCopyAddress = useCallback(() => {
    if (publicKey) {
      navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [publicKey]);

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
      setSplit(clampSplit(nextSplit));
    },
    [resetResultState]
  );

  const signAndSendUnsignedTransaction = useCallback(
    async (
      unsignedTransaction: UnsignedPaymentTransaction,
      onBeforeSend?: () => void
    ) => {
      if (!publicKey || !signTransaction || !connected) {
        throw new Error("Wallet not connected");
      }

      if (unsignedTransaction.version !== "legacy") {
        throw new Error(
          `Unsupported transaction version: ${unsignedTransaction.version}`
        );
      }

      if (!unsignedTransaction.requiredSigners.includes(publicKey.toBase58())) {
        throw new Error("Wallet is not listed as a required signer");
      }

      const transaction = Transaction.from(
        base64ToUint8Array(unsignedTransaction.transactionBase64)
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
    [publicKey, signTransaction, connected, connection]
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

  const handleSend = useCallback(async () => {
    if (!publicKey || !signTransaction || !connected) return;
    if (!resolvedReceiver || isResolvingRecipient) return;
    if (!rawAmount || rawAmount === "0") return;

    setStatus("building");
    setError(null);
    setTxSignature(null);

    try {
      const buildRes = await fetch("/api/payments/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: publicKey.toBase58(),
          to: resolvedReceiver,
          mint: tokenMint,
          amount: rawAmount,
          visibility: isPrivate ? "private" : "public",
          ...(memo ? { memo } : {}),
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
        throw new Error(errData.error || `Build failed: ${buildRes.status}`);
      }

      const jsonResponse = await buildRes.json();
      console.log("Res:\n%s", JSON.stringify(jsonResponse, null, 2));

      const unsignedTransaction = jsonResponse as UnsignedPaymentTransaction;

      setStatus("signing");
      const signature = await signAndSendUnsignedTransaction(
        unsignedTransaction,
        () => setStatus("sending")
      );
      setTxSignature(signature);
      setStatus("confirmed");
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
    isValidReceiver,
    rawAmount,
    resolvedReceiver,
    tokenMint,
    isPrivate,
    memo,
    minDelayMs,
    maxDelayMs,
    split,
    connection,
    isResolvingRecipient,
    signAndSendUnsignedTransaction,
  ]);

  const handleReset = useCallback(() => {
    setStatus("idle");
    setTxSignature(null);
    setError(null);
    setAmount("");
    setMemo("");
  }, []);

  return (
    <>
      <div className="w-full max-w-[480px] mx-auto">
        <div className="rounded-2xl bg-[var(--surface-container)] border border-border/40 shadow-xl shadow-black/30 overflow-hidden">
          {/* Send Section */}
          <div className="mx-3 mt-3 mb-1">
            <div className="rounded-xl bg-[var(--surface-inner)] border border-border/50 p-4">
              <div className="text-xs text-muted-foreground mb-3">You send</div>
              <div className="flex items-center justify-between">
                <div>
                  {/* Temporary: restore onClick, hover styles, and ChevronDown below to re-enable token selection. */}
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
                    {/* <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> */}
                  </button>
                  {connected && publicKey && (
                    <div className="mt-1 px-1 text-xs text-muted-foreground">
                      Balance:{" "}
                      {isWalletTokenBalanceLoading
                        ? "..."
                        : `${walletTokenBalance ?? "0"} ${selectedToken.symbol}`}
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
                    ${amountUsd > 0 ? amountUsd.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "0"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Receiver Section */}
          <div className="mx-3 mt-2">
            <div className="rounded-xl bg-[var(--surface-inner)] border border-border/50 p-4">
              <div className="text-xs text-muted-foreground mb-3">Recipient</div>
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
                  <span className="text-foreground">{recipientPrimaryDomain}</span>
                </div>
              )}
              {receiver && isDomainReceiver && resolvedReceiver && !isResolvingRecipient && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Resolves to{" "}
                  <span className="font-mono text-foreground">
                    {shortenAddress(resolvedReceiver)}
                  </span>
                </div>
              )}
              {receiver && !isResolvingRecipient && isValidReceiver && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Balance:{" "}
                  {isRecipientTokenBalanceLoading
                    ? "..."
                    : `${recipientTokenBalance ?? "0"} ${selectedToken.symbol}`}
                </div>
              )}
              {receiver && !isResolvingRecipient && !isValidReceiver && !isDomainReceiver && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="w-3 h-3" />
                  Invalid Solana address
                </div>
              )}
            </div>
          </div>

          {/* Memo (optional) */}
          <div className="mx-3 mt-2">
            <div className="rounded-xl bg-[var(--surface-inner)] border border-border/30 px-4 py-3">
              <input
                type="text"
                value={memo}
                onChange={(e) => {
                  setMemo(e.target.value);
                  resetResultState();
                }}
                placeholder="Add a memo (optional)"
                maxLength={140}
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none"
              />
            </div>
          </div>

          {/* Private Transfer Toggle */}
          <div className="mx-3 mt-2">
            <div className="rounded-xl border border-border/30 bg-[var(--surface-inner)] transition-colors group hover:border-border/60">
              <label
                htmlFor="private-toggle"
                className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 select-none"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {isPrivate ? (
                    <ShieldCheck className="w-5 h-5 shrink-0 text-primary" />
                  ) : (
                    <Shield className="w-5 h-5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                  )}
                  <div className="min-w-0 text-left">
                    <div className="text-sm font-medium text-foreground">
                      Private transfer
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {isPrivate
                        ? routingSummary
                        : "Enable MagicBlock private transactions"}
                    </div>
                  </div>
                </div>

                {/* Material Design 3 Toggle Switch */}
                <div className="relative shrink-0">
                  <input
                    id="private-toggle"
                    type="checkbox"
                    checked={isPrivate}
                    onChange={() => setIsPrivate(!isPrivate)}
                    className="sr-only peer"
                  />
                  <div
                    className={[
                      "w-[52px] h-8 rounded-full border-2 transition-all duration-200",
                      isPrivate
                        ? "bg-primary border-primary"
                        : "bg-transparent border-muted-foreground/50",
                    ].join(" ")}
                  />
                  <div
                    className={[
                      "absolute rounded-full shadow-md transition-all duration-200 ease-in-out",
                      isPrivate
                        ? "top-1 left-[24px] w-6 h-6 bg-primary-foreground"
                        : "top-[6px] left-[6px] w-5 h-5 bg-muted-foreground",
                    ].join(" ")}
                  />
                  {isPrivate && (
                    <Check className="absolute top-1 left-[24px] w-6 h-6 p-1 text-primary pointer-events-none" />
                  )}
                </div>
              </label>

              <div
                className={`overflow-hidden transition-all duration-300 ease-in-out ${
                  isPrivate ? "max-h-24 opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                <div className="flex items-center gap-2 border-t border-border/20 px-4 pb-2.5 pt-2">
                  <div className="min-w-0 flex-1 px-1">
                    <Slider
                      aria-label="Private delay range"
                      value={[minDelayMs, maxDelayMs]}
                      min={0}
                      max={MAX_PRIVATE_DELAY_MS}
                      step={1000}
                      onValueChange={handleDelayRangeChange}
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {[1, 2, 4].map((preset) => {
                      const isActive = split === preset;
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => handleSplitChange(preset)}
                          className={`h-6 min-w-6 rounded-full px-1.5 text-[11px] font-medium transition-colors cursor-pointer ${
                            isActive
                              ? "bg-primary text-primary-foreground"
                              : "bg-secondary text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {preset}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="number"
                    aria-label="Custom split count"
                    min={1}
                    max={10}
                    step={1}
                    value={split}
                    onChange={(e) => {
                      const nextValue = parseInt(e.target.value, 10);
                      handleSplitChange(Number.isNaN(nextValue) ? 1 : nextValue);
                    }}
                    className="h-6 w-10 shrink-0 rounded-lg border border-border/50 bg-background px-1.5 text-center text-[11px] text-foreground outline-none [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Your address */}
          {connected && publicKey && (
            <div className="mx-3 mt-2 flex items-center justify-between px-4 py-2.5 rounded-xl bg-secondary/30">
              <div className="text-xs text-muted-foreground">
                Sending from{" "}
                <span className="font-mono text-foreground/70">
                  {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
                </span>
              </div>
              <button
                onClick={handleCopyAddress}
                className="p-1 rounded-md hover:bg-accent transition-colors cursor-pointer"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-success" />
                ) : (
                  <Copy className="w-3 h-3 text-muted-foreground" />
                )}
              </button>
            </div>
          )}

          {/* Error */}
          {error && status === "error" && (
            <div className="mx-3 mt-2 flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
              <span className="text-xs text-destructive">{error}</span>
              {txSignature && (
                <a
                  href={`https://explorer.solana.com/tx/${txSignature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 flex items-center gap-1 text-xs text-destructive hover:underline"
                >
                  View tx
                  <ExternalLink className="w-3 h-3" />
                </a>
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
                <span className="text-xs text-success">Payment sent!</span>
              </div>
              <a
                href={`https://explorer.solana.com/tx/${txSignature}`}
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

/* ---------- Payment Action Button ---------- */
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
