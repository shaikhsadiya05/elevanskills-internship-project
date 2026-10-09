"use client";

import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Movie } from "../lib/movies/types";

export default function MovieDetailLink({ movie, adjacentMovie }: { movie: Movie; adjacentMovie?: Movie }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const href = `/movie/${encodeURIComponent(movie.id)}`;
  const prefetchMovie = (target: Movie) => {
    const targetHref = `/movie/${encodeURIComponent(target.id)}`;
    router.prefetch(targetHref);
    void queryClient.prefetchQuery({
      queryKey: ["movie", target.id],
      queryFn: async () => {
        const response = await fetch(`/api/movies/${encodeURIComponent(target.id)}`);
        if (!response.ok) throw new Error("Movie details are temporarily unavailable.");
        return (await response.json()) as Movie;
      },
      staleTime: 5 * 60_000,
    });
  };
  const prefetch = () => {
    prefetchMovie(movie);
    if (adjacentMovie) prefetchMovie(adjacentMovie);
  };
  return <Link href={href} onMouseEnter={prefetch} onFocus={prefetch} className="group block">
    <div className="relative aspect-[2/3] overflow-hidden bg-zinc-900">
      {movie.posterUrl ? <Image alt={`${movie.title} poster`} className="object-cover transition-transform duration-300 group-hover:scale-[1.03]" fill loading="lazy" sizes="(max-width: 640px) 45vw, 180px" src={movie.posterUrl} /> : <div className="grid h-full place-items-center text-sm text-zinc-500">Poster unavailable</div>}
    </div>
    <h3 className="mt-2 truncate font-medium group-hover:text-yellow-400">{movie.title}</h3>
    <p className="text-sm text-zinc-400">{movie.releaseDate.slice(0, 4) || "Release date unavailable"}</p>
  </Link>;
}