import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ details: vi.fn(), record: vi.fn() }));

vi.mock("../../../../src/lib/movies/providers", () => ({ getMovieProvider: () => ({ getDetails: mocks.details }) }));
vi.mock("../../../../src/lib/server/telemetry", () => ({ recordApiRequest: mocks.record }));

const movie = {
  id: "42", title: "Example Film", overview: "A synopsis.", releaseDate: "2025-01-01", rating: 8,
  posterUrl: null, backdropUrl: null, genres: ["Drama"], cast: [], trailerUrl: null,
};

describe("GET /api/movies/[id] validators", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.details.mockReset().mockResolvedValue(movie);
    mocks.record.mockReset();
  });

  it("returns 304 when If-None-Match matches the movie ETag", async () => {
    const { GET } = await import("./route");
    const first = await GET(new NextRequest("http://localhost/api/movies/42"), { params: Promise.resolve({ id: "42" }) });
    const etag = first.headers.get("etag");

    expect(first.status).toBe(200);
    expect(etag).toMatch(/^W\/".+"$/);
    expect(first.headers.get("cache-control")).toContain("s-maxage=300");

    const conditional = await GET(new NextRequest("http://localhost/api/movies/42", { headers: { "If-None-Match": etag! } }), { params: Promise.resolve({ id: "42" }) });

    expect(conditional.status).toBe(304);
    expect(conditional.headers.get("etag")).toBe(etag);
    expect(await conditional.text()).toBe("");
    expect(mocks.details).toHaveBeenCalledTimes(2);
  });
});