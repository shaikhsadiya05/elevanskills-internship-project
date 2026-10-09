"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import type { CommunityReview, ReviewPage } from "../lib/reviews/repository";
import { enqueueReview, listQueuedReviews, loadReviewDraft, removeQueuedReview, removeReviewDraft, reviewCapability, ReviewDraft, saveReviewDraft } from "../lib/reviews/draft-store";
import { reviewContentSchema, ReviewSort } from "../lib/reviews/schema";
import { diffReviewHistory, wilsonScoreLowerBound } from "../lib/reviews/scoring";

const PAGE_SIZE = 6;

async function loadReviews(movieId: string, sort: ReviewSort, page: number, capability: string): Promise<ReviewPage> {
  const params = new URLSearchParams({ sort, page: String(page), pageSize: String(PAGE_SIZE) });
  const response = await fetch(`/api/movies/${encodeURIComponent(movieId)}/reviews?${params}`, { headers: { "X-Review-Capability": capability } });
  if (!response.ok) throw new Error("Community reviews could not be loaded.");
  return response.json() as Promise<ReviewPage>;
}

function reviewHeaders(capability: string, idempotencyKey?: string): HeadersInit {
  return { "Content-Type": "application/json", "X-Review-Capability": capability, ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) };
}

export default function CommunityReviewPanel({ movieId }: { movieId: string }) {
  const queryClient = useQueryClient();
  const [capability, setCapability] = useState("");
  const [sort, setSort] = useState<ReviewSort>("recent");
  const [page, setPage] = useState(1);
  const [displayName, setDisplayName] = useState("Guest");
  const [body, setBody] = useState("");
  const [rating, setRating] = useState(8);
  const [message, setMessage] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [editing, setEditing] = useState<CommunityReview | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editRating, setEditRating] = useState(8);
  const [undo, setUndo] = useState<CommunityReview | null>(null);
  const queryKey = ["community-reviews", movieId, sort, page, capability] as const;
  const reviewsQuery = useQuery({ queryKey, queryFn: () => loadReviews(movieId, sort, page, capability), enabled: capability.length > 0, staleTime: 0 });

  useEffect(() => {
    const currentCapability = reviewCapability();
    setCapability(currentCapability);
    void loadReviewDraft(movieId).then((draft) => {
      if (!draft) return;
      setDisplayName(draft.displayName);
      setBody(draft.body);
      setRating(draft.rating);
    }).catch(() => {}).finally(() => setDraftReady(true));
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/review-sync-sw.js").then(async (registration) => {
      if ("sync" in registration) {
        try { await (registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register("review-submissions"); } catch { /* Online retry remains available. */ }
      }
    }).catch(() => {});
    const onOnline = () => {
      void listQueuedReviews().then(async (queuedReviews) => {
        for (const queued of queuedReviews.filter((item) => item.movieId === movieId)) {
          const response = await fetch(`/api/movies/${encodeURIComponent(movieId)}/reviews`, { method: "POST", headers: reviewHeaders(queued.capability, queued.idempotencyKey), body: JSON.stringify(queued.content) });
          if (response.ok) await removeQueuedReview(queued.idempotencyKey);
        }
        await queryClient.invalidateQueries({ queryKey: ["community-reviews", movieId] });
      }).catch(() => {});
      if ("serviceWorker" in navigator) void navigator.serviceWorker.ready.then((registration) => registration.active?.postMessage({ type: "sync-review-outbox" })).catch(() => {});
    };
    const serviceWorker = "serviceWorker" in navigator ? navigator.serviceWorker : null;
    const onServiceWorkerMessage = (event: MessageEvent<{ type?: string; movieId?: string }>) => {
      if (event.data?.type === "review-outbox-synced") void queryClient.invalidateQueries({ queryKey: ["community-reviews", event.data.movieId] });
    };
    window.addEventListener("online", onOnline);
    serviceWorker?.addEventListener("message", onServiceWorkerMessage);
    return () => {
      window.removeEventListener("online", onOnline);
      serviceWorker?.removeEventListener("message", onServiceWorkerMessage);
    };
  }, [movieId, queryClient]);

  useEffect(() => {
    if (!capability || !draftReady) return;
    const timeout = window.setTimeout(() => {
      if (body.length === 0) {
        void removeReviewDraft(movieId).catch(() => {});
        return;
      }
      const draft: ReviewDraft = { displayName: displayName.slice(0, 40), body: body.slice(0, 4000), rating: Math.min(10, Math.max(1, rating)), movieId, updatedAt: Date.now() };
      void saveReviewDraft(draft).catch(() => {});
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [body, capability, displayName, draftReady, movieId, rating]);

  useEffect(() => {
    if (!capability) return;
    const eventSource = new EventSource(`/api/movies/${encodeURIComponent(movieId)}/reviews/events`);
    const onReviewEvent = () => void queryClient.invalidateQueries({ queryKey: ["community-reviews", movieId] });
    eventSource.addEventListener("review", onReviewEvent);
    return () => eventSource.close();
  }, [capability, movieId, page, queryClient]);

  const reviews = reviewsQuery.data?.reviews ?? [];
  const queryData = reviewsQuery.data;

  useEffect(() => {
    if (!capability || page !== 1 || !reviewsQuery.isSuccess) return;
    void listQueuedReviews().then((queuedReviews) => {
      const pendingReviews: CommunityReview[] = queuedReviews.filter((item) => item.movieId === movieId && item.capability === capability).map((item) => ({
        id: `pending-${item.idempotencyKey}`, movieId, ...item.content, helpfulCount: 0, notHelpfulCount: 0, flagsCount: 0,
        createdAt: new Date(item.queuedAt).toISOString(), updatedAt: new Date(item.queuedAt).toISOString(), deletedAt: null,
        moderationStatus: "published", revisions: [], viewerCanEdit: true, viewerVote: null,
      }));
      queryClient.setQueryData<ReviewPage>(["community-reviews", movieId, sort, page, capability], (current) => current && ({
        ...current,
        reviews: [...pendingReviews.filter((pending) => !current.reviews.some((review) => review.id === pending.id)), ...current.reviews],
      }));
    }).catch(() => {});
  }, [capability, movieId, page, queryClient, reviewsQuery.isSuccess, sort]);

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = reviewContentSchema.safeParse({ displayName, body, rating });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? "Check your review details.");
      return;
    }
    const idempotencyKey = crypto.randomUUID();
    const now = new Date().toISOString();
    const optimistic: CommunityReview = {
      id: `pending-${idempotencyKey}`, movieId, ...parsed.data, helpfulCount: 0, notHelpfulCount: 0, flagsCount: 0,
      createdAt: now, updatedAt: now, deletedAt: null, moderationStatus: "published", revisions: [], viewerCanEdit: true, viewerVote: null,
    };
    const previous = queryClient.getQueryData<ReviewPage>(queryKey);
    queryClient.setQueryData<ReviewPage>(queryKey, (current) => page === 1 ? {
      ...(current ?? { reviews: [], page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 }),
      total: (current?.total ?? 0) + 1,
      reviews: [optimistic, ...(current?.reviews ?? [])],
    } : current);
    try {
      if (!navigator.onLine) throw new TypeError("offline");
      const response = await fetch(`/api/movies/${encodeURIComponent(movieId)}/reviews`, { method: "POST", headers: reviewHeaders(capability, idempotencyKey), body: JSON.stringify(parsed.data) });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error ?? "Review could not be posted.");
      }
      const saved = await response.json() as CommunityReview;
      queryClient.setQueryData<ReviewPage>(queryKey, (current) => current && page === 1 ? { ...current, reviews: current.reviews.map((review) => review.id === optimistic.id ? saved : review) } : current);
      await removeReviewDraft(movieId).catch(() => {});
      setBody("");
      setMessage(saved.moderationStatus === "pending" ? "Submitted for moderation." : "Review posted.");
      await queryClient.invalidateQueries({ queryKey: ["community-reviews", movieId] });
    } catch (error) {
      if (error instanceof TypeError) {
        try {
          await enqueueReview({ movieId, capability, idempotencyKey, content: parsed.data, queuedAt: Date.now() });
          if ("serviceWorker" in navigator) {
            void navigator.serviceWorker.ready.then((registration) => {
              if ("sync" in registration) return (registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register("review-submissions");
              registration.active?.postMessage({ type: "sync-review-outbox" });
            }).catch(() => {});
          }
          await removeReviewDraft(movieId).catch(() => {});
          setBody("");
          setMessage("Saved offline and queued to sync when you reconnect.");
          return;
        } catch { setMessage("Offline storage is unavailable. Keep this page open and try again when connected."); }
      } else {
        setMessage(error instanceof Error ? error.message : "Review could not be posted.");
      }
      queryClient.setQueryData(queryKey, previous);
    }
  }

  async function vote(review: CommunityReview, helpful: boolean) {
    const previous = queryClient.getQueryData<ReviewPage>(queryKey);
    queryClient.setQueryData<ReviewPage>(queryKey, (current) => current && ({ ...current, reviews: current.reviews.map((item) => item.id !== review.id ? item : {
      ...item,
      helpfulCount: Math.max(0, item.helpfulCount + (helpful && item.viewerVote !== true ? 1 : 0) - (!helpful && item.viewerVote === true ? 1 : 0)),
      notHelpfulCount: Math.max(0, item.notHelpfulCount + (!helpful && item.viewerVote !== false ? 1 : 0) - (helpful && item.viewerVote === false ? 1 : 0)),
      viewerVote: helpful,
    }) }));
    try {
      const response = await fetch(`/api/movies/${encodeURIComponent(movieId)}/reviews/${encodeURIComponent(review.id)}/vote`, { method: "POST", headers: reviewHeaders(capability), body: JSON.stringify({ helpful }) });
      if (!response.ok) throw new Error("Vote was not saved.");
      const saved = await response.json() as CommunityReview;
      queryClient.setQueryData<ReviewPage>(queryKey, (current) => current && ({ ...current, reviews: current.reviews.map((item) => item.id === saved.id ? saved : item) }));
    } catch { queryClient.setQueryData(queryKey, previous); }
  }

  async function saveEdit() {
    if (!editing) return;
    const parsed = reviewContentSchema.pick({ body: true, rating: true }).safeParse({ body: editBody, rating: editRating });
    if (!parsed.success) { setMessage(parsed.error.issues[0]?.message ?? "Check the review."); return; }
    const previous = queryClient.getQueryData<ReviewPage>(queryKey);
    queryClient.setQueryData<ReviewPage>(queryKey, (current) => current && ({ ...current, reviews: current.reviews.map((review) => review.id === editing.id ? { ...review, ...parsed.data, updatedAt: new Date().toISOString() } : review) }));
    try {
      const response = await fetch(`/api/movies/${encodeURIComponent(movieId)}/reviews/${encodeURIComponent(editing.id)}`, { method: "PATCH", headers: reviewHeaders(capability), body: JSON.stringify(parsed.data) });
      if (!response.ok) throw new Error("Edit could not be saved.");
      const saved = await response.json() as CommunityReview;
      queryClient.setQueryData<ReviewPage>(queryKey, (current) => current && ({ ...current, reviews: current.reviews.map((review) => review.id === saved.id ? saved : review) }));
      setEditing(null);
      setMessage("Review updated.");
    } catch (error) {
      queryClient.setQueryData(queryKey, previous);
      setMessage(error instanceof Error ? error.message : "Edit could not be saved.");
    }
  }

  async function deleteReview(review: CommunityReview) {
    const previous = queryClient.getQueryData<ReviewPage>(queryKey);
    queryClient.setQueryData<ReviewPage>(queryKey, (current) => current && ({ ...current, total: Math.max(0, current.total - 1), reviews: current.reviews.filter((item) => item.id !== review.id) }));
    try {
      const response = await fetch(`/api/movies/${encodeURIComponent(movieId)}/reviews/${encodeURIComponent(review.id)}`, { method: "DELETE", headers: reviewHeaders(capability) });
      if (!response.ok) throw new Error("Review could not be removed.");
      setUndo(review);
      await queryClient.invalidateQueries({ queryKey: ["community-reviews", movieId] });
      window.setTimeout(() => setUndo(null), 10_000);
    } catch (error) {
      queryClient.setQueryData(queryKey, previous);
      setMessage(error instanceof Error ? error.message : "Review could not be removed.");
    }
  }

  async function undoDelete() {
    if (!undo) return;
    try {
      const response = await fetch(`/api/movies/${encodeURIComponent(movieId)}/reviews/${encodeURIComponent(undo.id)}`, { method: "POST", headers: reviewHeaders(capability) });
      if (response.ok) {
        setUndo(null);
        await queryClient.invalidateQueries({ queryKey: ["community-reviews", movieId] });
      } else setMessage("Undo window expired or review could not be restored.");
    } catch { setMessage("Could not restore the review while offline."); }
  }

  async function flagReview(reviewId: string, reason: string) {
    try {
      const response = await fetch(`/api/movies/${encodeURIComponent(movieId)}/reviews/${encodeURIComponent(reviewId)}/flag`, { method: "POST", headers: reviewHeaders(capability), body: JSON.stringify({ reason }) });
      setMessage(response.ok ? "Report received for moderator review." : "Report could not be submitted.");
      if (response.ok) await queryClient.invalidateQueries({ queryKey: ["community-reviews", movieId] });
    } catch { setMessage("Report could not be submitted while offline."); }
  }

  return <section className="mt-10 border-t border-zinc-800 pt-7" aria-labelledby="community-reviews-heading">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase text-yellow-400">Community</p><h2 id="community-reviews-heading" className="mt-1 text-2xl font-semibold">Write a review</h2><p className="mt-1 text-sm text-zinc-400">Anonymous demo mode. Review controls are stored locally for this server process.</p></div>
      <label className="flex items-center gap-2 text-sm text-zinc-300">Sort
        <select className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2" onChange={(event) => { setSort(event.target.value as ReviewSort); setPage(1); }} value={sort}>
          <option value="recent">Recent</option><option value="helpful">Most helpful</option><option value="controversial">Most controversial</option>
        </select>
      </label>
    </div>

    <form className="mt-5 grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 sm:grid-cols-[minmax(0,1fr)_120px]" onSubmit={(event) => void submitReview(event)}>
      <label className="grid gap-1 text-sm">Display name<input className="rounded border border-zinc-700 bg-black px-3 py-2" maxLength={40} onChange={(event) => setDisplayName(event.target.value)} value={displayName} /></label>
      <label className="grid gap-1 text-sm">Rating<select className="rounded border border-zinc-700 bg-black px-3 py-2" onChange={(event) => setRating(Number(event.target.value))} value={rating}>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} / 10</option>)}</select></label>
      <label className="grid gap-1 text-sm sm:col-span-2">Your review<textarea className="min-h-28 rounded border border-zinc-700 bg-black px-3 py-2" maxLength={4000} onChange={(event) => setBody(event.target.value)} value={body} /></label>
      <p className="text-xs text-zinc-500 sm:col-span-2">Draft autosaves on this device. {draftReady && body && "Draft ready."}</p>
      <div className="sm:col-span-2"><button className="rounded bg-yellow-500 px-4 py-2 font-semibold text-black hover:bg-yellow-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" type="submit">Post review</button><p aria-live="polite" className="mt-2 text-sm text-zinc-300">{message}</p></div>
    </form>

    {undo && <p role="status" className="mt-4 flex items-center gap-3 text-sm">Review removed. <button className="font-semibold text-yellow-400 underline" onClick={() => void undoDelete()} type="button">Undo</button></p>}
    {reviewsQuery.isLoading && <p aria-busy="true" className="mt-6 animate-pulse text-zinc-400">Loading community reviews...</p>}
    {reviewsQuery.isError && <p role="alert" className="mt-6 text-red-300">{reviewsQuery.error.message} <button className="underline" onClick={() => void reviewsQuery.refetch()} type="button">Retry</button></p>}
    {!reviewsQuery.isLoading && !reviews.length && <p className="mt-6 text-zinc-400">No community reviews yet.</p>}
    <AnimatePresence mode="popLayout">
      <ul className="mt-4 divide-y divide-zinc-800">
        {reviews.map((review) => {
          const score = wilsonScoreLowerBound(review.helpfulCount, review.helpfulCount + review.notHelpfulCount);
          const revisionDiffs = diffReviewHistory(review.revisions, review.body);
          return <motion.li key={review.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }} className="py-5">
            <article>
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-semibold">{review.displayName} <span className="ml-2 text-sm text-yellow-400">{review.rating}/10</span></h3><p className="mt-1 text-xs text-zinc-500">{new Date(review.createdAt).toLocaleDateString()} · {score > 0 ? `${Math.round(score * 100)}% helpful confidence` : "No votes yet"}{review.updatedAt !== review.createdAt ? " · Edited" : ""}</p></div>
                <div className="flex flex-wrap gap-2">
                  <button aria-label={`Mark ${review.displayName}'s review helpful`} aria-pressed={review.viewerVote === true} className="rounded border border-zinc-700 px-3 py-1 text-sm hover:border-yellow-500" onClick={() => void vote(review, true)} type="button">Helpful {review.helpfulCount}</button>
                  <button aria-label={`Mark ${review.displayName}'s review not helpful`} aria-pressed={review.viewerVote === false} className="rounded border border-zinc-700 px-3 py-1 text-sm hover:border-yellow-500" onClick={() => void vote(review, false)} type="button">Not helpful {review.notHelpfulCount}</button>
                  <label className="sr-only" htmlFor={`flag-${review.id}`}>Report reason</label><select id={`flag-${review.id}`} aria-label={`Report ${review.displayName}'s review`} className="max-w-32 rounded border border-zinc-700 bg-zinc-950 px-2 text-sm" defaultValue="" onChange={(event) => { if (event.target.value) void flagReview(review.id, event.target.value); event.target.value = ""; }}><option value="" disabled>Report</option><option value="spam">Spam</option><option value="abuse">Abuse</option><option value="spoiler">Spoiler</option><option value="other">Other</option></select>
                  {review.viewerCanEdit && <><button className="rounded border border-zinc-700 px-3 py-1 text-sm" onClick={() => { setEditing(review); setEditBody(review.body); setEditRating(review.rating); }} type="button">Edit</button><button className="rounded border border-zinc-700 px-3 py-1 text-sm" onClick={() => void deleteReview(review)} type="button">Delete</button></>}
                </div>
              </header>
              {editing?.id === review.id ? <div className="mt-3 grid gap-2"><label className="sr-only" htmlFor={`edit-${review.id}`}>Edit review text</label><textarea id={`edit-${review.id}`} className="min-h-24 rounded border border-zinc-700 bg-zinc-950 p-3" maxLength={4000} onChange={(event) => setEditBody(event.target.value)} value={editBody} /><div className="flex gap-2"><label className="sr-only" htmlFor={`edit-rating-${review.id}`}>Edit review rating</label><select id={`edit-rating-${review.id}`} className="rounded border border-zinc-700 bg-zinc-950 px-2" onChange={(event) => setEditRating(Number(event.target.value))} value={editRating}>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} / 10</option>)}</select><button className="rounded bg-yellow-500 px-3 py-2 text-sm font-semibold text-black" onClick={() => void saveEdit()} type="button">Save edit</button><button className="rounded border border-zinc-700 px-3 py-2 text-sm" onClick={() => setEditing(null)} type="button">Cancel</button></div></div> : <p className="mt-3 whitespace-pre-line leading-7 text-zinc-300">{review.body}</p>}
              {review.revisions.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer text-zinc-400">Revision history ({review.revisions.length})</summary><ol className="mt-2 space-y-3">{review.revisions.map((revision, index) => {
                const diff = revisionDiffs[index];
                return <li key={revision.id}><time className="text-xs text-zinc-500">{new Date(revision.updatedAt).toLocaleString()}</time><p className="mt-1"><del className="text-red-300">{diff.removed}</del> <ins className="text-green-300 no-underline">{diff.added}</ins></p></li>;
              })}</ol></details>}
            </article>
          </motion.li>;
        })}
      </ul>
    </AnimatePresence>
    {queryData && queryData.totalPages > 1 && <nav aria-label="Community review pages" className="mt-5 flex items-center justify-between gap-3 border-t border-zinc-800 pt-4">
      <button className="rounded border border-zinc-700 px-3 py-2 text-sm disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">Previous</button>
      <p aria-live="polite" className="text-sm text-zinc-400">Page {page} of {queryData.totalPages} · {queryData.total} reviews</p>
      <button className="rounded border border-zinc-700 px-3 py-2 text-sm disabled:opacity-40" disabled={page >= queryData.totalPages} onClick={() => setPage((current) => Math.min(queryData.totalPages, current + 1))} type="button">Next</button>
    </nav>}
  </section>;
}