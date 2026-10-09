"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Star } from "lucide-react";
import Link from "next/link";
import React, { useEffect, useRef } from "react";
import { Movie, MovieCategory, MoviePage } from "../lib/movies/types";
import { fetchMovieApiJson, movieApiRetryDelay, shouldRetryMovieApiQuery } from "../lib/movies/api-query";
import WatchlistButton from "./WatchlistButton";

type MovieBrowserProps = {
  category: MovieCategory;
  initialPage?: MoviePage;
  query?: string;
};

async function requestMovies(category: MovieCategory, query: string | undefined, cursor: string | null) {
  const params = new URLSearchParams({ category });
  if (query) params.set("query", query);
  if (cursor) params.set("cursor", cursor);
  return fetchMovieApiJson<MoviePage>(`/api/movies?${params.toString()}`, "Movie data is temporarily unavailable.");
}

function MovieTile({ movie, onMovieOpen }: { movie: Movie; onMovieOpen: () => void }) {
  const queryClient = useQueryClient();
  const prefetchDetails = () => {
    void queryClient.prefetchQuery({
      queryKey: ["movie", movie.id],
      queryFn: () => fetchMovieApiJson<Movie>(`/api/movies/${encodeURIComponent(movie.id)}`, "Movie details are temporarily unavailable."),
      staleTime: 5 * 60_000,
    });
  };

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 transition-colors hover:border-yellow-500/70">
      <Link
        href={`/movie/${encodeURIComponent(movie.id)}`}
        onClick={(event) => {
          if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onMovieOpen();
        }}
        onMouseEnter={prefetchDetails}
        onFocus={prefetchDetails}
        className="group block"
      >
        <div className="relative aspect-[2/3] bg-zinc-900">
          {movie.posterUrl ? <img src={movie.posterUrl} alt={`${movie.title} poster`} loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center px-5 text-center text-sm text-zinc-500">Poster unavailable</div>}
          {movie.rating !== null && <span className="absolute right-3 top-3 flex items-center gap-1 rounded bg-black/80 px-2 py-1 text-sm text-yellow-400"><Star aria-hidden="true" className="h-4 w-4 fill-current" /> {movie.rating.toFixed(1)}</span>}
        </div>
        <div className="p-4 pb-2">
          <h2 className="truncate font-semibold group-hover:text-yellow-400">{movie.title}</h2>
          <p className="mt-1 text-sm text-zinc-400">{movie.releaseDate.slice(0, 4) || "Release date unavailable"}</p>
          {movie.genres.length > 0 && <p className="mt-2 truncate text-xs text-zinc-500">{movie.genres.slice(0, 2).join(" · ")}</p>}
        </div>
      </Link>
      <div className="px-4 pb-4"><WatchlistButton compact movie={movie} /></div>
    </article>
  );
}

export function MovieSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div aria-label="Loading movies" aria-busy="true" className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
          <div className="aspect-[2/3] animate-pulse bg-zinc-800" />
          <div className="space-y-2 p-4">
            <div className="h-4 animate-pulse rounded bg-zinc-800" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MovieBrowser({ category, initialPage, query }: MovieBrowserProps) {
  const isLoadingNextPage = useRef(false);
  const scrollStorageKey = `movie-list-scroll:${category}:${query ?? ""}`;
  const moviesQuery = useInfiniteQuery({
    queryKey: ["movies", category, query ?? ""],
    queryFn: ({ pageParam }) => requestMovies(category, query, pageParam),
    initialPageParam: null as string | null,
    initialData: initialPage ? { pages: [initialPage], pageParams: [null] } : undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: shouldRetryMovieApiQuery,
    retryDelay: movieApiRetryDelay,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });
  const saveScrollPosition = () => {
    try {
      window.sessionStorage.setItem(scrollStorageKey, String(window.scrollY));
    } catch (error) {
      console.warn("Could not preserve the movie list scroll position.", error);
    }
  };

  useEffect(() => {
    if (!moviesQuery.data) return;
    let frame = 0;
    try {
      const savedPosition = window.sessionStorage.getItem(scrollStorageKey);
      if (savedPosition === null) return;
      const scrollY = Number(savedPosition);
      if (!Number.isFinite(scrollY) || scrollY < 0) {
        window.sessionStorage.removeItem(scrollStorageKey);
        return;
      }
      frame = window.requestAnimationFrame(() => {
        window.scrollTo(0, scrollY);
        window.sessionStorage.removeItem(scrollStorageKey);
      });
    } catch (error) {
      console.warn("Could not restore the movie list scroll position.", error);
    }
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [moviesQuery.data, scrollStorageKey]);

  if (moviesQuery.isLoading) return <MovieSkeleton />;
  if (moviesQuery.isError) {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-900/70 bg-red-950/30 p-5 text-red-100">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <h2 className="font-semibold">Movie service unavailable</h2>
          <p className="mt-1 text-sm text-red-100/80">{moviesQuery.error instanceof Error ? moviesQuery.error.message : "Movie data is temporarily unavailable."} Check back in a moment.</p>
          <button onClick={() => void moviesQuery.refetch()} className="mt-3 text-sm font-semibold underline underline-offset-4">Retry</button>
        </div>
      </div>
    );
  }

  const movies = Array.from(
    new Map(moviesQuery.data.pages.flatMap((page) => page.results).map((movie) => [movie.id, movie])).values(),
  );
  const loadNextPage = () => {
    if (!moviesQuery.hasNextPage || moviesQuery.isFetchingNextPage || isLoadingNextPage.current) return;
    isLoadingNextPage.current = true;
    void moviesQuery.fetchNextPage({ cancelRefetch: false }).finally(() => {
      isLoadingNextPage.current = false;
    });
  };
  if (movies.length === 0) {
    return <p className="rounded-lg border border-zinc-800 p-6 text-zinc-400">No movies found for this selection.</p>;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {movies.map((movie) => <MovieTile key={movie.id} movie={movie} onMovieOpen={saveScrollPosition} />)}
      </div>
      {moviesQuery.hasNextPage && (
        <div className="mt-8 flex justify-center">
          <button
            onClick={loadNextPage}
            disabled={moviesQuery.isFetchingNextPage}
            className="flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-3 font-medium hover:border-yellow-500 disabled:opacity-60"
          >
            {moviesQuery.isFetchingNextPage ? "Loading more movies" : "Load more"}
            <ChevronDown aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {moviesQuery.isFetchingNextPage ? "Loading more movies" : `${movies.length} movies loaded`}
      </p>
    </>
  );
}