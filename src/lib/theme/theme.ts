export const THEME_PREFERENCES = ["system", "light", "dark", "high-contrast"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = Exclude<ThemePreference, "system">;
export const THEME_STORAGE_KEY = "moviedb-theme";
export const THEME_COOKIE_NAME = "moviedb-theme";

export function parseThemePreference(value: string | null | undefined): ThemePreference | null {
  return THEME_PREFERENCES.includes(value as ThemePreference) ? value as ThemePreference : null;
}

export function readThemeCookie(cookieHeader: string, fallback: ThemePreference = "system"): ThemePreference {
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${THEME_COOKIE_NAME}=`));
  return parseThemePreference(cookie?.slice(THEME_COOKIE_NAME.length + 1)) ?? fallback;
}

export function resolveTheme(preference: ThemePreference, systemTheme: "light" | "dark"): ResolvedTheme {
  return preference === "system" ? systemTheme : preference;
}

export function themeCookieValue(preference: ThemePreference, secure = false): string {
  return `${THEME_COOKIE_NAME}=${preference}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function persistThemePreference(
  preference: ThemePreference,
  storage: Pick<Storage, "setItem">,
  writeCookie: (value: string) => void,
  secure = false,
): void {
  storage.setItem(THEME_STORAGE_KEY, preference);
  writeCookie(themeCookieValue(preference, secure));
}

export function readStoredThemePreference(storage: Pick<Storage, "getItem">, fallback: ThemePreference): ThemePreference {
  try {
    return parseThemePreference(storage.getItem(THEME_STORAGE_KEY)) ?? fallback;
  } catch {
    return fallback;
  }
}