import Image from "next/image";
import Link from "next/link";
import { actorRepository } from "../../lib/actors/repository";

export default async function SimilarActorsPanel({ actorId, locale }: { actorId: string; locale: string }) {
  try {
    const actors = await actorRepository.getSimilarActors(actorId, locale);
    return (
      <section aria-labelledby="similar-heading" className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <h2 id="similar-heading" className="text-xl font-semibold">Similar actors</h2>
        {actors.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-400">No shared-credit matches are available.</p>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {actors.map((actor) => (
              <li key={actor.id}>
                <Link href={`/actor/${actor.id}`} className="block rounded border border-zinc-800 p-3 hover:border-yellow-500">
                  {actor.profileUrl && <Image src={actor.profileUrl} alt="" width={48} height={48} className="mb-2 h-12 w-12 rounded-full object-cover" />}
                  <span className="block truncate text-sm font-medium">{actor.name}</span>
                  <span className="text-xs text-zinc-500">{actor.sharedCredits} shared credits</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  } catch {
    return (
      <section aria-labelledby="similar-heading" className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <h2 id="similar-heading" className="text-xl font-semibold">Similar actors</h2>
        <p className="mt-4 text-sm text-zinc-400">Similar actor data is temporarily unavailable.</p>
      </section>
    );
  }
}