export class MovieApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "MovieApiError";
  }
}

export async function fetchMovieApiJson<T>(url: string, fallbackMessage: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : null;
    throw new MovieApiError(body.error || fallbackMessage, response.status, retryAfterMs);
  }
  return (await response.json()) as T;
}

export function shouldRetryMovieApiQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (error instanceof TypeError) return true;
  return error instanceof MovieApiError && (error.status === 429 || error.status >= 500);
}

export function movieApiRetryDelay(failureCount: number, error: unknown): number {
  if (error instanceof MovieApiError && error.retryAfterMs !== null) {
    return Math.min(error.retryAfterMs, 30_000);
  }
  return Math.min(500 * 2 ** failureCount, 3_000);
}
