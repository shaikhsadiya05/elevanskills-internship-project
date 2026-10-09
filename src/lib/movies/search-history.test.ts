// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { addRecentSearch, clearRecentSearches, MAX_RECENT_SEARCHES, readRecentSearches, SEARCH_HISTORY_KEY } from "./search-history";

afterEach(() => {
  window.localStorage.clear();
});

describe("recent movie searches", () => {
  it("stores unique recent searches, newest first, with a ten-item limit", () => {
    for (let index = 1; index <= MAX_RECENT_SEARCHES + 1; index += 1) {
      addRecentSearch(`Movie ${index}`);
    }
    const searches = addRecentSearch("  movie 5  ");

    expect(searches).toHaveLength(MAX_RECENT_SEARCHES);
    expect(searches[0]).toBe("movie 5");
    expect(searches).not.toContain("Movie 1");
    expect(readRecentSearches()).toEqual(searches);
  });

  it("clears saved searches and tolerates malformed saved data", () => {
    window.localStorage.setItem(SEARCH_HISTORY_KEY, "{");
    expect(readRecentSearches()).toEqual([]);

    addRecentSearch("Avatar");
    clearRecentSearches();
    expect(readRecentSearches()).toEqual([]);
  });
});
