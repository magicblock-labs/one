/** Fired after a successful payment transfer so private balance UIs can refetch. */
export const PRIVATE_BALANCE_REFRESH_EVENT = "magicblock:private-balance-refresh";

export function dispatchPrivateBalanceRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PRIVATE_BALANCE_REFRESH_EVENT));
}
