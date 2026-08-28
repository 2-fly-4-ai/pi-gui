import { expect, test, type Page } from "@playwright/test";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createNamedThread,
  emitTestSessionEvent,
  emitTestSessionEventNoWait,
  emitTestTranscriptEvent,
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

test("bounds a giant persisted tool payload before it enters the renderer", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("giant-historical-tool-payload-workspace");
  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    let window = await harness.firstWindow();
    await createNamedThread(window, "Bounded historical payload");
    const context = await selectedSessionContext(window);
    await harness.close();

    const transcriptKey = `${context.sessionRef.workspaceId}:${context.sessionRef.sessionId}`;
    const transcriptPath = join(userDataDir, "transcripts", `${encodeURIComponent(transcriptKey)}.json`);
    const hugeOutput = `payload-start\n${"x".repeat(22 * 1024 * 1024)}\npayload-end`;
    const persisted = {
      version: 1,
      transcript: [{
        kind: "tool",
        id: "giant-tool",
        callId: "giant-tool",
        toolName: "bash",
        status: "success",
        label: "Huge historical output",
        createdAt: "2026-07-30T00:00:00.000Z",
        input: { command: "generate-large-output" },
        output: { content: [{ type: "text", text: hugeOutput }] },
        outputText: hugeOutput,
      }],
    };
    await mkdir(join(userDataDir, "transcripts"), { recursive: true });
    await writeFile(transcriptPath, JSON.stringify(persisted), "utf8");

    harness = await launchDesktop(userDataDir, {
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    window = await harness.firstWindow();
    await expect(window.getByText("Huge historical output")).toBeVisible();

    const rendererSnapshot = await window.evaluate(async () => {
      const selected = await window.piApp?.getSelectedTranscript();
      const memory = (performance as Performance & {
        readonly memory?: { readonly usedJSHeapSize?: number };
      }).memory;
      return {
        serializedBytes: new TextEncoder().encode(JSON.stringify(selected)).byteLength,
        tool: selected?.transcript.find((item) => item.kind === "tool"),
        usedJSHeapSize: memory?.usedJSHeapSize ?? 0,
      };
    });

    expect(rendererSnapshot.serializedBytes).toBeLessThan(100_000);
    expect(rendererSnapshot.tool).toMatchObject({
      kind: "tool",
      payloadTruncated: true,
    });
    expect(rendererSnapshot.usedJSHeapSize).toBeLessThan(750 * 1024 * 1024);

    await window.locator(".timeline-tool__header").click();
    await expect(window.getByText("Large historical payload bounded")).toBeVisible();
    await expect(window.getByText(/stored task transcript remains unchanged/)).toBeVisible();

    expect((await stat(transcriptPath)).size).toBeGreaterThan(40 * 1024 * 1024);
    expect(await readFile(transcriptPath, "utf8")).toContain("payload-end");
  } finally {
    await harness.close().catch(() => undefined);
  }
});

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
    expect(diagnosticsBefore.statePatchChangedIpcCount).toBeGreaterThan(0);

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

    await expect
      .poll(
        async () =>
          (await getAppDiagnostics(harness)).transcriptEventIpcCount -
          diagnosticsBefore.transcriptEventIpcCount,
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0);

    const renderCountAfterStream = await surface.evaluate((node) =>
      Number((node as HTMLElement).dataset.renderCount ?? "0"),
    );
    const diagnosticsAfter = await getAppDiagnostics(harness);
    const selectedTranscriptPublishes =
      diagnosticsAfter.selectedTranscriptPublishCount - diagnosticsBefore.selectedTranscriptPublishCount;
    const selectedTranscriptIpcPublishes =
      diagnosticsAfter.selectedTranscriptChangedIpcCount - diagnosticsBefore.selectedTranscriptChangedIpcCount;
    const selectedTranscriptIpcBytes =
      diagnosticsAfter.selectedTranscriptChangedIpcBytes - diagnosticsBefore.selectedTranscriptChangedIpcBytes;
    const stateChangedIpcPublishes =
      diagnosticsAfter.stateChangedIpcCount - diagnosticsBefore.stateChangedIpcCount;
    const stateChangedIpcBytes =
      diagnosticsAfter.stateChangedIpcBytes - diagnosticsBefore.stateChangedIpcBytes;
    const transcriptEventIpcPublishes =
      diagnosticsAfter.transcriptEventIpcCount - diagnosticsBefore.transcriptEventIpcCount;
    const transcriptEventIpcBytes =
      diagnosticsAfter.transcriptEventIpcBytes - diagnosticsBefore.transcriptEventIpcBytes;

    // Hosted runners can split the same burst across a few more scheduler frames.
    // Keep the contract proportional: 80 deltas must coalesce to at most 12 renders.
    expect(renderCountAfterStream - renderCountBefore).toBeLessThanOrEqual(12);
    expect(diagnosticsAfter.statePatchChangedIpcBytes).toBeGreaterThan(0);
    expect(selectedTranscriptPublishes).toBe(0);
    expect(selectedTranscriptIpcPublishes).toBe(0);
    expect(selectedTranscriptIpcBytes).toBe(0);
    expect(diagnosticsAfter.selectedTranscriptChangedLastIpcBytes).toBe(0);
    expect(stateChangedIpcPublishes).toBe(0);
    expect(stateChangedIpcBytes).toBe(0);
    expect(transcriptEventIpcPublishes).toBeGreaterThan(0);
    expect(transcriptEventIpcBytes).toBeGreaterThan(0);
    expect(transcriptEventIpcBytes).toBeLessThan(256 * 1024);
    expect(diagnosticsAfter.transcriptEventLastIpcBytes).toBeGreaterThan(0);

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

