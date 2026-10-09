import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { authorizePublicActorRead } from "../../../../src/lib/actors/policy";

const payloadSchema = z.object({
  actorIds: z.array(z.string().regex(/^\d{1,12}$/)).min(1).max(25),
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
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid actor IDs." }, { status: 400 });

  const actorIds = [...new Set(parsed.data.actorIds)];
  try {
    actorIds.forEach((id) => authorizePublicActorRead(id));
  } catch {
    return NextResponse.json({ error: "Invalid actor ID." }, { status: 400 });
  }

  revalidateTag("actors");
  actorIds.forEach((id) => revalidateTag(`actor:${id}`));
  return NextResponse.json({ revalidated: actorIds.length });
}