export const SEARCH_HISTORY_KEY = "moviedb:recent-searches";
export const MAX_RECENT_SEARCHES = 10;

export function readRecentSearches(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(SEARCH_HISTORY_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter((search): search is string => typeof search === "string")
      .map((search) => search.trim())
      .filter(Boolean)
      .slice(0, MAX_RECENT_SEARCHES);
  } catch (error) {
    console.warn("Could not read recent movie searches.", error);
    return [];
  }
}

export function addRecentSearch(search: string): string[] {
  const normalizedSearch = search.trim();
  if (!normalizedSearch) return readRecentSearches();

  const searches = [
    normalizedSearch,
    ...readRecentSearches().filter((recent) => recent.toLocaleLowerCase() !== normalizedSearch.toLocaleLowerCase()),
  ].slice(0, MAX_RECENT_SEARCHES);

  try {
    window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(searches));
  } catch (error) {
    console.warn("Could not save the recent movie search.", error);
  }
  return searches;
}

export function clearRecentSearches(): void {
  try {
    window.localStorage.removeItem(SEARCH_HISTORY_KEY);
  } catch (error) {
    console.warn("Could not clear recent movie searches.", error);
  }
}
