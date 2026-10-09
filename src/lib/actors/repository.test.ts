import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("TMDb actor repository", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("TMDB_API_KEY", "test-actor-token");
    vi.stubEnv("TMDB_BASE_URL", "https://api.themoviedb.org/3");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  });

  it("normalizes localized profile names and film titles with genre and role metadata", async () => {
    const requestedUrls: URL[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedUrls.push(url);
      if (url.pathname.endsWith("/person/934")) {
        return Response.json({
          id: 934,
          name: "Russell Crowe",
          also_known_as: ["Russell Ira Crowe"],
          biography: "English biography",
          translations: { translations: [{ iso_639_1: "fr", iso_3166_1: "FR", data: { name: "Russell Crowe FR", biography: "Biographie française" } }] },
          combined_credits: {
            cast: [{ id: 10, media_type: "movie", title: "Titre français", original_title: "Original title", release_date: "2001-01-01", genre_ids: [18], character: "Le rôle", vote_average: 7.5 }],
            crew: [],
          },
          external_ids: { imdb_id: "nm0000128", instagram_id: "russellcrowe" },
        });
      }
      return Response.json({ genres: [{ id: 18, name: "Drame" }] });
    });
    vi.stubGlobal("fetch", fetcher);
    const { TmdbActorRepository } = await import("./repository");

    const actor = await new TmdbActorRepository().getProfile("934", "fr-FR");

    expect(actor.name).toBe("Russell Crowe FR");
    expect(actor.biography).toBe("Biographie française");
    expect(actor.alternateNames).toContain("Russell Ira Crowe");
    expect(actor.filmography[0]).toMatchObject({
      title: "Titre français",
      originalTitle: "Original title",
      alternateTitles: ["Original title"],
      year: 2001,
      character: "Le rôle",
      genres: ["Drame"],
    });
    expect(requestedUrls.every((url) => url.searchParams.get("language") === "fr-FR")).toBe(true);
  });

  it("loads the actor profile when an optional genre catalog is unavailable", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/person/934")) {
        return Response.json({
          id: 934,
          name: "Russell Crowe",
          combined_credits: {
            cast: [{ id: 10, media_type: "movie", title: "Film", release_date: "2001-01-01", genre_ids: [18] }],
            crew: [],
          },
        });
      }
      if (url.pathname.endsWith("/genre/movie/list")) {
        return Response.json({ status_message: "Not found" }, { status: 404 });
      }
      return Response.json({ genres: [{ id: 18, name: "Drama" }] });
    });
    vi.stubGlobal("fetch", fetcher);
    const { TmdbActorRepository } = await import("./repository");

    await expect(new TmdbActorRepository().getProfile("934")).resolves.toMatchObject({
      name: "Russell Crowe",
      filmography: [{ title: "Film", genres: ["Drama"] }],
    });
  });

  it("rejects a successful HTTP response that is not an actor profile", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status_message: "unexpected response" })));
    const { TmdbActorRepository } = await import("./repository");

    await expect(new TmdbActorRepository().getProfile("934")).rejects.toMatchObject({
      status: 502,
      code: "INVALID_PROVIDER_RESPONSE",
    });
  });

  it("preserves an upstream actor-not-found response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { status_message: "The resource you requested could not be found." },
      { status: 404 },
    )));
    const { TmdbActorRepository } = await import("./repository");

    await expect(new TmdbActorRepository().getProfile("934")).rejects.toMatchObject({
      status: 404,
      code: "ACTOR_NOT_FOUND",
    });
  });
});