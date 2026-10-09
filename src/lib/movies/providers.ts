import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { Movie, MovieCategory, MovieListInput, MoviePage, MovieProvider, MovieReview } from "./types";
import { consumeMovieProviderTokenBucket } from "../server/movie-rate-limit";
import { CircuitBreaker, fetchWithRetry, logProviderFailure, ProviderError } from "../server/resilience";

const DEFAULT_TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";
const OMDB_BASE_URL = "https://www.omdbapi.com/";
const breakers = new Map<string, CircuitBreaker>();
const inFlightProviderRequests = new Map<string, Promise<unknown>>();
const CURSOR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type CursorContext = {
  provider: "tmdb" | "omdb";
  category: MovieCategory;
  query: string;
};

type CursorPayload = CursorContext & {
  version: 1;
  page: number;
  issuedAt: number;
};

type TmdbMovie = {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  release_date?: string;
  vote_average?: number;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genre_ids?: number[];
  genres?: Array<{ name: string }>;
  credits?: { cast?: Array<{ id: number; name: string; character?: string; profile_path?: string | null }> };
  cast?: Array<{ id: number; name: string; character?: string; profile_path?: string | null }>;
  reviews?: { results?: Array<{ id: string; author?: string; content?: string; author_details?: { rating?: number | null } }> };
  results?: TmdbMovie[];
  videos?: { results?: Array<{ site: string; type: string; key: string; official?: boolean }> };
};

type OmdbMovie = {
  Title: string;
  Year: string;
  imdbID: string;
  Plot?: string;
  imdbRating?: string;
  Poster?: string;
  Genre?: string;
  Actors?: string;
  Response: "True" | "False";
  Error?: string;
};

function cursorSigningKey(provider: CursorContext["provider"]): string {
  const configuredSecret = process.env.CURSOR_SIGNING_SECRET;
  const providerCredential = provider === "tmdb" ? process.env.TMDB_API_KEY : process.env.OMDB_API_KEY;
  const secret = configuredSecret || providerCredential;
  if (!secret) {
    throw new ProviderError("Movie provider is not configured for cursor signing.", 503, "PROVIDER_NOT_CONFIGURED");
  }
  return secret;
}

function encodeCursor(page: number, context: CursorContext): string {
  const payload: CursorPayload = { ...context, version: 1, page, issuedAt: Date.now() };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", cursorSigningKey(context.provider)).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function decodeCursor(cursor: string | null | undefined, context: CursorContext): number {
  if (!cursor) return 1;
  const signingKey = cursorSigningKey(context.provider);
  try {
    const [encodedPayload, providedSignature, ...extra] = cursor.split(".");
    if (!encodedPayload || !providedSignature || extra.length > 0) throw new Error("Malformed cursor");
    const expectedSignature = createHmac("sha256", signingKey).update(encodedPayload).digest();
    const actualSignature = Buffer.from(providedSignature, "base64url");
    if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
      throw new Error("Invalid cursor signature");
    }
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as CursorPayload;
    const isValidContext = parsed.version === 1 && parsed.provider === context.provider &&
      parsed.category === context.category && parsed.query === context.query;
    const isValidPage = Number.isInteger(parsed.page) && parsed.page > 0 && parsed.page <= 500;
    const isFresh = Number.isFinite(parsed.issuedAt) && Date.now() - parsed.issuedAt <= CURSOR_MAX_AGE_MS;
    if (isValidContext && isValidPage && isFresh) return parsed.page;
  } catch {
    throw new ProviderError("Invalid or expired page cursor.", 400, "INVALID_CURSOR");
  }
  throw new ProviderError("Invalid or expired page cursor.", 400, "INVALID_CURSOR");
}

function imageUrl(path?: string | null): string | null {
  return path && path !== "N/A" ? (path.startsWith("http") ? path : `${TMDB_IMAGE_BASE_URL}${path}`) : null;
}

function tmdbBaseUrl(): string {
  const configuredUrl = process.env.TMDB_BASE_URL?.trim() || DEFAULT_TMDB_BASE_URL;
  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "https:" || url.search || url.hash) throw new Error("Invalid TMDb base URL");
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new ProviderError("TMDb API base URL configuration is invalid.", 500, "INVALID_PROVIDER_CONFIGURATION");
  }
}

