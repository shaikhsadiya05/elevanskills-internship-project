"use client";

export default function ActorRouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-3xl flex-col justify-center px-5">
      <h1 className="text-3xl font-bold">Actor profile error</h1>
      <p role="alert" className="mt-3 text-zinc-400">We could not load this actor profile. Please retry.</p>
      <button onClick={reset} className="mt-5 w-fit rounded bg-yellow-500 px-4 py-2 font-semibold text-black">Retry</button>
    </main>
  );
}