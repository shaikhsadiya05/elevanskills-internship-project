import {
  mergeWatchlistEntries,
  WatchlistEntry,
  WatchlistMovie,
  watchlistClientIdSchema,
  watchlistEntrySchema,
  watchlistMovieSchema,
  watchlistSyncResponseSchema,
} from "./types";

const DATABASE_NAME = "moviedb-watchlist-cache";
const DATABASE_VERSION = 1;
const ENTRY_STORE = "entries";
const OUTBOX_STORE = "outbox";
const CLIENT_ID_KEY = "moviedb-watchlist-client-id";
const WRITER_ID_KEY = "moviedb-watchlist-writer-id";
const CHANNEL_NAME = "moviedb-watchlist";

type QueuedMutation = { clientId: string; entry: WatchlistEntry };
type WatchlistResponse = { entries: WatchlistEntry[] };
type Persistence = {
  readEntries(): Promise<WatchlistEntry[]>;
  writeEntries(entries: WatchlistEntry[]): Promise<void>;
  enqueue(mutation: QueuedMutation): Promise<void>;
  readOutbox(clientId: string): Promise<QueuedMutation[]>;
  removeOutbox(mutationIds: string[]): Promise<void>;
};
type Transport = {
  read(clientId: string): Promise<WatchlistResponse>;
  write(clientId: string, entries: WatchlistEntry[]): Promise<WatchlistResponse>;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is unavailable."));
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ENTRY_STORE)) request.result.createObjectStore(ENTRY_STORE, { keyPath: "movieId" });
      if (!request.result.objectStoreNames.contains(OUTBOX_STORE)) request.result.createObjectStore(OUTBOX_STORE, { keyPath: "entry.mutationId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open watchlist storage."));
  });
}

async function withStore<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Watchlist storage request failed."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Watchlist storage transaction failed."));
    };
  });
}

class IndexedDbWatchlistPersistence implements Persistence {
  async readEntries(): Promise<WatchlistEntry[]> {
    const values = await withStore<unknown[]>(ENTRY_STORE, "readonly", (store) => store.getAll());
    return values.flatMap((value) => {
      const parsed = watchlistEntrySchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    });
  }

  async writeEntries(entries: WatchlistEntry[]): Promise<void> {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(ENTRY_STORE, "readwrite");
      const store = transaction.objectStore(ENTRY_STORE);
      store.clear();
      entries.forEach((entry) => store.put(entry));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save watchlist entries."));
    }).finally(() => database.close());
  }

  async enqueue(mutation: QueuedMutation): Promise<void> {
    await withStore(OUTBOX_STORE, "readwrite", (store) => store.put(mutation));
  }

  async readOutbox(clientId: string): Promise<QueuedMutation[]> {
    const values = await withStore<unknown[]>(OUTBOX_STORE, "readonly", (store) => store.getAll());
    return values.filter((value): value is QueuedMutation => {
      const mutation = value as Partial<QueuedMutation>;
      return mutation.clientId === clientId && watchlistEntrySchema.safeParse(mutation.entry).success;
    });
  }

  async removeOutbox(mutationIds: string[]): Promise<void> {
    if (!mutationIds.length) return;
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(OUTBOX_STORE, "readwrite");
      const store = transaction.objectStore(OUTBOX_STORE);
      mutationIds.forEach((id) => store.delete(id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear synced watchlist changes."));
    }).finally(() => database.close());
  }
}

