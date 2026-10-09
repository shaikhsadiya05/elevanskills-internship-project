export default function ActorPanelFallback({ title }: { title: string }) {
  return (
    <section aria-label={`Loading ${title}`} aria-busy="true" className="min-h-36 animate-pulse rounded-lg border border-zinc-800 bg-zinc-950 p-5">
      <div className="h-5 w-40 rounded bg-zinc-800" />
      <div className="mt-5 h-16 rounded bg-zinc-900" />
    </section>
  );
}