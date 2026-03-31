"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  ArrowDownUp,
  ChevronDown,
  Copy,
  Loader2,
  ExternalLink,
  AlertTriangle,
  Settings2,
  Check,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import {
  type AggregatorToken,
  DEFAULT_SELL_MINT,
  DEFAULT_BUY_MINT,
  FALLBACK_TOKENS,
  findTokenByMint,
} from "@/lib/tokens";
import { usePrices } from "@/hooks/use-sol-price";
import { useAggregatorTokens } from "@/hooks/use-aggregator-tokens";
import { useSwap, type SwapStatus } from "@/hooks/use-swap";
import { TokenSelectModal } from "./token-select-modal";
import { useUnifiedWallet } from "@/app/wallet/solana-wallet-provider";

const tabs = [
  "Market",
  // "Limit",
  // "Recurring",
];
const SLIPPAGE_PRESETS = [50, 100, 300]; // 0.5%, 1%, 3%

interface SwapCardProps {
  initialBuyMint?: string;
  initialSellMint?: string;
  initialAmount?: string;
}

function getInitialMint(mint: string | undefined, fallbackMint: string) {
  return mint && findTokenByMint(mint) ? mint : fallbackMint;
}

function getInitialAmount(amount: string | undefined) {
  return amount && /^\d*\.?\d*$/.test(amount) ? amount : "";
}

export function SwapCard({
  initialBuyMint,
  initialSellMint,
  initialAmount,
}: SwapCardProps) {
  const { connected, openConnectModal } = useUnifiedWallet();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSelectionKeyRef = useRef<string | null>(null);

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
    enabled: rawAmount !== "0" && sellMint !== buyMint,
  });

  useEffect(() => {
    if (!initialSellMint && !initialBuyMint && !initialAmount) {
      urlSelectionKeyRef.current = null;
      return;
    }

    const nextAmount = getInitialAmount(initialAmount);
    const nextKey = `${initialSellMint ?? ""}:${initialBuyMint ?? ""}:${nextAmount}`;
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
    resetSwap();
    urlSelectionKeyRef.current = nextKey;
  }, [initialSellMint, initialBuyMint, initialAmount, tokens, tokensLoading, resetSwap]);

  const buyUsd = useMemo(() => {
    const buyPrice = prices[buyMint]?.usd ?? 0;
    return outputAmount * buyPrice;
  }, [outputAmount, prices, buyMint]);

  const updateSwapUrl = useCallback(
    (nextSellMint: string, nextBuyMint: string, nextSellAmount: string) => {
      urlSelectionKeyRef.current = `${nextSellMint}:${nextBuyMint}:${nextSellAmount}`;
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
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const handleSwapTokens = useCallback(() => {
    const nextSellMint = buyMint;
    const nextBuyMint = sellMint;
    setSellMint(nextSellMint);
    setBuyMint(nextBuyMint);
    setSellAmount("");
    resetSwap();
    updateSwapUrl(nextSellMint, nextBuyMint, "");
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
      updateSwapUrl(nextSellMint, nextBuyMint, sellAmount);
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
      updateSwapUrl(nextSellMint, nextBuyMint, sellAmount);
    } catch {
      // Clipboard access can fail due to browser permissions; ignore silently.
    }
  }, [tokens, sellMint, buyMint, sellAmount, resetSwap, updateSwapUrl]);

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
                        updateSwapUrl(sellMint, buyMint, v);
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

          {/* Success */}
          {status === "confirmed" && txSignature && (
            <div className="mx-3 mt-2 flex items-center justify-between px-3 py-2 rounded-lg bg-success/10 border border-success/20">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-success" />
                <span className="text-xs text-success">Swap successful!</span>
              </div>
              <a
                href={`https://solscan.io/tx/${txSignature}`}
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
        {isHighImpact ? `Swap Anyway (${priceImpact.toFixed(2)}% impact)` : `Swap ${sellSymbol} for ${buySymbol}`}
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
