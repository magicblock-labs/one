import { Connection } from "@solana/web3.js";
import {
  SOLANA_PUBLIC_RPC_ENDPOINT,
  SOLANA_SERVER_RPC_ENDPOINT,
} from "@/lib/aggregator";

export function createServerSolanaConnection() {
  return new Connection(SOLANA_SERVER_RPC_ENDPOINT, "confirmed");
}

export { SOLANA_PUBLIC_RPC_ENDPOINT, SOLANA_SERVER_RPC_ENDPOINT };
