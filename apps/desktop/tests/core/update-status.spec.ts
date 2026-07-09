import { expect, test } from "@playwright/test";
import type { DesktopUpdateStatus } from "../../src/ipc";
import { launchDesktop, makeUserDataDir, type DesktopHarness } from "../helpers/electron-app";

test("shows a restart affordance when a direct update is ready", async () => {
  const userDataDir = await makeUserDataDir();
  const harness = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await harness.firstWindow();

    await setUpdateStatus(harness, {
      status: "ready",
      currentVersion: "0.1.0",
      latestVersion: "0.1.1",
      source: "direct",
    });

    await expect(window.getByRole("button", { name: "Restart to update to version 0.1.1" })).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("shows Homebrew guidance for Homebrew-managed updates", async () => {
  const userDataDir = await makeUserDataDir();
  const harness = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await harness.firstWindow();

    await setUpdateStatus(harness, {
      status: "homebrew-update-available",
      currentVersion: "0.1.0",
      latestVersion: "0.1.1",
      source: "homebrew",
      command: "brew upgrade --cask pi-gui",
    });

    const action = window.getByRole("button", { name: "Homebrew update to version 0.1.1 available" });
    await expect(action).toBeVisible();
    await expect(action).toHaveText("Run brew upgrade");
    await expect(action).toHaveAttribute("title", "brew upgrade --cask pi-gui");
    await action.click();
    await expect
      .poll(() => harness.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe("brew upgrade --cask pi-gui");
  } finally {
    await harness.close();
  }
});

async function setUpdateStatus(harness: DesktopHarness, status: DesktopUpdateStatus): Promise<void> {
  await harness.electronApp.evaluate((_, nextStatus) => {
    const hooks = (globalThis as {
      __PI_APP_TEST_HOOKS?: { setUpdateStatus?: (status: DesktopUpdateStatus) => void };
    }).__PI_APP_TEST_HOOKS;
    if (!hooks?.setUpdateStatus) {
      throw new Error("Update status hook is unavailable");
    }
    hooks.setUpdateStatus(nextStatus);
  }, status);
}
