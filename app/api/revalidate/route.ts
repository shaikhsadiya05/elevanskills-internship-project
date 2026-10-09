import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";

const requestSchema = z.object({
  tags: z.array(z.string().regex(/^(movies|movies:(trending|popular|top-rated|upcoming|search)|movie:\d+|movie:tt\d+)$/)).min(1).max(20),
});

export async function POST(request: NextRequest) {
  const secret = process.env.REVALIDATION_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid cache tags." }, { status: 400 });

  parsed.data.tags.forEach((tag) => revalidateTag(tag));
  return NextResponse.json({ revalidated: parsed.data.tags.length });
}