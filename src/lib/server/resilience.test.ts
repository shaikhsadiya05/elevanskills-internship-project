import { beforeEach, describe, expect, it, vi } from "vitest";
import { CircuitBreaker, fetchWithRetry, KeyedTokenBuckets, ProviderError } from "./resilience";

describe("provider resilience", () => {
  it("refills a token bucket over time", () => {
    const bucket = new KeyedTokenBuckets(2, 1);
    expect(bucket.take("client", 1000).allowed).toBe(true);
    expect(bucket.take("client", 1000).allowed).toBe(true);
    expect(bucket.take("client", 1000).allowed).toBe(false);
    expect(bucket.take("client", 2000).allowed).toBe(true);
  });

  it("retries 429 responses and honors Retry-After", async () => {
    const sleep = vi.fn(async (_delay: number) => undefined);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const response = await fetchWithRetry("https://provider.test", {}, { fetcher, sleep });

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("retries 5xx responses with bounded exponential jitter", async () => {
    const sleep = vi.fn(async (_delay: number) => undefined);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await expect(fetchWithRetry("https://provider.test", {}, {
      fetcher,
      sleep,
      random: () => 0.5,
      baseDelayMs: 100,
      maxDelayMs: 500,
    })).resolves.toHaveProperty("status", 200);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([50, 100]);
  });

  it("returns a sanitized failure after exhausting retries", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("sensitive upstream body", { status: 503 }));

    await expect(fetchWithRetry("https://provider.test", {}, {
      fetcher,
      maxAttempts: 2,
      sleep: async () => undefined,
    })).rejects.toMatchObject({
      status: 503,
      code: "PROVIDER_TEMPORARY",
      message: "The movie provider is temporarily unavailable.",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reports rejected provider credentials without retrying or exposing secrets", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("credential details", { status: 401 }));

    await expect(fetchWithRetry("https://provider.test", {}, { fetcher })).rejects.toMatchObject({
      status: 503,
      code: "PROVIDER_AUTH_FAILED",
      message: "The movie provider rejected the server credentials.",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("logs provider category, status, and code without logging request URLs", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetcher = vi.fn().mockResolvedValue(new Response("upstream error", { status: 503 }));
    try {
      await expect(fetchWithRetry(
        "https://provider.test/3/search/movie?query=private-search-term",
        {},
        {
          fetcher,
          maxAttempts: 1,
          provider: "tmdb",
          endpointCategory: "movie_search",
        },
      )).rejects.toMatchObject({ code: "PROVIDER_TEMPORARY" });

      const diagnostic = JSON.parse(String(warning.mock.calls[0]?.[0]));
      expect(diagnostic).toMatchObject({
        event: "provider_request_failed",
        provider: "tmdb",
        endpointCategory: "movie_search",
        status: 503,
        errorCode: "PROVIDER_TEMPORARY",
        attempt: 1,
      });
      expect(String(warning.mock.calls[0]?.[0])).not.toContain("private-search-term");
    } finally {
      warning.mockRestore();
    }
  });

  it("aborts provider requests that exceed the configured timeout", async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("Expected an upstream timeout signal."));
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    );

    await expect(fetchWithRetry("https://provider.test", {}, {
      fetcher,
      maxAttempts: 1,
      timeoutMs: 5,
    })).rejects.toMatchObject({
      status: 502,
      code: "PROVIDER_NETWORK_ERROR",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("opens after repeated provider failures and allows a half-open recovery", async () => {
    let now = 0;
    const breaker = new CircuitBreaker(2, 100, () => now);
    const failure = async () => { throw new Error("provider failed"); };

    await expect(breaker.execute(failure)).rejects.toThrow("provider failed");
    await expect(breaker.execute(failure)).rejects.toThrow("provider failed");
    await expect(breaker.execute(async () => "closed")).rejects.toMatchObject({ code: "CIRCUIT_OPEN" });

    now = 101;
    await expect(breaker.execute(async () => "recovered")).resolves.toBe("recovered");
  });

  it("does not open for a non-retryable missing-title response", async () => {
    const breaker = new CircuitBreaker(2);
    const missing = async () => { throw new ProviderError("Movie was not found.", 404, "MOVIE_NOT_FOUND"); };

    await expect(breaker.execute(missing)).rejects.toMatchObject({ status: 404 });
    await expect(breaker.execute(missing)).rejects.toMatchObject({ status: 404 });
    await expect(breaker.execute(async () => "still closed")).resolves.toBe("still closed");
  });
});

describe("TMDb to OMDb search fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("MOVIE_PROVIDER", "tmdb");
    vi.stubEnv("TMDB_API_KEY", "test-server-token");
    vi.stubEnv("TMDB_BASE_URL", "https://api.themoviedb.org/3");
    vi.stubEnv("OMDB_API_KEY", "test-server-key");
  });

  it("returns a clear server configuration error without contacting TMDb when the token is missing", async () => {
    vi.stubEnv("TMDB_API_KEY", "");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.doMock("server-only", () => ({}));
    const { getMovieProvider } = await import("../movies/providers");

    await expect(getMovieProvider().list({ category: "popular" })).rejects.toMatchObject({
      status: 503,
      code: "PROVIDER_NOT_CONFIGURED",
      message: "TMDb is not configured on this server. Set TMDB_API_KEY in the server environment.",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses the configured HTTPS base URL and sends the token only upstream", async () => {
    vi.stubEnv("TMDB_BASE_URL", "https://tmdb.test/api/3/");
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-server-token");
      return new Response(JSON.stringify({ results: [], page: 1, total_pages: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    vi.doMock("server-only", () => ({}));
    const { getMovieProvider } = await import("../movies/providers");

    const result = await getMovieProvider().list({ category: "trending" });

    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://tmdb.test/api/3/trending/movie/week?page=1");
    expect(JSON.stringify(result)).not.toContain("test-server-token");
  });

  it("issues a signed cursor that continues the matching query on the next provider page", async () => {
    const requestedUrls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      return new Response(JSON.stringify({ results: [], total_pages: 2 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    vi.doMock("server-only", () => ({}));
    const { getMovieProvider } = await import("../movies/providers");
    const provider = getMovieProvider();

    const firstPage = await provider.list({ category: "search", query: "Dune" });
    expect(firstPage.nextCursor).toMatch(/\./);
    await provider.list({ category: "search", query: "Dune", cursor: firstPage.nextCursor });

    expect(new URL(requestedUrls[0]).searchParams.get("page")).toBe("1");
    expect(new URL(requestedUrls[1]).searchParams.get("page")).toBe("2");
    await expect(provider.list({ category: "search", query: "Other", cursor: firstPage.nextCursor })).rejects.toMatchObject({
      status: 400,
      code: "INVALID_CURSOR",
    });
    await expect(provider.list({ category: "search", query: "Dune", cursor: `${firstPage.nextCursor}tampered` })).rejects.toMatchObject({
      status: 400,
      code: "INVALID_CURSOR",
    });
    expect(requestedUrls).toHaveLength(2);
  });

  it("falls back to OMDb after TMDb 5xx failures", async () => {
    vi.doMock("server-only", () => ({}));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.themoviedb.org")) return new Response(null, { status: 503 });
      return new Response(JSON.stringify({
        Response: "True",
        Search: [{ Title: "Dune", Year: "2021", imdbID: "tt1160419", Poster: "N/A" }],
        totalResults: "1",
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetcher);
    const { getMovieProvider } = await import("../movies/providers");

    const result = await getMovieProvider().list({ category: "search", query: "Dune" });

    expect(result.provider).toBe("omdb");
    expect(result.results[0]?.title).toBe("Dune");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("api.themoviedb.org");
    expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain("www.omdbapi.com");
  });
});