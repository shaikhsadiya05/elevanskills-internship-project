import { Suspense } from "react";
import MovieBrowser, { MovieSkeleton } from "../../src/components/MovieBrowser";
import { getMovieProvider, isMovieCategory } from "../../src/lib/movies/providers";
import { MovieCategory } from "../../src/lib/movies/types";

export const dynamic = "force-dynamic";

type MoviesPageProps = { searchParams: Promise<{ search?: string; sort?: string }> };

async function MovieResults({ searchParams }: MoviesPageProps) {
  const params = await searchParams;
  const query = params.search?.trim().slice(0, 100);
  const requestedCategory = params.sort || (query ? "search" : "popular");
  const category: MovieCategory = isMovieCategory(requestedCategory) ? requestedCategory : "popular";
  let initialPage;
  try {
    initialPage = await getMovieProvider().list({ category, query });
  } catch {
    initialPage = undefined;
  }

  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-7xl px-5 py-10 sm:px-8">
      <header className="mb-8">
        <p className="text-sm font-medium uppercase text-yellow-400">Movie catalog</p>
        <h1 className="mt-2 text-3xl font-bold">{query ? `Search results for “${query}”` : category.replace("-", " ")}</h1>
      </header>
      <MovieBrowser category={category} query={query} initialPage={initialPage} />
    </main>
  );
}

export default function MoviesPage(props: MoviesPageProps) {
  return <Suspense fallback={<main className="mx-auto max-w-7xl px-5 py-10 sm:px-8"><MovieSkeleton /></main>}><MovieResults {...props} /></Suspense>;
}