const MAX_BACKOFF_DELAY_MS = 60_000;
const BACKOFF_STEP_THRESHOLD_MS = 16_000;
const INITIAL_BACKOFF_MIN_MS = 500;
const INITIAL_BACKOFF_MAX_MS = 900;

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomInteger(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function getBackoffDelayMs(attempt: number) {
  let minDelayMs = INITIAL_BACKOFF_MIN_MS;
  let maxDelayMs = INITIAL_BACKOFF_MAX_MS;

  for (let currentAttempt = 1; currentAttempt < attempt; currentAttempt += 1) {
    if (maxDelayMs < BACKOFF_STEP_THRESHOLD_MS) {
      minDelayMs = Math.min(BACKOFF_STEP_THRESHOLD_MS, minDelayMs * 2);
      maxDelayMs = Math.min(BACKOFF_STEP_THRESHOLD_MS, maxDelayMs * 2);
    } else {
      minDelayMs = Math.min(MAX_BACKOFF_DELAY_MS, minDelayMs + 4_000);
      maxDelayMs = Math.min(MAX_BACKOFF_DELAY_MS, maxDelayMs + 4_000);
    }
  }

  return getRandomInteger(
    Math.min(MAX_BACKOFF_DELAY_MS, minDelayMs),
    Math.min(MAX_BACKOFF_DELAY_MS, maxDelayMs)
  );
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
