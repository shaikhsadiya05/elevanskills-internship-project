// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MovieBrowser from "./MovieBrowser";
import { Movie, MoviePage } from "../lib/movies/types";

vi.mock("./WatchlistButton", () => ({ default: () => null }));

const movie = (id: string, title: string): Movie => ({
  id,
  title,
  overview: "",
  releaseDate: "2025-01-01",
  rating: null,
  posterUrl: null,
  backdropUrl: null,
  genres: [],
  cast: [],
  trailerUrl: null,
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("MovieBrowser pagination", () => {
  it("prevents concurrent next-page requests and renders duplicate IDs only once", async () => {
    const initialPage: MoviePage = {
      results: [movie("1", "First Movie")],
      page: 1,
      totalPages: 2,
      nextCursor: "next-page",
      provider: "tmdb",
    };
    let resolveNextPage!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveNextPage = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(createElement(
      QueryClientProvider,
      { client },
      createElement(MovieBrowser, { category: "search", query: "Avatar", initialPage }),
    ));

    const loadMore = screen.getByRole("button", { name: "Load more" });
    fireEvent.click(loadMore);
    await waitFor(() => expect(loadMore.hasAttribute("disabled")).toBe(true));
    fireEvent.click(loadMore);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("cursor=next-page");

    resolveNextPage(Response.json({
      results: [movie("1", "First Movie"), movie("2", "Second Movie")],
      page: 2,
      totalPages: 2,
      nextCursor: null,
      provider: "tmdb",
    }));

    await screen.findByText("Second Movie");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).toBeNull());
    expect(document.querySelectorAll("article")).toHaveLength(2);
    expect(screen.getByText("First Movie")).toBeTruthy();
    expect(screen.getByText("Second Movie")).toBeTruthy();
  });

  it("restores the saved scroll position for the same search", () => {
    const initialPage: MoviePage = {
      results: [movie("1", "First Movie")],
      page: 1,
      totalPages: 1,
      nextCursor: null,
      provider: "tmdb",
    };
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    window.sessionStorage.setItem("movie-list-scroll:search:Avatar", "850");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(createElement(
      QueryClientProvider,
      { client },
      createElement(MovieBrowser, { category: "search", query: "Avatar", initialPage }),
    ));

    expect(scrollTo).toHaveBeenCalledWith(0, 850);
    expect(window.sessionStorage.getItem("movie-list-scroll:search:Avatar")).toBeNull();
  });

  it("retries a transient next-page API failure once", async () => {
    const initialPage: MoviePage = {
      results: [movie("1", "First Movie")],
      page: 1,
      totalPages: 2,
      nextCursor: "next-page",
      provider: "tmdb",
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "Temporarily unavailable" }, { status: 502 }))
      .mockResolvedValueOnce(Response.json({
        results: [movie("2", "Second Movie")],
        page: 2,
        totalPages: 2,
        nextCursor: null,
        provider: "tmdb",
      }));
    vi.stubGlobal("fetch", fetcher);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(createElement(
      QueryClientProvider,
      { client },
      createElement(MovieBrowser, { category: "search", query: "Avatar", initialPage }),
    ));

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await screen.findByText("Second Movie");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0][0])).toContain("cursor=next-page");
    expect(String(fetcher.mock.calls[1][0])).toContain("cursor=next-page");
  });
});
