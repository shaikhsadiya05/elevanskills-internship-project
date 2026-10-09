import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMovieProvider, isMovieCategory } from "../../../src/lib/movies/providers";
import { consumeMovieApiTokenBucket } from "../../../src/lib/server/movie-rate-limit";
import { ProviderError } from "../../../src/lib/server/resilience";
import { recordApiRequest } from "../../../src/lib/server/telemetry";

const querySchema = z.object({
  category: z.string().refine(isMovieCategory).default("popular"),
  query: z.string().trim().max(100).optional(),
  cursor: z.string().max(512).optional(),
});

function getClientKey(request: NextRequest) {
  const realIp = request.headers.get("x-real-ip")?.trim();
  const forwardedChain = request.headers.get("x-forwarded-for")?.split(",");
  return realIp || forwardedChain?.at(-1)?.trim() || "unknown-client";
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  const permit = await consumeMovieApiTokenBucket(getClientKey(request));
  if (!permit.allowed) {
    recordApiRequest({ requestId, route: "GET /api/movies", status: 429, durationMs: Math.round(performance.now() - startedAt), errorCode: "RATE_LIMITED" });
    return NextResponse.json(
      { error: "Too many requests. Please try again shortly.", code: "RATE_LIMITED", requestId },
      { status: 429, headers: { "Retry-After": String(permit.retryAfterSeconds), "X-Request-Id": requestId } },
    );
  }

  const parsed = querySchema.safeParse({
    category: request.nextUrl.searchParams.get("category") ?? "popular",
    query: request.nextUrl.searchParams.get("query") ?? undefined,
    cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
  });
  if (!parsed.success) {
    recordApiRequest({ requestId, route: "GET /api/movies", status: 400, durationMs: Math.round(performance.now() - startedAt), errorCode: "INVALID_REQUEST" });
    return NextResponse.json(
      { error: "Invalid movie request.", code: "INVALID_REQUEST", requestId },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  try {
    const page = await getMovieProvider().list(parsed.data);
    recordApiRequest({ requestId, route: "GET /api/movies", status: 200, provider: page.provider, durationMs: Math.round(performance.now() - startedAt) });
    return NextResponse.json(page, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    const providerError = error instanceof ProviderError ? error : new ProviderError("Movie data is temporarily unavailable.", 502, "MOVIE_PROVIDER_ERROR");
    recordApiRequest({ requestId, route: "GET /api/movies", status: providerError.status, durationMs: Math.round(performance.now() - startedAt), errorCode: providerError.code });
    return NextResponse.json(
      { error: providerError.message, code: providerError.code, requestId },
      { status: providerError.status, headers: { "X-Request-Id": requestId } },
    );
  }
}