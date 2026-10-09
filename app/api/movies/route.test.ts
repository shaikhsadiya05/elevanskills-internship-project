import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  rateLimit: vi.fn(),
  record: vi.fn(),
}));

vi.mock("../../../src/lib/movies/providers", () => ({
  getMovieProvider: () => ({ list: mocks.list }),
  isMovieCategory: (value: string) => ["trending", "popular", "top-rated", "upcoming", "search"].includes(value),
}));
vi.mock("../../../src/lib/server/movie-rate-limit", () => ({ consumeMovieApiTokenBucket: mocks.rateLimit }));
vi.mock("../../../src/lib/server/telemetry", () => ({ recordApiRequest: mocks.record }));

describe("GET /api/movies", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.list.mockReset();
    mocks.rateLimit.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.record.mockReset();
  });

  it("returns 429 and Retry-After when the client bucket is exhausted", async () => {
    mocks.rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 9 });
    const { GET } = await import("./route");

    const response = await GET(new NextRequest("http://localhost/api/movies"));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("9");
    await expect(response.json()).resolves.toMatchObject({ code: "RATE_LIMITED" });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("maps provider 5xx failures to a sanitized route response", async () => {
    const { ProviderError } = await import("../../../src/lib/server/resilience");
    mocks.list.mockRejectedValue(new ProviderError("Upstream details must stay private.", 502, "PROVIDER_TEMPORARY"));
    const { GET } = await import("./route");

    const response = await GET(new NextRequest("http://localhost/api/movies"));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({ code: "PROVIDER_TEMPORARY" });
    expect(body.error).toBe("Upstream details must stay private.");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});