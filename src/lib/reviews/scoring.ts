import { ReviewSort } from "./schema";

export type ReviewScoreInput = {
  helpfulCount: number;
  notHelpfulCount: number;
  createdAt: string;
};

export function wilsonScoreLowerBound(positive: number, total: number, z = 1.96): number {
  if (total <= 0 || positive <= 0) return 0;
  const n = Math.max(0, total);
  const p = Math.min(1, Math.max(0, positive / n));
  const zSquared = z * z;
  const denominator = 1 + zSquared / n;
  const center = p + zSquared / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + zSquared / (4 * n)) / n);
  return Math.max(0, (center - margin) / denominator);
}

export function sortReviews<T extends ReviewScoreInput>(reviews: T[], sort: ReviewSort): T[] {
  return [...reviews].sort((left, right) => {
    if (sort === "helpful") {
      const scoreDifference = wilsonScoreLowerBound(right.helpfulCount, right.helpfulCount + right.notHelpfulCount)
        - wilsonScoreLowerBound(left.helpfulCount, left.helpfulCount + left.notHelpfulCount);
      if (scoreDifference !== 0) return scoreDifference;
    } else if (sort === "controversial") {
      const leftDisagreement = left.helpfulCount * left.notHelpfulCount;
      const rightDisagreement = right.helpfulCount * right.notHelpfulCount;
      if (rightDisagreement !== leftDisagreement) return rightDisagreement - leftDisagreement;
    }
    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
}

export type TextDiff = { removed: string; added: string };

export function diffReviewText(previous: string, current: string): TextDiff {
  let prefix = 0;
  while (prefix < previous.length && prefix < current.length && previous[prefix] === current[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < current.length - prefix &&
    previous[previous.length - 1 - suffix] === current[current.length - 1 - suffix]
  ) suffix += 1;
  return {
    removed: previous.slice(prefix, previous.length - suffix),
    added: current.slice(prefix, current.length - suffix),
  };
}

export function diffReviewHistory(revisions: readonly { body: string }[], currentBody: string): TextDiff[] {
  return revisions.map((revision, index) => diffReviewText(revision.body, revisions[index + 1]?.body ?? currentBody));
}