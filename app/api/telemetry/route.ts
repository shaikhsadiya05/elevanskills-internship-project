import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordWebVital } from "../../../src/lib/server/telemetry";

const metricSchema = z.object({
  name: z.enum(["CLS", "FCP", "FID", "INP", "LCP", "TTFB"]),
  value: z.number().finite().min(0).max(10_000_000),
  id: z.string().max(100),
  rating: z.enum(["good", "needs-improvement", "poor"]),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const metric = metricSchema.safeParse(body);
  if (!metric.success) return new NextResponse(null, { status: 204 });

  recordWebVital(crypto.randomUUID(), metric.data);
  return new NextResponse(null, { status: 204 });
}