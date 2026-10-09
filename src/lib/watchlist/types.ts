import { z } from "zod";

export const watchlistMovieSchema = z.object({
  id: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  posterUrl: z.string().url().nullable(),
  releaseDate: z.string().max(32),
  rating: z.number().finite().min(0).max(10).nullable(),
  genres: z.array(z.string().max(60)).max(20),
});

export const watchlistEntrySchema = z.object({
  movieId: z.string().trim().min(1).max(64),
  movie: watchlistMovieSchema,
  saved: z.boolean(),
  updatedAt: z.number().int().nonnegative().safe(),
  writerId: z.string().min(1).max(128),
  mutationId: z.string().uuid(),
}).refine((entry) => entry.movieId === entry.movie.id, "Movie ID must match the watchlist entry.");

export const watchlistSyncRequestSchema = z.object({
  clientId: z.string().uuid(),
  entries: z.array(watchlistEntrySchema).max(200),
});
export const watchlistSyncResponseSchema = z.object({ entries: z.array(watchlistEntrySchema) });

export const watchlistClientIdSchema = z.string().uuid();

export type WatchlistMovie = z.infer<typeof watchlistMovieSchema>;
export type WatchlistEntry = z.infer<typeof watchlistEntrySchema>;
export type WatchlistSyncRequest = z.infer<typeof watchlistSyncRequestSchema>;
export type WatchlistSyncResponse = z.infer<typeof watchlistSyncResponseSchema>;

export function compareWatchlistEntries(left: WatchlistEntry, right: WatchlistEntry): number {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt - right.updatedAt;
  const writerOrder = left.writerId.localeCompare(right.writerId);
  if (writerOrder !== 0) return writerOrder;
  if (left.saved !== right.saved) return left.saved ? -1 : 1;
  return left.mutationId.localeCompare(right.mutationId);
}

export function mergeWatchlistEntries(...collections: WatchlistEntry[][]): WatchlistEntry[] {
  const winners = new Map<string, WatchlistEntry>();
  collections.flat().forEach((candidate) => {
    const current = winners.get(candidate.movieId);
    if (!current || compareWatchlistEntries(candidate, current) > 0) winners.set(candidate.movieId, candidate);
  });
  return [...winners.values()].sort((left, right) => left.movie.title.localeCompare(right.movie.title));
}

export function toWatchlistMovie(movie: {
  id: string;
  title: string;
  posterUrl: string | null;
  releaseDate: string;
  rating: number | null;
  genres: string[];
}): WatchlistMovie {
  return watchlistMovieSchema.parse({
    id: movie.id,
    title: movie.title,
    posterUrl: movie.posterUrl,
    releaseDate: movie.releaseDate,
    rating: movie.rating,
    genres: movie.genres,
  });
}