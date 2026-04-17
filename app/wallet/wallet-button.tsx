"use client";

import { useCallback, useState } from "react";
import { Copy, LogOut, ChevronDown, Wallet } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUnifiedWallet } from "@/app/wallet/solana-wallet-provider";

interface WalletButtonProps {
  variant?: "header" | "swap";
}

export function WalletButton({ variant = "header" }: WalletButtonProps) {
  const {
    connected,
    connectPrivyWallet,
    connectSolanaWallet,
    disconnect,
    displayAddress,
    address,
    openConnectModal,
    walletIcon,
    walletLabel,
  } = useUnifiedWallet();
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(() => {
    if (!connected) {
      openConnectModal();
    }
  }, [connected, openConnectModal]);

  const handleCopy = useCallback(() => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [address]);

  const handleDisconnect = useCallback(() => {
    void disconnect();
  }, [disconnect]);

  if (variant === "swap") {
    return (
      <button
        onClick={handleClick}
        className="w-full rounded-xl bg-primary py-4 text-lg font-semibold text-primary-foreground transition-all hover:brightness-105 active:scale-[0.99] cursor-pointer"
      >
        {connected ? `Connected: ${displayAddress}` : "Connect Wallet"}
      </button>
    );
  }

  if (!connected) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-2 rounded-full border border-border bg-transparent px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent cursor-pointer"
          >
            <Wallet className="h-4 w-4" />
            Connect
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            onSelect={connectSolanaWallet}
            className="cursor-pointer"
          >
            Solana wallet
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void connectPrivyWallet();
            }}
            className="cursor-pointer"
          >
            Privy
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-2 rounded-full border border-border bg-transparent px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent cursor-pointer"
          >
            {walletIcon ? (
              <img
                src={walletIcon}
                alt={walletLabel ?? "Wallet"}
                className="h-4 w-4 rounded-sm"
              />
            ) : (
              <Wallet className="h-4 w-4" />
            )}
            {displayAddress}
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem disabled>
            Connected via {walletLabel ?? "wallet"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <button
            onClick={handleCopy}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-accent cursor-pointer"
          >
            <Copy className="h-4 w-4 text-muted-foreground" />
            {copied ? "Copied!" : "Copy Address"}
          </button>
          <button
            onClick={handleDisconnect}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-destructive transition-colors hover:bg-accent cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            Disconnect
          </button>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
