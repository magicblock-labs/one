"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { Copy, LogOut, ChevronDown, Wallet } from "lucide-react";

interface WalletButtonProps {
  variant?: "header" | "swap";
}

export function WalletButton({ variant = "header" }: WalletButtonProps) {
  const { publicKey, wallet, disconnect, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [showMenu, setShowMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const address = useMemo(() => {
    if (!publicKey) return "";
    const base58 = publicKey.toBase58();
    return `${base58.slice(0, 4)}...${base58.slice(-4)}`;
  }, [publicKey]);

  const handleClick = useCallback(() => {
    if (connected) {
      setShowMenu((prev) => !prev);
    } else {
      setVisible(true);
    }
  }, [connected, setVisible]);

  const handleCopy = useCallback(() => {
    if (publicKey) {
      navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [publicKey]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    setShowMenu(false);
  }, [disconnect]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (variant === "swap") {
    return (
      <button
        onClick={handleClick}
        className="w-full rounded-xl bg-primary py-4 text-lg font-semibold text-primary-foreground transition-all hover:brightness-105 active:scale-[0.99] cursor-pointer"
      >
        {connected ? `Connected: ${address}` : "Connect Wallet"}
      </button>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={handleClick}
        className="flex items-center gap-2 rounded-full border border-border bg-transparent px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent cursor-pointer"
      >
        {connected && wallet?.adapter.icon ? (
          <img
            src={wallet.adapter.icon}
            alt={wallet.adapter.name}
            className="h-4 w-4 rounded-sm"
          />
        ) : (
          <Wallet className="h-4 w-4" />
        )}
        {connected ? address : "Connect"}
        {connected && <ChevronDown className="h-3 w-3 text-muted-foreground" />}
      </button>

      {showMenu && connected && (
        <div className="absolute right-0 top-full z-50 mt-2 w-52 rounded-xl border border-border bg-card p-1.5 shadow-2xl">
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
        </div>
      )}
    </div>
  );
}
