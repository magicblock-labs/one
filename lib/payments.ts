import { USDC_MINT } from "@/lib/tokens";

const DEFAULT_PAYMENTS_API_BASE_URL = "https://payments.magicblock.app";

const configuredPaymentsApiBaseUrl =
  process.env.PAYMENTS_API_BASE_URL?.trim() ??
  process.env.NEXT_PUBLIC_PAYMENTS_API_BASE_URL?.trim() ??
  "";

const configuredPaymentsCluster =
  process.env.CLUSTER?.trim() ||
  process.env.NEXT_PUBLIC_CLUSTER?.trim() ||
  process.env.PAYMENTS_CLUSTER?.trim() ||
  process.env.NEXT_PUBLIC_PAYMENTS_CLUSTER?.trim() ||
  "";
const configuredPaymentsTestUsdcMint =
  process.env.NEXT_PUBLIC_PAYMENTS_TEST_USDC_MINT?.trim() ?? "";

function normalizePaymentsCluster(value: string) {
  const normalizedValue = value.trim().toLowerCase();

  if (!normalizedValue) {
    return "";
  }

  if (normalizedValue === "devnet" || normalizedValue === "testnet") {
    return normalizedValue;
  }

  if (normalizedValue === "mainnet" || normalizedValue === "mainnet-beta") {
    return "mainnet";
  }

  const inferredCluster = normalizedValue.includes("devnet")
    ? "devnet"
    : normalizedValue.includes("testnet")
      ? "testnet"
      : normalizedValue.includes("mainnet")
        ? "mainnet"
        : "";

  return inferredCluster || value.trim();
}

export const PAYMENTS_API_BASE_URL = (
  configuredPaymentsApiBaseUrl || DEFAULT_PAYMENTS_API_BASE_URL
).replace(/\/+$/, "");

export const PAYMENTS_CLUSTER = normalizePaymentsCluster(configuredPaymentsCluster);
export const PAYMENTS_DEFAULT_USDC_MINT =
  configuredPaymentsTestUsdcMint || USDC_MINT;

export const PAYMENTS_ENDPOINTS = {
  initializeMint: "/v1/spl/initialize-mint",
  isMintInitialized: "/v1/spl/is-mint-initialized",
  splTransfer: "/v1/spl/transfer",
} as const;

export function getPaymentsApiUrl(path: string) {
  return new URL(path, `${PAYMENTS_API_BASE_URL}/`).toString();
}

export function getPaymentsTimeoutSignal(timeoutMs = 15_000) {
  return AbortSignal.timeout(timeoutMs);
}

export function getPaymentsExplorerTransactionUrl(signature: string) {
  const explorerUrl = new URL(
    `/tx/${encodeURIComponent(signature)}`,
    "https://explorer.solana.com"
  );

  if (PAYMENTS_CLUSTER === "devnet" || PAYMENTS_CLUSTER === "testnet") {
    explorerUrl.searchParams.set("cluster", PAYMENTS_CLUSTER);
  }

  return explorerUrl.toString();
}
