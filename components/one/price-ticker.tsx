"use client";

import { Star, Copy, Clock, ArrowUpRight } from "lucide-react";
import { useTokenPrice } from "@/hooks/use-sol-price";
import { SOL_MINT } from "@/lib/tokens";

export function PriceTicker() {
  const { price, change24h, isLoading } = useTokenPrice(SOL_MINT);

  const formattedPrice = isLoading ? "..." : `$${price.toFixed(2)}`;
  const formattedChange = isLoading
    ? "..."
    : `${change24h >= 0 ? "+" : ""}${change24h.toFixed(1)}%`;
  const isPositive = change24h >= 0;

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 bg-[var(--surface-container)] border-b border-border/30">
      <div className="flex items-center gap-3">
        <button className="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
          >
            <path
              d="M2 4h10M2 7h10M2 10h10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button className="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <Star className="w-3.5 h-3.5" />
        </button>
        <button className="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button className="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <Clock className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <div className="w-3 h-3 rounded-full bg-gradient-to-br from-[#9945FF] via-[#14F195] to-[#00D1FF]" />
        <span className="text-foreground font-medium">SOL</span>
        <span className="text-foreground">{formattedPrice}</span>
        <span
          className={
            isPositive ? "text-[var(--success)]" : "text-destructive"
          }
        >
          {formattedChange}
        </span>
      </div>

      <div className="ml-auto">
        <button className="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
