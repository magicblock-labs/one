"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

const WalletProviders = dynamic(
  () =>
    import("@/app/wallet/solana-wallet-provider").then(
      (module) => module.SolanaWalletProvider
    ),
  {
    ssr: false,
  }
);

export function Providers({ children }: { children: ReactNode }) {
  return <WalletProviders>{children}</WalletProviders>;
}
