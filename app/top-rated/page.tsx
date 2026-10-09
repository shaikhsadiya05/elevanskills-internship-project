import MovieBrowser from "../../src/components/MovieBrowser";
import { getMovieProvider } from "../../src/lib/movies/providers";

export const dynamic = "force-dynamic";

export default async function TopRatedPage() {
  let initialPage;
  try {
    initialPage = await getMovieProvider().list({ category: "top-rated" });
  } catch {
    initialPage = undefined;
  }

  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-7xl px-5 py-10 sm:px-8">
      <header className="mb-8">
        <p className="text-sm font-medium uppercase text-yellow-400">Movie catalog</p>
        <h1 className="mt-2 text-3xl font-bold">Top Rated Movies</h1>
      </header>
      <MovieBrowser category="top-rated" initialPage={initialPage} />
    </main>
  );
}