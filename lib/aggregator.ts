const DEFAULT_API_BASE_URL = "https://api.jup.ag";
const DEFAULT_PUBLIC_BASE_URL = "https://lite-api.jup.ag";
const DEFAULT_SOLANA_RPC_ENDPOINT = "https://rpc.magicblock.app/mainnet";

type AggregatorQueryValue = string | number | boolean | null | undefined;

const configuredApiKey =
  process.env.AGGREGATOR_API_KEY?.trim() ??
  process.env.JUP_API_KEY?.trim() ??
  process.env.NEXT_PUBLIC_JUP_API_KEY?.trim() ??
  "";

const configuredBaseUrl =
  process.env.AGGREGATOR_API_BASE_URL?.trim() ??
  process.env.JUP_API_BASE_URL?.trim();

const configuredPublicRpcEndpoint =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ?? "";
const configuredServerRpcEndpoint =
  process.env.SOLANA_RPC_URL?.trim() ?? configuredPublicRpcEndpoint;

export const AGGREGATOR_API_KEY = configuredApiKey;
export const AGGREGATOR_BASE_URL = (
  configuredBaseUrl ||
  (AGGREGATOR_API_KEY ? DEFAULT_API_BASE_URL : DEFAULT_PUBLIC_BASE_URL)
).replace(/\/+$/, "");
export const SOLANA_PUBLIC_RPC_ENDPOINT =
  configuredPublicRpcEndpoint || DEFAULT_SOLANA_RPC_ENDPOINT;
export const SOLANA_SERVER_RPC_ENDPOINT =
  configuredServerRpcEndpoint || DEFAULT_SOLANA_RPC_ENDPOINT;

export const AGGREGATOR_ENDPOINTS = {
  swapQuote: "/swap/v1/quote",
  swap: "/swap/v1/swap",
  price: "/price/v3",
  tokensTag: "/tokens/v2/tag",
  tokensStrictListCdn: "https://cdn.jup.ag/token-list/strict.json",
} as const;

export function getAggregatorHeaders(contentType?: string): HeadersInit {
  const headers: HeadersInit = {};

  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  if (AGGREGATOR_API_KEY) {
    headers["x-api-key"] = AGGREGATOR_API_KEY;
  }

  return headers;
}

export function getAggregatorUrl(
  path: string,
  query?: Record<string, AggregatorQueryValue>
) {
  const url = new URL(path, `${AGGREGATOR_BASE_URL}/`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

export function getAggregatorTimeoutSignal(timeoutMs = 15_000) {
  return AbortSignal.timeout(timeoutMs);
}
