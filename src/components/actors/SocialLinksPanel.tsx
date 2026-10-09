import { ExternalLink } from "lucide-react";
import { ActorProfile } from "../../lib/actors/types";

export default function SocialLinksPanel({ actor }: { actor: ActorProfile }) {
  const links = [
    actor.imdbId ? { label: "IMDb", href: `https://www.imdb.com/name/${encodeURIComponent(actor.imdbId)}/` } : null,
    actor.instagramId ? { label: "Instagram", href: `https://www.instagram.com/${encodeURIComponent(actor.instagramId.replace(/^@/, ""))}/` } : null,
  ].filter((link): link is { label: string; href: string } => link !== null);

  return (
    <section aria-labelledby="social-heading" className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
      <h2 id="social-heading" className="text-xl font-semibold">Social & external profiles</h2>
      {links.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-400">No verified external profiles are available.</p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-3">
          {links.map((link) => (
            <li key={link.label}>
              <a href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded border border-zinc-700 px-3 py-2 text-sm hover:border-yellow-500">
                {link.label}<ExternalLink aria-hidden="true" className="h-4 w-4" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}