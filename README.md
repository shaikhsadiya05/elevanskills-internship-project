# MovieDB

An IMDb-inspired movie discovery frontend using Next.js App Router. The existing home, movie list, movie detail, actor detail, and top-rated screens are retained. Movie discovery now uses server-side TMDb access, with optional OMDb title-search fallback.

## Requirements

- Node.js 20.9 or newer
- npm
- A TMDb API Read Access Token for live catalog data
- Optional OMDb API key for title-search fallback

## Local setup

1. Install dependencies with `npm install`.
2. Use `.env.example` as the reference for local server-only environment variables. After implementation is complete, manually create or update `.env.local` and replace the TMDb placeholder with your real Bearer token:

```dotenv
TMDB_API_KEY=your_real_tmdb_bearer_token
TMDB_BASE_URL=https://api.themoviedb.org/3
# Optional: enables OMDb title search fallback
OMDB_API_KEY=your_omdb_api_key
# Optional: set to "omdb" to use OMDb as the configured provider
MOVIE_PROVIDER=tmdb
# Optional: secure the on-demand revalidation endpoint
REVALIDATION_SECRET=use-a-long-random-secret
# Optional: stable signing key for movie continuation cursors
CURSOR_SIGNING_SECRET=use-another-long-random-secret
# Optional: enables globally shared API token-bucket limits across instances
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

3. Start the app with `npm run dev` and open `http://localhost:3000`.

You will add the real token yourself after implementation is complete; do not paste it into Copilot or commit `.env.local`. The provider reads `TMDB_API_KEY` only in server-only code. Never rename it to a `NEXT_PUBLIC_` variable. `TMDB_BASE_URL` defaults to `https://api.themoviedb.org/3` and may be overridden with another HTTPS TMDb-compatible endpoint. If the credential is missing, the API returns a clear server configuration error and movie pages show the existing recoverable unavailable state; no mock catalog is substituted.

Recent movie searches are stored in the current browser's local storage (up to ten terms). Focus the movie search field to reopen a recent search or clear the history.

## Checks

- `npm run typecheck` runs TypeScript checks.
- `npm test` and `npm run test:ci` run provider resilience and actor policy tests.
- `npm run build` creates the production build.
- `npm start` serves the production build.

## Data and caching

The server-only provider abstraction normalizes TMDb and OMDb results. Its signed, expiring continuation cursor is bound to the provider, category, and query; because TMDb and OMDb expose page-number APIs, the server maps the cursor to the next provider page. TanStack Query appends pages, refreshes active lists every five minutes, deduplicates requests, prefetches movie details on hover/focus, and refetches on focus/reconnect. Next.js caches provider fetches for five minutes with tags; API responses expose short shared-cache windows with stale-while-revalidate. `POST /api/revalidate` accepts validated cache tags and requires `Authorization: Bearer <REVALIDATION_SECRET>`.

Movie API rate limiting uses a shared Upstash token bucket when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured; without them, local development falls back to an in-memory per-process bucket. A configured but unavailable Upstash backend fails closed. Circuit breakers remain process-local. Redis is not used for server-side response caching.

## Actor profiles

The default actor route is `/actor/{tmdb-person-id}`; localized profiles use `/{locale}/actor/{tmdb-person-id}`, for example `/fr-FR/actor/934`. Both routes use a one-hour ISR window and tagged Next.js fetch caching. `POST /api/revalidate/actor` accepts `{ "actorIds": ["934"] }`, requires `Authorization: Bearer <REVALIDATION_SECRET>`, and invalidates the shared actor tag plus each actor-specific tag.

Actor core profile and combined credits are fetched in a server-only TMDb repository. The client filmography explorer virtualizes rows and filters by year, genre, role, and title. Awards, social links, and similar actors are separate Suspense panels. Awards currently come from a small mock repository and are visibly marked as sample records; social links and similar-actor matches use TMDb external IDs and shared credits. Person JSON-LD is rendered on the server. Locale selection uses TMDb translated person names/biographies and localized credit titles, preserving original names/titles as alternates where available.

## Actor profiles

`/actor/{tmdb-person-id}` is an ISR route with a one-hour revalidation window. Its Server Component reads person details, translations, combined movie/TV credits, genre names, and external IDs through the server-only TMDb repository. Add `?lang=fr-FR` (or another supported BCP-47-style language tag) to request localized names, biography, genres, and alternate titles. Invalid IDs/locales are rejected by the actor policy.

The client filmography explorer virtualizes its rows and filters by year, genre, role, and title. Awards, social links, and similar-actor matches are split into independent Suspense panels. Awards currently come from a small, visibly labeled sample repository; social links use TMDb external IDs; similar actors are derived from shared movie/TV credits. This is not a live awards service.

For on-demand actor cache invalidation, configure `REVALIDATION_SECRET` and POST `{"actorIds":["12345"]}` to `/api/revalidate/actor` with `Authorization: Bearer <REVALIDATION_SECRET>`. Actor data uses Next.js tagged fetch caching and ISR; the revalidation route invalidates the shared actor tag and each requested actor tag.

## Deployment

Deploy with the Next.js preset on Vercel or another Next.js-capable host. Configure the same server-only environment variables in the deployment settings. Never commit `.env.local` or provider credentials. For Vercel, use the deployment's server-side environment variable settings and trigger tag revalidation through the protected endpoint when catalog data needs immediate refresh.

## Community reviews (demo architecture)

Community reviews are a demonstrator, not authenticated production accounts. The `InMemoryReviewRepository` is process-local and resets on restart/deploy; its random browser capability stored in localStorage only gates demo edit/delete/restore actions and is not a secure identity credential. Do not use this repository for durable data or trust client capabilities in production. Replace it with a transactional database repository and verified server-side account/session identity before launch. The API validates request payloads with Zod, uses the shared API rate limiter, and supports idempotent creates, votes, reports, soft deletion/restore, moderation hooks, and revision snapshots. The built-in profanity filter and three-report queue are basic moderation hooks, not a complete moderation service.

Drafts and offline submissions use IndexedDB. A service worker drains queued creates with Background Sync when the browser supports it; an online event/message retry is used otherwise. Review live updates use process-local Server-Sent Events to invalidate client query data; this is not WebSocket infrastructure and is not cross-instance. Production deployments need shared pub/sub or polling plus a persistent repository. Sorting uses the Wilson lower confidence bound for helpful votes; controversial sorting ranks vote disagreement. The review API and moderation behavior are demo-grade and require abuse, privacy, and retention policy review before public deployment.

## Watchlist (browser-local demo)

The watchlist stores a LocalStorage snapshot and an IndexedDB primary copy/outbox. Same-browser tabs reconcile with BroadcastChannel, with the `storage` event as fallback. Offline mutations remain optimistic and are sent to the mock `/api/watchlist` endpoint on reconnect or through Background Sync when available. The API uses a process-local in-memory repository partitioned by a random browser client ID; it is a mock sync boundary, not durable storage or authenticated account sync. It does not provide multi-device synchronization. Entries use last-write-wins ordering by timestamp and writer ID, with removals winning exact ties. Replace the mock API with an authenticated persistent repository before offering account-level watchlists.

Run `npx playwright install chromium` once to install the browser, then run `npm run test:e2e` for Playwright coverage. The Playwright config starts a separate development server on port 3100 with `.next-e2e` output so it does not share Next build artifacts with the normal development server.