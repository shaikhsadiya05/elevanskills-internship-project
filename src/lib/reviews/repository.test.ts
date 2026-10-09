import { describe, expect, it } from "vitest";
import { InMemoryReviewRepository, ReviewRepositoryError } from "./repository";
import { publishReviewEvent, subscribeToReviewEvents } from "./events";
import { diffReviewHistory, diffReviewText, sortReviews, wilsonScoreLowerBound } from "./scoring";
import { reviewContentSchema, reviewListQuerySchema } from "./schema";

const owner = "owner-capability-012345678901234567890123456789";
const voter = "voter-capability-012345678901234567890123456789";
const other = "other-capability-012345678901234567890123456789";
const validReview = { displayName: "Movie fan", body: "A careful and entertaining film with a strong final act.", rating: 8 };

function expectErrorCode(action: () => unknown, code: string) {
  let thrown: unknown;
  try { action(); } catch (error) { thrown = error; }
  expect(thrown).toMatchObject({ code });
}

describe("community review validation and scoring", () => {
  it("validates review input and paginated sort options", () => {
    expect(reviewContentSchema.safeParse({ ...validReview, rating: 11 }).success).toBe(false);
    expect(reviewContentSchema.safeParse({ ...validReview, body: "too short" }).success).toBe(false);
    expect(reviewListQuerySchema.safeParse({ sort: "unknown", page: "0" }).success).toBe(false);
    expect(reviewListQuerySchema.parse({ sort: "helpful", page: "2" })).toMatchObject({ sort: "helpful", page: 2, pageSize: 6 });
  });

  it("uses the Wilson lower bound and stable sort tie-breaking", () => {
    expect(wilsonScoreLowerBound(0, 0)).toBe(0);
    expect(wilsonScoreLowerBound(1, 1)).toBeCloseTo(0.2065, 3);
    const reviews = [
      { id: "balanced", helpfulCount: 5, notHelpfulCount: 5, createdAt: "2025-01-01" },
      { id: "liked", helpfulCount: 9, notHelpfulCount: 1, createdAt: "2024-01-01" },
    ];
    expect(sortReviews(reviews, "helpful").map(({ id }) => id)).toEqual(["liked", "balanced"]);
    expect(sortReviews(reviews, "controversial")[0].id).toBe("balanced");
    expect(sortReviews(reviews, "recent")[0].id).toBe("balanced");
  });

  it("produces a compact text diff", () => {
    expect(diffReviewText("A slow but beautiful film", "A tense and beautiful film")).toEqual({ removed: "slow but", added: "tense and" });
  });

  it("compares each review revision with the next saved version", () => {
    expect(diffReviewHistory([{ body: "A one and same" }, { body: "B two and same" }], "C three and same")).toEqual([
      { removed: "A one", added: "B two" },
      { removed: "B two", added: "C three" },
    ]);
  });
});

describe("in-memory review repository", () => {
  it("publishes review events only to active subscribers for the movie", () => {
    const events: string[] = [];
    const unsubscribe = subscribeToReviewEvents("movie-live", (event) => events.push(event.type));
    publishReviewEvent({ movieId: "another-movie", type: "created" });
    publishReviewEvent({ movieId: "movie-live", type: "updated" });
    unsubscribe();
    publishReviewEvent({ movieId: "movie-live", type: "deleted" });
    expect(events).toEqual(["updated"]);
  });

  it("makes creates idempotent and stores edits as revisions with a reversible soft delete", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const repository = new InMemoryReviewRepository(undefined, () => now, (() => {
      let nextId = 0;
      return () => `review-${++nextId}`;
    })());
    const input = { movieId: "movie-1", capability: owner, idempotencyKey: "request-key-0123456789", content: validReview };
    const created = repository.create(input);
    expect(created.viewerCanEdit).toBe(true);
    expect(repository.create(input).id).toBe(created.id);
    expect(repository.list("movie-1", { sort: "recent", page: 1, pageSize: 6 }).total).toBe(1);

    const edited = repository.update("movie-1", created.id, owner, { body: "A sharp and entertaining film with a strong final act." });
    expect(edited.revisions).toHaveLength(1);
    expect(edited.revisions[0].body).toBe(validReview.body);
    expect(() => repository.update("movie-1", created.id, voter, { rating: 5 })).toThrowError(ReviewRepositoryError);

    repository.softDelete("movie-1", created.id, owner);
    expect(repository.list("movie-1", { sort: "recent", page: 1, pageSize: 6 }).total).toBe(0);
    expect(repository.restore("movie-1", created.id, owner).deletedAt).toBeNull();
    expect(repository.list("movie-1", { sort: "recent", page: 1, pageSize: 6 }).total).toBe(1);

    now = new Date(now.getTime() + 11_000);
    repository.softDelete("movie-1", created.id, owner);
    now = new Date(now.getTime() + 11_000);
    expectErrorCode(() => repository.restore("movie-1", created.id, owner), "REVIEW_UNDO_EXPIRED");
  });

  it("scopes idempotency keys to the anonymous capability", () => {
    const repository = new InMemoryReviewRepository();
    const first = repository.create({ movieId: "movie-scope", capability: owner, idempotencyKey: "shared-key-0123456789", content: validReview });
    const second = repository.create({ movieId: "movie-scope", capability: voter, idempotencyKey: "shared-key-0123456789", content: { ...validReview, displayName: "Another fan" } });
    expect(second.id).not.toBe(first.id);
    expect(second.viewerCanEdit).toBe(true);
    expect(repository.list("movie-scope", { sort: "recent", page: 1, pageSize: 6, viewerCapability: owner }).reviews.find((review) => review.id === second.id)?.viewerCanEdit).toBe(false);
  });

  it("reconciles one vote per capability and moves repeatedly flagged content to moderation", () => {
    const repository = new InMemoryReviewRepository();
    const created = repository.create({ movieId: "movie-2", capability: owner, idempotencyKey: "another-key-0123456789", content: validReview });
    expect(repository.vote("movie-2", created.id, voter, true)).toMatchObject({ helpfulCount: 1, viewerVote: true });
    expect(repository.vote("movie-2", created.id, voter, false)).toMatchObject({ helpfulCount: 0, notHelpfulCount: 1 });
    repository.flag("movie-2", created.id, owner, "spam");
    repository.flag("movie-2", created.id, voter, "abuse");
    const flagged = repository.flag("movie-2", created.id, other, "spoiler");
    expect(flagged).toMatchObject({ flagsCount: 3, moderationStatus: "pending" });
    expect(repository.list("movie-2", { sort: "recent", page: 1, pageSize: 6 }).total).toBe(0);
  });

  it("rejects profanity through the injectable moderation hook", () => {
    const repository = new InMemoryReviewRepository();
    expectErrorCode(() => repository.create({
      movieId: "movie-3", capability: owner, idempotencyKey: "profanity-key-012345", content: { ...validReview, body: "This shit film is not worth the ticket." },
    }), "REVIEW_MODERATED");
  });
});