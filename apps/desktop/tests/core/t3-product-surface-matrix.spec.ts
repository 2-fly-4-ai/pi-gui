import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { createNamedThread, launchDesktop, makeUserDataDir, makeWorkspace, toggleTopbarPanel } from "../helpers/electron-app";

test("T3 productivity surfaces remain named, bounded, and usable across the appearance matrix", async ({ browserName: _browserName }, testInfo) => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("t3-product-surface-matrix");
  const app = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
  try {
    const page = await app.firstWindow();
    await createNamedThread(page, "Product surface matrix");

    await setTheme(page, "Light");
    await openPaletteAction(page, "Usage dashboard");
    await assertSurface(page, page.getByTestId("usage-dashboard"), "light-usage", testInfo);

    await backToApp(page);
    await setTheme(page, "Dark");
    await openPaletteAction(page, "Pull requests");
    await assertSurface(page, page.getByTestId("pull-request-workbench"), "dark-pull-requests", testInfo);

    await backToApp(page);
    await page.emulateMedia({ forcedColors: "active" });
    await openPaletteAction(page, "Diagnose Pi");
    await assertSurface(page, page.getByTestId("resource-inspector"), "forced-colors-resources", testInfo);
    await page.emulateMedia({ forcedColors: "none" });

    await page.getByLabel("Close logs").click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openPaletteAction(page, "Manage project actions");
    const actions = page.getByTestId("project-actions-surface");
    await assertSurface(page, actions, "reduced-motion-project-actions", testInfo);
    const animated = await actions.locator("*").evaluateAll((elements) => elements.filter((element) => {
      const style = getComputedStyle(element);
      return style.animationName !== "none" && !/^0(?:s|ms)(?:,\s*0(?:s|ms))*$/.test(style.animationDuration);
    }).length);
    expect(animated).toBe(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });

    await backToApp(page);
    await page.evaluate(() => { document.documentElement.dataset.density = "compact"; });
    await openPaletteAction(page, "Open Prompt Shelf");
    await assertSurface(page, page.getByTestId("prompt-shelf-surface"), "compact-prompt-shelf", testInfo);

    await backToApp(page);
    await page.evaluate(() => { document.body.style.zoom = "1.25"; });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByTestId("settings-surface").getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByTestId("theme-gallery").scrollIntoViewIfNeeded();
    await assertSurface(page, page.getByTestId("theme-gallery"), "increased-scale-theme-gallery", testInfo);

    await page.evaluate(() => { document.body.style.zoom = ""; document.documentElement.dataset.density = "comfortable"; });
    await page.setViewportSize({ width: 720, height: 780 });
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await toggleTopbarPanel(page, "App logs");
    await page.getByRole("tab", { name: "Remote spike" }).click();
    await assertSurface(page, page.getByTestId("loopback-remote-diagnostics"), "narrow-remote-spike", testInfo);
  } finally {
    await app.close();
  }
});

async function openPaletteAction(page: Page, label: string): Promise<void> {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  const palette = page.getByTestId("command-palette");
  await palette.getByPlaceholder("Search commands…").fill(label);
  await palette.getByRole("option", { name: new RegExp(label, "i") }).click();
}

async function setTheme(page: Page, mode: "Light" | "Dark"): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByTestId("settings-surface");
  await settings.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.locator(`input[name="theme"][aria-label="${mode}"]`).check();
  await settings.getByRole("button", { name: "Back to app", exact: true }).click();
}

async function backToApp(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Back to app", exact: true });
  if (await button.count()) await button.click();
}

async function assertSurface(page: Page, surface: Locator, name: string, testInfo: TestInfo): Promise<void> {
  await expect(surface).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2)).toBe(true);
  const unnamed = await surface.locator("button, a[href], input, select, textarea, [role=button]").evaluateAll((elements) => elements.filter((element) => {
    const node = element as HTMLElement;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const input = element as HTMLInputElement;
    const label = input.labels?.[0]?.textContent ?? "";
    return !(node.getAttribute("aria-label") || node.getAttribute("title") || label || node.textContent?.trim());
  }).length);
  expect(unnamed, `${name} contains unnamed visible controls`).toBe(0);
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  await testInfo.attach(`${name}.png`, { body: await page.screenshot(), contentType: "image/png" });
}
