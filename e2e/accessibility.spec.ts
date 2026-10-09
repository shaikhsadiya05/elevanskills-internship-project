import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("watchlist has no axe violations in each theme preference", async ({ page }) => {
  await page.goto("/watchlist");
  await expect(page.getByRole("heading", { name: "Watchlist", level: 1 })).toBeVisible();

  for (const preference of ["system", "light", "dark", "high-contrast"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.dataset.themePreference = value;
      const dark = value === "dark" || (value === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
    }, preference);
    await expect(page.locator("html")).toHaveAttribute("data-theme", preference);
    await page.waitForTimeout(200);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, `${preference} theme violations`).toEqual([]);
  }
});

test("watchlist fits narrow mobile viewports without horizontal page overflow", async ({ page }) => {
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 740 });
    await page.goto("/watchlist");
    await expect(page.getByRole("heading", { name: "Watchlist", level: 1 })).toBeVisible();
    const pageOverflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(pageOverflows, `page overflow at ${width}px`).toBe(false);
  }
});

test("movie details fit narrow mobile viewports without horizontal page overflow", async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 740 });
    await page.goto("/movie/42", { timeout: 90_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const pageOverflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(pageOverflows, `movie detail page overflow at ${width}px`).toBe(false);
  }
});