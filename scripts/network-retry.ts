const MAX_BACKOFF_DELAY_MS = 60_000;
const BACKOFF_STEP_THRESHOLD_MS = 16_000;

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getBackoffDelayMs(attempt: number) {
  let delayMs = 500;

  for (let currentAttempt = 1; currentAttempt < attempt; currentAttempt += 1) {
    delayMs =
      delayMs < BACKOFF_STEP_THRESHOLD_MS
        ? Math.min(BACKOFF_STEP_THRESHOLD_MS, delayMs * 2)
        : Math.min(MAX_BACKOFF_DELAY_MS, delayMs + 4_000);
  }

  return Math.min(MAX_BACKOFF_DELAY_MS, delayMs);
}

export function isRetriableNetworkError(message: string) {
  return /too many requests|429|fetch failed|timed out|timeout|network/i.test(message);
}

export async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  onRetry: (info: { attempt: number; delayMs: number; message: string }) => void,
  shouldRetry?: (message: string) => boolean
): Promise<T> {
  let attempt = 1;

  while (true) {
    try {
      return await fn();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = shouldRetry ? shouldRetry(message) : isRetriableNetworkError(message);
      if (!retryable) {
        throw error;
      }

      const delayMs = getBackoffDelayMs(attempt);
      onRetry({ attempt, delayMs, message });
      await sleep(delayMs);
      attempt += 1;
    }
  }
}
