import useSWR from "swr";

export interface TokenPriceData {
  usd: number;
  usd_24h_change: number;
}

/** Prices keyed by mint address */
export type PriceMap = Record<string, TokenPriceData>;

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Fetch prices for a set of mint addresses.
 * If no mints provided, fetches the default popular set.
 */
export function usePrices(mints?: string[]) {
  const key = mints && mints.length > 0
    ? `/api/price?mints=${mints.join(",")}`
    : "/api/price";

  const { data, error, isLoading } = useSWR<PriceMap>(key, fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
    dedupingInterval: 15_000,
  });

  return { prices: data ?? {}, error, isLoading };
}

/** Convenience: get price for a single mint */
export function useTokenPrice(mint: string) {
  const { prices, error, isLoading } = usePrices([mint]);
  const tokenData = prices[mint];

  return {
    price: tokenData?.usd ?? 0,
    change24h: tokenData?.usd_24h_change ?? 0,
    error,
    isLoading,
  };
}
