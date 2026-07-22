import { getPaymentsApiUrl, PAYMENTS_CLUSTER } from "@/lib/payments";

const STORAGE_PREFIX = "magicblock:spl-private-auth-token";
const PRIVATE_BALANCE_MINTS_STORAGE_PREFIX =
  "magicblock:spl-private-positive-balance-mints";
export const PRIVATE_AUTH_TOKEN_EVENT = "magicblock:spl-private-auth-token";
export const PRIVATE_BALANCE_MINTS_EVENT =
  "magicblock:spl-private-balance-mints";

function dispatchPrivateAuthTokenEvent(pubkeyBase58: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(PRIVATE_AUTH_TOKEN_EVENT, {
      detail: { pubkey: pubkeyBase58 },
    }),
  );
}

function dispatchPrivateBalanceMintsEvent(pubkeyBase58: string, mint: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(PRIVATE_BALANCE_MINTS_EVENT, {
      detail: { pubkey: pubkeyBase58, mint },
    }),
  );
}

function isPositiveBaseUnits(raw: string) {
  try {
    return BigInt(raw) > BigInt(0);
  } catch {
    return false;
  }
}

export function getStoredPrivateBalanceMints(pubkeyBase58: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(
      `${PRIVATE_BALANCE_MINTS_STORAGE_PREFIX}:${pubkeyBase58}`,
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(parsed.filter((mint): mint is string => typeof mint === "string")),
    );
  } catch {
    return [];
  }
}

function storePrivateBalanceMint(pubkeyBase58: string, mint: string) {
  if (typeof window === "undefined") return;
  try {
    const storedMints = getStoredPrivateBalanceMints(pubkeyBase58);
    if (storedMints.includes(mint)) return;

    localStorage.setItem(
      `${PRIVATE_BALANCE_MINTS_STORAGE_PREFIX}:${pubkeyBase58}`,
      JSON.stringify([...storedMints, mint]),
    );
    dispatchPrivateBalanceMintsEvent(pubkeyBase58, mint);
  } catch {
    /* ignore storage failures */
  }
}

export function getStoredPrivateAuthToken(pubkeyBase58: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}:${pubkeyBase58}`);
  } catch {
    return null;
  }
}

export function setStoredPrivateAuthToken(pubkeyBase58: string, token: string) {
  localStorage.setItem(`${STORAGE_PREFIX}:${pubkeyBase58}`, token);
  dispatchPrivateAuthTokenEvent(pubkeyBase58);
}

export function clearStoredPrivateAuthToken(pubkeyBase58: string) {
  localStorage.removeItem(`${STORAGE_PREFIX}:${pubkeyBase58}`);
  dispatchPrivateAuthTokenEvent(pubkeyBase58);
}

export async function fetchSplChallenge(pubkeyBase58: string): Promise<string> {
  const params = new URLSearchParams({
    pubkey: pubkeyBase58,
  });
  if (PAYMENTS_CLUSTER) {
    params.set("cluster", PAYMENTS_CLUSTER);
  }
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
      ...(PAYMENTS_CLUSTER ? { cluster: PAYMENTS_CLUSTER } : {}),
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
  });
  if (PAYMENTS_CLUSTER) {
    params.set("cluster", PAYMENTS_CLUSTER);
  }
  const res = await fetch(
    getPaymentsApiUrl(`/v1/spl/private-balance?${params}`),
    { headers: { Authorization: `Bearer ${authToken}` } },
  );
  if (!res.ok) {
    let message = `Balance failed (${res.status})`;
    try {
      const err = (await res.json()) as {
        error?: {
          message?: string;
          code?: string;
          details?: { message?: string };
        };
      };
      if (err.error?.message) message = err.error.message;
      if (err.error?.details?.message) {
        message = `${message}: ${err.error.details.message}`;
      }
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const row = (await res.json()) as PrivateBalanceRow;
  if (isPositiveBaseUnits(row.balance)) {
    storePrivateBalanceMint(owner, row.mint || mint);
  }
  return row;
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
