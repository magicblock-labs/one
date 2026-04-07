import { USDC_MINT } from "@/lib/tokens";

const DEFAULT_PAYMENTS_API_BASE_URL = "https://payments.magicblock.app";
const DEFAULT_PAYMENTS_CLUSTER = "devnet";

const configuredPaymentsApiBaseUrl =
  process.env.PAYMENTS_API_BASE_URL?.trim() ??
  process.env.NEXT_PUBLIC_PAYMENTS_API_BASE_URL?.trim() ??
  "";

const configuredPaymentsCluster =
  process.env.PAYMENTS_CLUSTER?.trim() ??
  process.env.NEXT_PUBLIC_PAYMENTS_CLUSTER?.trim() ??
  "";
const configuredPaymentsTestUsdcMint =
  process.env.NEXT_PUBLIC_PAYMENTS_TEST_USDC_MINT?.trim() ?? "";

export const PAYMENTS_API_BASE_URL = (
  configuredPaymentsApiBaseUrl || DEFAULT_PAYMENTS_API_BASE_URL
).replace(/\/+$/, "");

export const PAYMENTS_CLUSTER =
  configuredPaymentsCluster || DEFAULT_PAYMENTS_CLUSTER;
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
