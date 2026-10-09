import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const detailPath = "/movie/969681";

async function openDetail(page: import("@playwright/test").Page) {
  await page.goto(detailPath);
  const addButton = page.getByRole("button", { name: /Add .* to watchlist/ });
  const removeButton = page.getByRole("button", { name: /Remove .* from watchlist/ });
  await expect(addButton.or(removeButton)).toBeEnabled({ timeout: 30_000 });
}

test("normal add and remove updates the detail action", async ({ page }) => {
  await openDetail(page);
  await page.getByRole("button", { name: /Add .* to watchlist/ }).click();
  await expect(page.getByRole("button", { name: /Remove .* from watchlist/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Remove .* from watchlist/ }).click();
  await expect(page.getByRole("button", { name: /Add .* to watchlist/ })).toHaveAttribute("aria-pressed", "false");
});

test("watchlist survives a page refresh", async ({ page }) => {
  await openDetail(page);
  await page.getByRole("button", { name: /Add .* to watchlist/ }).click();
  await expect(page.getByRole("button", { name: /Remove .* from watchlist/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /Remove .* from watchlist/ })).toHaveAttribute("aria-pressed", "true");
  await page.goto("/watchlist");
  await expect(page.getByRole("button", { name: /Remove .* from watchlist/ })).toBeVisible();
});

test("offline add is stored locally and announced", async ({ page, context }) => {
  await openDetail(page);
  await context.setOffline(true);
  await page.getByRole("button", { name: /Add .* to watchlist/ }).click();
  await expect(page.getByRole("button", { name: /Remove .* from watchlist/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/saved offline and queued to sync/)).toBeVisible();
});

test("reconnecting sends the queued change to the mock server", async ({ page, context }) => {
  await openDetail(page);
  await context.setOffline(true);
  await page.getByRole("button", { name: /Add .* to watchlist/ }).click();
  await expect(page.getByRole("button", { name: /Remove .* from watchlist/ })).toBeVisible();

  const synced = page.waitForResponse((response) => response.url().endsWith("/api/watchlist") && response.request().method() === "POST");
  await context.setOffline(false);
  const syncResponse = await synced;
  expect(syncResponse.status()).toBe(200);
  await page.goto("/watchlist");
  await expect(page.getByRole("button", { name: /Remove .* from watchlist/ })).toBeVisible();
});

test("two same-browser tabs receive watchlist updates", async ({ page, context }) => {
  await page.goto("/watchlist");
  const secondTab = await context.newPage();
  await secondTab.goto("/watchlist");
  await openDetail(page);
  await page.getByRole("button", { name: /Add .* to watchlist/ }).click();
  await expect(secondTab.getByRole("button", { name: /Remove .* from watchlist/ })).toBeVisible({ timeout: 10_000 });
});

test("simultaneous conflicting mutations resolve deterministically with LWW", async ({ page, request }) => {
  await openDetail(page);
  const clientId = await page.evaluate(() => localStorage.getItem("moviedb-watchlist-client-id"));
  expect(clientId).toMatch(/^[0-9a-f-]{36}$/i);
  const updatedAt = Date.now() + 60_000;
  const movieId = `conflict-${clientId!.slice(0, 8)}`;
  const movie = { id: movieId, title: "Conflict Test Movie", posterUrl: null, releaseDate: "2026", rating: 7, genres: ["Test"] };
  const makeMutation = (writerId: string, saved: boolean) => ({
    movieId,
    movie,
    saved,
    updatedAt,
    writerId,
    mutationId: randomUUID(),
  });
  const add = makeMutation("tab-a", true);
  const remove = makeMutation("tab-b", false);
  const responses = await Promise.all([
    request.post("/api/watchlist", { data: { clientId, entries: [add] } }),
    request.post("/api/watchlist", { data: { clientId, entries: [remove] } }),
  ]);
  expect(responses.every((response) => response.ok())).toBe(true);
  const snapshot = await request.get(`/api/watchlist?clientId=${encodeURIComponent(clientId!)}`);
  const data = await snapshot.json() as { entries: Array<{ movieId: string; saved: boolean; writerId: string }> };
  expect(data.entries.find((entry) => entry.movieId === movieId)).toMatchObject({ saved: false, writerId: "tab-b" });
});

test("rolls back an optimistic add rejected by the mock server", async ({ page }) => {
  await openDetail(page);
  await page.route("**/api/watchlist", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Rejected for rollback test." }) });
    } else {
      await route.continue();
    }
  });
  await page.getByRole("button", { name: /Add .* to watchlist/ }).click();
  await expect(page.getByRole("button", { name: /Add .* to watchlist/ })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText(/could not be saved\. Your previous watchlist was restored\./)).toBeVisible();
});
