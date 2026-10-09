import { describe, expect, it } from "vitest";
import { mergeWatchlistEntries, WatchlistEntry, watchlistEntrySchema } from "./types";

function entry(overrides: Partial<WatchlistEntry> = {}): WatchlistEntry {
  const movie = { id: "movie-1", title: "Example Movie", posterUrl: null, releaseDate: "2026", rating: 8, genres: ["Drama"] };
  return {
    movieId: movie.id,
    movie,
    saved: true,
    updatedAt: 100,
    writerId: "tab-a",
    mutationId: "00000000-0000-4000-8000-000000000001",
    ...overrides,
  };
}

describe("watchlist entry validation and LWW resolution", () => {
  it("rejects mismatched ids and malformed persisted records", () => {
    expect(watchlistEntrySchema.safeParse(entry()).success).toBe(true);
    expect(watchlistEntrySchema.safeParse(entry({ movieId: "another-id" })).success).toBe(false);
  });

  it("uses timestamps then writer ids for deterministic concurrent conflict resolution", () => {
    const add = entry({ writerId: "tab-a", saved: true });
    const remove = entry({ writerId: "tab-b", saved: false });
    expect(mergeWatchlistEntries([add], [remove])[0]).toEqual(remove);
    expect(mergeWatchlistEntries([remove], [add])[0]).toEqual(remove);
    expect(mergeWatchlistEntries([add], [entry({ updatedAt: 101, saved: false })])[0].saved).toBe(false);
  });

  it("lets a tombstone win when otherwise identical updates tie", () => {
    const saved = entry({ writerId: "tab-a", saved: true });
    const removed = entry({ writerId: "tab-a", saved: false });
    expect(mergeWatchlistEntries([saved], [removed])[0].saved).toBe(false);
  });
});