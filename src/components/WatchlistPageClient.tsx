"use client";

import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useWatchlist } from "./WatchlistProvider";
import WatchlistButton from "./WatchlistButton";

export default function WatchlistPageClient() {
  const { entries, ready } = useWatchlist();
  if (!ready) return <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8"><p aria-busy="true" className="animate-pulse text-zinc-400">Loading your watchlist...</p></main>;

  return <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800 pb-5">
      <div><p className="text-sm font-semibold uppercase text-yellow-400">Your collection</p><h1 className="mt-1 text-3xl font-bold">Watchlist</h1></div>
      <p className="text-sm text-zinc-400" aria-live="polite">{entries.length} {entries.length === 1 ? "movie" : "movies"}</p>
    </header>
    {entries.length === 0 ? <div className="border-y border-zinc-800 py-14 text-center">
      <h2 className="text-xl font-semibold">Your watchlist is empty</h2>
      <p className="mt-2 text-zinc-400">Save movies here to keep them close.</p>
      <Link className="mt-5 inline-flex min-h-10 items-center rounded-md bg-yellow-500 px-4 py-2 font-semibold text-black hover:bg-yellow-400" href="/movies">Browse movies</Link>
    </div> : <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-6 lg:grid-cols-5">
      <AnimatePresence initial={false}>
        {entries.map((entry) => <motion.li key={entry.movieId} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.18 }}>
          <article className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
            <Link className="group block" href={`/movie/${encodeURIComponent(entry.movieId)}`}>
              <div className="relative aspect-[2/3] bg-zinc-900">
                {entry.movie.posterUrl ? <Image alt={`${entry.movie.title} poster`} className="object-cover" fill loading="lazy" sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 220px" src={entry.movie.posterUrl} /> : <div className="grid h-full place-items-center px-4 text-center text-sm text-zinc-500">Poster unavailable</div>}
              </div>
              <div className="p-4 pb-2">
                <h2 className="truncate font-semibold group-hover:text-yellow-400">{entry.movie.title}</h2>
                <p className="mt-1 text-sm text-zinc-400">{entry.movie.releaseDate.slice(0, 4) || "Release date unavailable"}</p>
              </div>
            </Link>
            <div className="px-4 pb-4"><WatchlistButton compact movie={entry.movie} /></div>
          </article>
        </motion.li>)}
      </AnimatePresence>
    </ul>}
  </main>;
}