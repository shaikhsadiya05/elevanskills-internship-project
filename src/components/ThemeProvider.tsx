"use client";

import React, { createContext, ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { parseThemePreference, readStoredThemePreference, resolveTheme, ResolvedTheme, ThemePreference, themeCookieValue, THEME_STORAGE_KEY } from "../lib/theme/theme";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  systemTheme: "light" | "dark";
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider.");
  return context;
}

export function ThemeProvider({ initialPreference, children }: { initialPreference: ThemePreference; children: ReactNode }) {
  const [preference, setPreferenceState] = useState(initialPreference);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">("dark");
  const resolvedTheme = resolveTheme(preference, systemTheme);

  useIsomorphicLayoutEffect(() => {
    let stored = initialPreference;
    try { stored = readStoredThemePreference(window.localStorage, initialPreference); } catch { /* Cookie-backed SSR remains available. */ }
    if (stored !== preference) {
      setPreferenceState(stored);
      try { document.cookie = themeCookieValue(stored, window.location.protocol === "https:"); } catch { /* Local storage remains authoritative for this browser. */ }
    }
    else {
      try {
        if (!parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY))) window.localStorage.setItem(THEME_STORAGE_KEY, initialPreference);
      } catch { /* Cookie-backed SSR remains available. */ }
    }
  }, [initialPreference, preference]);

  useIsomorphicLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = preference;
    root.dataset.themePreference = preference;
    root.classList.toggle("dark", resolvedTheme === "dark");
  }, [preference, resolvedTheme]);

  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => setSystemTheme(media.matches ? "light" : "dark");
    update();
    if (media.addEventListener) media.addEventListener("change", update);
    else media.addListener?.(update);
    return () => {
      if (media.removeEventListener) media.removeEventListener("change", update);
      else media.removeListener?.(update);
    };
  }, []);

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    try { window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference); } catch { /* Cookie persistence still applies if local storage is blocked. */ }
    try { document.cookie = themeCookieValue(nextPreference, window.location.protocol === "https:"); } catch { /* The in-memory preference still applies if cookies are blocked. */ }
    setPreferenceState(nextPreference);
  }, []);

  const value = useMemo(() => ({ preference, resolvedTheme, systemTheme, setPreference }), [preference, resolvedTheme, setPreference, systemTheme]);
  return <ThemeContext.Provider value={value}><MotionConfig reducedMotion="user">{children}</MotionConfig></ThemeContext.Provider>;
}

export function ThemeScope({ preference, children }: { preference?: ThemePreference; children: ReactNode }) {
  const inherited = useTheme();
  if (!preference) return <>{children}</>;
  const resolvedTheme = resolveTheme(preference, inherited.systemTheme);
  const value = { ...inherited, preference, resolvedTheme };
  return <ThemeContext.Provider value={value}><div className={resolvedTheme === "dark" ? "dark" : undefined} data-theme={preference}>{children}</div></ThemeContext.Provider>;
}