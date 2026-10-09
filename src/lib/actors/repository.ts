import "server-only";

import { consumeMovieProviderTokenBucket } from "../server/movie-rate-limit";
import { fetchWithRetry, logProviderFailure, ProviderError } from "../server/resilience";
import { authorizePublicActorRead } from "./policy";
import { ActorCredit, ActorProfile, SimilarActor } from "./types";

const DEFAULT_TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";

type TmdbTranslation = {
  iso_639_1: string;
  iso_3166_1?: string;
  data?: { name?: string; biography?: string };
};

type TmdbCredit = {
  id: number;
  media_type: "movie" | "tv";
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  poster_path?: string | null;
  genre_ids?: number[];
  department?: string;
  job?: string;
  character?: string;
  adult?: boolean;
};

type TmdbPerson = {
  id: number;
  name: string;
  also_known_as?: string[];
  biography?: string;
  birthday?: string | null;
  place_of_birth?: string | null;
  profile_path?: string | null;
  known_for_department?: string;
  external_ids?: { imdb_id?: string | null; instagram_id?: string | null };
  translations?: { translations?: TmdbTranslation[] };
  combined_credits?: { cast?: TmdbCredit[]; crew?: TmdbCredit[] };
};

type TmdbGenre = { id: number; name: string };

type TmdbMovieCredits = {
  cast?: Array<{ id: number; name: string; profile_path?: string | null }>;
  crew?: Array<{ id: number; name: string; profile_path?: string | null }>;
};

export interface ActorRepository {
  getProfile(actorId: string, locale: string): Promise<ActorProfile>;
  getSimilarActors(actorId: string, locale: string): Promise<SimilarActor[]>;
}

function tmdbBaseUrl() {
  const configured = process.env.TMDB_BASE_URL?.trim() || DEFAULT_TMDB_BASE_URL;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.search || url.hash) throw new Error("Invalid TMDb URL");
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new ProviderError("TMDb API base URL configuration is invalid.", 500, "INVALID_PROVIDER_CONFIGURATION");
  }
}

async function tmdbJson<T>(path: string, locale: string, tags: string[]): Promise<T> {
  const token = process.env.TMDB_API_KEY;
  if (!token?.trim()) {
    logProviderFailure("tmdb", path.startsWith("/person/") ? "actor_profile" : "actor_genre_catalog", null, "PROVIDER_NOT_CONFIGURED");
    throw new ProviderError(
      "TMDb is not configured on this server. Set TMDB_API_KEY in the server environment.",
      503,
      "PROVIDER_NOT_CONFIGURED",
    );
  }
  const permit = await consumeMovieProviderTokenBucket("tmdb");
  if (!permit.allowed) throw new ProviderError("Movie data is temporarily rate limited.", 429, "UPSTREAM_RATE_LIMIT");

  const url = new URL(`${tmdbBaseUrl()}${path}`);
  url.searchParams.set("language", locale);
  const response = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    next: { revalidate: 3600, tags },
  }, {
    provider: "tmdb",
    endpointCategory: path.startsWith("/person/") ? "actor_profile" : path.startsWith("/genre/") ? "actor_genre_catalog" : "actor_related_data",
  });
  try {
    return (await response.json()) as T;
  } catch {
    throw new ProviderError("TMDb returned an invalid response.", 502, "INVALID_PROVIDER_RESPONSE");
  }
}

function localizedTranslation(translations: TmdbTranslation[], locale: string) {
  const [language, region] = locale.split("-");
  return translations.find((item) => item.iso_639_1 === language && (!region || item.iso_3166_1 === region))
    ?? translations.find((item) => item.iso_639_1 === language);
}

function imageUrl(path?: string | null) {
  return path ? `${TMDB_IMAGE_BASE_URL}${path}` : null;
}

function toCredit(credit: TmdbCredit, genres: Map<number, string>): ActorCredit | null {
  if (credit.adult || (credit.media_type !== "movie" && credit.media_type !== "tv")) return null;
  const title = credit.title ?? credit.name ?? "Untitled";
  const originalTitle = credit.original_title ?? credit.original_name ?? title;
  const releaseDate = credit.release_date ?? credit.first_air_date ?? "";
  const year = Number(releaseDate.slice(0, 4));
  return {
    id: String(credit.id),
    mediaType: credit.media_type,
    title,
    originalTitle,
    alternateTitles: originalTitle !== title ? [originalTitle] : [],
    releaseDate,
    year: Number.isInteger(year) && year > 1800 ? year : null,
    department: credit.department ?? "Acting",
    job: credit.job ?? "",
    character: credit.character ?? "",
    rating: typeof credit.vote_average === "number" ? credit.vote_average : null,
    posterUrl: imageUrl(credit.poster_path),
    genres: (credit.genre_ids ?? []).map((id) => genres.get(id)).filter((name): name is string => Boolean(name)),
  };
}

