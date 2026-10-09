import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { consumeMovieApiTokenBucket } from "../server/movie-rate-limit";
import { ReviewRepositoryError } from "./repository";

export function reviewCapability(request: NextRequest): string {
  return request.headers.get("x-review-capability") ?? "";
}

export async function reviewRateLimit(request: NextRequest): Promise<NextResponse | null> {
  const key = request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown-client";
  const permit = await consumeMovieApiTokenBucket(`reviews:${key}`);
  if (permit.allowed) return null;
  return NextResponse.json({ error: "Too many review requests. Try again shortly.", code: "RATE_LIMITED" }, {
    status: 429,
    headers: { "Retry-After": String(permit.retryAfterSeconds), "Cache-Control": "no-store" },
  });
}

export function reviewErrorResponse(error: unknown): NextResponse {
  if (error instanceof ReviewRepositoryError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid review request.", code: "INVALID_REVIEW" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "Request body must be valid JSON.", code: "INVALID_JSON" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ error: "Review request failed.", code: "REVIEW_REQUEST_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

export function jsonBody(request: NextRequest): Promise<unknown> {
  return request.json();
}