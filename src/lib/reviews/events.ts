export type ReviewEvent = { movieId: string; type: "created" | "updated" | "deleted" | "restored" | "voted" | "flagged" };
type Listener = (event: ReviewEvent) => void;

type ReviewEventGlobal = typeof globalThis & { __movieDbReviewListeners?: Map<string, Set<Listener>> };
const reviewEventGlobal = globalThis as ReviewEventGlobal;
const listeners = reviewEventGlobal.__movieDbReviewListeners ??= new Map<string, Set<Listener>>();

export function subscribeToReviewEvents(movieId: string, listener: Listener): () => void {
  const movieListeners = listeners.get(movieId) ?? new Set<Listener>();
  movieListeners.add(listener);
  listeners.set(movieId, movieListeners);
  return () => {
    movieListeners.delete(listener);
    if (movieListeners.size === 0) listeners.delete(movieId);
  };
}

export function publishReviewEvent(event: ReviewEvent): void {
  listeners.get(event.movieId)?.forEach((listener) => listener(event));
}