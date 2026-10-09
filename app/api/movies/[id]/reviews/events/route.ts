import { NextRequest } from "next/server";
import { subscribeToReviewEvents } from "../../../../../../src/lib/reviews/events";
import { reviewRateLimit } from "../../../../../../src/lib/reviews/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limited = await reviewRateLimit(request);
  if (limited) return limited;
  const { id: movieId } = await context.params;
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));
      unsubscribe = subscribeToReviewEvents(movieId, (event) => {
        controller.enqueue(encoder.encode(`event: review\ndata: ${JSON.stringify(event)}\n\n`));
      });
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": keep-alive\n\n")), 20_000);
      request.signal.addEventListener("abort", () => {
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        controller.close();
      }, { once: true });
    },
    cancel() {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}