class FetchWatchlistTransport implements Transport {
  async read(clientId: string): Promise<WatchlistResponse> {
    const response = await fetch(`/api/watchlist?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load the mock watchlist snapshot.");
    return watchlistSyncResponseSchema.parse(await response.json());
  }

  async write(clientId: string, entries: WatchlistEntry[]): Promise<WatchlistResponse> {
    const response = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, entries }),
    });
    if (!response.ok) throw Object.assign(new Error("The mock watchlist server rejected the update."), { status: response.status });
    return watchlistSyncResponseSchema.parse(await response.json());
  }
}

export class BrowserWatchlistRepository {
  private entries: WatchlistEntry[] = [];
  private readonly listeners = new Set<(entries: WatchlistEntry[]) => void>();
  private readonly writerId: string;
  private readonly storageKey: string;
  private channel: BroadcastChannel | null = null;

  constructor(
    readonly clientId: string,
    private readonly persistence: Persistence = new IndexedDbWatchlistPersistence(),
    private readonly transport: Transport = new FetchWatchlistTransport(),
    writerId?: string,
  ) {
    this.writerId = writerId ?? getWriterId();
    this.storageKey = `moviedb-watchlist:${clientId}`;
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.addEventListener("message", this.onBroadcast);
    }
    window.addEventListener("storage", this.onStorage);
    window.addEventListener("online", this.onOnline);
  }

  getSnapshot = (): WatchlistEntry[] => this.entries;

  subscribe = (listener: (entries: WatchlistEntry[]) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async initialize(): Promise<void> {
    const [storedEntries, mirroredEntries] = await Promise.all([
      this.persistence.readEntries().catch(() => []),
      Promise.resolve(readLocalSnapshot(this.storageKey)),
    ]);
    this.replace(mergeWatchlistEntries(storedEntries, mirroredEntries));
    await this.persist().catch(() => {});
    if (navigator.onLine) {
      void this.transport.read(this.clientId).then(async (remote) => {
        this.replace(mergeWatchlistEntries(this.entries, remote.entries));
        await this.persist();
        await this.flushOutbox();
      }).catch(() => this.flushOutbox().catch(() => {}));
    }
  }

  async add(movie: WatchlistMovie): Promise<void> {
    const validatedMovie = watchlistMovieSchema.parse(movie);
    const existing = this.entries.find((entry) => entry.movieId === validatedMovie.id);
    if (existing?.saved) return;
    await this.mutate(validatedMovie, true, existing);
  }

  async remove(movieId: string): Promise<void> {
    const existing = this.entries.find((entry) => entry.movieId === movieId);
    if (!existing?.saved) return;
    await this.mutate(existing.movie, false, existing);
  }

  async flushOutbox(): Promise<void> {
    if (!navigator.onLine) return;
    const queued = await this.persistence.readOutbox(this.clientId).catch(() => []);
    if (!queued.length) return;
    const response = await this.transport.write(this.clientId, queued.map((mutation) => mutation.entry));
    this.replace(mergeWatchlistEntries(this.entries, response.entries));
    await this.persist();
    await this.persistence.removeOutbox(queued.map((mutation) => mutation.entry.mutationId));
    this.channel?.postMessage({ clientId: this.clientId, entries: response.entries });
  }

  dispose(): void {
    this.channel?.removeEventListener("message", this.onBroadcast);
    this.channel?.close();
    window.removeEventListener("storage", this.onStorage);
    window.removeEventListener("online", this.onOnline);
  }

  private async mutate(movie: WatchlistMovie, saved: boolean, previous?: WatchlistEntry): Promise<void> {
    const entry = watchlistEntrySchema.parse({
      movieId: movie.id,
      movie,
      saved,
      updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1),
      writerId: this.writerId,
      mutationId: crypto.randomUUID(),
    });
    this.replace(mergeWatchlistEntries(this.entries, [entry]));
    await this.persist();
    this.channel?.postMessage({ clientId: this.clientId, entries: [entry] });
    if (!navigator.onLine) {
      await this.persistence.enqueue({ clientId: this.clientId, entry });
      this.requestBackgroundSync();
      return;
    }
    try {
      const response = await this.transport.write(this.clientId, [entry]);
      this.replace(mergeWatchlistEntries(this.entries, response.entries));
      await this.persist();
      await this.persistence.removeOutbox([entry.mutationId]).catch(() => {});
      this.channel?.postMessage({ clientId: this.clientId, entries: response.entries });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === undefined || status === 429 || status >= 500) {
        await this.persistence.enqueue({ clientId: this.clientId, entry });
        this.requestBackgroundSync();
        return;
      }
      const current = this.entries.find((item) => item.movieId === entry.movieId);
      if (current?.mutationId === entry.mutationId) {
        this.replace(this.entries.filter((item) => item.movieId !== entry.movieId));
        if (previous) this.replace(mergeWatchlistEntries(this.entries, [previous]));
        await this.persist();
      }
      throw error;
    }
  }

  private requestBackgroundSync() {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.ready.then(async (registration) => {
      if ("sync" in registration) {
        try { await (registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register("watchlist-sync"); } catch { /* The online event remains a fallback. */ }
      }
      registration.active?.postMessage({ type: "sync-watchlist-outbox" });
    }).catch(() => {});
  }

  private onOnline = () => { void this.flushOutbox().catch(() => {}); };

  private onBroadcast = (event: MessageEvent<{ clientId?: string; entries?: unknown }>) => {
    if (event.data?.clientId !== this.clientId || !Array.isArray(event.data.entries)) return;
    const incoming = event.data.entries.flatMap((item) => {
      const parsed = watchlistEntrySchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
    this.accept(incoming);
  };

  private onStorage = (event: StorageEvent) => {
    if (event.key !== this.storageKey || !event.newValue) return;
    this.accept(readLocalSnapshot(this.storageKey, event.newValue));
  };

  private accept(incoming: WatchlistEntry[]) {
    const merged = mergeWatchlistEntries(this.entries, incoming);
    if (sameEntries(this.entries, merged)) return;
    this.replace(merged);
    void this.persist().catch(() => {});
    if (navigator.onLine) void this.transport.write(this.clientId, incoming).then((response) => {
      this.replace(mergeWatchlistEntries(this.entries, response.entries));
      return this.persist();
    }).catch(() => {});
  }

  private replace(entries: WatchlistEntry[]) {
    this.entries = entries;
    const snapshot = [...entries];
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private async persist() {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.entries)); } catch { /* IndexedDB remains the primary persistence layer. */ }
    await this.persistence.writeEntries(this.entries).catch(() => {});
  }
}

export function createBrowserWatchlistRepository(): BrowserWatchlistRepository {
  const clientId = getPersistentId(CLIENT_ID_KEY);
  return new BrowserWatchlistRepository(clientId);
}

function getPersistentId(key: string): string {
  try {
    const stored = localStorage.getItem(key);
    const parsed = watchlistClientIdSchema.safeParse(stored);
    if (parsed.success) return parsed.data;
    const created = crypto.randomUUID();
    localStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function getWriterId(): string {
  try {
    const stored = sessionStorage.getItem(WRITER_ID_KEY);
    if (stored) return stored;
    const created = crypto.randomUUID();
    sessionStorage.setItem(WRITER_ID_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function readLocalSnapshot(key: string, value?: string | null): WatchlistEntry[] {
  try {
    const snapshot = value === undefined ? localStorage.getItem(key) : value;
    const parsed = JSON.parse(snapshot ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const entry = watchlistEntrySchema.safeParse(item);
      return entry.success ? [entry.data] : [];
    });
  } catch {
    return [];
  }
}

function sameEntries(left: WatchlistEntry[], right: WatchlistEntry[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry.mutationId === right[index]?.mutationId);
}