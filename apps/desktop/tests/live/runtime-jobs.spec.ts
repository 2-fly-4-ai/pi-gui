import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  getRealAuthConfig,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

test("shows a live runtime job card for a surviving bash child process", async () => {
  test.setTimeout(240_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("runtime-live-jobs-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    realAuthSourceDir: realAuth.sourceDir,
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Runtime live background survivor");

    const composer = window.getByTestId("composer");
    await composer.fill(
      "Use your bash or shell tool to run this exact command and do not wait for the child before replying: `sleep 20 >/dev/null 2>&1 & echo rest-lane-1 launched`. After running it, briefly confirm what happened.",
    );
    await composer.press("Enter");

    await expect
      .poll(
        async () => {
          const state = await getDesktopState(window);
          const session = state.workspaces
            .find((workspace) => workspace.id === state.selectedWorkspaceId)
            ?.sessions.find((entry) => entry.id === state.selectedSessionId);
          return session?.runtimeSummary?.jobs.some((job) => job.confidence === "survived" && (job.status === "background" || job.status === "running")) ?? false;
        },
        { timeout: 90_000 },
      )
      .toBe(true);

    const runtimeJobCard = window.getByTestId("runtime-job-card").filter({ hasText: /survived/i }).first();
    await expect(runtimeJobCard).toHaveCount(1, { timeout: 30_000 });
    await expect(runtimeJobCard).toBeVisible({ timeout: 30_000 });
    await expect(runtimeJobCard).toContainText(/survived/i);
  } finally {
    await harness.close();
  }
});
