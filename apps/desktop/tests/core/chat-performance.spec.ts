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
  seedAgentDir,
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

test("coalesces streaming transcript updates without rerendering the idle composer", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = `${userDataDir}/agent`;
  const workspacePath = await makeWorkspace("chat-performance-streaming-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Streaming performance session");
    const context = await selectedSessionContext(window);
    const runId = `perf-run-${Date.now()}`;

    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef: context.sessionRef,
      timestamp: new Date().toISOString(),
      runId,
      snapshot: {
        ref: context.sessionRef,
        workspace: context.workspace,
        title: context.title,
        status: "running",
        updatedAt: new Date().toISOString(),
        preview: "streaming performance",
        runningRunId: runId,
      },
    });

    const composer = window.getByTestId("composer");
    await composer.fill("local draft before stream");
    const surface = window.getByTestId("composer-surface");
    const renderCountBefore = await surface.evaluate((node) =>
      Number((node as HTMLElement).dataset.renderCount ?? "0"),
    );
    const diagnosticsBefore = await getAppDiagnostics(harness);

    await Promise.all(
      Array.from({ length: 80 }, (_, index) =>
        emitTestSessionEventNoWait(harness, assistantDeltaEvent(context, runId, `chunk-${index} `)),
      ),
    );

    await expect
      .poll(
        async () =>
          window
            .getByTestId("transcript")
            .innerText()
            .then((text) => Array.from({ length: 80 }, (_, index) => text.includes(`chunk-${index}`)).every(Boolean)),
        { timeout: 15_000 },
      )
      .toBe(true);

    const renderCountAfterStream = await surface.evaluate((node) =>
      Number((node as HTMLElement).dataset.renderCount ?? "0"),
    );
    const diagnosticsAfter = await getAppDiagnostics(harness);
    const selectedTranscriptPublishes =
      diagnosticsAfter.selectedTranscriptPublishCount - diagnosticsBefore.selectedTranscriptPublishCount;

    expect(renderCountAfterStream - renderCountBefore).toBeLessThanOrEqual(6);
    expect(selectedTranscriptPublishes).toBeLessThan(20);

    await composer.press("End");
    await composer.type(" plus typing", { delay: 1 });
    await expect(composer).toHaveValue("local draft before stream plus typing");

    const markerCost = await window.evaluate(() => {
      const pane = document.querySelector<HTMLElement>("[data-testid='timeline-pane']");
      const before = performance.now();
      for (let index = 0; index < 20; index += 1) {
        pane?.dispatchEvent(new Event("scroll"));
      }
      return performance.now() - before;
    });
    expect(markerCost).toBeLessThan(50);
  } finally {
    await harness.close();
  }
});

test("keeps virtualization enabled for long assistant messages", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("chat-performance-long-message-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Long message virtualization session");
    await seedTranscriptMessages(harness, window, {
      count: 140,
      textFactory: (index) =>
        index === 139
          ? `long assistant block ${"x".repeat(12_000)}`
          : `short assistant row ${index}`,
    });

    await expect(window.getByTestId("transcript")).toContainText("long assistant block");
    await expect
      .poll(async () =>
        window.evaluate(async () => {
          const transcript = await window.piApp?.getSelectedTranscript();
          const renderedRows = document.querySelectorAll(
            ".timeline-item, .timeline-tool, .timeline-activity, .timeline-summary",
          ).length;
          const transcriptLength = transcript?.transcript.length ?? 0;
          return {
            virtualized: Boolean(document.querySelector(".timeline--virtualized")),
            renderedRows,
            transcriptLength,
            renderedLessThanTranscript: transcriptLength > 0 && renderedRows < transcriptLength,
          };
        }),
      )
      .toMatchObject({ virtualized: true, renderedLessThanTranscript: true });
  } finally {
    await harness.close();
  }
});
