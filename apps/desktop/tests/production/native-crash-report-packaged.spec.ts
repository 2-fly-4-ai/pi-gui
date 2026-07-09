import { expect, test } from "@playwright/test";
import {
  getDesktopState,
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
} from "../helpers/electron-app";

test("packaged app records a real native crash artifact after opt-in", async () => {
  test.setTimeout(120_000);

  const userDataDir = await makeUserDataDir("pi-gui-packaged-native-crash-user-data-");
  const workspacePath = await makeWorkspace("packaged-native-crash-workspace");
  const firstRun = await launchPackagedDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  const appProcess = firstRun.electronApp.process();
  const exitPromise = new Promise<void>((resolve) => {
    appProcess.once("exit", () => resolve());
  });

  try {
    const window = await firstRun.firstWindow();
    await openNewThread(window);

    const reportingPrompt = window.getByTestId("diagnostic-reporting-onboarding");
    await expect(reportingPrompt).toContainText("Nothing is sent automatically");
    await reportingPrompt.getByRole("button", { name: "Enable diagnostics" }).click();
    await expect.poll(async () => (await getDesktopState(window)).diagnosticReporting).toEqual({
      issueDraftsEnabled: true,
      nativeCrashReportsEnabled: true,
      onboardingDismissed: true,
    });

    await Promise.all([
      exitPromise,
      firstRun.electronApp.evaluate(() => {
        const hooks = (globalThis as {
          __PI_APP_TEST_HOOKS?: { forceNativeCrash?: () => void };
        }).__PI_APP_TEST_HOOKS;
        if (!hooks?.forceNativeCrash) {
          throw new Error("Native crash test hook is unavailable");
        }
        hooks.forceNativeCrash();
      }).catch(() => undefined),
    ]);
  } finally {
    if (!appProcess.killed && appProcess.exitCode === null) {
      await firstRun.electronApp.close().catch(() => undefined);
    }
  }

  const restarted = await launchPackagedDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await restarted.firstWindow();
    await expect.poll(async () => (await getDesktopState(window)).diagnosticReporting.nativeCrashReportsEnabled).toBe(true);
    await window.getByRole("button", { name: "Threads", exact: true }).click();
    await expect(window.getByLabel("Toggle logs panel")).toBeVisible();
    await window.getByLabel("Toggle logs panel").click();
    await window.getByRole("tab", { name: "App logs" }).click();
    await expect.poll(async () => {
      await window.getByLabel("Refresh logs").click();
      return window.locator(".logs-panel__event-title", { hasText: "Native crash report artifact" }).count();
    }, { timeout: 30_000 }).toBeGreaterThan(0);
  } finally {
    await restarted.close();
  }
});
