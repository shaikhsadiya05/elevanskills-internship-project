import { describe, expect, it } from "vitest";
import { fetchMovieApiJson, movieApiRetryDelay, MovieApiError, shouldRetryMovieApiQuery } from "./api-query";

describe("movie API query resilience", () => {
  it("preserves API status and Retry-After for client retries", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": "4" } },
    );
    try {
      await expect(fetchMovieApiJson("/api/movies", "Unavailable")).rejects.toMatchObject({
        status: 429,
        retryAfterMs: 4000,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("retries only bounded transient failures and uses exponential delay", () => {
    const unavailable = new MovieApiError("Unavailable", 503, null);
    const badRequest = new MovieApiError("Invalid request", 400, null);
    const rateLimited = new MovieApiError("Rate limited", 429, 5000);

    expect(shouldRetryMovieApiQuery(0, unavailable)).toBe(true);
    expect(shouldRetryMovieApiQuery(0, rateLimited)).toBe(true);
    expect(shouldRetryMovieApiQuery(0, badRequest)).toBe(false);
    expect(shouldRetryMovieApiQuery(1, unavailable)).toBe(false);
    expect(movieApiRetryDelay(1, unavailable)).toBe(1000);
    expect(movieApiRetryDelay(0, rateLimited)).toBe(5000);
  });
});
