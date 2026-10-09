import { describe, expect, it } from "vitest";
import {
  parseThemePreference,
  persistThemePreference,
  readStoredThemePreference,
  readThemeCookie,
  resolveTheme,
  THEME_STORAGE_KEY,
  themeCookieValue,
} from "./theme";

describe("theme preference persistence", () => {
  it("reads and validates the server cookie with a system fallback", () => {
    expect(readThemeCookie("other=value; moviedb-theme=high-contrast; session=abc")).toBe("high-contrast");
    expect(readThemeCookie("moviedb-theme=invalid")).toBe("system");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("sepia")).toBeNull();
  });

  it("persists selection to both local storage and a year-long cookie", () => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
    };
    const cookies: string[] = [];
    persistThemePreference("dark", storage, (value) => cookies.push(value), true);
    expect(readStoredThemePreference(storage, "system")).toBe("dark");
    expect(entries.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(cookies).toEqual([themeCookieValue("dark", true)]);
    expect(cookies[0]).toContain("Max-Age=31536000");
  });

  it("switches explicit themes and resolves system preference", () => {
    expect(resolveTheme("system", "light")).toBe("light");
    expect(resolveTheme("system", "dark")).toBe("dark");
    expect(resolveTheme("high-contrast", "light")).toBe("high-contrast");
  });
});