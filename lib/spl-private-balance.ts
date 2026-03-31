import { getPaymentsApiUrl, PAYMENTS_CLUSTER } from "@/lib/payments";

const STORAGE_PREFIX = "magicblock:spl-private-auth-token";

export function getStoredPrivateAuthToken(pubkeyBase58: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}:${pubkeyBase58}`);
  } catch {
    return null;
  }
}

export function setStoredPrivateAuthToken(
  pubkeyBase58: string,
  token: string,
) {
  localStorage.setItem(`${STORAGE_PREFIX}:${pubkeyBase58}`, token);
}

export function clearStoredPrivateAuthToken(pubkeyBase58: string) {
  localStorage.removeItem(`${STORAGE_PREFIX}:${pubkeyBase58}`);
}

export async function fetchSplChallenge(pubkeyBase58: string): Promise<string> {
  const params = new URLSearchParams({
    pubkey: pubkeyBase58,
  });
  const res = await fetch(getPaymentsApiUrl(`/v1/spl/challenge?${params}`));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Challenge failed (${res.status})`);
  }
  const data = (await res.json()) as { challenge?: string };
  if (!data.challenge) throw new Error("No challenge in response");
  return data.challenge;
}

export async function loginSplPrivate(params: {
  pubkey: string;
  challenge: string;
  signature: string;
}): Promise<string> {
  const res = await fetch(getPaymentsApiUrl("/v1/spl/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pubkey: params.pubkey,
      challenge: params.challenge,
      signature: params.signature,
      cluster: PAYMENTS_CLUSTER,
    }),
  });
  if (!res.ok) {
    let message = `Login failed (${res.status})`;
    try {
      const err = (await res.json()) as {
        error?: { message?: string };
      };
      if (err.error?.message) message = err.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("No token in login response");
  return data.token;
}

export type PrivateBalanceRow = {
  address: string;
  mint: string;
  ata: string;
  location: "base" | "ephemeral";
  balance: string;
};

export async function fetchPrivateBalance(
  owner: string,
  mint: string,
  authToken: string,
): Promise<PrivateBalanceRow> {
  const params = new URLSearchParams({
    address: owner,
    mint,
    cluster: PAYMENTS_CLUSTER,
  });
  const res = await fetch(
    getPaymentsApiUrl(`/v1/spl/private-balance?${params}`),
    { headers: { Authorization: `Bearer ${authToken}` } }
  );
  if (!res.ok) {
    let message = `Balance failed (${res.status})`;
    try {
      const err = (await res.json()) as {
        error?: { message?: string; code?: string };
      };
      if (err.error?.message) message = err.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<PrivateBalanceRow>;
}

export function formatBaseUnits(raw: string, decimals: number): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  const v = n / 10 ** decimals;
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(decimals, 6),
  });
}
