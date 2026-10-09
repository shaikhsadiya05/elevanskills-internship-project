import type { Metadata } from "next";
import { cookies } from "next/headers";
import Navbar from "../src/components/Navbar";
import { parseThemePreference, THEME_COOKIE_NAME, ThemePreference } from "../src/lib/theme/theme";
import QueryProvider from "./providers";
import WebVitalsReporter from "./web-vitals-reporter";
import "../src/index.css";

export const metadata: Metadata = {
  title: "MovieDB | Discover Movies",
  description: "Explore movies, ratings, cast, and film details.",
};

const themeBootstrap = `(()=>{try{const saved=localStorage.getItem("moviedb-theme");const valid=["system","light","dark","high-contrast"].includes(saved);const v=valid?saved:(document.documentElement.dataset.theme||"system");if(valid){document.documentElement.dataset.theme=v;document.documentElement.dataset.themePreference=v}const dark=v==="dark"||(v==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark)}catch{}})()`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const themePreference: ThemePreference = parseThemePreference(cookieStore.get(THEME_COOKIE_NAME)?.value) ?? "system";
  return (
    <html lang="en" className={themePreference === "dark" ? "dark" : undefined} data-theme={themePreference} data-theme-preference={themePreference}>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head>
      <body>
        <QueryProvider initialThemePreference={themePreference}>
          <Navbar />
          {children}
          <WebVitalsReporter />
        </QueryProvider>
      </body>
    </html>
  );
}