"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, Loader2 } from "lucide-react";
import { type AggregatorToken, POPULAR_SYMBOLS } from "@/lib/tokens";
import { useAggregatorTokens } from "@/hooks/use-aggregator-tokens";

interface TokenSelectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (token: AggregatorToken) => void;
  disabledMint?: string;
}

const BATCH_SIZE = 80;

export function TokenSelectModal({
  open,
  onOpenChange,
  onSelect,
  disabledMint,
}: TokenSelectModalProps) {
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const [failedImageMints, setFailedImageMints] = useState<Set<string>>(
    () => new Set()
  );
  const { tokens, isLoading: tokensLoading } = useAggregatorTokens();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset visible count when search changes or dialog opens
  useEffect(() => {
    setVisibleCount(BATCH_SIZE);
  }, [search, open]);

  const displayableTokens = useMemo(
    () => tokens.filter((token) => !failedImageMints.has(token.address)),
    [tokens, failedImageMints]
  );

  const popularTokens = useMemo(
    () =>
      POPULAR_SYMBOLS.map((s) =>
        displayableTokens.find((t) => t.symbol === s)
      ).filter(
        Boolean
      ) as AggregatorToken[],
    [displayableTokens]
  );

  const allFiltered = useMemo(() => {
    if (!search.trim()) return displayableTokens;
    const q = search.toLowerCase();
    return displayableTokens.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase() === q
    );
  }, [search, displayableTokens]);

  const visibleTokens = useMemo(
    () => allFiltered.slice(0, visibleCount),
    [allFiltered, visibleCount]
  );

  const hasMore = visibleCount < allFiltered.length;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      setVisibleCount((c) => Math.min(c + BATCH_SIZE, allFiltered.length));
    }
  }, [hasMore, allFiltered.length]);

  const handleSelect = (token: AggregatorToken) => {
    if (token.address === disabledMint) return;
    onSelect(token);
    onOpenChange(false);
    setSearch("");
  };

  const handleTokenImageError = useCallback((tokenMint: string) => {
    setFailedImageMints((current) => {
      if (current.has(tokenMint)) return current;

      const next = new Set(current);
      next.add(tokenMint);
      return next;
    });
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card p-0 gap-0" aria-describedby={undefined}>
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
            Select a token
            {!tokensLoading && tokens.length > 3 && (
              <span className="text-xs font-normal text-muted-foreground">
                {allFiltered.length.toLocaleString()} tokens
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Search Input */}
        <div className="px-5 pt-4 pb-3">
          <div className="flex items-center gap-2.5 rounded-xl border border-border bg-secondary px-3.5 py-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search name, symbol or paste address"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
              autoFocus
            />
          </div>
        </div>

        {/* Popular tokens */}
        {!search && (
          <div className="flex flex-wrap gap-2 px-5 pb-3">
            {popularTokens.map((token) => (
              <button
                key={token.address}
                onClick={() => handleSelect(token)}
                disabled={token.address === disabledMint}
                className="flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30 cursor-pointer"
              >
                {token.logoURI && (
                  <img
                    src={token.logoURI}
                    alt={token.symbol}
                    className="h-5 w-5 rounded-full"
                    crossOrigin="anonymous"
                    onError={() => handleTokenImageError(token.address)}
                  />
                )}
                {token.symbol}
              </button>
            ))}
          </div>
        )}

        <div className="mx-5 border-t border-border" />

        {/* Token List */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-80 overflow-y-auto"
        >
          {tokensLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Loading tokens from aggregator...
              </span>
            </div>
          ) : (
            <div className="flex flex-col py-1">
              {visibleTokens.map((token) => {
                const isDisabled = token.address === disabledMint;
                return (
                  <button
                    key={token.address}
                    onClick={() => handleSelect(token)}
                    disabled={isDisabled}
                    className="flex items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30 cursor-pointer"
                  >
                    {token.logoURI ? (
                      <img
                        src={token.logoURI}
                        alt={token.symbol}
                        className="h-8 w-8 rounded-full shrink-0"
                        crossOrigin="anonymous"
                        onError={() => handleTokenImageError(token.address)}
                      />
                    ) : null}
                    <div
                      className="h-8 w-8 rounded-full shrink-0 bg-accent items-center justify-center text-xs font-bold text-muted-foreground"
                      style={{ display: token.logoURI ? "none" : "flex" }}
                    >
                      {token.symbol.slice(0, 2)}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm font-semibold text-foreground">
                        {token.symbol}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {token.name}
                      </span>
                    </div>
                    {token.daily_volume != null && token.daily_volume > 0 && (
                      <span className="text-xs text-muted-foreground font-mono shrink-0">
                        ${token.daily_volume >= 1_000_000
                          ? `${(token.daily_volume / 1_000_000).toFixed(1)}M`
                          : token.daily_volume >= 1_000
                          ? `${(token.daily_volume / 1_000).toFixed(1)}K`
                          : token.daily_volume.toFixed(0)}
                      </span>
                    )}
                  </button>
                );
              })}
              {hasMore && (
                <div className="flex items-center justify-center py-3">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {allFiltered.length === 0 && (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No tokens found for &quot;{search}&quot;
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
