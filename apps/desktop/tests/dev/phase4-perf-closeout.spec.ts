import { expect, test, type Page } from "@playwright/test";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import {
  createNamedThread,
  emitTestSessionEvent,
  emitTestSessionEventNoWait,
  getAppDiagnostics,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedTranscriptMessages,
} from "../helpers/electron-app";

async function selectedSessionContext(window: Page) {
  const state = await getDesktopState(window);
  const workspace = state.workspaces.find((entry) => entry.id === state.selectedWorkspaceId);
  if (!workspace) throw new Error("Expected selected workspace");
  const session = workspace.sessions.find((entry) => entry.id === state.selectedSessionId);
  if (!session) throw new Error("Expected selected session");
  return {
    sessionRef: { workspaceId: workspace.id, sessionId: session.id },
    workspace: { workspaceId: workspace.id, path: workspace.path, displayName: workspace.name },
    title: session.title,
  };
}

function assistantDeltaEvent(
  context: Awaited<ReturnType<typeof selectedSessionContext>>,
  runId: string,
  text: string,
): Extract<SessionDriverEvent, { type: "assistantDelta" }> {
  return {
    type: "assistantDelta",
    sessionRef: context.sessionRef,
    timestamp: new Date().toISOString(),
    runId,
    text,
  };
}

test("records Phase 4 long-transcript streaming IPC closeout numbers", async ({ browserName: _browserName }, testInfo) => {
  test.setTimeout(300_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("phase4-perf-closeout-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Phase 4 perf closeout session");
    await seedTranscriptMessages(harness, window, {
      count: 1_000,
      textFactory: (index) => `phase 4 seeded transcript row ${index}`,
    });

    const context = await selectedSessionContext(window);
    const runId = `phase4-perf-${Date.now()}`;
    const startedAt = new Date().toISOString();
    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef: context.sessionRef,
      timestamp: startedAt,
      runId,
      snapshot: {
        ref: context.sessionRef,
        workspace: context.workspace,
        title: context.title,
        status: "running",
        updatedAt: startedAt,
        preview: "phase 4 perf closeout stream",
        runningRunId: runId,
      },
    });
    await window.waitForTimeout(500);

    const diagnosticsBefore = await getAppDiagnostics(harness);
    const chunks = Array.from({ length: 80 }, (_, index) => `phase4-closeout-chunk-${index} `);
    await Promise.all(
      chunks.map((chunk) => emitTestSessionEventNoWait(harness, assistantDeltaEvent(context, runId, chunk))),
    );

    await expect
      .poll(
        async () =>
          window
            .getByTestId("transcript")
            .innerText()
            .then((text) => chunks.every((chunk) => text.includes(chunk.trim()))),
        { timeout: 30_000 },
      )
      .toBe(true);

    await expect
      .poll(
        async () => (await getAppDiagnostics(harness)).transcriptEventIpcCount -
          diagnosticsBefore.transcriptEventIpcCount,
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0);

    const diagnosticsAfter = await getAppDiagnostics(harness);
    const metrics = {
      seededTranscriptRows: 1_000,
      streamedChunks: chunks.length,
      selectedTranscriptChangedIpcCount:
        diagnosticsAfter.selectedTranscriptChangedIpcCount - diagnosticsBefore.selectedTranscriptChangedIpcCount,
      selectedTranscriptChangedIpcBytes:
        diagnosticsAfter.selectedTranscriptChangedIpcBytes - diagnosticsBefore.selectedTranscriptChangedIpcBytes,
      selectedTranscriptChangedLastIpcBytes: diagnosticsAfter.selectedTranscriptChangedLastIpcBytes,
      stateChangedIpcCount: diagnosticsAfter.stateChangedIpcCount - diagnosticsBefore.stateChangedIpcCount,
      stateChangedIpcBytes: diagnosticsAfter.stateChangedIpcBytes - diagnosticsBefore.stateChangedIpcBytes,
      transcriptEventIpcCount: diagnosticsAfter.transcriptEventIpcCount - diagnosticsBefore.transcriptEventIpcCount,
      transcriptEventIpcBytes: diagnosticsAfter.transcriptEventIpcBytes - diagnosticsBefore.transcriptEventIpcBytes,
      transcriptEventLastIpcBytes: diagnosticsAfter.transcriptEventLastIpcBytes,
      statePatchChangedIpcCount:
        diagnosticsAfter.statePatchChangedIpcCount - diagnosticsBefore.statePatchChangedIpcCount,
      statePatchChangedIpcBytes:
        diagnosticsAfter.statePatchChangedIpcBytes - diagnosticsBefore.statePatchChangedIpcBytes,
      statePatchChangedLastIpcBytes: diagnosticsAfter.statePatchChangedLastIpcBytes,
    };

    await testInfo.attach("phase4-perf-closeout.json", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
    console.log(`PHASE4_PERF_CLOSEOUT ${JSON.stringify(metrics)}`);

    expect(metrics.selectedTranscriptChangedIpcCount).toBe(0);
    expect(metrics.selectedTranscriptChangedIpcBytes).toBe(0);
    expect(metrics.stateChangedIpcCount).toBe(0);
    expect(metrics.stateChangedIpcBytes).toBe(0);
    expect(metrics.transcriptEventIpcCount).toBeGreaterThan(0);
    expect(metrics.transcriptEventIpcBytes).toBeGreaterThan(0);
  } finally {
    await harness.close();
  }
});
