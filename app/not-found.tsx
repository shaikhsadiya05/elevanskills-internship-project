import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col justify-center px-6">
      <h1 className="text-3xl font-bold">Movie not found</h1>
      <p className="mt-3 text-zinc-400">This title could not be found in the selected movie provider.</p>
      <Link href="/movies" className="mt-6 w-fit text-yellow-400 underline underline-offset-4">Return to movies</Link>
    </main>
  );
}