function normalizeTmdb(movie: TmdbMovie): Movie {
  const trailers = movie.videos?.results?.filter(
    (video) => video.site === "YouTube" && video.type === "Trailer" && /^[\w-]{11}$/.test(video.key),
  ) ?? [];
  const trailer = trailers.find((video) => video.official) ?? trailers[0];
  return {
    id: String(movie.id),
    title: movie.title ?? movie.name ?? "Untitled",
    overview: movie.overview ?? "",
    releaseDate: movie.release_date ?? "",
    rating: typeof movie.vote_average === "number" ? movie.vote_average : null,
    posterUrl: imageUrl(movie.poster_path),
    backdropUrl: imageUrl(movie.backdrop_path),
    genres: movie.genres?.map((genre) => genre.name) ?? [],
    cast: (movie.credits?.cast ?? []).slice(0, 12).map((person) => ({
      id: String(person.id),
      name: person.name,
      role: person.character ?? "",
      profileUrl: imageUrl(person.profile_path),
    })),
    trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
  };
}

function normalizeOmdb(movie: OmdbMovie): Movie {
  return {
    id: movie.imdbID,
    title: movie.Title,
    overview: movie.Plot && movie.Plot !== "N/A" ? movie.Plot : "",
    releaseDate: movie.Year?.slice(0, 4) ?? "",
    rating: movie.imdbRating && movie.imdbRating !== "N/A" ? Number(movie.imdbRating) : null,
    posterUrl: imageUrl(movie.Poster),
    backdropUrl: null,
    genres: movie.Genre && movie.Genre !== "N/A" ? movie.Genre.split(", ") : [],
    cast: movie.Actors && movie.Actors !== "N/A"
      ? movie.Actors.split(", ").map((name) => ({ id: name, name, role: "Cast", profileUrl: null }))
      : [],
    trailerUrl: null,
  };
}

function isTmdbMovie(value: unknown): value is TmdbMovie {
  if (!value || typeof value !== "object") return false;
  const movie = value as Partial<TmdbMovie>;
  return Number.isInteger(movie.id) && (typeof movie.title === "string" || typeof movie.name === "string");
}

function assertTmdbMoviePage(data: unknown): asserts data is { results?: TmdbMovie[]; total_pages?: number } {
  if (!data || typeof data !== "object") {
    throw new ProviderError("TMDb returned an invalid movie search response.", 502, "INVALID_PROVIDER_RESPONSE");
  }
  const page = data as { results?: unknown; total_pages?: unknown };
  if (
    (page.results !== undefined && (!Array.isArray(page.results) || !page.results.every(isTmdbMovie))) ||
    (page.total_pages !== undefined && (!Number.isInteger(page.total_pages) || (page.total_pages as number) < 0))
  ) {
    throw new ProviderError("TMDb returned an invalid movie search response.", 502, "INVALID_PROVIDER_RESPONSE");
  }
}

function breakerFor(name: string) {
  let breaker = breakers.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker();
    breakers.set(name, breaker);
  }
  return breaker;
}

async function providerJson<T>(provider: "tmdb" | "omdb", url: URL, token?: string, tags: string[] = []): Promise<T> {
  const key = `${provider}:${url.toString()}`;
  const pending = inFlightProviderRequests.get(key);
  if (pending) return pending as Promise<T>;

  const request = (async () => {
    const permit = await consumeMovieProviderTokenBucket(provider);
    if (!permit.allowed) {
      throw new ProviderError("Movie data is temporarily rate limited.", 429, "UPSTREAM_RATE_LIMIT");
    }

    return breakerFor(provider).execute(async () => {
      const endpointCategory = provider === "omdb"
        ? url.searchParams.has("s")
          ? "movie_search"
          : url.searchParams.has("i")
            ? "movie_details"
            : "movie_catalog"
        : url.pathname.includes("/search/movie")
          ? "movie_search"
          : url.pathname.includes("/movie/")
            ? url.pathname.endsWith("/credits")
              ? "movie_credits"
              : url.pathname.endsWith("/reviews")
                ? "movie_reviews"
                : url.pathname.endsWith("/recommendations")
                  ? "movie_recommendations"
                  : "movie_details"
            : "movie_catalog";
      const response = await fetchWithRetry(url, {
        headers: token ? { Authorization: `Bearer ${token}`, accept: "application/json" } : { accept: "application/json" },
        next: { revalidate: 300, tags },
      }, {
        provider,
        endpointCategory,
      });
      if (!response.ok) {
        throw new ProviderError("Movie data is temporarily unavailable.", 502, "PROVIDER_HTTP_ERROR");
      }
      return (await response.json()) as T;
    });
  })();
  inFlightProviderRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (inFlightProviderRequests.get(key) === request) inFlightProviderRequests.delete(key);
  }
}

