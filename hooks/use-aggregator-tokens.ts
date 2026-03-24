import useSWR from "swr";
import {
  type AggregatorToken,
  FALLBACK_TOKENS,
  findToken as findTokenInList,
  findTokenByMint as findTokenByMintInList,
} from "@/lib/tokens";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
  return res.json();
};

export function useAggregatorTokens() {
  const { data, error, isLoading } = useSWR<AggregatorToken[]>(
    "/api/tokens",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 300_000, // 5 min
      keepPreviousData: true,
      errorRetryCount: 3,
    }
  );

  // Only use fallback if API returned nothing or errored
  const tokens = data && data.length > 3 ? data : FALLBACK_TOKENS;

  function findToken(symbol: string) {
    return findTokenInList(symbol, tokens);
  }

  function findByMint(mint: string) {
    return findTokenByMintInList(mint, tokens);
  }

  return { tokens, error, isLoading, findToken, findByMint };
}

export const useJupiterTokens = useAggregatorTokens;
