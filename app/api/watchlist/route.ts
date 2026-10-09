import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { mockWatchlistServer, parseWatchlistSyncBody } from "../../../src/lib/watchlist/mock-server";
import { watchlistClientIdSchema } from "../../../src/lib/watchlist/types";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const parsedClientId = watchlistClientIdSchema.safeParse(request.nextUrl.searchParams.get("clientId"));
  if (!parsedClientId.success) return NextResponse.json({ error: "Valid browser clientId is required." }, { status: 400, headers: noStore });
  return NextResponse.json({ entries: mockWatchlistServer.read(parsedClientId.data) }, { headers: noStore });
}

export async function POST(request: NextRequest) {
  try {
    const body = parseWatchlistSyncBody(await request.json());
    const entries = mockWatchlistServer.merge(body.clientId, body.entries);
    return NextResponse.json({ entries }, { headers: noStore });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid watchlist sync payload." }, { status: 400, headers: noStore });
    }
    return NextResponse.json({ error: "Watchlist synchronization failed." }, { status: 500, headers: noStore });
  }
}