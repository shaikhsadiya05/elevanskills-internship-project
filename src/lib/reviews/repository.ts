import { randomUUID } from "node:crypto";
import { ReviewContentInput, ReviewSort, ReviewUpdateInput } from "./schema";
import { publishReviewEvent, ReviewEvent } from "./events";
import { sortReviews } from "./scoring";

export type ReviewRevision = {
  id: string;
  body: string;
  rating: number;
  updatedAt: string;
};

export type CommunityReview = {
  id: string;
  movieId: string;
  displayName: string;
  body: string;
  rating: number;
  helpfulCount: number;
  notHelpfulCount: number;
  flagsCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  moderationStatus: "published" | "pending";
  revisions: ReviewRevision[];
  viewerCanEdit?: boolean;
  viewerVote?: boolean | null;
};

type StoredReview = CommunityReview & { ownerCapability: string };
export type ReviewPage = { reviews: CommunityReview[]; page: number; pageSize: number; total: number; totalPages: number };
export type ModerationResult = { status: "published" | "pending" | "rejected"; reason?: string };
export type ReviewModerationHook = (review: ReviewContentInput) => ModerationResult;

export class ReviewRepositoryError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

const profanityTerms = new Set(["asshole", "bitch", "cunt", "fuck", "shit"]);

export function defaultReviewModeration(review: ReviewContentInput): ModerationResult {
  const words = review.body.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (words.some((word) => profanityTerms.has(word))) return { status: "rejected", reason: "Please remove profanity before posting." };
  const links = review.body.match(/https?:\/\//gi) ?? [];
  return links.length >= 3 ? { status: "pending" } : { status: "published" };
}

export interface ReviewRepository {
  list(movieId: string, options: { sort: ReviewSort; page: number; pageSize: number; viewerCapability?: string }): ReviewPage;
  create(input: { movieId: string; capability: string; idempotencyKey: string; content: ReviewContentInput }): CommunityReview;
  update(movieId: string, reviewId: string, capability: string, content: ReviewUpdateInput): CommunityReview;
  softDelete(movieId: string, reviewId: string, capability: string): CommunityReview;
  restore(movieId: string, reviewId: string, capability: string): CommunityReview;
  vote(movieId: string, reviewId: string, capability: string, helpful: boolean): CommunityReview;
  flag(movieId: string, reviewId: string, capability: string, reason: string): CommunityReview;
}

export class InMemoryReviewRepository implements ReviewRepository {
  private readonly reviews = new Map<string, StoredReview>();
  private readonly idempotency = new Map<string, string>();
  private readonly votes = new Map<string, Map<string, boolean>>();
  private readonly flags = new Map<string, Map<string, string>>();

  constructor(
    private readonly moderate: ReviewModerationHook = defaultReviewModeration,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
    private readonly emit: (event: ReviewEvent) => void = publishReviewEvent,
  ) {}

  list(movieId: string, options: { sort: ReviewSort; page: number; pageSize: number; viewerCapability?: string }): ReviewPage {
    const all = sortReviews(
      [...this.reviews.values()]
        .filter((review) => review.movieId === movieId && review.deletedAt === null && review.moderationStatus === "published")
        .map((review) => this.forViewer(review, options.viewerCapability ?? "")),
      options.sort,
    );
    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / options.pageSize));
    return { reviews: all.slice((options.page - 1) * options.pageSize, options.page * options.pageSize), page: options.page, pageSize: options.pageSize, total, totalPages };
  }

  create(input: { movieId: string; capability: string; idempotencyKey: string; content: ReviewContentInput }): CommunityReview {
    this.validateCapability(input.capability);
    const dedupeKey = `${input.movieId}:${input.capability}:${input.idempotencyKey}`;
    const existingId = this.idempotency.get(dedupeKey);
    if (existingId) return this.forViewer(this.requireReview(input.movieId, existingId), input.capability);
    const moderation = this.moderate(input.content);
    if (moderation.status === "rejected") throw new ReviewRepositoryError(moderation.reason ?? "Review rejected by moderation.", 422, "REVIEW_MODERATED");
    const now = this.now().toISOString();
    const review: StoredReview = {
      id: this.createId(), movieId: input.movieId, displayName: input.content.displayName, body: input.content.body,
      rating: input.content.rating, helpfulCount: 0, notHelpfulCount: 0, flagsCount: 0, createdAt: now,
      updatedAt: now, deletedAt: null, moderationStatus: moderation.status, revisions: [], ownerCapability: input.capability,
    };
    this.reviews.set(review.id, review);
    this.idempotency.set(dedupeKey, review.id);
    this.emit({ movieId: input.movieId, type: "created" });
    return this.forViewer(review, input.capability);
  }

  update(movieId: string, reviewId: string, capability: string, content: ReviewUpdateInput): CommunityReview {
    const review = this.requireOwner(movieId, reviewId, capability);
    const nextBody = content.body ?? review.body;
    const moderation = this.moderate({ displayName: review.displayName, body: nextBody, rating: content.rating ?? review.rating });
    if (moderation.status === "rejected") throw new ReviewRepositoryError(moderation.reason ?? "Review rejected by moderation.", 422, "REVIEW_MODERATED");
    const now = this.now().toISOString();
    review.revisions.push({ id: this.createId(), body: review.body, rating: review.rating, updatedAt: review.updatedAt });
    review.body = nextBody;
    review.rating = content.rating ?? review.rating;
    review.updatedAt = now;
    review.moderationStatus = moderation.status;
    this.emit({ movieId, type: "updated" });
    return this.forViewer(review, capability);
  }

  softDelete(movieId: string, reviewId: string, capability: string): CommunityReview {
    const review = this.requireOwner(movieId, reviewId, capability);
    review.deletedAt = this.now().toISOString();
    review.updatedAt = review.deletedAt;
    this.emit({ movieId, type: "deleted" });
    return this.forViewer(review, capability);
  }

  restore(movieId: string, reviewId: string, capability: string): CommunityReview {
    const review = this.requireOwner(movieId, reviewId, capability);
    if (!review.deletedAt) throw new ReviewRepositoryError("This review is not deleted.", 409, "REVIEW_NOT_DELETED");
    if (this.now().getTime() - Date.parse(review.deletedAt) > 10_000) throw new ReviewRepositoryError("The review undo window has expired.", 410, "REVIEW_UNDO_EXPIRED");
    review.deletedAt = null;
    review.updatedAt = this.now().toISOString();
    this.emit({ movieId, type: "restored" });
    return this.forViewer(review, capability);
  }

  vote(movieId: string, reviewId: string, capability: string, helpful: boolean): CommunityReview {
    this.validateCapability(capability);
    const review = this.requireReview(movieId, reviewId);
    if (review.deletedAt || review.moderationStatus !== "published") throw new ReviewRepositoryError("This review is unavailable.", 404, "REVIEW_NOT_FOUND");
    const reviewVotes = this.votes.get(reviewId) ?? new Map<string, boolean>();
    reviewVotes.set(capability, helpful);
    this.votes.set(reviewId, reviewVotes);
    review.helpfulCount = [...reviewVotes.values()].filter(Boolean).length;
    review.notHelpfulCount = reviewVotes.size - review.helpfulCount;
    review.updatedAt = this.now().toISOString();
    this.emit({ movieId, type: "voted" });
    return this.forViewer(review, capability);
  }

  flag(movieId: string, reviewId: string, capability: string, reason: string): CommunityReview {
    this.validateCapability(capability);
    const review = this.requireReview(movieId, reviewId);
    const reviewFlags = this.flags.get(reviewId) ?? new Map<string, string>();
    if (reviewFlags.has(capability)) return this.forViewer(review, capability);
    reviewFlags.set(capability, reason);
    this.flags.set(reviewId, reviewFlags);
    review.flagsCount = reviewFlags.size;
    if (review.flagsCount >= 3) review.moderationStatus = "pending";
    this.emit({ movieId, type: "flagged" });
    return this.forViewer(review, capability);
  }

  private requireReview(movieId: string, reviewId: string): StoredReview {
    const review = this.reviews.get(reviewId);
    if (!review || review.movieId !== movieId) throw new ReviewRepositoryError("Review not found.", 404, "REVIEW_NOT_FOUND");
    return review;
  }

  private requireOwner(movieId: string, reviewId: string, capability: string): StoredReview {
    this.validateCapability(capability);
    const review = this.requireReview(movieId, reviewId);
    if (review.ownerCapability !== capability) throw new ReviewRepositoryError("Review capability is invalid.", 403, "REVIEW_FORBIDDEN");
    return review;
  }

  private validateCapability(capability: string) {
    if (capability.length < 32 || capability.length > 128) throw new ReviewRepositoryError("A valid anonymous review capability is required.", 401, "REVIEW_CAPABILITY_REQUIRED");
  }

  private publicReview(review: StoredReview): CommunityReview {
    return {
      id: review.id,
      movieId: review.movieId,
      displayName: review.displayName,
      body: review.body,
      rating: review.rating,
      helpfulCount: review.helpfulCount,
      notHelpfulCount: review.notHelpfulCount,
      flagsCount: review.flagsCount,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
      deletedAt: review.deletedAt,
      moderationStatus: review.moderationStatus,
      revisions: review.revisions.map((revision) => ({ ...revision })),
    };
  }

  private forViewer(review: StoredReview, capability: string): CommunityReview {
    return { ...this.publicReview(review), viewerCanEdit: review.ownerCapability === capability, viewerVote: this.votes.get(review.id)?.get(capability) ?? null };
  }
}

type ReviewRepositoryGlobal = typeof globalThis & { __movieDbReviewRepository?: ReviewRepository };
const reviewRepositoryGlobal = globalThis as ReviewRepositoryGlobal;
export const reviewRepository = reviewRepositoryGlobal.__movieDbReviewRepository ??= new InMemoryReviewRepository();