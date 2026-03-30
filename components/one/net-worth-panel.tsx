"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PRIVATE_BALANCE_REFRESH_EVENT } from "@/lib/private-balance-refresh";
import {
  clearStoredPrivateAuthToken,
  defaultPrivateBalanceMints,
  fetchPrivateBalance,
  fetchSplChallenge,
  formatBaseUnits,
  getStoredPrivateAuthToken,
  loginSplPrivate,
  setStoredPrivateAuthToken,
} from "@/lib/spl-private-balance";

export function NetWorthPanel() {
  const { connected, publicKey, signMessage } = useWallet();

  const owner = publicKey?.toBase58() ?? null;

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [authBusy, setAuthBusy] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const rows = useMemo(() => defaultPrivateBalanceMints(), []);

  useEffect(() => {
    if (!owner) {
      setAuthToken(null);
      setBalances({});
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
          rows.map(async ({ mint, decimals }) => {
            const row = await fetchPrivateBalance(owner, mint, token);
            next[mint] = formatBaseUnits(
              row.balance,
              decimals,
            );
          }),
        );
        setBalances(next);
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
      setBalances({});
      return;
    }
    void loadBalances(authToken);
  }, [owner, authToken, loadBalances]);

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
      const token = await loginSplPrivate({ pubkey: owner, challenge, signature });
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

  return (
    <div className="hidden xl:block fixed top-20 right-4 w-[220px] rounded-2xl bg-[var(--surface-container)] border border-border/40 p-4 shadow-lg shadow-black/20">
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground">Private Balance</div>

        {rows.map(({ mint, symbol, logo }) => (
          <div key={mint} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img
                src={logo}
                alt={symbol}
                className="w-5 h-5 rounded-full"
              />
              <span className="text-sm font-medium text-foreground">{symbol}</span>
            </div>
            <span className="text-sm text-foreground tabular-nums">
              {authToken
                ? balanceLoading
                  ? "…"
                  : (balances[mint] ?? "—")
                : "—"}
            </span>
          </div>
        ))}

        {balanceError && (
          <p className="text-xs text-destructive">{balanceError}</p>
        )}
      </div>

      {needsAuthOverlay && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl bg-background/55 backdrop-blur-md px-3 py-4 border border-border/30"
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
                <p className="text-xs text-center text-destructive">{authError}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
