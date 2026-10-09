import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("community review route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  });

  it("validates review creation and returns it in the capability-scoped list", async () => {
    const { GET, POST } = await import("./route");
    const movieId = `route-test-${crypto.randomUUID()}`;
    const capability = "review-capability-012345678901234567890123456789";
    const headers = {
      "Content-Type": "application/json",
      "X-Review-Capability": capability,
      "Idempotency-Key": "route-test-idempotency-key-001",
    };
    const content = { displayName: "Test viewer", body: "A thoughtful film with a strong ending and memorable performances.", rating: 8 };
    const invalid = await POST(new NextRequest(`http://localhost/api/movies/${movieId}/reviews`, {
      method: "POST", headers, body: JSON.stringify({ ...content, rating: 11 }),
    }), { params: Promise.resolve({ id: movieId }) });

    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: "INVALID_REVIEW" });

    const created = await POST(new NextRequest(`http://localhost/api/movies/${movieId}/reviews`, {
      method: "POST", headers, body: JSON.stringify(content),
    }), { params: Promise.resolve({ id: movieId }) });
    const createdReview = await created.json();

    expect(created.status).toBe(201);
    expect(createdReview).toMatchObject({ ...content, viewerCanEdit: true });

    const listed = await GET(new NextRequest(`http://localhost/api/movies/${movieId}/reviews`, {
      headers: { "X-Review-Capability": capability },
    }), { params: Promise.resolve({ id: movieId }) });

    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({ total: 1, reviews: [{ id: createdReview.id, viewerCanEdit: true }] });
  });
});