import { Award } from "lucide-react";
import { actorAwardsRepository } from "../../lib/actors/mock-awards-repository";

export default async function AwardsPanel({ actorId }: { actorId: string }) {
  const { awards } = await actorAwardsRepository.getAwards(actorId);
  return (
    <section aria-labelledby="awards-heading" className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="awards-heading" className="text-xl font-semibold">Awards & recognition</h2>
        <span className="text-xs text-zinc-500">Sample supplemental records</span>
      </div>
      {awards.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-400">No award records are available for this person.</p>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-800">
          {awards.map((award) => (
            <li key={`${award.title}-${award.year}-${award.category}`} className="flex gap-3 py-3">
              <Award aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-yellow-400" />
              <div>
                <p className="font-medium">{award.title} · {award.year}</p>
                <p className="text-sm text-zinc-300">{award.category} · {award.result}</p>
                <p className="text-sm text-zinc-500">{award.work}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}