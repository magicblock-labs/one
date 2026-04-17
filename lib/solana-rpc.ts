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

export function createServerSolanaConnection() {
  return new Connection(SOLANA_SERVER_RPC_ENDPOINT, "confirmed");
}

export function createSwapServerSolanaConnection() {
  return new Connection(
    configuredSwapServerRpcEndpoint || DEFAULT_SWAP_SERVER_RPC_ENDPOINT,
    "confirmed"
  );
}

export { SOLANA_PUBLIC_RPC_ENDPOINT, SOLANA_SERVER_RPC_ENDPOINT };
