// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MovieDetailClient, { MovieMediaCarousel } from "./MovieDetailClient";
import { Movie } from "../lib/movies/types";

vi.mock("./WatchlistButton", () => ({ default: () => null }));

const movie: Movie = {
  id: "42",
  title: "Example Film",
  overview: "A short synopsis.",
  releaseDate: "2025-01-01",
  rating: 8.2,
  posterUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
  backdropUrl: "https://image.tmdb.org/t/p/w500/backdrop.jpg",
  genres: ["Drama"],
  cast: [],
  trailerUrl: "https://www.youtube.com/watch?v=abcdefghijk",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MovieMediaCarousel accessibility", () => {
  it("exposes labeled controls and supports arrow-key navigation", async () => {
    render(createElement(MovieMediaCarousel, { movie }));
    const carousel = screen.getByRole("group", { name: "Example Film media" });
    expect(carousel.getAttribute("aria-roledescription")).toBe("carousel");
    expect(screen.getByRole("button", { name: "Previous media" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next media" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Example Film backdrop" })).toBeTruthy();

    fireEvent.keyDown(carousel, { key: "ArrowRight" });
    expect(await screen.findByRole("img", { name: "Example Film poster" })).toBeTruthy();
    expect(await screen.findByText("Slide 2 of 3: Example Film poster")).toBeTruthy();

    fireEvent.keyDown(carousel, { key: "ArrowLeft" });
    expect(await screen.findByRole("img", { name: "Example Film backdrop" })).toBeTruthy();
  });

  it("shows a clear fallback when trailer data is missing", () => {
    render(createElement(MovieMediaCarousel, { movie: { ...movie, trailerUrl: null } }));
    expect(screen.getByRole("status").textContent).toBe("Trailer not available.");
    expect(screen.queryByTitle("Example Film trailer")).toBeNull();
  });

  it("does not break if the active trailer disappears after movie data refreshes", async () => {
    const { rerender } = render(createElement(MovieMediaCarousel, { movie }));
    const carousel = screen.getByRole("group", { name: "Example Film media" });
    fireEvent.keyDown(carousel, { key: "ArrowRight" });
    fireEvent.keyDown(carousel, { key: "ArrowRight" });
    expect(await screen.findByTitle("Example Film trailer")).toBeTruthy();

    rerender(createElement(MovieMediaCarousel, { movie: { ...movie, trailerUrl: null } }));

    expect(screen.getByRole("status").textContent).toBe("Trailer not available.");
    await waitFor(() => expect(screen.queryByTitle("Example Film trailer")).toBeNull());
  });

  it("recovers from the server fallback after one transient details API failure", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "Temporarily unavailable" }, { status: 502 }))
      .mockResolvedValueOnce(Response.json({ ...movie, title: "Recovered Film", trailerUrl: null }));
    vi.stubGlobal("fetch", fetcher);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const fallbackMovie = { ...movie, title: "Movie details unavailable", overview: "", trailerUrl: null };

    render(createElement(
      QueryClientProvider,
      { client },
      createElement(MovieDetailClient, { movie: fallbackMovie, fallback: true }),
    ));

    expect(await screen.findByRole("heading", { name: "Recovered Film", level: 1 })).toBeTruthy();
    expect(screen.queryByText("Movie details could not be loaded. Showing a fallback view.")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});