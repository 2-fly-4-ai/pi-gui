import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeGitWorkspace,
  makeUserDataDir,
} from "../helpers/electron-app";

test("Focus mode hides chrome temporarily, layers the palette, restores layout, and persists only by choice", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("focus-mode-workspace");
  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    let window = await harness.firstWindow();
    await createNamedThread(window, "Focus mode thread");
    await window.getByLabel("Toggle changes").click();
    await window.getByLabel("Toggle terminal").click();
    await expect(window.locator(".sidebar")).toBeVisible();
    await expect(window.locator(".diff-panel")).toBeVisible();
    await expect(window.locator(".terminal-panel")).toBeVisible();

    await window.keyboard.press("Meta+Shift+f");
    await expect(window.locator(".shell")).toHaveClass(/shell--focus-mode/);
    await expect(window.getByRole("button", { name: "Exit Focus mode" })).toBeVisible();
    await expect(window.locator(".sidebar")).toHaveCount(0);
    await expect(window.locator(".diff-panel")).toHaveCount(0);
    await expect(window.locator(".terminal-panel")).toHaveCount(0);
    await expect(window.getByTestId("transcript")).toBeVisible();
    await expect(window.locator(".composer")).toBeVisible();
    await expect(window.getByTestId("task-evidence-surface")).toBeVisible();

    await window.keyboard.press("Meta+k");
    await expect(window.getByTestId("command-palette")).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("command-palette")).toHaveCount(0);
    await expect(window.locator(".shell")).toHaveClass(/shell--focus-mode/);

    await window.keyboard.press("Escape");
    await expect(window.locator(".shell")).not.toHaveClass(/shell--focus-mode/);
    await expect(window.locator(".sidebar")).toBeVisible();
    await expect(window.locator(".diff-panel")).toBeVisible();
    await expect(window.locator(".terminal-panel")).toBeVisible();

    await window.getByRole("button", { name: "Enter Focus mode" }).click();
    await window.getByLabel("Keep").check();
    await expect.poll(() => window.evaluate(() => localStorage.getItem("pi-gui:focus-mode:keep"))).toBe("true");

    await harness.close();
    harness = await launchDesktop(userDataDir, {
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    window = await harness.firstWindow();
    await expect(window.locator(".shell")).toHaveClass(/shell--focus-mode/);
    await expect(window.locator(".sidebar")).toHaveCount(0);

    await window.keyboard.press("Escape");
    await expect(window.locator(".shell")).not.toHaveClass(/shell--focus-mode/);
    await expect.poll(() => window.evaluate(() => localStorage.getItem("pi-gui:focus-mode:keep"))).toBeNull();

    await harness.close();
    harness = await launchDesktop(userDataDir, {
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    window = await harness.firstWindow();
    await expect(window.locator(".shell")).not.toHaveClass(/shell--focus-mode/);
    await expect(window.locator(".sidebar")).toBeVisible();
  } finally {
    await harness.close();
  }
});
