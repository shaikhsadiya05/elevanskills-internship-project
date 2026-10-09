import { NextRequest, NextResponse } from "next/server";
import { reviewUpdateSchema } from "../../../../../../src/lib/reviews/schema";
import { reviewRepository } from "../../../../../../src/lib/reviews/repository";
import { jsonBody, reviewCapability, reviewErrorResponse, reviewRateLimit } from "../../../../../../src/lib/reviews/http";

type Context = { params: Promise<{ id: string; reviewId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const limited = await reviewRateLimit(request);
  if (limited) return limited;
  try {
    const { id, reviewId } = await context.params;
    const content = reviewUpdateSchema.parse(await jsonBody(request));
    return NextResponse.json(reviewRepository.update(id, reviewId, reviewCapability(request), content), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const limited = await reviewRateLimit(request);
  if (limited) return limited;
  try {
    const { id, reviewId } = await context.params;
    return NextResponse.json(reviewRepository.softDelete(id, reviewId, reviewCapability(request)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  const limited = await reviewRateLimit(request);
  if (limited) return limited;
  try {
    const { id, reviewId } = await context.params;
    return NextResponse.json(reviewRepository.restore(id, reviewId, reviewCapability(request)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}