export class TmdbActorRepository implements ActorRepository {
  async getProfile(actorId: string, locale = "en-US"): Promise<ActorProfile> {
    const request = authorizePublicActorRead(actorId, locale);
    const actorTag = `actor:${request.actorId}`;
    const [personResult, movieGenresResult, tvGenresResult] = await Promise.allSettled([
      tmdbJson<TmdbPerson>(`/person/${request.actorId}?append_to_response=combined_credits,external_ids,translations`, request.locale, ["actors", actorTag]),
      tmdbJson<{ genres: TmdbGenre[] }>("/genre/movie/list", request.locale, ["actor-genres"]),
      tmdbJson<{ genres: TmdbGenre[] }>("/genre/tv/list", request.locale, ["actor-genres"]),
    ]);
    if (personResult.status === "rejected") {
      if (personResult.reason instanceof ProviderError && personResult.reason.status === 404) {
        throw new ProviderError("Actor was not found.", 404, "ACTOR_NOT_FOUND");
      }
      throw personResult.reason;
    }
    const person = personResult.value;
    if (
      !person ||
      !Number.isInteger(person.id) ||
      String(person.id) !== request.actorId ||
      typeof person.name !== "string" ||
      !person.name.trim()
    ) {
      throw new ProviderError("TMDb returned invalid actor profile data.", 502, "INVALID_PROVIDER_RESPONSE");
    }
    if (movieGenresResult.status === "rejected") {
      console.warn("TMDb movie genre metadata is unavailable for this actor profile.", movieGenresResult.reason);
    }
    if (tvGenresResult.status === "rejected") {
      console.warn("TMDb TV genre metadata is unavailable for this actor profile.", tvGenresResult.reason);
    }
    const movieGenres = movieGenresResult.status === "fulfilled" && Array.isArray(movieGenresResult.value.genres)
      ? movieGenresResult.value
      : { genres: [] };
    const tvGenres = tvGenresResult.status === "fulfilled" && Array.isArray(tvGenresResult.value.genres)
      ? tvGenresResult.value
      : { genres: [] };

    const translations = Array.isArray(person.translations?.translations) ? person.translations.translations : [];
    const translation = localizedTranslation(translations, request.locale);
    const originalName = person.name;
    const name = translation?.data?.name || originalName;
    const genreMap = new Map([...movieGenres.genres, ...tvGenres.genres].map((genre) => [genre.id, genre.name]));
    const castCredits = Array.isArray(person.combined_credits?.cast) ? person.combined_credits.cast : [];
    const crewCredits = Array.isArray(person.combined_credits?.crew) ? person.combined_credits.crew : [];
    const filmography = [...castCredits, ...crewCredits]
      .map((credit) => toCredit(credit, genreMap))
      .filter((credit): credit is ActorCredit => credit !== null)
      .sort((left, right) => (right.releaseDate || "").localeCompare(left.releaseDate || ""));
    const alternateNames = [...new Set([
      ...(person.also_known_as ?? []),
      originalName,
      ...translations.map((item) => item.data?.name).filter((value): value is string => Boolean(value)),
    ])].filter((alternate) => alternate !== name);

    return {
      id: String(person.id),
      name,
      originalName,
      alternateNames,
      biography: translation?.data?.biography || person.biography || "",
      birthday: person.birthday ?? null,
      placeOfBirth: person.place_of_birth ?? null,
      profileUrl: imageUrl(person.profile_path),
      knownForDepartment: person.known_for_department ?? null,
      imdbId: person.external_ids?.imdb_id ?? null,
      instagramId: person.external_ids?.instagram_id ?? null,
      filmography,
    };
  }

  async getSimilarActors(actorId: string, locale = "en-US"): Promise<SimilarActor[]> {
    const request = authorizePublicActorRead(actorId, locale);
    const profile = await this.getProfile(request.actorId, request.locale);
    const credits = profile.filmography.slice(0, 3);
    const creditLists = await Promise.all(credits.map((credit) =>
      tmdbJson<TmdbMovieCredits>(`/${credit.mediaType}/${credit.id}/credits`, request.locale, ["actors", `actor:${request.actorId}`]),
    ));
    const sharedCounts = new Map<string, { name: string; profileUrl: string | null; sharedCredits: number }>();
    for (const creditList of creditLists) {
      for (const person of [...(creditList.cast ?? []), ...(creditList.crew ?? [])]) {
        if (String(person.id) === request.actorId) continue;
        const existing = sharedCounts.get(String(person.id));
        if (existing) existing.sharedCredits += 1;
        else sharedCounts.set(String(person.id), { name: person.name, profileUrl: imageUrl(person.profile_path), sharedCredits: 1 });
      }
    }
    return [...sharedCounts.entries()]
      .map(([id, actor]) => ({ id, ...actor }))
      .sort((left, right) => right.sharedCredits - left.sharedCredits || left.name.localeCompare(right.name))
      .slice(0, 8);
  }
}

export const actorRepository: ActorRepository = new TmdbActorRepository();