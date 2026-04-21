"use client";

import bs58 from "bs58";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useUnifiedWallet } from "@/app/wallet/solana-wallet-provider";
import { useAggregatorTokens } from "@/hooks/use-aggregator-tokens";
import { PRIVATE_BALANCE_REFRESH_EVENT } from "@/lib/private-balance-refresh";
import { PAYMENTS_DEFAULT_USDC_MINT } from "@/lib/payments";
import {
  clearStoredPrivateAuthToken,
  fetchPrivateBalance,
  fetchSplChallenge,
  formatBaseUnits,
  getStoredPrivateAuthToken,
  loginSplPrivate,
  setStoredPrivateAuthToken,
} from "@/lib/spl-private-balance";
import { findTokenByMint, SOL_MINT } from "@/lib/tokens";

export function NetWorthPanel() {
  const { connected, publicKey, signMessage } = useUnifiedWallet();
  const { tokens } = useAggregatorTokens();

  const owner = publicKey?.toBase58() ?? null;

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [rawBalances, setRawBalances] = useState<Record<string, string>>({});
  const [authBusy, setAuthBusy] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const rows = useMemo(() => {
    return [SOL_MINT, PAYMENTS_DEFAULT_USDC_MINT].map((mint) => {
      const meta = findTokenByMint(mint, tokens) ?? findTokenByMint(mint);
      return {
        mint,
        decimals: meta?.decimals ?? (mint === SOL_MINT ? 9 : 6),
        symbol: meta?.symbol ?? mint.slice(0, 4),
        logoURI: meta?.logoURI ?? "",
      };
    });
  }, [tokens]);

  useEffect(() => {
    if (!owner) {
      setAuthToken(null);
      setRawBalances({});
      return;
    }
    setAuthToken(getStoredPrivateAuthToken(owner));
  }, [owner]);

  const loadBalances = useCallback(
    async (token: string) => {
      if (!owner) return;
      setBalanceLoading(true);
      setBalanceError(null);
      try {
        const next: Record<string, string> = {};
        await Promise.all(
          rows.map(async ({ mint }) => {
            const row = await fetchPrivateBalance(owner, mint, token);
            next[mint] = row.balance;
          }),
        );
        setRawBalances(next);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load balances";
        setBalanceError(msg);
        clearStoredPrivateAuthToken(owner);
        setAuthToken(null);
      } finally {
        setBalanceLoading(false);
      }
    },
    [owner, rows],
  );

  useEffect(() => {
    if (!owner || !authToken) {
      setRawBalances({});
      return;
    }
    void loadBalances(authToken);
  }, [owner, authToken, loadBalances]);

  const displayRows = useMemo(() => {
    const usdcRow = rows.find((r) => r.mint === PAYMENTS_DEFAULT_USDC_MINT);
    if (!authToken) {
      return usdcRow ? [usdcRow] : [];
    }
    if (balanceLoading) {
      return usdcRow ? [usdcRow] : [];
    }
    const nonzero = rows.filter(({ mint }) => {
      const raw = rawBalances[mint];
      if (raw === undefined) return false;
      try {
        return BigInt(raw) > BigInt(0);
      } catch {
        return false;
      }
    });
    if (nonzero.length > 0) return nonzero;
    return usdcRow ? [usdcRow] : [];
  }, [rows, rawBalances, authToken, balanceLoading]);

  useEffect(() => {
    if (!authToken) return;
    const onRefresh = () => {
      void loadBalances(authToken);
    };
    window.addEventListener(PRIVATE_BALANCE_REFRESH_EVENT, onRefresh);
    return () =>
      window.removeEventListener(PRIVATE_BALANCE_REFRESH_EVENT, onRefresh);
  }, [authToken, loadBalances]);

  const needsAuthOverlay = Boolean(owner && !authToken);

  const handleAuthenticate = async () => {
    if (!owner || !signMessage) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      const challenge = await fetchSplChallenge(owner);
      const message = new TextEncoder().encode(challenge);
      const sigBytes = await signMessage(message);
      const signature = bs58.encode(sigBytes);
      const token = await loginSplPrivate({
        pubkey: owner,
        challenge,
        signature,
      });
      setStoredPrivateAuthToken(owner, token);
      setAuthToken(token);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Authentication failed";
      setAuthError(msg);
    } finally {
      setAuthBusy(false);
    }
  };

  if (!connected || !publicKey) {
    return null;
  }

  const balanceLabel = (mint: string, decimals: number) => {
    if (!authToken) return "—";
    if (balanceLoading) return "…";
    const raw = rawBalances[mint] ?? "0";
    return formatBaseUnits(raw, decimals);
  };

  return (
    <div className="hidden xl:block fixed top-20 right-4 w-[220px] rounded-2xl bg-[var(--surface-container)] border border-border/40 p-4 shadow-lg shadow-black/20">
      {needsAuthOverlay ? (
        <div
          className="inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl"
          aria-live="polite"
        >
          <p className="text-xs text-center text-muted-foreground">
            Authenticate to load private balances.
          </p>
          {!signMessage ? (
            <p className="text-xs text-center text-destructive">
              This wallet does not support message signing.
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void handleAuthenticate()}
                disabled={authBusy}
                className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
              >
                {authBusy ? "Signing…" : "Authenticate"}
              </button>
              {authError && (
                <p className="text-xs text-center text-destructive">
                  {authError}
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">Private Balance</div>

          {displayRows.map(({ mint, symbol, logoURI, decimals }) => (
            <div key={mint} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {logoURI ? (
                  <img src={logoURI} alt="" className="w-5 h-5 rounded-full" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground">
                    {symbol.charAt(0)}
                  </div>
                )}
                <span className="text-sm font-medium text-foreground">
                  {symbol}
                </span>
              </div>
              <span className="text-sm text-foreground tabular-nums">
                {balanceLabel(mint, decimals)}
              </span>
            </div>
          ))}

          {balanceError && (
            <p className="text-xs text-destructive">{balanceError}</p>
          )}
        </div>
      )}
    </div>
  );
}
