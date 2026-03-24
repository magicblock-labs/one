import { NextResponse } from "next/server";
import type { AggregatorToken } from "@/lib/tokens";
import {
  AGGREGATOR_ENDPOINTS,
  getAggregatorHeaders,
  getAggregatorTimeoutSignal,
  getAggregatorUrl,
} from "@/lib/aggregator";

// In-memory cache so we don't hammer the API
let cache: { data: AggregatorToken[]; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Aggregator token response shape (Jupiter-compatible V2):
 *   id, name, symbol, decimals, icon, tags[], daily_volume, ...
 *
 * We normalize to our AggregatorToken shape: address, logoURI, etc.
 */
interface JupV2Token {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  icon: string;
  tags?: string[];
  daily_volume?: number;
  stats24h?: {
    buyVolume?: number;
    sellVolume?: number;
  };
  freeze_authority?: string | null;
  mint_authority?: string | null;
}

function normalizeV2(raw: JupV2Token[]): AggregatorToken[] {
  return raw
    .filter((t) => t.symbol && t.name && t.id)
    .map((t) => ({
      address: t.id,
      name: t.name,
      symbol: t.symbol,
      decimals: t.decimals,
      logoURI: t.icon ?? "",
      tags: t.tags,
      daily_volume:
        t.daily_volume ??
        (t.stats24h?.buyVolume ?? 0) + (t.stats24h?.sellVolume ?? 0),
      freeze_authority: t.freeze_authority ?? null,
      mint_authority: t.mint_authority ?? null,
    }))
    .sort((a, b) => (b.daily_volume ?? 0) - (a.daily_volume ?? 0));
}

async function fetchTokens(): Promise<AggregatorToken[]> {
  // Return cache if valid
  if (cache && Date.now() - cache.ts < CACHE_TTL && cache.data.length > 10) {
    return cache.data;
  }

  // Attempt 1: Tokens V2 verified tag.
  try {
    const res = await fetch(
      getAggregatorUrl(AGGREGATOR_ENDPOINTS.tokensTag, { query: "verified" }),
      {
        headers: getAggregatorHeaders(),
        signal: getAggregatorTimeoutSignal(),
        next: { revalidate: 300 },
      }
    );
    if (res.ok) {
      const raw: JupV2Token[] = await res.json();
      if (raw.length > 10) {
        const tokens = normalizeV2(raw);
        cache = { data: tokens, ts: Date.now() };
        return tokens;
      }
    }
  } catch {
    // fall through
  }

  // Attempt 2: Static compatible token-list CDN fallback.
  try {
    const res = await fetch(
      AGGREGATOR_ENDPOINTS.tokensStrictListCdn,
      {
        signal: getAggregatorTimeoutSignal(),
        next: { revalidate: 300 },
      }
    );
    if (res.ok) {
      const raw: AggregatorToken[] = await res.json();
      if (raw.length > 10) {
        const tokens = raw
          .filter((t) => t.symbol && t.name && t.address)
          .sort((a, b) => (b.daily_volume ?? 0) - (a.daily_volume ?? 0));
        cache = { data: tokens, ts: Date.now() };
        return tokens;
      }
    }
  } catch {
    // fall through
  }

  return [];
}

export async function GET() {
  try {
    const tokens = await fetchTokens();

    if (tokens.length > 0) {
      return NextResponse.json(tokens, {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      });
    }

    const { FALLBACK_TOKENS } = await import("@/lib/tokens");
    return NextResponse.json(FALLBACK_TOKENS);
  } catch {
    const { FALLBACK_TOKENS } = await import("@/lib/tokens");
    return NextResponse.json(FALLBACK_TOKENS);
  }
}
