import { test, expect } from "@playwright/test";
import { handle, MemoryRepository } from "../../supabase/functions/_shared/service.js";

// Deterministic transport lets the browser exercise rare moves without test-only
// production endpoints. The ordinary game suite also runs on the live backend.
test("every card route animates on both phones and one snap closes the burn without a timer", async ({ browser, baseURL }, testInfo) => {
  test.skip(!!process.env.CAMBIO_LIVE_URL, "Controlled local transport fixture");
  const repo = new MemoryRepository(), contexts = [], pages = [], errors = [];
  const users = ["movement-alice", "movement-bob"];
  for (let p = 0; p < 2; p++) {
    const context = await browser.newContext(testInfo.project.use);
    contexts.push(context);
    await context.addInitScript(() => {
      window.observedMovements = [];
      new MutationObserver((changes) => {
        for (const change of changes) for (const node of change.addedNodes) {
          if (node.matches?.(".swap-overlay")) window.observedMovements.push({
            kind: node.dataset.kind,
            faces: node.querySelectorAll(".swap-flight.face").length,
            cards: node.querySelectorAll(".swap-flight").length,
          });
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await context.route("**/game", async (route) => {
      try {
        const result = await handle(repo, users[p], route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
      } catch (error) {
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: error.code, message: error.message }) });
      }
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    pages.push(page);
  }
  const [a, b] = pages;
  const observed = async (kind) => {
    for (const page of pages)
      await expect.poll(() => page.evaluate((kind) => window.observedMovements.some((event) => event.kind === kind), kind), { timeout: 15000 }).toBe(true);
  };
  try {
    await a.goto(baseURL);
    await a.locator("#create").click();
    await expect(a.locator(".room-code")).toBeVisible();
    await b.goto(a.url());
    await observed("deal");
    for (const page of pages) {
      for (let i = 0; i < 2; i++) {
        await page.locator(".mine .card").nth(i).click();
        await expect(page.locator(".mine .card:not(.back)")).toHaveCount(i + 1);
      }
      await page.locator("#ready").click();
    }
    await expect(a.locator("#deck")).toBeEnabled();
    const row = [...repo.rooms.values()][0];
    row.state.discard = [{ r: 5, s: "♠" }];
    row.state.hands[0][0].card = { r: 5, s: "♥" };
    row.state.hands[0][1].card = { r: 5, s: "♦" };
    row.state.deck = [{ r: 13, s: "♠" }, { r: 8, s: "♣" }, { r: 6, s: "♦" }];
    row.state.snap = { id: crypto.randomUUID(), card: row.state.discard[0], winner: null, attempted: [], closesAt: Date.now() - 60000 };
    row.version++;
    repo.rooms.set(row.code, row);
    await expect(b.locator("#snap-line")).toContainText("SNAP 5♠ · AVAILABLE");
    // Opponent snap, followed by the mandatory face-down transfer.
    await b.locator(".partner .card").nth(0).click();
    await expect(b.locator("#status")).toContainText("Tap one of your cards to pass");
    await observed("snap");
    await b.locator(".mine .card").nth(0).click();
    await observed("transfer");
    await expect(a.locator("#deck")).toBeEnabled();
    await a.locator(".mine .card").nth(0).click();
    await expect(a.locator(".toast")).toContainText("No snap available");
    await expect(a.locator(".mine .card")).toHaveCount(4);
    // Ordinary draw/discard flows immediately; a wrong snap draws a private penalty.
    await a.locator("#deck").click();
    await expect(a.locator(".drawn-card")).toBeVisible();
    await a.locator("#discard").click();
    await observed("draw");
    await observed("discard");
    await expect(b.locator("#deck")).toBeEnabled();
    // The remaining original card at this index is deliberately not a six.
    const latest = repo.rooms.get(row.code);
    latest.state.hands[1][0].card = { r: 2, s: "♣" };
    repo.rooms.set(row.code, latest);
    await b.locator(".mine .card").nth(0).click();
    await observed("penalty");
    await expect(b.locator(".mine .card")).toHaveCount(4);
    await b.locator("#deck").click();
    await expect(b.locator(".drawn-card")).toBeVisible();
    await b.locator("#discard").click();
    await expect(b.locator("#ability-swap")).toBeVisible();
    await b.locator(".mine .card").nth(0).click();
    await b.locator(".partner .card").nth(0).click();
    await b.locator("#ability-swap").click();
    await observed("blind-swap");
    await a.locator("#deck").click();
    await observed("recycle");
    for (const page of pages) {
      const events = await page.evaluate(() => window.observedMovements);
      for (const kind of ["draw", "penalty", "transfer", "blind-swap", "recycle"])
        expect(events.filter((event) => event.kind === kind).every((event) => event.faces === 0)).toBe(true);
      expect(events.find((event) => event.kind === "deal").cards).toBe(9);
      await expect(page.locator(".partner .card:not(.back)")).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
  }
});