test("bounds delayed timeline work during a rapid virtualized stream", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("chat-performance-bounded-timeline-work-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Bounded timeline scheduling session");
    await seedTranscriptMessages(harness, window, {
      count: 90,
      textFactory: (index) => `virtualized scheduling seed ${index} ${"wrapped ".repeat(8)}`,
    });
    const context = await selectedSessionContext(window);
    const runId = `bounded-scheduling-${Date.now()}`;

    await window.evaluate(() => {
      const target = window as Window & {
        __piTimelineTimerProbe?: {
          maxPendingTimeouts: number;
          pendingTimeouts: Set<number>;
        };
      };
      const originalSetTimeout = window.setTimeout.bind(window);
      const originalClearTimeout = window.clearTimeout.bind(window);
      const pendingTimeouts = new Set<number>();
      const probe = { maxPendingTimeouts: 0, pendingTimeouts };
      target.__piTimelineTimerProbe = probe;
      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        let timerId = 0;
        timerId = originalSetTimeout(() => {
          pendingTimeouts.delete(timerId);
          if (typeof handler === "function") {
            Reflect.apply(handler, window, args);
          }
        }, timeout);
        pendingTimeouts.add(timerId);
        probe.maxPendingTimeouts = Math.max(probe.maxPendingTimeouts, pendingTimeouts.size);
        return timerId;
      }) as typeof window.setTimeout;
      window.clearTimeout = ((timerId?: number) => {
        if (typeof timerId === "number") pendingTimeouts.delete(timerId);
        originalClearTimeout(timerId);
      }) as typeof window.clearTimeout;
    });

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
        preview: "bounded timeline scheduling",
        runningRunId: runId,
      },
    });
    await Promise.all(
      Array.from({ length: 240 }, (_, index) =>
        emitTestSessionEventNoWait(harness, assistantDeltaEvent(context, runId, `rapid-${index} `)),
      ),
    );
    await expect(window.getByTestId("transcript")).toContainText("rapid-239", { timeout: 15_000 });

    const scheduling = await window.evaluate(() => {
      const probe = (window as Window & {
        __piTimelineTimerProbe?: {
          maxPendingTimeouts: number;
          pendingTimeouts: Set<number>;
        };
      }).__piTimelineTimerProbe;
      return {
        maxPendingTimeouts: probe?.maxPendingTimeouts ?? 0,
        pendingTimeouts: probe?.pendingTimeouts.size ?? 0,
      };
    });
    expect(scheduling.maxPendingTimeouts).toBeLessThanOrEqual(16);
    expect(scheduling.pendingTimeouts).toBeLessThanOrEqual(12);

    const desktopLog = await readFile(join(userDataDir, "logs", "desktop.log"), "utf8").catch(() => "");
    expect(desktopLog).not.toContain("Maximum update depth exceeded");
    expect(desktopLog).not.toContain("ResizeObserver loop limit exceeded");
  } finally {
    await harness.close();
  }
});

test("resets the transcript after a delta sequence gap", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("chat-performance-gap-reset-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Gap reset session");
    const seeded = await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => "authoritative transcript row",
    });
    await expect(window.getByTestId("transcript")).toContainText("authoritative transcript row");
    await expect
      .poll(async () => (await getAppDiagnostics(harness)).transcriptEventIpcCount, { timeout: 5_000 })
      .toBeGreaterThan(0);

    const diagnosticsBefore = await getAppDiagnostics(harness);
    await emitTestTranscriptEvent(harness, {
      kind: "append",
      workspaceId: seeded.sessionRef.workspaceId,
      sessionId: seeded.sessionRef.sessionId,
      sequence: 99,
      items: [{
        kind: "message",
        id: "fault-injected-gap-message",
        role: "assistant",
        text: "bad sequence text should not render",
        createdAt: new Date().toISOString(),
      }],
    });

    await expect
      .poll(
        async () => (await getAppDiagnostics(harness)).transcriptEventIpcCount -
          diagnosticsBefore.transcriptEventIpcCount,
        { timeout: 5_000 },
      )
      .toBeGreaterThanOrEqual(2);
    await expect(window.getByTestId("transcript")).toContainText("authoritative transcript row");
    await expect(window.getByTestId("transcript")).not.toContainText("bad sequence text should not render");
    await expect
      .poll(async () =>
        window.evaluate(async () => {
          const transcript = await window.piApp?.getSelectedTranscript();
          return transcript?.transcript.some((item) =>
            item.kind === "message" && item.text.includes("bad sequence text should not render"),
          ) ?? false;
        }),
      )
      .toBe(false);
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
