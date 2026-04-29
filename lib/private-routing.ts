export const MAX_PRIVATE_DELAY_MS = 5 * 60 * 1000;

export function clampPrivateSplit(value: number) {
  return Math.min(10, Math.max(1, value));
}

export function formatPrivateDelayValue(delayMs: number) {
  if (delayMs >= 60_000) {
    const minutes = delayMs / 60_000;
    const roundedMinutes = Number.isInteger(minutes)
      ? minutes.toString()
      : minutes.toFixed(1).replace(/\.0$/, "");

    return `${roundedMinutes} min`;
  }

  if (delayMs >= 1_000) {
    const seconds = delayMs / 1_000;
    const roundedSeconds = Number.isInteger(seconds)
      ? seconds.toString()
      : seconds.toFixed(1).replace(/\.0$/, "");

    return `${roundedSeconds} sec`;
  }

  return `${delayMs} ms`;
}

export function formatPrivateRoutingSummary(
  split: number,
  minDelayMs: number,
  maxDelayMs: number
) {
  const splitLabel = split === 1 ? "1 split" : `${split} splits`;

  if (minDelayMs === 0 && maxDelayMs === 0) {
    return split === 1 ? "Immediate transfer" : `${splitLabel}. Immediate transfer`;
  }

  if (minDelayMs === maxDelayMs) {
    return `${splitLabel} scheduled at ${formatPrivateDelayValue(minDelayMs)}`;
  }

  return `${splitLabel} across ${formatPrivateDelayValue(minDelayMs)}-${formatPrivateDelayValue(maxDelayMs)}`;
}
