import { beforeEach, describe, expect, it, vi } from "vitest";

const upstash = vi.hoisted(() => ({
  Redis: vi.fn(() => ({})),
  limiter: vi.fn(),
  tokenBucket: vi.fn(() => ({ type: "token-bucket" })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@upstash/redis", () => ({ Redis: upstash.Redis }));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: Object.assign(vi.fn(() => ({ limit: upstash.limiter })), { tokenBucket: upstash.tokenBucket }),
}));

describe("movie API rate limiter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    upstash.Redis.mockClear();
    upstash.limiter.mockReset();
    upstash.tokenBucket.mockClear();
  });

  it("uses the local token bucket when shared Redis is not configured", async () => {
    const { consumeMovieApiTokenBucket } = await import("./movie-rate-limit");
    const results = await Promise.all(Array.from({ length: 61 }, () => consumeMovieApiTokenBucket("local-client")));

    expect(results.filter((result) => result.allowed)).toHaveLength(60);
    expect(results.filter((result) => !result.allowed)).toHaveLength(1);
    expect(upstash.Redis).not.toHaveBeenCalled();
  });

  it("uses the configured shared Upstash token bucket", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-redis-token");
    upstash.limiter.mockResolvedValue({ success: false, reset: Date.now() + 5000 });
    const { consumeMovieApiTokenBucket } = await import("./movie-rate-limit");

    const result = await consumeMovieApiTokenBucket("client-id");

    expect(upstash.Redis).toHaveBeenCalledWith({ url: "https://redis.example.test", token: "test-redis-token" });
    expect(upstash.tokenBucket).toHaveBeenCalledWith(60, "1 m", 60);
    expect(upstash.limiter).toHaveBeenCalledWith("client-id");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("applies a separate shared aggregate bucket to upstream provider requests", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-redis-token");
    upstash.limiter.mockResolvedValue({ success: true, reset: Date.now() });
    const { consumeMovieProviderTokenBucket } = await import("./movie-rate-limit");

    const result = await consumeMovieProviderTokenBucket("tmdb");

    expect(upstash.tokenBucket).toHaveBeenCalledWith(600, "1 m", 40);
    expect(upstash.limiter).toHaveBeenCalledWith("tmdb");
    expect(result.allowed).toBe(true);
  });

  it("fails closed when the configured shared limiter is unavailable", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-redis-token");
    upstash.limiter.mockRejectedValue(new Error("backend down"));
    const { consumeMovieApiTokenBucket } = await import("./movie-rate-limit");

    await expect(consumeMovieApiTokenBucket("client-id")).resolves.toEqual({ allowed: false, retryAfterSeconds: 60 });
  });
});