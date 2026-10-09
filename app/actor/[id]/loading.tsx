export default function ActorLoading() {
  return (
    <main aria-label="Loading actor profile" aria-busy="true" className="mx-auto max-w-7xl animate-pulse px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid gap-6 border-b border-zinc-800 pb-8 sm:grid-cols-[160px_minmax(0,1fr)]">
        <div className="h-40 w-32 rounded-lg bg-zinc-800 sm:h-52 sm:w-40" />
        <div className="space-y-4 self-end"><div className="h-4 w-24 rounded bg-zinc-800" /><div className="h-10 w-2/3 rounded bg-zinc-800" /><div className="h-4 w-1/2 rounded bg-zinc-800" /></div>
      </div>
      <div className="mt-8 h-32 rounded-lg bg-zinc-900" />
      <div className="mt-8 h-96 rounded-lg bg-zinc-900" />
    </main>
  );
}