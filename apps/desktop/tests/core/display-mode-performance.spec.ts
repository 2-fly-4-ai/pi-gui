import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  flushTestPersistence,
  getAppDiagnostics,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedDisplayModeScaleFixture,
  selectSession,
  updateDisplayModeFixtureSession,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("keeps 200 Display Mode threads projection- and render-bounded", async ({ browserName: _browserName }, testInfo) => {
  const userDataDir = await makeUserDataDir();
  const workspacePaths = await Promise.all([
    makeWorkspace("display-mode-scale-a"),
    makeWorkspace("display-mode-scale-b"),
    makeWorkspace("display-mode-scale-c"),
  ]);
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: workspacePaths,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    for (const workspacePath of workspacePaths) {
      await waitForWorkspaceByPath(window, workspacePath);
    }
    const fixture = await seedDisplayModeScaleFixture(harness, { count: 200, legacyCount: 12 });
    const baseline = await getAppDiagnostics(harness);
    const startedAt = performance.now();

    await window.locator(".sidebar__nav").getByRole("button", { name: "Display Mode" }).click();
    const surface = window.getByTestId("display-mode-surface");
    const grid = window.getByTestId("display-mode-virtual-grid");
    await expect(surface).toBeVisible();
    await expect(surface.locator(".display-mode__summary")).toContainText(`${fixture.count} threads`);
    await expect.poll(async () => Number(await grid.getAttribute("data-resident-row-count") ?? "0")).toBeGreaterThan(0);
    await expect(grid).toHaveAttribute("data-column-count", "2");
    await expect(grid).toHaveAttribute("data-total-row-count", "100");
    const firstUsableMs = Math.round(performance.now() - startedAt);
    testInfo.annotations.push({ type: "display-mode-first-usable-ms", description: String(firstUsableMs) });

    const detailedTiles = window.getByTestId("display-mode-thread-tile");
    await expect.poll(() => detailedTiles.count()).toBeGreaterThan(0);
    const initialTileCount = await detailedTiles.count();
    expect(initialTileCount).toBeLessThanOrEqual(30);
    expect(await detailedTiles.locator("textarea").count()).toBe(initialTileCount);
    expect(await detailedTiles.locator(".display-mode-tile__transcript").count()).toBeLessThanOrEqual(initialTileCount);

    await expect.poll(async () => (await getAppDiagnostics(harness)).displayModeProjectionRequests).toBeGreaterThan(
      baseline.displayModeProjectionRequests,
    );
    const initialDiagnostics = await getAppDiagnostics(harness);
    expect(initialDiagnostics.displayModeLegacyTranscriptReads - baseline.displayModeLegacyTranscriptReads).toBe(0);
    expect(initialDiagnostics.displayModeChangedFilesRequests - baseline.displayModeChangedFilesRequests).toBe(0);
    expect(initialDiagnostics.fullTranscriptCacheEntries).toBe(baseline.fullTranscriptCacheEntries);
    expect(initialDiagnostics.displayModeProjectionRequests - baseline.displayModeProjectionRequests).toBeLessThanOrEqual(30);
    expect(Number(await surface.getAttribute("data-projection-cache-bytes"))).toBeLessThanOrEqual(12 * 1024 * 1024);
    expect(Number(await surface.getAttribute("data-projection-cache-count"))).toBeLessThanOrEqual(30);

    const offscreenSession = await window.evaluate(async () => {
      const state = await window.piApp?.getState();
      const workspace = state?.workspaces.find((entry) =>
        entry.sessions.some((session) => session.title === "Scale thread 050"));
      const session = workspace?.sessions.find((entry) => entry.title === "Scale thread 050");
      if (!workspace || !session) throw new Error("Offscreen fixture session was not found.");
      return { workspace, session };
    });
    await updateDisplayModeFixtureSession(
      harness,
      { workspaceId: offscreenSession.workspace.id, sessionId: offscreenSession.session.id },
      { status: "failed", preview: "Offscreen metadata update" },
    );
    await expect(surface.locator(".display-mode__summary")).toContainText("9 failed");
    const offscreenDiagnostics = await getAppDiagnostics(harness);
    expect(offscreenDiagnostics.displayModeProjectionRequests).toBe(initialDiagnostics.displayModeProjectionRequests);
    expect(offscreenDiagnostics.fullTranscriptCacheEntries).toBe(baseline.fullTranscriptCacheEntries);
    expect(offscreenDiagnostics.statePatchChangedLastIpcBytes).toBeLessThan(128 * 1024);
    testInfo.annotations.push({
      type: "display-mode-200-session-patch-bytes",
      description: String(offscreenDiagnostics.statePatchChangedLastIpcBytes),
    });
    const topOrderBeforeFilter = await detailedTiles.locator(".display-mode-tile__title").allTextContents();
    await window.getByRole("button", { name: "Failed", exact: true }).click();
    await expect(detailedTiles.filter({ hasText: "Scale thread 050" })).toBeVisible();
    await window.getByRole("button", { name: "All", exact: true }).click();
    await expect.poll(async () =>
      (await detailedTiles.locator(".display-mode-tile__title").allTextContents()).join("|")
    ).toBe(topOrderBeforeFilter.join("|"));

    const scroller = window.locator(".display-mode__main");
    const focusedTile = detailedTiles.filter({ hasText: "Scale thread 000" });
    await focusedTile.locator("textarea").focus();
    const lastTile = detailedTiles.filter({ hasText: "Scale thread 199" });
    const draftTile = detailedTiles.filter({ hasText: "Scale thread 198" });
    await expect.poll(async () => {
      await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event("scroll"));
      });
      return lastTile.count();
    }).toBe(1);
    await expect(lastTile).toBeVisible();
    await expect(focusedTile).toHaveCount(1);
    await expect.poll(() => focusedTile.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(focusedTile).toHaveCount(0);
    await expect(draftTile.locator("textarea")).toHaveValue("Offscreen draft survives virtualization");
    await expect(lastTile.locator(".composer-attachment")).toContainText("display-mode-scale-fixture.txt");
    await expect.poll(async () => (await getAppDiagnostics(harness)).displayModeLegacyTranscriptReads).toBeGreaterThan(
      initialDiagnostics.displayModeLegacyTranscriptReads,
    );
    const legacyDiagnostics = await getAppDiagnostics(harness);
    const legacyReads = legacyDiagnostics.displayModeLegacyTranscriptReads - initialDiagnostics.displayModeLegacyTranscriptReads;
    expect(legacyReads).toBeGreaterThan(0);
    expect(legacyReads).toBeLessThanOrEqual(fixture.legacyCount);
    expect(legacyDiagnostics.fullTranscriptCacheEntries).toBe(baseline.fullTranscriptCacheEntries);

    await lastTile.getByRole("button", { name: "Thread actions" }).click();
    await lastTile.getByRole("menu", { name: "Thread actions" }).getByRole("menuitem", { name: "Terminal" }).click();
    await expect(lastTile.locator(".display-mode-tile__terminal")).toBeVisible();
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect(draftTile).toHaveCount(1);
    await expect(lastTile.locator(".display-mode-tile__terminal")).toHaveCount(1);
    await expect.poll(async () => detailedTiles.count()).toBeLessThanOrEqual(34);
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll"));
    });

    const scrollBeforeColumns = await scroller.evaluate((element) => element.scrollTop);
    await window.getByLabel("Grid columns").selectOption("1");
    await expect(grid).toHaveAttribute("data-column-count", "1");
    await expect(grid).toHaveAttribute("data-total-row-count", "200");
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(scrollBeforeColumns).toBeGreaterThan(0);

    await window.getByRole("button", { name: "Failed", exact: true }).click();
    await expect(lastTile).toHaveCount(0);
    await window.getByRole("button", { name: "All", exact: true }).click();
    await expect.poll(async () => {
      await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event("scroll"));
      });
      return lastTile.count();
    }).toBe(1);
    await expect(draftTile.locator("textarea")).toHaveValue("Offscreen draft survives virtualization");
    await expect(lastTile.locator(".composer-attachment")).toContainText("display-mode-scale-fixture.txt");

    await window.getByRole("button", { name: "Use compact Display Mode cards" }).click();
    await expect(window.getByRole("button", { name: "Use detailed Display Mode cards" })).toBeVisible();
    expect(await detailedTiles.locator("textarea").count()).toBe(0);
    expect(await detailedTiles.locator(".display-mode-tile__transcript").count()).toBe(0);
    expect(await detailedTiles.count()).toBeLessThanOrEqual(60);
    expect(Number(await surface.getAttribute("data-projection-cache-bytes"))).toBeLessThanOrEqual(12 * 1024 * 1024);
  } finally {
    await harness.close();
  }
});