class TmdbProvider implements MovieProvider {
  readonly name = "tmdb" as const;

  private token(): string {
    const token = process.env.TMDB_API_KEY;
    if (!token?.trim()) {
      logProviderFailure("tmdb", "configuration", null, "PROVIDER_NOT_CONFIGURED");
      throw new ProviderError(
        "TMDb is not configured on this server. Set TMDB_API_KEY in the server environment.",
        503,
        "PROVIDER_NOT_CONFIGURED",
      );
    }
    return token;
  }

  async list(input: MovieListInput): Promise<MoviePage> {
    const query = input.query?.trim();
    const cursorContext = { provider: this.name, category: input.category, query: query ?? "" } as const;
    const page = decodeCursor(input.cursor, cursorContext);
    if (input.category === "search" && !query) {
      return { results: [], page, totalPages: 0, nextCursor: null, provider: this.name };
    }
    const paths: Record<Exclude<MovieCategory, "search">, string> = {
      trending: "/trending/movie/week",
      popular: "/movie/popular",
      "top-rated": "/movie/top_rated",
      upcoming: "/movie/upcoming",
    };
    const url = new URL(`${tmdbBaseUrl()}${query ? "/search/movie" : paths[input.category as Exclude<MovieCategory, "search">]}`);
    url.searchParams.set("page", String(page));
    if (query) url.searchParams.set("query", query);
    const data: unknown = await providerJson<unknown>(
      this.name,
      url,
      this.token(),
      ["movies", `movies:${input.category}`, ...(query ? [] : [])],
    );
    assertTmdbMoviePage(data);
    const totalPages = Math.min(data.total_pages ?? 0, 500);
    return {
      results: (data.results ?? []).map(normalizeTmdb),
      page,
      totalPages,
      nextCursor: page < totalPages ? encodeCursor(page + 1, cursorContext) : null,
      provider: this.name,
    };
  }

  async getDetails(id: string): Promise<Movie> {
    if (!/^\d+$/.test(id)) throw new ProviderError("Movie was not found.", 404, "MOVIE_NOT_FOUND");
    const url = new URL(`${tmdbBaseUrl()}/movie/${encodeURIComponent(id)}`);
    url.searchParams.set("append_to_response", "videos");
    const data: unknown = await providerJson<unknown>(this.name, url, this.token(), ["movies", `movie:${id}`]);
    if (!isTmdbMovie(data) || String(data.id) !== id) {
      throw new ProviderError("TMDb returned invalid movie details.", 502, "INVALID_PROVIDER_RESPONSE");
    }
    return normalizeTmdb(data);
  }

  async getCredits(id: string) {
    const data = await providerJson<TmdbMovie>(this.name, new URL(`${tmdbBaseUrl()}/movie/${encodeURIComponent(id)}/credits`), this.token(), ["movies", `movie:${id}`]);
    return (data.cast ?? []).slice(0, 12).map((person) => ({
      id: String(person.id), name: person.name, role: person.character ?? "", profileUrl: imageUrl(person.profile_path),
    }));
  }

  async getReviews(id: string): Promise<MovieReview[]> {
    const data = await providerJson<TmdbMovie>(this.name, new URL(`${tmdbBaseUrl()}/movie/${encodeURIComponent(id)}/reviews`), this.token(), ["movies", `movie:${id}`]);
    return (data.reviews?.results ?? []).slice(0, 10).map((review) => ({
      id: review.id,
      author: review.author ?? "Movie fan",
      content: review.content ?? "",
      rating: typeof review.author_details?.rating === "number" ? review.author_details.rating : null,
    }));
  }

  async getRecommendations(id: string): Promise<Movie[]> {
    const data = await providerJson<{ results?: TmdbMovie[] }>(this.name, new URL(`${tmdbBaseUrl()}/movie/${encodeURIComponent(id)}/recommendations`), this.token(), ["movies", `movie:${id}`]);
    return (data.results ?? []).slice(0, 8).map(normalizeTmdb);
  }
}

