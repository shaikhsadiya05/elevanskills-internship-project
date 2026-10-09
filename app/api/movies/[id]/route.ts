import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getMovieProvider } from "../../../../src/lib/movies/providers";
import { ProviderError } from "../../../../src/lib/server/resilience";
import { recordApiRequest } from "../../../../src/lib/server/telemetry";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  const { id } = await context.params;
  try {
    const movie = await getMovieProvider().getDetails(id);
    const etag = `W/"${createHash("sha256").update(JSON.stringify(movie)).digest("base64url")}"`;
    recordApiRequest({ requestId, route: "GET /api/movies/[id]", status: 200, provider: /^tt\d+$/.test(id) ? "omdb" : "tmdb", durationMs: Math.round(performance.now() - startedAt) });
    const cacheHeaders = {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800",
      ETag: etag,
      "X-Request-Id": requestId,
    };
    const validators = request.headers.get("if-none-match")?.split(",").map((value) => value.trim()) ?? [];
    if (validators.includes("*") || validators.includes(etag)) {
      return new NextResponse(null, { status: 304, headers: cacheHeaders });
    }
    return NextResponse.json(movie, {
      headers: cacheHeaders,
    });
  } catch (error) {
    const providerError = error instanceof ProviderError ? error : new ProviderError("Movie data is temporarily unavailable.", 502, "MOVIE_PROVIDER_ERROR");
    recordApiRequest({ requestId, route: "GET /api/movies/[id]", status: providerError.status, durationMs: Math.round(performance.now() - startedAt), errorCode: providerError.code });
    return NextResponse.json(
      { error: providerError.message, code: providerError.code, requestId },
      { status: providerError.status, headers: { "X-Request-Id": requestId } },
    );
  }
}