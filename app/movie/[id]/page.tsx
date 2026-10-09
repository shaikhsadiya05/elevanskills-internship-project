import { notFound } from "next/navigation";
import { Suspense } from "react";
import MovieDetailClient from "../../../src/components/MovieDetailClient";
import MovieDetailLink from "../../../src/components/MovieDetailLink";
import CommunityReviewPanel from "../../../src/components/CommunityReviewPanel";
import { getMovieProvider } from "../../../src/lib/movies/providers";
import { ProviderError } from "../../../src/lib/server/resilience";
import { Movie, MovieRecommendation, MovieReview } from "../../../src/lib/movies/types";

function SectionLoading({ label }: { label: string }) {
  return <p aria-busy="true" className="mt-4 animate-pulse text-sm text-zinc-500">Loading {label}...</p>;
}

async function CreditsSection({ creditsPromise }: { creditsPromise: Promise<Movie["cast"]> }) {
  const credits = await creditsPromise;
  return <section className="mt-10 border-t border-zinc-800 pt-7" aria-labelledby="cast-heading">
    <h2 id="cast-heading" className="text-2xl font-semibold">Cast</h2>
    {credits.length ? <ul className="mt-4 grid gap-x-8 divide-y divide-zinc-800 sm:grid-cols-2">{credits.map((person) => <li key={person.id} className="py-3"><a href={`/actor/${encodeURIComponent(person.id)}`} className="font-medium hover:text-yellow-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-400">{person.name}</a><p className="text-sm text-zinc-400">{person.role}</p></li>)}</ul> : <p className="mt-4 text-zinc-400">Cast information is unavailable.</p>}
  </section>;
}

async function ReviewsSection({ reviewsPromise }: { reviewsPromise: Promise<MovieReview[]> }) {
  const reviews = await reviewsPromise;
  return <section className="mt-10 border-t border-zinc-800 pt-7" aria-labelledby="reviews-heading">
    <h2 id="reviews-heading" className="text-2xl font-semibold">Reviews</h2>
    {reviews.length ? <ul className="mt-4 divide-y divide-zinc-800">{reviews.map((review) => <li key={review.id} className="py-4"><h3 className="font-medium">{review.author}{review.rating !== null && <span className="ml-2 text-sm text-yellow-400">{review.rating}/10</span>}</h3><p className="mt-2 whitespace-pre-line text-sm leading-6 text-zinc-300">{review.content}</p></li>)}</ul> : <p className="mt-4 text-zinc-400">Reviews are unavailable for this title.</p>}
  </section>;
}

async function RecommendationsSection({ recommendationsPromise }: { recommendationsPromise: Promise<MovieRecommendation[]> }) {
  const recommendations = await recommendationsPromise;
  if (!recommendations.length) return null;
  return <section className="mt-10 border-t border-zinc-800 pt-7" aria-labelledby="recommendations-heading">
    <h2 id="recommendations-heading" className="text-2xl font-semibold">More like this</h2>
    <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">{recommendations.map((movie, index) => <li key={movie.id}><MovieDetailLink movie={movie} adjacentMovie={recommendations[index + 1]} /></li>)}</ul>
  </section>;
}

function staticMovie(id: string): Movie {
  return { id, title: "Movie details unavailable", overview: "", releaseDate: "", rating: null, posterUrl: null, backdropUrl: null, genres: [], cast: [], trailerUrl: null };
}

export default async function MovieDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const provider = getMovieProvider();
  const creditsPromise = provider.getCredits(id).catch(() => []);
  const reviewsPromise = provider.getReviews(id).catch(() => []);
  const recommendationsPromise = provider.getRecommendations(id).catch(() => []);
  try {
    const movie = await provider.getDetails(id);
    return <>
      <MovieDetailClient movie={movie} />
      <main className="mx-auto max-w-7xl px-5 pb-10 sm:px-8">
        <Suspense fallback={<SectionLoading label="cast" />}><CreditsSection creditsPromise={creditsPromise} /></Suspense>
        <Suspense fallback={<SectionLoading label="reviews" />}><ReviewsSection reviewsPromise={reviewsPromise} /></Suspense>
        <CommunityReviewPanel movieId={id} />
        <Suspense fallback={<SectionLoading label="recommendations" />}><RecommendationsSection recommendationsPromise={recommendationsPromise} /></Suspense>
      </main>
    </>;
  } catch (error) {
    if (error instanceof ProviderError && error.status === 404) notFound();
    return <MovieDetailClient movie={staticMovie(id)} fallback />;
  }
}