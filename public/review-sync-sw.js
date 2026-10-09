const DATABASE_NAME = "moviedb-review-cache";
const OUTBOX_STORE = "outbox";
const WATCHLIST_DATABASE_NAME = "moviedb-watchlist-cache";
const WATCHLIST_OUTBOX_STORE = "outbox";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function drainReviewOutbox() {
  const database = await openDatabase();
  const reviews = await new Promise((resolve, reject) => {
    const request = database.transaction(OUTBOX_STORE, "readonly").objectStore(OUTBOX_STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  for (const review of reviews) {
    const response = await fetch(`/api/movies/${encodeURIComponent(review.movieId)}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Review-Capability": review.capability, "Idempotency-Key": review.idempotencyKey },
      body: JSON.stringify(review.content),
    });
    if (response.ok || response.status === 409) {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(OUTBOX_STORE, "readwrite");
        transaction.objectStore(OUTBOX_STORE).delete(review.idempotencyKey);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      clients.forEach((client) => client.postMessage({ type: "review-outbox-synced", movieId: review.movieId }));
    } else if (response.status >= 500 || response.status === 429) {
      throw new Error("Review sync will retry later.");
    } else {
      await new Promise((resolve) => {
        const transaction = database.transaction(OUTBOX_STORE, "readwrite");
        transaction.objectStore(OUTBOX_STORE).delete(review.idempotencyKey);
        transaction.oncomplete = resolve;
      });
    }
  }
  database.close();
}

async function drainWatchlistOutbox() {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(WATCHLIST_DATABASE_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const mutations = await new Promise((resolve, reject) => {
    const request = database.transaction(WATCHLIST_OUTBOX_STORE, "readonly").objectStore(WATCHLIST_OUTBOX_STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    for (const mutation of mutations) {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: mutation.clientId, entries: [mutation.entry] }),
      });
      if (response.status >= 500 || response.status === 429) throw new Error("Watchlist sync will retry later.");
      if (response.ok || response.status < 500) {
        await new Promise((resolve, reject) => {
          const transaction = database.transaction(WATCHLIST_OUTBOX_STORE, "readwrite");
          transaction.objectStore(WATCHLIST_OUTBOX_STORE).delete(mutation.entry.mutationId);
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        });
        if (response.ok) {
          const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
          clients.forEach((client) => client.postMessage({ type: "watchlist-outbox-synced", clientId: mutation.clientId }));
        }
      }
    }
  } finally {
    database.close();
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === "review-submissions") event.waitUntil(drainReviewOutbox());
  if (event.tag === "watchlist-sync") event.waitUntil(drainWatchlistOutbox());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "sync-review-outbox") event.waitUntil(drainReviewOutbox());
  if (event.data?.type === "sync-watchlist-outbox") event.waitUntil(drainWatchlistOutbox());
});