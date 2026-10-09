"use client";

import React, { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ActorCredit } from "../../lib/actors/types";

type FilmographyExplorerProps = {
  credits: ActorCredit[];
  locale: string;
};

export default function FilmographyExplorer({ credits, locale }: FilmographyExplorerProps) {
  const [year, setYear] = useState("");
  const [genre, setGenre] = useState("");
  const [role, setRole] = useState("");
  const [search, setSearch] = useState("");
  const scrollElementRef = useRef<HTMLDivElement>(null);

  const years = useMemo(() => [...new Set(credits.map((credit) => credit.year).filter((value): value is number => value !== null))].sort((a, b) => b - a), [credits]);
  const genres = useMemo(() => [...new Set(credits.flatMap((credit) => credit.genres))].sort((a, b) => a.localeCompare(b, locale)), [credits, locale]);
  const roles = useMemo(() => [...new Set(credits.map((credit) => credit.character || credit.job || credit.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, locale)), [credits, locale]);
  const normalizedSearch = search.trim().toLocaleLowerCase(locale);
  const filtered = credits.filter((credit) => {
    if (year && credit.year !== Number(year)) return false;
    if (genre && !credit.genres.includes(genre)) return false;
    if (role && (credit.character || credit.job || credit.department) !== role) return false;
    if (normalizedSearch && ![credit.title, credit.originalTitle, ...credit.alternateTitles, credit.character]
      .join(" ").toLocaleLowerCase(locale).includes(normalizedSearch)) return false;
    return true;
  });

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => 112,
    overscan: 6,
  });

  return (
    <section aria-labelledby="filmography-heading" className="mt-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-yellow-400">{credits.length} credits</p>
          <h2 id="filmography-heading" className="mt-1 text-2xl font-bold">Filmography</h2>
        </div>
        <label className="text-sm text-zinc-300">
          Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 block min-w-52 rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-white" placeholder="Title or role" />
        </label>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-sm text-zinc-300">Year
          <select value={year} onChange={(event) => setYear(event.target.value)} className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-white">
            <option value="">All years</option>
            {years.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="text-sm text-zinc-300">Genre
          <select value={genre} onChange={(event) => setGenre(event.target.value)} className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-white">
            <option value="">All genres</option>
            {genres.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="text-sm text-zinc-300">Role
          <select value={role} onChange={(event) => setRole(event.target.value)} className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-white">
            <option value="">All roles</option>
            {roles.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 p-6 text-zinc-400">No credits match these filters.</p>
      ) : (
        <div ref={scrollElementRef} role="list" aria-label="Filtered filmography" className="relative h-[min(68vh,44rem)] min-h-80 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const credit = filtered[virtualRow.index];
              const roleText = credit.character || credit.job || credit.department;
              return (
                <article
                  key={`${credit.mediaType}-${credit.id}-${virtualRow.index}`}
                  role="listitem"
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full border-b border-zinc-800 px-4 py-3"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div className="flex min-h-20 items-center gap-4">
                    {credit.posterUrl ? <img src={credit.posterUrl} alt="" loading="lazy" className="h-20 w-14 shrink-0 rounded object-cover" /> : <div className="h-20 w-14 shrink-0 rounded bg-zinc-800" aria-hidden="true" />}
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold">{credit.title}</h3>
                      {credit.originalTitle !== credit.title && <p className="truncate text-sm text-zinc-400">{credit.originalTitle}</p>}
                      <p className="mt-1 truncate text-sm text-zinc-400">{credit.year ?? "Year unknown"} · {credit.mediaType.toUpperCase()} · {roleText || "Role unavailable"}</p>
                    </div>
                    {credit.rating !== null && <span className="shrink-0 text-sm text-yellow-400" aria-label={`Rating ${credit.rating.toFixed(1)}`}>{credit.rating.toFixed(1)}</span>}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
      <p className="sr-only" aria-live="polite">Showing {filtered.length} of {credits.length} filmography credits.</p>
    </section>
  );
}