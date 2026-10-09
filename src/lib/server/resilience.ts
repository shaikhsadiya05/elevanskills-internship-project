export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class TokenBucket {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    now = Date.now(),
  ) {
    this.tokens = capacity;
    this.updatedAt = now;
  }

  take(now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const elapsedSeconds = Math.max(0, now - this.updatedAt) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.updatedAt = now;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - this.tokens) / this.refillPerSecond)),
    };
  }
}

export class KeyedTokenBuckets {
  private readonly buckets = new Map<string, { bucket: TokenBucket; lastSeen: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly maxKeys = 1000,
  ) {}

  take(key: string, now = Date.now()) {
    let entry = this.buckets.get(key);
    if (!entry) {
      if (this.buckets.size >= this.maxKeys) {
        const oldestKey = this.buckets.keys().next().value;
        if (oldestKey) this.buckets.delete(oldestKey);
      }
      entry = { bucket: new TokenBucket(this.capacity, this.refillPerSecond, now), lastSeen: now };
      this.buckets.set(key, entry);
    }
    entry.lastSeen = now;
    return entry.bucket.take(now);
  }
}

type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  provider?: "tmdb" | "omdb";
  endpointCategory?: string;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  fetcher?: typeof fetch;
};

export function logProviderFailure(
  provider: "tmdb" | "omdb",
  endpointCategory: string,
  status: number | null,
  errorCode: string,
  attempt = 1,
) {
  console.warn(JSON.stringify({
    event: "provider_request_failed",
    provider,
    endpointCategory,
    status,
    errorCode,
    attempt,
  }));
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const fetcher = options.fetcher ?? fetch;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetcher(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return response;
      const retryable = response.status === 429 || response.status >= 500;
      const notFound = response.status === 404;
      const unauthorized = response.status === 401 || response.status === 403;
      const errorCode = notFound
        ? options.endpointCategory === "actor_profile" ? "ACTOR_NOT_FOUND" : "MOVIE_NOT_FOUND"
        : unauthorized
          ? "PROVIDER_AUTH_FAILED"
          : response.status === 429
            ? "UPSTREAM_RATE_LIMIT"
            : retryable
              ? "PROVIDER_TEMPORARY"
              : "PROVIDER_REJECTED";
      if (options.provider && options.endpointCategory) {
        logProviderFailure(options.provider, options.endpointCategory, response.status, errorCode, attempt + 1);
      }
      if (!retryable) {
        throw new ProviderError(
          notFound
            ? "Movie was not found."
            : unauthorized
              ? "The movie provider rejected the server credentials."
              : "The movie provider rejected the request.",
          notFound ? 404 : unauthorized ? 503 : 502,
          notFound ? "MOVIE_NOT_FOUND" : unauthorized ? "PROVIDER_AUTH_FAILED" : "PROVIDER_REJECTED",
        );
      }
      lastError = new ProviderError("The movie provider is temporarily unavailable.", response.status, "PROVIDER_TEMPORARY");
      const retryAfter = retryAfterMs(response);
      if (attempt + 1 < maxAttempts) {
        const exponentialCap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
        await sleep(Math.min(maxDelayMs, retryAfter ?? Math.floor(random() * exponentialCap)));
      }
    } catch (error) {
      if (error instanceof ProviderError && error.code !== "PROVIDER_TEMPORARY") throw error;
      if (!(error instanceof ProviderError)) {
        if (options.provider && options.endpointCategory) {
          logProviderFailure(options.provider, options.endpointCategory, null, "PROVIDER_NETWORK_ERROR", attempt + 1);
        }
      }
      lastError = error;
      if (attempt + 1 < maxAttempts) {
        const exponentialCap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
        await sleep(Math.floor(random() * exponentialCap));
      }
    }
  }

  if (lastError instanceof ProviderError) throw lastError;
  throw new ProviderError("The movie provider could not be reached.", 502, "PROVIDER_NETWORK_ERROR");
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private halfOpenRequest = false;

  constructor(
    private readonly failureThreshold = 4,
    private readonly resetAfterMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.openedAt !== null) {
      if (this.now() - this.openedAt < this.resetAfterMs || this.halfOpenRequest) {
        throw new ProviderError("The movie provider is temporarily unavailable.", 503, "CIRCUIT_OPEN");
      }
      this.halfOpenRequest = true;
    }

    try {
      const value = await operation();
      this.failures = 0;
      this.openedAt = null;
      return value;
    } catch (error) {
      if (
        error instanceof ProviderError &&
        !["PROVIDER_TEMPORARY", "PROVIDER_NETWORK_ERROR", "UPSTREAM_RATE_LIMIT"].includes(error.code)
      ) {
        throw error;
      }
      this.failures += 1;
      if (this.failures >= this.failureThreshold) this.openedAt = this.now();
      throw error;
    } finally {
      this.halfOpenRequest = false;
    }
  }
}