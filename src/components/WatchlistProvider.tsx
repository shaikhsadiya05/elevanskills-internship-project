"use client";

import React, { createContext, ReactNode, useContext, useEffect, useRef, useState } from "react";
import { BrowserWatchlistRepository, createBrowserWatchlistRepository } from "../lib/watchlist/repository";
import { WatchlistEntry, WatchlistMovie } from "../lib/watchlist/types";

type WatchlistContextValue = {
  entries: WatchlistEntry[];
  ready: boolean;
  status: string;
  isSaved: (movieId: string) => boolean;
  add: (movie: WatchlistMovie) => Promise<void>;
  remove: (movieId: string) => Promise<void>;
};

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

export function useWatchlist(): WatchlistContextValue {
  const context = useContext(WatchlistContext);
  if (!context) throw new Error("useWatchlist must be used within WatchlistProvider.");
  return context;
}

export default function WatchlistProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("");
  const repositoryRef = useRef<BrowserWatchlistRepository | null>(null);

  useEffect(() => {
    const repository = createBrowserWatchlistRepository();
    repositoryRef.current = repository;
    const unsubscribe = repository.subscribe((allEntries) => setEntries(allEntries.filter((entry) => entry.saved)));
    void repository.initialize().catch(() => setStatus("Showing this browser's saved watchlist." )).finally(() => setReady(true));
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/review-sync-sw.js").then((registration) => {
      if ("sync" in registration) {
        try { void (registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register("watchlist-sync").catch(() => {}); } catch { /* Reconnect handling remains available. */ }
      }
    }).catch(() => {});
    const onOnline = () => void repository.flushOutbox().catch(() => {});
    const onServiceWorkerMessage = (event: MessageEvent<{ type?: string; clientId?: string }>) => {
      if (event.data?.type === "watchlist-outbox-synced" && event.data.clientId === repository.clientId) void repository.initialize().catch(() => {});
    };
    window.addEventListener("online", onOnline);
    navigator.serviceWorker?.addEventListener("message", onServiceWorkerMessage);
    return () => {
      unsubscribe();
      repository.dispose();
      repositoryRef.current = null;
      window.removeEventListener("online", onOnline);
      navigator.serviceWorker?.removeEventListener("message", onServiceWorkerMessage);
    };
  }, []);

  const add = async (movie: WatchlistMovie) => {
    const title = movie.title;
    setStatus(`${title} added to your watchlist${typeof navigator !== "undefined" && !navigator.onLine ? "; saved offline and queued to sync" : ""}.`);
    try { await repositoryRef.current?.add(movie); }
    catch { setStatus(`${title} could not be saved. Your previous watchlist was restored.`); }
  };

  const remove = async (movieId: string) => {
    const title = entries.find((entry) => entry.movieId === movieId)?.movie.title ?? "Movie";
    setStatus(`${title} removed from your watchlist.`);
    try { await repositoryRef.current?.remove(movieId); }
    catch { setStatus(`${title} could not be removed. Your previous watchlist was restored.`); }
  };

  const value: WatchlistContextValue = {
    entries,
    ready,
    status,
    isSaved: (movieId) => entries.some((entry) => entry.movieId === movieId),
    add,
    remove,
  };

  return <WatchlistContext.Provider value={value}>
    {children}
    <p aria-live="polite" aria-atomic="true" className="sr-only">{status}</p>
  </WatchlistContext.Provider>;
}