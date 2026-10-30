import { test, expect } from "@playwright/test";

async function initialPeek(page) {
  await expect(page.locator(".mine .card")).toHaveCount(4);
  await page.locator(".mine .card").nth(0).click();
  await expect(page.locator(".mine .card:not(.back)")).toHaveCount(1);
  await page.locator(".mine .card").nth(1).click();
  await expect(page.locator(".mine .card:not(.back)")).toHaveCount(2);
}
async function resolveAbility(page) {
  // Wait for the discard response before inspecting the resulting ability.
  await expect(page.locator(".drawn-card")).toHaveCount(0);
  if (await page.locator("#ability-swap").count()) {
    await page.locator(".mine .card").nth(0).click();
    await page.locator(".partner .card").nth(0).click();
    await page.locator("#ability-swap").click();
  } else if (
    (await page.locator("#status").textContent()) ===
    "Jack · Tap one of your own cards to peek."
  ) {
    await page.locator(".mine .card").nth(0).click();
    await page.locator("#ability-done").click();
  } else if (
    (await page.locator("#status").textContent()).startsWith("Red Queen")
  ) {
    await page.locator(".partner .card").nth(0).click();
    await page.locator("#ability-done").click();
  }
}
test("two isolated phones: private peeks, realtime turn, draw privacy, refresh, final turn, table reveal, next round", async ({
  browser,
  baseURL,
}, testInfo) => {
  const contextA = await browser.newContext(testInfo.project.use),
    contextB = await browser.newContext(testInfo.project.use);
  const a = await contextA.newPage(),
    b = await contextB.newPage();
  const errors = [];
  for (const p of [a, b]) p.on("pageerror", (e) => errors.push(e.message));
  try {
    await a.goto(baseURL);
    await a.locator("#target").selectOption("100");
    await a.locator("#create").click();
    await expect(a.locator(".room-code")).toBeVisible();
    const invite = a.url();
    await b.goto(invite);
    await initialPeek(a);
    await expect(b.locator(".partner .card:not(.back)")).toHaveCount(0);
    await initialPeek(b);
    await expect(a.locator(".partner .card:not(.back)")).toHaveCount(0);
    await a.locator("#ready").click();
    await b.locator("#ready").click();
    await expect(a.locator("#deck")).toBeEnabled();
    await expect(a.locator(".mine .back")).toHaveCount(4);
    await expect(a.locator(".room-bar")).toContainText("TARGET 100");
    await a.locator("#deck").click();
    await expect(a.locator(".drawn-card")).toBeVisible();
    await expect(b.locator(".drawn-area .back")).toBeVisible();
    await expect(b.locator(".drawn-card")).toHaveCount(0);
    await a.reload();
    await expect(a.locator(".drawn-card")).toBeVisible();
    await a.locator("#discard").click();
    await resolveAbility(a);
    await expect(b.locator("#deck")).toBeEnabled({ timeout: 12000 });
    await b.locator("#call").click();
    await expect(a.locator("#status")).toContainText("final turn");
    await a.locator("#deck").click();
    await a.locator("#discard").click();
    await resolveAbility(a);
    await expect(a.locator(".result")).toBeVisible({ timeout: 12000 });
    await expect(b.locator(".result")).toBeVisible();
    await expect(a.locator(".cards .card:not(.back)")).toHaveCount(8);
    await expect(a.locator("dialog")).toHaveCount(0);
    await expect(a.locator("#next")).toBeEnabled();
    await expect(a.locator(".reveal-cover")).toHaveCount(0);
    await a.screenshot({
      path: `test-results/${testInfo.project.name}-round.png`,
      fullPage: true,
    });
    await a.locator("#next").click();
    await b.locator("#next").click();
    await expect(a.locator("#status")).toContainText("Remember two cards");
    await expect(b.locator("#status")).toContainText("Remember two cards");
    expect(errors).toEqual([]);
    for (const p of [a, b])
      expect(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
test("mobile lobby, room code, copy fallback, reduced motion, accessible rules", async ({
  page,
  baseURL,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(baseURL);
  await expect(
    page.getByRole("heading", { name: "Two players. One good evening." }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/lobby.png", fullPage: true });
  await page.getByRole("button", { name: "Game rules" }).click();
  await expect(page.getByRole("dialog")).toContainText("Specials:");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator("#create").click();
  await expect(page.locator(".room-code")).toBeVisible();
  await page.locator("#copy").click();
  await expect(page.locator(".toast.visible, dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
