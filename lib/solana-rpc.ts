import { Connection } from "@solana/web3.js";
import {
  SOLANA_PUBLIC_RPC_ENDPOINT,
  SOLANA_SERVER_RPC_ENDPOINT,
} from "@/lib/aggregator";

const DEFAULT_SWAP_SERVER_RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";

const configuredSwapServerRpcEndpoint =
  process.env.SWAP_SOLANA_RPC_URL?.trim() ??
  process.env.JUP_SWAP_SOLANA_RPC_URL?.trim() ??
  "";
const configuredPaymentsEphemeralRpcEndpoint =
  process.env.PAYMENTS_EPHEMERAL_RPC_URL?.trim() ??
  process.env.EPHEMERAL_RPC_URL?.trim() ??
  process.env.NEXT_PUBLIC_PAYMENTS_EPHEMERAL_RPC_URL?.trim() ??
  process.env.NEXT_PUBLIC_EPHEMERAL_RPC_URL?.trim() ??
  "";

export function createServerSolanaConnection() {
  return new Connection(SOLANA_SERVER_RPC_ENDPOINT, "confirmed");
}

export function createSwapServerSolanaConnection() {
  return new Connection(
    configuredSwapServerRpcEndpoint || DEFAULT_SWAP_SERVER_RPC_ENDPOINT,
    "confirmed"
  );
}

export function createPaymentsEphemeralConnection(authToken?: string) {
  if (!configuredPaymentsEphemeralRpcEndpoint) {
    throw new Error("Missing PAYMENTS_EPHEMERAL_RPC_URL or EPHEMERAL_RPC_URL");
  }

  if (!authToken) {
    return new Connection(configuredPaymentsEphemeralRpcEndpoint, "confirmed");
  }

  const endpoint = new URL(configuredPaymentsEphemeralRpcEndpoint);
  endpoint.searchParams.set("token", authToken);

  return new Connection(endpoint.toString(), "confirmed");
}

export { SOLANA_PUBLIC_RPC_ENDPOINT, SOLANA_SERVER_RPC_ENDPOINT };