test("keeps one keyed draft and attachment across Display Mode residency, thread parity, and restart", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("display-mode-durable-composer");
  const attachmentPath = join(workspacePath, "durable-display-mode-note.txt");
  await writeFile(attachmentPath, "Durable Display Mode attachment");
  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    let window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Display Mode durable composer");
    await window.locator(".sidebar__nav").getByRole("button", { name: "Display Mode" }).click();

    let tile = window.getByTestId("display-mode-thread-tile").filter({ hasText: "Display Mode durable composer" });
    const draft = "Draft retained through every Display Mode residency transition";
    await tile.locator("textarea").fill(draft);
    await tile.locator('input[type="file"]').setInputFiles(attachmentPath);
    await expect(tile.locator(".composer-attachment")).toContainText("durable-display-mode-note.txt");

    await window.getByRole("button", { name: "Use compact Display Mode cards" }).click();
    await expect(tile.locator("textarea")).toHaveCount(0);
    await window.getByRole("button", { name: "Use detailed Display Mode cards" }).click();
    await expect(tile.locator("textarea")).toHaveValue(draft);
    await expect(tile.locator(".composer-attachment")).toContainText("durable-display-mode-note.txt");

    await window.getByRole("button", { name: "Failed", exact: true }).click();
    await expect(tile).toHaveCount(0);
    await window.getByRole("button", { name: "All", exact: true }).click();
    tile = window.getByTestId("display-mode-thread-tile").filter({ hasText: "Display Mode durable composer" });
    await expect(tile.locator("textarea")).toHaveValue(draft);
    await expect(tile.locator(".composer-attachment")).toContainText("durable-display-mode-note.txt");

    await tile.getByRole("button", { name: "Thread actions" }).click();
    await tile.getByRole("menu", { name: "Thread actions" }).getByRole("menuitem", { name: "Open thread" }).click();
    await expect(window.getByTestId("composer")).toHaveValue(draft);
    await expect(window.getByTestId("composer-surface").locator(".composer-attachment")).toContainText(
      "durable-display-mode-note.txt",
    );
    await flushTestPersistence(harness);
    await harness.close();

    harness = await launchDesktop(userDataDir, {
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await selectSession(window, "Display Mode durable composer");
    await expect(window.getByTestId("composer")).toHaveValue(draft);
    await expect(window.getByTestId("composer-surface").locator(".composer-attachment")).toContainText(
      "durable-display-mode-note.txt",
    );

    await window.locator(".sidebar__nav").getByRole("button", { name: "Display Mode" }).click();
    tile = window.getByTestId("display-mode-thread-tile").filter({ hasText: "Display Mode durable composer" });
    await expect(tile.locator("textarea")).toHaveValue(draft);
    await expect(tile.locator(".composer-attachment")).toContainText("durable-display-mode-note.txt");
    await tile.locator("textarea").fill("/model");
    await tile.getByRole("button", { name: "Send reply" }).click();
    await expect(tile.locator("textarea")).toHaveValue("/model");
    await expect(tile.locator(".composer-attachment")).toContainText("durable-display-mode-note.txt");
    await expect(tile.getByTestId("composer-error-banner")).toContainText(/model|provider/i);
  } finally {
    await harness.close().catch(() => undefined);
  }
});

