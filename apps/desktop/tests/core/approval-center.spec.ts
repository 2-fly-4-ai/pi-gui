import { expect, test } from "@playwright/test";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  type PiAppWindow,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("aggregates approvals across threads, survives renderer reload, and approves once", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("approval-center");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Approval owner");
    const ownerState = await getDesktopState(window);
    const workspaceId = ownerState.selectedWorkspaceId ?? "";
    const ownerSessionId = ownerState.selectedSessionId ?? "";
    await emitTestSessionEvent(harness, {
      type: "hostUiRequest",
      sessionRef: { workspaceId, sessionId: ownerSessionId },
      runId: "approval-run-1",
      timestamp: new Date().toISOString(),
      request: {
        kind: "confirm",
        requestId: "approval-request-1",
        title: "Allow dependency update?",
        message: "The extension wants to update a package.",
        timeoutMs: 60_000,
      },
    } satisfies Extract<SessionDriverEvent, { type: "hostUiRequest" }>);

    await createNamedThread(window, "Other thread");
    await expect(window.getByTestId("approval-center-trigger")).toContainText("1 waiting");
    await window.getByTestId("approval-center-trigger").click();
    const center = window.getByTestId("approval-center");
    await expect(center).toContainText("Allow dependency update?");
    await expect(center).toContainText("Approval owner");
    await expect(center).toContainText("Runtime extension · thread scope");
    await expect(center).toContainText("significant risk");
    await expect(center).toContainText("Approval Center never creates a persistent “always approve” rule");
    await center.getByRole("button", { name: "Open thread" }).click();
    await expect(window.getByTestId("topbar")).toContainText("Approval owner");
    await expect(window.getByTestId("extension-dialog")).toContainText("Allow dependency update?");

    await window.reload();
    await expect(window.getByTestId("approval-center-trigger")).toContainText("1 waiting");
    await window.getByTestId("approval-center-trigger").click();
    await window.getByTestId("approval-center").getByRole("button", { name: "Approve once" }).click();
    await expect(window.getByTestId("approval-center-trigger")).toHaveCount(0);
    await expect(window.getByTestId("extension-dialog")).toHaveCount(0);

    const evidence = await window.evaluate(
      ({ workspaceId, sessionId }) =>
        (window as PiAppWindow).piApp?.listTaskEvidence({
          workspaceId,
          sessionId,
          kinds: ["approval"],
        }),
      { workspaceId, sessionId: ownerSessionId },
    );
    expect(evidence?.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        approval: expect.objectContaining({
          requestId: "approval-request-1",
          decision: "approved",
        }),
      }),
    ]));
  } finally {
    await harness.close();
  }
});

test("marks timed-out approval requests stale and disables responses", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("approval-center-stale");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Expired approval");
    const state = await getDesktopState(window);
    const workspaceId = state.selectedWorkspaceId ?? "";
    const sessionId = state.selectedSessionId ?? "";
    await emitTestSessionEvent(harness, {
      type: "hostUiRequest",
      sessionRef: { workspaceId, sessionId },
      timestamp: "2020-01-01T00:00:00.000Z",
      request: {
        kind: "confirm",
        requestId: "expired-request",
        title: "Expired request",
        message: "This request is no longer live.",
        timeoutMs: 1,
      },
    } satisfies Extract<SessionDriverEvent, { type: "hostUiRequest" }>);

    await window.getByTestId("approval-center-trigger").click();
    const center = window.getByTestId("approval-center");
    await expect(center).toContainText("Expired — the runtime may no longer accept a response");
    await expect(center.getByRole("button", { name: "Approve once" })).toBeDisabled();
    await expect(center.getByRole("button", { name: "Deny" })).toBeDisabled();
  } finally {
    await harness.close();
  }
});
