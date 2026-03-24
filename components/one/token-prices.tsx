"use client";

import { useAggregatorTokens } from "@/hooks/use-aggregator-tokens";
import { SOL_MINT, USDC_MINT } from "@/lib/tokens";

// Mock total volume data - in production this would come from your backend
const TOTAL_VOLUMES = {
  USDC: { volume: 1247832.45, txCount: 3421 },
  SOL: { volume: 15234.78, txCount: 2156 },
};

export function TokenPrices() {
  const { findByMint } = useAggregatorTokens();

  const usdcToken = findByMint(USDC_MINT);
  const solToken = findByMint(SOL_MINT);

  return (
    <div className="flex items-center justify-center gap-3 mt-5 w-full max-w-[480px] mx-auto">
      {/* USDC Volume */}
      <div className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--surface-inner)] border border-border/50">
        {usdcToken && (
          <img
            src={usdcToken.logoURI}
            alt={usdcToken.symbol}
            className="w-8 h-8 rounded-full"
            crossOrigin="anonymous"
          />
        )}
        <div className="text-left flex-1">
          <div className="text-xs text-muted-foreground">USDC Volume</div>
          <div className="text-sm font-semibold text-foreground font-mono">
            ${TOTAL_VOLUMES.USDC.volume.toLocaleString(undefined, {
              maximumFractionDigits: 0,
            })}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Txns</div>
          <div className="text-sm font-medium text-foreground font-mono">
            {TOTAL_VOLUMES.USDC.txCount.toLocaleString()}
          </div>
        </div>
      </div>

      {/* SOL Volume */}
      <div className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--surface-inner)] border border-border/50">
        {solToken && (
          <img
            src={solToken.logoURI}
            alt={solToken.symbol}
            className="w-8 h-8 rounded-full"
            crossOrigin="anonymous"
          />
        )}
        <div className="text-left flex-1">
          <div className="text-xs text-muted-foreground">SOL Volume</div>
          <div className="text-sm font-semibold text-foreground font-mono">
            {TOTAL_VOLUMES.SOL.volume.toLocaleString(undefined, {
              maximumFractionDigits: 0,
            })}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Txns</div>
          <div className="text-sm font-medium text-foreground font-mono">
            {TOTAL_VOLUMES.SOL.txCount.toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}