test("supports pointer and keyboard reordering through an accessible virtual-card handle", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("display-mode-accessible-reorder");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Reorder thread A");
    await createNamedThread(window, "Reorder thread B");
    await window.locator(".sidebar__nav").getByRole("button", { name: "Display Mode" }).click();
    const tiles = window.getByTestId("display-mode-thread-tile");
    await expect(tiles).toHaveCount(2);
    const titles = tiles.locator(".display-mode-tile__title");
    const originalOrder = await titles.allTextContents();
    const handles = tiles.getByRole("button", { name: "Drag to reorder" });
    await expect(handles).toHaveCount(2);
    await tiles.nth(0).getByRole("button", { name: "Expand tile to half width" }).click();
    await expect(window.locator(".display-mode__split")).toBeVisible();
    await window.getByRole("button", { name: "Collapse tile" }).click();
    await expect(window.locator(".display-mode__split")).toHaveCount(0);

    const sourceBox = await handles.nth(0).boundingBox();
    const targetBox = await handles.nth(1).boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    await window.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
    await window.mouse.down();
    await window.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 10, sourceBox!.y + sourceBox!.height / 2, { steps: 3 });
    await window.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 8 });
    await window.mouse.up();
    await expect.poll(async () => (await titles.allTextContents()).join("|")).not.toBe(originalOrder.join("|"));

    const keyboardTargetId = await tiles.nth(1).getAttribute("data-thread-key");
    expect(keyboardTargetId).toBeTruthy();
    await handles.nth(0).focus();
    await window.keyboard.press("Space");
    await expect.poll(async () => (await window.locator('[role="status"]').allTextContents()).join(" ")).toMatch(
      /picked up|moved over/i,
    );
    await window.keyboard.press("ArrowRight");
    await expect.poll(async () => (await window.locator('[role="status"]').allTextContents()).join(" ")).toContain(
      keyboardTargetId!,
    );
    await window.keyboard.press("Space");
    await expect.poll(async () => (await window.locator('[role="status"]').allTextContents()).join(" ")).toMatch(/dropped/i);
    await expect.poll(async () => (await titles.allTextContents()).join("|")).toBe(originalOrder.join("|"));
  } finally {
    await harness.close();
  }
});
