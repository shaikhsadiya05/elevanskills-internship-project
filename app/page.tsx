import { Suspense } from "react";
import MovieBrowser, { MovieSkeleton } from "../src/components/MovieBrowser";
import { getMovieProvider } from "../src/lib/movies/providers";
import { Movie } from "../src/lib/movies/types";

export const dynamic = "force-dynamic";

async function TrendingMovies() {
  let initialPage;
  try {
    initialPage = await getMovieProvider().list({ category: "trending" });
  } catch {
    initialPage = undefined;
  }
  const featured: Movie | undefined = initialPage?.results[0];

  return (
    <>
      <section className="relative isolate flex min-h-[58vh] items-end overflow-hidden border-b border-zinc-800 bg-zinc-950">
        {featured?.backdropUrl && <img src={featured.backdropUrl} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />}
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black via-black/75 to-black/20" />
        <div className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-8">
          <p className="mb-3 text-sm font-bold uppercase text-yellow-400">Discover movies</p>
          <h1 className="max-w-3xl text-4xl font-bold sm:text-6xl">{featured?.title ?? "Movies worth your time"}</h1>
          <p className="mt-4 max-w-2xl text-lg leading-7 text-zinc-300">{featured?.overview || "Browse current titles, explore ratings, and find your next watch."}</p>
        </div>
      </section>
      <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div><p className="text-sm font-medium text-yellow-400">Updated from the movie catalog</p><h2 className="mt-1 text-2xl font-bold">Trending this week</h2></div>
          <a href="/movies?sort=trending" className="text-sm font-semibold text-yellow-400 hover:text-yellow-300">Browse movies</a>
        </div>
        <MovieBrowser category="trending" initialPage={initialPage} />
      </main>
    </>
  );
}

export default function HomePage() {
  return <Suspense fallback={<main className="mx-auto max-w-7xl px-5 py-10 sm:px-8"><MovieSkeleton /></main>}><TrendingMovies /></Suspense>;
}