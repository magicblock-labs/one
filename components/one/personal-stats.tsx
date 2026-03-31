"use client";

import { Gift, TrendingUp, Users, ArrowUpRight, Wallet } from "lucide-react";
import Link from "next/link";
import { useUnifiedWallet } from "@/app/wallet/solana-wallet-provider";

// Mock personal data - in production this would come from your backend
const MOCK_PERSONAL_DATA = {
  referralEarnings: 127.50,
  totalVolume: 4850,
  transactionCount: 23,
  referredUsers: 8,
};

export function PersonalStats() {
  const { connected } = useUnifiedWallet();

  if (!connected) {
    return (
      <div className="w-full max-w-[480px] mx-auto mb-6">
        <div className="rounded-2xl bg-[var(--surface-inner)] border border-border/50 p-5">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Wallet className="h-5 w-5" />
            <span className="text-sm">Connect your wallet to view personal stats and referral earnings</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[480px] mx-auto mb-6 space-y-4">
      {/* Referral Earnings Card */}
      <Link href="#referral-program" className="block group">
        <div className="rounded-2xl bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 p-5 transition-all hover:border-primary/40 hover:from-primary/15 hover:to-primary/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Gift className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">Referral Earnings</div>
                <div className="text-xs text-muted-foreground">
                  {MOCK_PERSONAL_DATA.referredUsers} users joined via your link
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-primary font-mono">
                ${MOCK_PERSONAL_DATA.referralEarnings.toFixed(2)}
              </span>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
          </div>
        </div>
      </Link>

      {/* Personal Volume Stats */}
      <div className="rounded-2xl bg-[var(--surface-inner)] border border-border/50 p-5">
        <div className="text-sm font-semibold text-foreground mb-4">Account Overview</div>
        
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center mx-auto mb-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-lg font-bold text-foreground font-mono">
              ${MOCK_PERSONAL_DATA.totalVolume.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">Total Volume</div>
          </div>

          <div className="text-center">
            <div className="w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center mx-auto mb-2">
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-lg font-bold text-foreground font-mono">
              {MOCK_PERSONAL_DATA.transactionCount}
            </div>
            <div className="text-xs text-muted-foreground">Transactions</div>
          </div>

          <div className="text-center">
            <div className="w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center mx-auto mb-2">
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-lg font-bold text-foreground font-mono">
              {MOCK_PERSONAL_DATA.referredUsers}
            </div>
            <div className="text-xs text-muted-foreground">Referrals</div>
          </div>
        </div>
      </div>
    </div>
  );
}
