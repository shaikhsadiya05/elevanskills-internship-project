import { describe, expect, it } from "vitest";
import { InMemoryWatchlistServerRepository } from "./mock-server";
import { WatchlistEntry } from "./types";

const firstClient = "00000000-0000-4000-8000-000000000001";
const secondClient = "00000000-0000-4000-8000-000000000002";

function entry(saved: boolean, writerId: string, updatedAt: number): WatchlistEntry {
  return {
    movieId: "movie-1",
    movie: { id: "movie-1", title: "Example", posterUrl: null, releaseDate: "2026", rating: 8, genres: [] },
    saved,
    writerId,
    updatedAt,
    mutationId: `00000000-0000-4000-8000-${String(updatedAt).padStart(12, "0")}`,
  };
}

describe("in-memory mock watchlist server", () => {
  it("reconciles LWW entries per browser client and keeps clients partitioned", () => {
    const repository = new InMemoryWatchlistServerRepository();
    const initial = entry(true, "tab-a", 1);
    repository.merge(firstClient, [initial]);
    const tombstone = entry(false, "tab-b", 2);
    const result = repository.merge(firstClient, [tombstone, initial]);
    expect(result).toHaveLength(1);
    expect(result[0].saved).toBe(false);
    expect(repository.read(secondClient)).toEqual([]);
  });
});