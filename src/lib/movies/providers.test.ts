import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("movie provider request coalescing", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("MOVIE_PROVIDER", "tmdb");
    vi.stubEnv("TMDB_API_KEY", "test-server-token");
    vi.stubEnv("TMDB_BASE_URL", "https://api.themoviedb.org/3");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  });

  it("shares an in-flight request for concurrent identical provider URLs", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const { getMovieProvider } = await import("./providers");
    const provider = getMovieProvider();

    const first = provider.list({ category: "trending" });
    const second = provider.list({ category: "trending" });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    resolveFetch(Response.json({ results: [], total_pages: 1 }));

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("prefers official YouTube trailers and ignores invalid or missing video IDs", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({
        id: 42,
        title: "Example Film",
        videos: { results: [
          { site: "YouTube", type: "Trailer", key: "abcdefghijk", official: false },
          { site: "YouTube", type: "Trailer", key: "zyxwvutsrqp", official: true },
        ] },
      }))
      .mockResolvedValueOnce(Response.json({
        id: 43,
        title: "No Trailer",
        videos: { results: [{ site: "YouTube", type: "Trailer", key: "short" }] },
      }));
    vi.stubGlobal("fetch", fetcher);
    const { getMovieProvider } = await import("./providers");
    const provider = getMovieProvider();

    await expect(provider.getDetails("42")).resolves.toMatchObject({
      trailerUrl: "https://www.youtube.com/watch?v=zyxwvutsrqp",
    });
    await expect(provider.getDetails("43")).resolves.toMatchObject({ trailerUrl: null });
  });

  it("searches TMDb using the supported movie search endpoint and maps results", async () => {
    let requestedUrl: URL | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = new URL(String(input));
      return Response.json({
        results: [{ id: 123, title: "Arasu", overview: "Movie synopsis", release_date: "2006-01-01" }],
        total_pages: 1,
      });
    }));
    const { getMovieProvider } = await import("./providers");

    const page = await getMovieProvider().list({ category: "search", query: "arasu" });

    expect(requestedUrl?.pathname).toBe("/3/search/movie");
    expect(requestedUrl?.searchParams.get("query")).toBe("arasu");
    expect(page.results).toMatchObject([{ id: "123", title: "Arasu", overview: "Movie synopsis" }]);
    expect(page.nextCursor).toBeNull();
  });

  it("returns an empty result set for a valid empty search and rejects malformed results", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ results: [], total_pages: 0 }))
      .mockResolvedValueOnce(Response.json({ results: { unexpected: true }, total_pages: 0 }));
    vi.stubGlobal("fetch", fetcher);
    const { getMovieProvider } = await import("./providers");
    const provider = getMovieProvider();

    await expect(provider.list({ category: "search", query: "no matching title" })).resolves.toMatchObject({
      results: [],
      totalPages: 0,
      nextCursor: null,
    });
    await expect(provider.list({ category: "search", query: "malformed response" })).rejects.toMatchObject({
      status: 502,
      code: "INVALID_PROVIDER_RESPONSE",
    });
  });
});