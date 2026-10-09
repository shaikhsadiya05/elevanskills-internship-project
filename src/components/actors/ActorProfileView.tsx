import Image from "next/image";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { Metadata } from "next";
import ActorPanelFallback from "./ActorPanelFallback";
import AwardsPanel from "./AwardsPanel";
import FilmographyExplorer from "./FilmographyExplorer";
import SimilarActorsPanel from "./SimilarActorsPanel";
import SocialLinksPanel from "./SocialLinksPanel";
import { actorRepository } from "../../lib/actors/repository";
import { ProviderError } from "../../lib/server/resilience";

export async function getActorMetadata(actorId: string, locale: string): Promise<Metadata> {
  try {
    const actor = await actorRepository.getProfile(actorId, locale);
    return {
      title: `${actor.name} | MovieDB`,
      description: actor.biography.slice(0, 160) || `Filmography and profile for ${actor.name}.`,
    };
  } catch {
    return { title: "Actor profile | MovieDB", description: "Actor filmography and profile." };
  }
}

export default async function ActorProfileView({ actorId, locale }: { actorId: string; locale: string }) {
  let actor;
  try {
    actor = await actorRepository.getProfile(actorId, locale);
  } catch (error) {
    if (error instanceof ProviderError && error.status === 404) notFound();
    const message = error instanceof ProviderError && error.code === "PROVIDER_NOT_CONFIGURED"
      ? "Actor profiles are unavailable because the server's TMDb provider is not configured."
      : error instanceof ProviderError && error.code === "UPSTREAM_RATE_LIMIT"
        ? "TMDb is temporarily rate limiting actor-profile requests. Please wait and try again."
      : error instanceof ProviderError && error.code === "PROVIDER_AUTH_FAILED"
        ? "TMDb rejected the server credentials. Check the server-side TMDb token configuration."
      : error instanceof ProviderError && error.code === "INVALID_PROVIDER_RESPONSE"
        ? "The actor profile service returned data that could not be displayed."
        : error instanceof ProviderError && error.code === "PROVIDER_REJECTED"
          ? "TMDb rejected the actor-profile request. Check the server-side provider configuration."
          : "The actor profile service is temporarily unavailable. Check TMDb connectivity and try again.";
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col justify-center px-5 sm:px-8">
        <h1 className="text-3xl font-bold">Actor profile unavailable</h1>
        <p role="alert" className="mt-3 text-zinc-400">{message}</p>
        <form action="" className="mt-4" method="get">
          <button className="font-semibold text-yellow-400 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-400" type="submit">Try again</button>
        </form>
      </main>
    );
  }

  const sameAs = [
    actor.imdbId ? `https://www.imdb.com/name/${actor.imdbId}/` : null,
    actor.instagramId ? `https://www.instagram.com/${actor.instagramId.replace(/^@/, "")}/` : null,
  ].filter((url): url is string => Boolean(url));
  const personJsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Person",
    name: actor.name,
    alternateName: actor.alternateNames.length ? actor.alternateNames : undefined,
    description: actor.biography || undefined,
    image: actor.profileUrl || undefined,
    birthDate: actor.birthday || undefined,
    birthPlace: actor.placeOfBirth ? { "@type": "Place", name: actor.placeOfBirth } : undefined,
    sameAs: sameAs.length ? sameAs : undefined,
  }).replace(/</g, "\\u003c");

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: personJsonLd }} />
      <header className="grid gap-6 border-b border-zinc-800 pb-8 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-end">
        {actor.profileUrl ? (
          <Image src={actor.profileUrl} alt={actor.name} width={320} height={480} priority sizes="(max-width: 640px) 128px, 160px" className="h-40 w-32 rounded-lg object-cover sm:h-52 sm:w-40" />
        ) : (
          <div aria-label="Profile image unavailable" className="h-40 w-32 rounded-lg bg-zinc-800 sm:h-52 sm:w-40" />
        )}
        <div>
          <p className="text-sm font-semibold uppercase text-yellow-400">{actor.knownForDepartment || "Actor"}</p>
          <h1 className="mt-2 text-4xl font-bold sm:text-5xl">{actor.name}</h1>
          {actor.alternateNames.length > 0 && <p className="mt-3 text-sm text-zinc-400">Also known as: {actor.alternateNames.slice(0, 5).join(", ")}</p>}
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-300">
            {actor.birthday && <div><dt className="sr-only">Born</dt><dd>{actor.birthday}</dd></div>}
            {actor.placeOfBirth && <div><dt className="sr-only">Place of birth</dt><dd>{actor.placeOfBirth}</dd></div>}
          </dl>
        </div>
      </header>

      <section className="mt-8 max-w-4xl" aria-labelledby="biography-heading">
        <h2 id="biography-heading" className="text-2xl font-semibold">Biography</h2>
        {actor.biography ? <p className="mt-3 whitespace-pre-line leading-7 text-zinc-300">{actor.biography}</p> : <p className="mt-3 text-zinc-400">No biography is available in this language.</p>}
      </section>

      <FilmographyExplorer credits={actor.filmography} locale={locale} />

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        <Suspense fallback={<ActorPanelFallback title="awards" />}><AwardsPanel actorId={actor.id} /></Suspense>
        <Suspense fallback={<ActorPanelFallback title="social links" />}><SocialLinksPanel actor={actor} /></Suspense>
        <Suspense fallback={<ActorPanelFallback title="similar actors" />}><SimilarActorsPanel actorId={actor.id} locale={locale} /></Suspense>
      </div>
    </main>
  );
}