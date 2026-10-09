import "server-only";

type ApiRequestEvent = {
  requestId: string;
  route: string;
  status: number;
  durationMs: number;
  provider?: string;
  errorCode?: string;
};

export function recordApiRequest(event: ApiRequestEvent) {
  const payload = JSON.stringify({
    event: event.errorCode ? "api_request_error" : "api_request_complete",
    ...event,
  });
  if (event.status >= 500) console.error(payload);
  else if (event.errorCode) console.warn(payload);
  else console.info(payload);
}

export function recordWebVital(requestId: string, metric: Record<string, string | number>) {
  console.info(JSON.stringify({ event: "web_vital", requestId, ...metric }));
}