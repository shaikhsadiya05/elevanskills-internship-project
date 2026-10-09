"use client";

import { useReportWebVitals } from "next/web-vitals";

export default function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    const payload = JSON.stringify({
      name: metric.name,
      value: metric.value,
      id: metric.id,
      rating: metric.rating,
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/telemetry", new Blob([payload], { type: "application/json" }));
    } else {
      void fetch("/api/telemetry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true,
      });
    }
  });

  return null;
}