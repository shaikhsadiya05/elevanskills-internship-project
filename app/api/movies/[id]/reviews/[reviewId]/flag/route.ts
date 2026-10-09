import { NextRequest, NextResponse } from "next/server";
import { reviewFlagSchema } from "../../../../../../../src/lib/reviews/schema";
import { reviewRepository } from "../../../../../../../src/lib/reviews/repository";
import { jsonBody, reviewCapability, reviewErrorResponse, reviewRateLimit } from "../../../../../../../src/lib/reviews/http";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string; reviewId: string }> }) {
  const limited = await reviewRateLimit(request);
  if (limited) return limited;
  try {
    const { id, reviewId } = await context.params;
    const { reason } = reviewFlagSchema.parse(await jsonBody(request));
    return NextResponse.json(reviewRepository.flag(id, reviewId, reviewCapability(request), reason), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}