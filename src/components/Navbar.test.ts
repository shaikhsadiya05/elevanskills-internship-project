// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    createElement("a", { ...props, href }, children),
}));
vi.mock("./ThemeProvider", () => ({
  useTheme: () => ({ preference: "system", resolvedTheme: "dark", setPreference: vi.fn() }),
}));

import Navbar from "./Navbar";
import { SEARCH_HISTORY_KEY } from "../lib/movies/search-history";

afterEach(() => {
  window.localStorage.clear();
  push.mockClear();
});

describe("Navbar recent movie searches", () => {
  it("saves submitted searches and lets the user reopen a recent search", async () => {
    render(createElement(Navbar));
    const search = screen.getByRole("textbox", { name: "Search movies" });

    fireEvent.change(search, { target: { value: "  Arasu  " } });
    fireEvent.submit(search.closest("form")!);

    expect(push).toHaveBeenCalledWith("/movies?search=Arasu");
    expect(JSON.parse(window.localStorage.getItem(SEARCH_HISTORY_KEY) ?? "[]")).toEqual(["Arasu"]);

    fireEvent.focus(search);
    const recentSearch = await screen.findByRole("button", { name: "Arasu" });
    fireEvent.click(recentSearch);
    expect(push).toHaveBeenLastCalledWith("/movies?search=Arasu");

    fireEvent.focus(search);
    fireEvent.click(await screen.findByRole("button", { name: "Clear" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Arasu" })).toBeNull());
    expect(window.localStorage.getItem(SEARCH_HISTORY_KEY)).toBeNull();
  });
});
