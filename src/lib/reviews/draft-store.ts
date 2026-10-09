import type { ReviewContentInput } from "./schema";

const DATABASE_NAME = "moviedb-review-cache";
const DATABASE_VERSION = 1;
const DRAFT_STORE = "drafts";
const OUTBOX_STORE = "outbox";

export type ReviewDraft = { movieId: string; displayName: string; body: string; rating: number; updatedAt: number };
export type QueuedReview = { movieId: string; capability: string; idempotencyKey: string; content: ReviewContentInput; queuedAt: number };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is unavailable."));
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DRAFT_STORE)) request.result.createObjectStore(DRAFT_STORE, { keyPath: "movieId" });
      if (!request.result.objectStoreNames.contains(OUTBOX_STORE)) request.result.createObjectStore(OUTBOX_STORE, { keyPath: "idempotencyKey" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open review storage."));
  });
}

async function requestValue<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Review storage request failed."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Review storage transaction failed."));
    };
  });
}

export async function loadReviewDraft(movieId: string): Promise<ReviewDraft | undefined> {
  return requestValue(DRAFT_STORE, "readonly", (store) => store.get(movieId));
}

export async function saveReviewDraft(draft: ReviewDraft): Promise<void> {
  await requestValue(DRAFT_STORE, "readwrite", (store) => store.put(draft));
}

export async function removeReviewDraft(movieId: string): Promise<void> {
  await requestValue(DRAFT_STORE, "readwrite", (store) => store.delete(movieId));
}

export async function enqueueReview(review: QueuedReview): Promise<void> {
  await requestValue(OUTBOX_STORE, "readwrite", (store) => store.put(review));
}

export async function listQueuedReviews(): Promise<QueuedReview[]> {
  return requestValue(OUTBOX_STORE, "readonly", (store) => store.getAll());
}

export async function removeQueuedReview(idempotencyKey: string): Promise<void> {
  await requestValue(OUTBOX_STORE, "readwrite", (store) => store.delete(idempotencyKey));
}

export function reviewCapability(): string {
  const key = "moviedb-anonymous-review-capability";
  try {
    let capability = window.localStorage.getItem(key);
    if (!capability) {
      capability = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      window.localStorage.setItem(key, capability);
    }
    return capability;
  } catch {
    return `${crypto.randomUUID()}${crypto.randomUUID()}`;
  }
}