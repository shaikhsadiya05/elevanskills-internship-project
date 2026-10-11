import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("community review events route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("streams review events and closes when the request is aborted", async () => {
    const { GET } = await import("./route");
    const { publishReviewEvent } = await import("../../../../../../src/lib/reviews/events");
    const movieId = `events-test-${crypto.randomUUID()}`;
    const abortController = new AbortController();
    const request = new NextRequest(`http://localhost/api/movies/${movieId}/reviews/events`, {
      headers: { "x-real-ip": crypto.randomUUID() },
      signal: abortController.signal,
    });
    const response = await GET(request, { params: Promise.resolve({ id: movieId }) });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    await expect(reader.read()).resolves.toMatchObject({ done: false, value: expect.any(Uint8Array) });
    publishReviewEvent({ movieId, type: "created" });
    const event = await reader.read();
    expect(decoder.decode(event.value)).toContain('data: {"movieId":"events-test-');
    abortController.abort();

    await expect(reader.read()).resolves.toMatchObject({ done: true });
  });

  it("closes the stream before the platform execution limit", async () => {
    vi.useFakeTimers();
    const { GET } = await import("./route");
    const movieId = `events-timeout-${crypto.randomUUID()}`;
    const request = new NextRequest(`http://localhost/api/movies/${movieId}/reviews/events`, {
      headers: { "x-real-ip": crypto.randomUUID() },
    });
    const response = await GET(request, { params: Promise.resolve({ id: movieId }) });
    const reader = response.body!.getReader();

    await reader.read();
    const pendingReads = (async () => {
      let result = await reader.read();
      while (!result.done) {
        result = await reader.read();
      }
      return result;
    })();

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    await expect(pendingReads).resolves.toMatchObject({ done: true });
  });
});
