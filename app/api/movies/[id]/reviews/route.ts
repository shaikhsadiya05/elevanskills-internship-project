import { NextRequest, NextResponse } from "next/server";
import { reviewContentSchema, reviewListQuerySchema } from "../../../../../src/lib/reviews/schema";
import { reviewRepository } from "../../../../../src/lib/reviews/repository";
import { jsonBody, reviewCapability, reviewErrorResponse, reviewRateLimit } from "../../../../../src/lib/reviews/http";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limited = await reviewRateLimit(request);
  if (limited) return limited;
  const { id: movieId } = await context.params;
  const query = reviewListQuerySchema.safeParse({
    sort: request.nextUrl.searchParams.get("sort") ?? undefined,
    page: request.nextUrl.searchParams.get("page") ?? undefined,
    pageSize: request.nextUrl.searchParams.get("pageSize") ?? undefined,
  });
  if (!query.success) return reviewErrorResponse(query.error);
  const page = reviewRepository.list(movieId, { ...query.data, viewerCapability: reviewCapability(request) || undefined });
  return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limited = await reviewRateLimit(request);
  if (limited) return limited;
  const { id: movieId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    return NextResponse.json({ error: "A valid Idempotency-Key header is required.", code: "INVALID_IDEMPOTENCY_KEY" }, { status: 400 });
  }
  try {
    const content = reviewContentSchema.parse(await jsonBody(request));
    const review = reviewRepository.create({ movieId, capability: reviewCapability(request), idempotencyKey, content });
    return NextResponse.json(review, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}