"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { WatchlistMovie } from "../lib/watchlist/types";
import { useWatchlist } from "./WatchlistProvider";

export default function WatchlistButton({ movie, compact = false }: { movie: WatchlistMovie; compact?: boolean }) {
  const { ready, isSaved, add, remove } = useWatchlist();
  const prefersReducedMotion = useReducedMotion();
  const saved = isSaved(movie.id);
  const Icon = saved ? BookmarkCheck : Bookmark;

  return (
    <button
      type="button"
      aria-label={`${saved ? "Remove" : "Add"} ${movie.title} ${saved ? "from" : "to"} watchlist`}
      aria-pressed={saved}
      disabled={!ready}
      onClick={() => void (saved ? remove(movie.id) : add(movie))}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-100 transition-colors hover:border-yellow-500 hover:text-yellow-400 disabled:cursor-wait disabled:opacity-60 ${compact ? "w-full" : ""}`}
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span key={saved ? "saved" : "unsaved"} aria-hidden="true" initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.75, y: prefersReducedMotion ? 0 : 3 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.75, y: 0 }} transition={{ duration: prefersReducedMotion ? 0 : 0.14 }}>
          <Icon className="h-4 w-4" />
        </motion.span>
      </AnimatePresence>
      <span>{saved ? "In watchlist" : "Add to watchlist"}</span>
    </button>
  );
}