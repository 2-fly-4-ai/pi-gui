import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("renders and clears extension dock state for the selected session", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-dock-core");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Extension dock host");

    const state = await getDesktopState(window);
    const selectedWorkspace = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
    const selectedSession = selectedWorkspace?.sessions.find((session) => session.id === state.selectedSessionId);
    if (!selectedWorkspace || !selectedSession) {
      throw new Error("Expected selected workspace and session");
    }
    const sessionRef = { workspaceId: selectedWorkspace.id, sessionId: selectedSession.id };
    const timestamp = new Date().toISOString();

    await emitTestSessionEvent(harness, {
      type: "hostUiRequest",
      sessionRef,
      timestamp,
      request: {
        kind: "status",
        requestId: "status-1",
        key: "demo",
        text: "Extension ready",
      },
    });
    await emitTestSessionEvent(harness, {
      type: "hostUiRequest",
      sessionRef,
      timestamp,
      request: {
        kind: "widget",
        requestId: "widget-1",
        key: "details",
        lines: ["Widget body line"],
        placement: "belowComposer",
      },
    });

    await expect(window.getByTestId("extension-dock-summary")).toHaveText("Extension ready");
    await window.getByTestId("extension-dock-toggle").click();
    await expect(window.getByTestId("extension-dock-body")).toContainText("Widget body line");

    await emitTestSessionEvent(harness, {
      type: "hostUiRequest",
      sessionRef,
      timestamp: new Date().toISOString(),
      request: {
        kind: "reset",
        requestId: "reset-1",
      },
    });
    await expect(window.getByTestId("extension-dock")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
