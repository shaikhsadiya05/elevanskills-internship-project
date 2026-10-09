"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { ThemePreference } from "../src/lib/theme/theme";
import { ThemeProvider } from "../src/components/ThemeProvider";
import WatchlistProvider from "../src/components/WatchlistProvider";

export default function QueryProvider({ children, initialThemePreference = "system" }: Readonly<{ children: React.ReactNode; initialThemePreference?: ThemePreference }>) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 15 * 60_000,
            retry: false,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
        },
      }),
  );

  return <ThemeProvider initialPreference={initialThemePreference}><WatchlistProvider><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></WatchlistProvider></ThemeProvider>;
}