class OmdbProvider implements MovieProvider {
  readonly name = "omdb" as const;

  private url(params: Record<string, string>) {
    const key = process.env.OMDB_API_KEY;
    if (!key?.trim()) {
      logProviderFailure("omdb", "configuration", null, "PROVIDER_NOT_CONFIGURED");
      throw new ProviderError("Movie data is not configured on this server.", 503, "PROVIDER_NOT_CONFIGURED");
    }
    const url = new URL(OMDB_BASE_URL);
    url.searchParams.set("apikey", key);
    Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, value));
    return url;
  }

  async list(input: MovieListInput): Promise<MoviePage> {
    if (!input.query?.trim()) {
      throw new ProviderError("OMDb supports title searches; choose TMDb for movie lists.", 501, "PROVIDER_OPERATION_UNSUPPORTED");
    }
    const query = input.query.trim();
    const cursorContext = { provider: this.name, category: input.category, query } as const;
    const page = decodeCursor(input.cursor, cursorContext);
    const data = await providerJson<{ Search?: OmdbMovie[]; totalResults?: string; Response: "True" | "False"; Error?: string }>(
      this.name,
      this.url({ s: query, page: String(page) }),
      undefined,
      ["movies", "movies:search"],
    );
    if (data.Response === "False" && data.Error !== "Movie not found!") {
      throw new ProviderError("OMDb could not complete the request.", 502, "PROVIDER_HTTP_ERROR");
    }
    const totalPages = Math.ceil(Number(data.totalResults ?? 0) / 10);
    return {
      results: (data.Search ?? []).map(normalizeOmdb),
      page,
      totalPages,
      nextCursor: page < totalPages ? encodeCursor(page + 1, cursorContext) : null,
      provider: this.name,
    };
  }

  async getDetails(id: string): Promise<Movie> {
    if (!/^tt\d+$/.test(id)) throw new ProviderError("Movie was not found.", 404, "MOVIE_NOT_FOUND");
    const data = await providerJson<OmdbMovie>(this.name, this.url({ i: id }), undefined, ["movies", `movie:${id}`]);
    if (data.Response === "False") throw new ProviderError("Movie was not found.", 404, "MOVIE_NOT_FOUND");
    return normalizeOmdb(data);
  }

  async getCredits() { return []; }
  async getReviews(): Promise<MovieReview[]> { return []; }
  async getRecommendations(): Promise<Movie[]> { return []; }
}

class MovieProviderRouter implements MovieProvider {
  readonly name: "tmdb" | "omdb";
  private readonly tmdb = new TmdbProvider();
  private readonly omdb = new OmdbProvider();

  constructor() {
    this.name = process.env.MOVIE_PROVIDER === "omdb" ? "omdb" : "tmdb";
  }

  async list(input: MovieListInput): Promise<MoviePage> {
    if (this.name === "omdb") return this.omdb.list(input);
    try {
      return await this.tmdb.list(input);
    } catch (error) {
      if (input.query?.trim() && process.env.OMDB_API_KEY) return this.omdb.list(input);
      throw error;
    }
  }

  async getDetails(id: string): Promise<Movie> {
    if (this.name === "omdb" || /^tt\d+$/.test(id)) return this.omdb.getDetails(id);
    return this.tmdb.getDetails(id);
  }

  async getCredits(id: string) {
    if (this.name === "omdb" || /^tt\d+$/.test(id)) return this.omdb.getCredits();
    return this.tmdb.getCredits(id);
  }

  async getReviews(id: string) {
    if (this.name === "omdb" || /^tt\d+$/.test(id)) return this.omdb.getReviews();
    return this.tmdb.getReviews(id);
  }

  async getRecommendations(id: string) {
    if (this.name === "omdb" || /^tt\d+$/.test(id)) return this.omdb.getRecommendations();
    return this.tmdb.getRecommendations(id);
  }
}

let provider: MovieProvider | undefined;

export function getMovieProvider(): MovieProvider {
  provider ??= new MovieProviderRouter();
  return provider;
}

export function isMovieCategory(value: string): value is MovieCategory {
  return ["trending", "popular", "top-rated", "upcoming", "search"].includes(value);
}