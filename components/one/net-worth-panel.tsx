"use client";

import { useUnifiedWallet } from "@/app/wallet/solana-wallet-provider";

export function NetWorthPanel() {
  const { connected, openConnectModal } = useUnifiedWallet();

  return (
    <div className="hidden xl:block fixed top-20 right-4 w-[220px] rounded-2xl bg-[var(--surface-container)] border border-border/40 p-4 shadow-lg shadow-black/20">
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground">Private Balance</div>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
              alt="SOL"
              className="w-5 h-5 rounded-full"
            />
            <span className="text-sm font-medium text-foreground">SOL</span>
          </div>
          <span className="text-sm text-foreground">0.00</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png"
              alt="USDC"
              className="w-5 h-5 rounded-full"
            />
            <span className="text-sm font-medium text-foreground">USDC</span>
          </div>
          <span className="text-sm text-foreground">0.00</span>
        </div>
      </div>

      {!connected && (
        <button
          onClick={openConnectModal}
          className="w-full mt-4 py-2 rounded-xl border border-border/50 text-foreground text-sm font-medium hover:bg-secondary transition-colors cursor-pointer"
        >
          Connect
        </button>
      )}

    </div>
  );
}
