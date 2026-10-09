"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center px-6 text-center">
      <h1 className="text-3xl font-bold">Something went wrong</h1>
      <p className="mt-3 text-zinc-400">Movie data is temporarily unavailable. Please try again.</p>
      <button onClick={reset} className="mt-6 rounded-lg bg-yellow-500 px-5 py-3 font-semibold text-black">
        Try again
      </button>
    </main>
  );
}