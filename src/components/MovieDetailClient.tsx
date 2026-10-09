"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import React, { KeyboardEvent, useState } from "react";
import { Movie } from "../lib/movies/types";
import { fetchMovieApiJson, movieApiRetryDelay, shouldRetryMovieApiQuery } from "../lib/movies/api-query";
import WatchlistButton from "./WatchlistButton";

async function loadMovie(id: string): Promise<Movie> {
  return fetchMovieApiJson<Movie>(`/api/movies/${encodeURIComponent(id)}`, "Movie details are temporarily unavailable.");
}

function youtubeEmbedUrl(trailerUrl: string): string | null {
  try {
    const url = new URL(trailerUrl);
    const videoId = url.protocol !== "https:"
      ? null
      : url.hostname === "youtu.be"
      ? url.pathname.slice(1)
      : ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)
        ? url.searchParams.get("v")
        : null;
    return videoId && /^[\w-]{11}$/.test(videoId) ? `https://www.youtube-nocookie.com/embed/${videoId}` : null;
  } catch {
    return null;
  }
}

export function MovieMediaCarousel({ movie }: { movie: Movie }) {
  const prefersReducedMotion = useReducedMotion();
  const trailerUrl = movie.trailerUrl ? youtubeEmbedUrl(movie.trailerUrl) : null;
  const slides = [
    ...(movie.backdropUrl ? [{ type: "image" as const, src: movie.backdropUrl, label: `${movie.title} backdrop` }] : []),
    ...(movie.posterUrl ? [{ type: "image" as const, src: movie.posterUrl, label: `${movie.title} poster` }] : []),
    ...(trailerUrl ? [{ type: "video" as const, src: trailerUrl, label: `${movie.title} trailer` }] : []),
  ];
  const [activeSlide, setActiveSlide] = useState(0);
  const move = (offset: number) => setActiveSlide((index) => (index + offset + slides.length) % slides.length);
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      move(1);
    }
  };

  if (!slides.length) return (
    <div className="space-y-2">
      <div className="flex aspect-video items-center justify-center bg-zinc-900 text-zinc-500">Movie media unavailable</div>
      <p role="status" className="text-sm text-zinc-400">Trailer not available.</p>
    </div>
  );
  const slide = slides[activeSlide] ?? slides[0];
  return (
    <div>
      <section aria-label={`${movie.title} media`} aria-roledescription="carousel" className="relative overflow-hidden bg-black" onKeyDown={handleKeyDown} role="group" tabIndex={0}>
        <div className="relative aspect-video">
          <AnimatePresence initial={false} mode="wait">
            <motion.div key={slide.src} animate={{ opacity: 1, x: 0 }} className="absolute inset-0" exit={{ opacity: 0, x: prefersReducedMotion ? 0 : -24 }} initial={{ opacity: 0, x: prefersReducedMotion ? 0 : 24 }} transition={{ duration: prefersReducedMotion ? 0 : 0.22 }}>
              {slide.type === "video" ? (
                <iframe allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen className="h-full w-full" loading="lazy" src={slide.src} title={slide.label} />
              ) : (
                <Image alt={slide.label} className="object-cover" fill priority={activeSlide === 0} sizes="(max-width: 768px) 100vw, 1200px" src={slide.src} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        {slides.length > 1 && <>
          <button aria-label="Previous media" className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/75 text-white hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-400" onClick={() => move(-1)} type="button"><ChevronLeft aria-hidden="true" /></button>
          <button aria-label="Next media" className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/75 text-white hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-400" onClick={() => move(1)} type="button">{slide.type === "video" ? <Play aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</button>
        </>}
        <p aria-live="polite" className="sr-only">{`Slide ${activeSlide + 1} of ${slides.length}: ${slide.label}`}</p>
      </section>
      {!trailerUrl && <p role="status" className="mt-2 text-sm text-zinc-400">Trailer not available.</p>}
    </div>
  );
}

export default function MovieDetailClient({ movie: initialMovie, fallback = false }: { movie: Movie; fallback?: boolean }) {
  const query = useQuery({
    queryKey: ["movie", initialMovie.id],
    queryFn: () => loadMovie(initialMovie.id),
    initialData: initialMovie,
    retry: shouldRetryMovieApiQuery,
    retryDelay: movieApiRetryDelay,
    staleTime: fallback ? 0 : 5 * 60_000,
  });
  const movie = query.data;
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
      {fallback && movie.title === "Movie details unavailable" && <div role={query.isError ? "alert" : "status"} className="mb-5 border-l-2 border-yellow-500 pl-3 text-sm text-zinc-300">
        <p>Movie details could not be loaded. Showing a fallback view.</p>
        <button className="mt-2 font-semibold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-400" onClick={() => void query.refetch()} type="button">Retry movie data</button>
      </div>}
      <MovieMediaCarousel movie={movie} />
      <header className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 sm:mt-7 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-zinc-400">{movie.releaseDate || "Release date unavailable"}</p>
            <h1 className="mt-2 break-words text-3xl font-bold leading-tight sm:text-4xl">{movie.title}</h1>
            {movie.genres.length > 0 && <ul aria-label="Genres" className="mt-3 flex flex-wrap gap-2">
              {movie.genres.map((genre) => <li key={genre} className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300">{genre}</li>)}
            </ul>}
          </div>
          {movie.rating !== null && <p className="shrink-0 rounded-lg bg-zinc-900 px-3 py-2 text-yellow-400" aria-label={`Rating ${movie.rating} out of 10`}>
            <span aria-hidden="true">★ </span><span className="font-semibold">{movie.rating.toFixed(1)}</span><span className="text-sm text-zinc-400"> / 10</span>
          </p>}
        </div>
        <section className="mt-5 border-t border-zinc-800 pt-4" aria-labelledby="overview-heading">
          <h2 id="overview-heading" className="text-lg font-semibold">Overview</h2>
          <p className="mt-2 max-w-4xl break-words text-sm leading-7 text-zinc-300 sm:text-base">{movie.overview || "No overview is available for this title."}</p>
        </section>
        <div className="mt-5">
          <WatchlistButton movie={movie} />
        </div>
        <p aria-live="polite" className="sr-only">{query.isFetching ? "Refreshing movie data" : "Movie details loaded"}</p>
      </header>
    </main>
  );
}