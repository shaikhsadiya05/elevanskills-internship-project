import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { KeyedTokenBuckets } from "./resilience";

const localBuckets = new KeyedTokenBuckets(60, 1);
const localProviderBuckets = new KeyedTokenBuckets(40, 10);
const sharedLimiters = new Map<string, Ratelimit>();

function getSharedLimiter(scope: "api" | "provider"): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  let limiter = sharedLimiters.get(scope);
  if (limiter) return limiter;

  const capacity = scope === "api" ? 60 : 40;
  const refillPerMinute = scope === "api" ? 60 : 600;
  limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.tokenBucket(refillPerMinute, "1 m", capacity),
    analytics: false,
    prefix: `moviedb:${scope}-token-bucket`,
  });
  sharedLimiters.set(scope, limiter);
  return limiter;
}

async function consumeTokenBucket(scope: "api" | "provider", identifier: string) {
  const limiter = getSharedLimiter(scope);
  if (!limiter) return scope === "api" ? localBuckets.take(identifier) : localProviderBuckets.take(identifier);
  try {
    const result = await limiter.limit(identifier);
    return {
      allowed: result.success,
      retryAfterSeconds: result.success ? 0 : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
    };
  } catch {
    console.error(JSON.stringify({ event: "movie_rate_limit_backend_failed", code: "RATE_LIMIT_BACKEND_UNAVAILABLE" }));
    return { allowed: false, retryAfterSeconds: 60 };
  }
}

export function consumeMovieApiTokenBucket(identifier: string) {
  return consumeTokenBucket("api", identifier);
}

export function consumeMovieProviderTokenBucket(provider: "tmdb" | "omdb") {
  return consumeTokenBucket("provider", provider);
}