import { mergeWatchlistEntries, WatchlistEntry, watchlistSyncRequestSchema } from "./types";

export interface WatchlistServerRepository {
  read(clientId: string): WatchlistEntry[];
  merge(clientId: string, entries: WatchlistEntry[]): WatchlistEntry[];
}

export class InMemoryWatchlistServerRepository implements WatchlistServerRepository {
  private readonly clients = new Map<string, WatchlistEntry[]>();

  read(clientId: string): WatchlistEntry[] {
    return [...(this.clients.get(clientId) ?? [])];
  }

  merge(clientId: string, entries: WatchlistEntry[]): WatchlistEntry[] {
    const merged = mergeWatchlistEntries(this.read(clientId), entries);
    this.clients.set(clientId, merged);
    return [...merged];
  }
}

type MockWatchlistGlobal = typeof globalThis & { __movieDbMockWatchlists?: WatchlistServerRepository };
const mockWatchlistGlobal = globalThis as MockWatchlistGlobal;
export const mockWatchlistServer: WatchlistServerRepository = mockWatchlistGlobal.__movieDbMockWatchlists ??= new InMemoryWatchlistServerRepository();

export function parseWatchlistSyncBody(value: unknown) {
  return watchlistSyncRequestSchema.parse(value);
}