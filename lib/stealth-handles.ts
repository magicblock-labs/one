export const STEALTH_HANDLE_SUFFIX = ".block";
export const STEALTH_HANDLE_MAX_BYTES = 64;
export const STEALTH_POOL_MAX_DESTINATIONS = 10;

const STORAGE_PREFIX = "magicblock:stealth-handle";
const STEALTH_HANDLE_PATTERN = /^[a-z0-9][a-z0-9._-]*\.block$/;
const textEncoder = new TextEncoder();

export function getExactStealthHandleInput(value: string) {
  return value.trim();
}

export function isStealthHandleInput(value: string) {
  return (
    STEALTH_HANDLE_PATTERN.test(value) &&
    textEncoder.encode(value).length <= STEALTH_HANDLE_MAX_BYTES
  );
}

export function getStealthHandleByteLength(value: string) {
  return textEncoder.encode(value).length;
}

export function getStoredStealthHandle(owner: string): string | null {
  if (typeof window === "undefined") return null;

  try {
    return localStorage.getItem(`${STORAGE_PREFIX}:${owner}`);
  } catch {
    return null;
  }
}

export function setStoredStealthHandle(owner: string, handle: string) {
  localStorage.setItem(`${STORAGE_PREFIX}:${owner}`, handle);
}
