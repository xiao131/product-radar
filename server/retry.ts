export class RetryableProviderError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

function delay(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    retries: number;
    baseDelayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  },
) {
  const baseDelayMs = options.baseDelayMs ?? 400;
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      const retry =
        attempt < options.retries &&
        (options.shouldRetry?.(error) ??
          (error instanceof RetryableProviderError ||
            (error instanceof Error && error.name === "TimeoutError")));
      if (!retry) throw error;
      const retryAfter =
        error instanceof RetryableProviderError ? error.retryAfterMs : undefined;
      const jitter = Math.floor(Math.random() * 200);
      await delay(retryAfter ?? baseDelayMs * 2 ** attempt + jitter);
      attempt += 1;
    }
  }
}
