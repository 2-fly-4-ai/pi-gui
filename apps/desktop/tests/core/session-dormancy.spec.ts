import { expect, test } from "@playwright/test";
import type { SessionRef } from "@pi-gui/session-driver";
import {
  getAppDiagnostics,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSession,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("switching through 100 idle Pi sessions keeps only the bounded runtime set resident", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("session-dormancy-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    const fixture = await harness.electronApp.evaluate(async (_, count) => {
      const hooks = (globalThis as {
        __PI_APP_TEST_HOOKS?: {
          seedSessionDormancyFixture?: (amount: number) => Promise<{
            readonly count: number;
            readonly firstTarget: SessionRef;
            readonly lastTarget: SessionRef;
            readonly residentTargets: readonly SessionRef[];
            readonly subscribedTargets: readonly SessionRef[];
            readonly selectedTarget?: SessionRef;
          }>;
        };
      }).__PI_APP_TEST_HOOKS;
      if (!hooks?.seedSessionDormancyFixture) {
        throw new Error("Session dormancy fixture hook is unavailable.");
      }
      return hooks.seedSessionDormancyFixture(count);
    }, 100);

    expect(fixture.count).toBe(100);
    let diagnostics = await getAppDiagnostics(harness);
    expect(
      diagnostics.residentSessionRuntimeCount,
      JSON.stringify({
        residentTargets: fixture.residentTargets,
        subscribedTargets: fixture.subscribedTargets,
        selectedTarget: fixture.selectedTarget,
      }),
    ).toBeLessThanOrEqual(8);
    expect(diagnostics.sessionSubscriptionCount).toBeLessThanOrEqual(8);
    expect(diagnostics.dormantSessionEvictions).toBeGreaterThanOrEqual(92);

    await selectSession(window, "Dormancy fixture 000");
    await expect.poll(async () => {
      const state = await window.evaluate(() => window.piApp?.getState());
      return state?.selectedSessionId;
    }).toBe(fixture.firstTarget.sessionId);
    await expect(window.getByTestId("composer")).toBeVisible();
    await expect(window.getByTestId("transcript")).not.toContainText("Loading transcript");
    const reopenedState = await window.evaluate(() => window.piApp?.getState());
    const reopenedSession = reopenedState?.workspaces
      .find((workspace) => workspace.id === fixture.firstTarget.workspaceId)
      ?.sessions.find((session) => session.id === fixture.firstTarget.sessionId);
    expect(reopenedSession?.config?.toolAccess).toMatchObject({ mode: "full" });

    diagnostics = await getAppDiagnostics(harness);
    expect(diagnostics.residentSessionRuntimeCount).toBeLessThanOrEqual(8);
    expect(diagnostics.sessionSubscriptionCount).toBeLessThanOrEqual(8);
  } finally {
    await harness.close();
  }
});
