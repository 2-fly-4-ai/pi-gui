import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  getOpenDialogInvocationCount,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  stubNextOpenDialog,
} from "../helpers/electron-app";

test("imports a local VS Code color theme through the native picker and applies it", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("native-theme-import-workspace");
  const themePath = join(workspacePath, "safe-theme.json");
  await writeFile(themePath, JSON.stringify({
    name: "Native Safe Theme",
    type: "dark",
    colors: {
      "editor.background": "#101820",
      "editor.foreground": "#f4f7fb",
      "focusBorder": "#4da3ff",
      "sideBar.background": "#16212b",
      "input.background": "#1d2a36",
    },
  }), "utf8");
  const app = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "foreground" });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByTestId("settings-surface").getByRole("button", { name: "Appearance", exact: true }).click();
    await stubNextOpenDialog(app, [themePath]);
    const choose = page.getByRole("button", { name: "Choose theme file…" });
    await choose.scrollIntoViewIfNeeded();
    await choose.click();
    await expect.poll(() => getOpenDialogInvocationCount(app)).toBe(1);
    await expect(page.getByRole("status")).toContainText("Previewing Native Safe Theme");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.paletteId)).toMatch(/^vscode:/);
    await page.getByRole("button", { name: "Apply theme" }).click();
    const importedCard = page.locator(".theme-card", { has: page.getByRole("heading", { name: "Native Safe Theme" }) });
    await expect(importedCard).toContainText("Applied");
    await expect(importedCard).toContainText("safe-theme.json");
  } finally {
    await app.close();
  }
});
