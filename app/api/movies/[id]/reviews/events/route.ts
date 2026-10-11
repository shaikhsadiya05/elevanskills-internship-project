import { NextRequest } from "next/server";
import { subscribeToReviewEvents } from "../../../../../../src/lib/reviews/events";
import { reviewRateLimit } from "../../../../../../src/lib/reviews/http";

export const dynamic = "force-dynamic";

const MAX_STREAM_DURATION_MS = 4 * 60 * 1000;

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limited = await reviewRateLimit(request);
  if (limited) return limited;
  const { id: movieId } = await context.params;
  const encoder = new TextEncoder();
  let cancelStream = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      const cleanup = () => {
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        if (lifetime) clearTimeout(lifetime);
        request.signal.removeEventListener("abort", onAbort);
      };
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        controller.close();
      };
      const onAbort = () => close();
      cancelStream = () => {
        if (closed) return;
        closed = true;
        cleanup();
      };

      controller.enqueue(encoder.encode(": connected\n\n"));
      unsubscribe = subscribeToReviewEvents(movieId, (event) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: review\ndata: ${JSON.stringify(event)}\n\n`));
      });
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 20_000);
      const lifetime = setTimeout(close, MAX_STREAM_DURATION_MS);
      if (request.signal.aborted) close();
      else request.signal.addEventListener("abort", onAbort, { once: true });
    },
    cancel() {
      cancelStream();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}