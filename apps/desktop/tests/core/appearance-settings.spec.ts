import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

test("appearance shuriken picker controls the thinking spinner", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("appearance-shuriken-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Shuriken appearance session");

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    const settingsSurface = window.getByTestId("settings-surface");
    await expect(settingsSurface).toBeVisible();
    await settingsSurface.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Appearance");

    const shurikenPicker = window.getByTestId("shuriken-picker");
    await shurikenPicker.scrollIntoViewIfNeeded();
    await expect(shurikenPicker).toBeVisible();
    await window.getByTestId("shuriken-option-shuriken-07").click();
    await expect(window.getByTestId("selected-shuriken")).toContainText("Compass Ring");
    await expect(window.getByTestId("shuriken-option-shuriken-07")).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(() => window.evaluate(() => window.localStorage.getItem("pi-gui:selected-shuriken")))
      .toBe("shuriken-07");

    await settingsSurface.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(window.getByTestId("composer")).toBeVisible();
    await window.getByTestId("thinking-trace-toggle").click();

    const state = await getDesktopState(window);
    const selectedWorkspace = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
    const selectedSession = selectedWorkspace?.sessions.find((session) => session.id === state.selectedSessionId);
    expect(selectedWorkspace).toBeTruthy();
    expect(selectedSession).toBeTruthy();
    if (!selectedWorkspace || !selectedSession) {
      throw new Error("Expected selected workspace and session");
    }

    const sessionRef = { workspaceId: selectedWorkspace.id, sessionId: selectedSession.id };
    const workspace = {
      workspaceId: selectedWorkspace.id,
      path: selectedWorkspace.path,
      displayName: selectedWorkspace.name,
    };
    const runId = "appearance-shuriken-thinking-run";
    const startedAt = new Date().toISOString();
    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef,
      timestamp: startedAt,
      runId,
      snapshot: {
        ref: sessionRef,
        workspace,
        title: selectedSession.title,
        status: "running",
        updatedAt: startedAt,
        preview: "Thinking with selected shuriken",
        runningRunId: runId,
      },
    });
    await emitTestSessionEvent(harness, {
      type: "assistantThinkingStarted",
      sessionRef,
      timestamp: startedAt,
      runId,
    });
    await emitTestSessionEvent(harness, {
      type: "assistantThinkingDelta",
      sessionRef,
      timestamp: new Date(Date.now() + 1_000).toISOString(),
      runId,
      text: "Checking the selected shuriken.",
    });

    const thinkingShuriken = window.getByTestId("timeline-thinking-shuriken");
    await expect(thinkingShuriken).toBeVisible();
    await expect(thinkingShuriken).toHaveAttribute("data-shuriken-id", "shuriken-07");
    await expect(thinkingShuriken).toHaveJSProperty("naturalWidth", 782);
  } finally {
    await harness.close();
  }
});
