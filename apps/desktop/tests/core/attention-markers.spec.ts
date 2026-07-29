import { expect, test } from "@playwright/test";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

test("attention markers navigate structured evidence and survive compaction and relaunch", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("attention-markers-workspace");
  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    let window = await harness.firstWindow();
    await createNamedThread(window, "Attention marker thread");
    await window.getByTestId("composer").fill("Change direction and run the verification set.");
    await window.getByTestId("composer").press("Enter");
    await expect(window.locator(".timeline-item--user")).toContainText("Change direction");
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByTestId("settings-surface").getByRole("button", { name: "Appearance", exact: true }).click();
    await window.getByLabel("Timeline compression").selectOption("compact");
    await window.getByRole("button", { name: "Back to app" }).click();

    const state = await getDesktopState(window);
    const sessionRef = { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
    for (let index = 0; index < 3; index += 1) {
      await emitTestSessionEvent(harness, testToolEvent(sessionRef, index, "toolStarted"));
      await emitTestSessionEvent(harness, testToolEvent(sessionRef, index, "toolFinished"));
    }
    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      timestamp: timestamp(4_000),
      toolName: "read",
      callId: "failed-read",
      input: { path: "missing.ts" },
    });
    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef,
      timestamp: timestamp(4_500),
      callId: "failed-read",
      success: false,
      output: "missing",
    });
    await emitTestSessionEvent(harness, {
      type: "runCompleted",
      sessionRef,
      timestamp: timestamp(5_000),
      runId: "attention-run",
      snapshot: {
        ref: sessionRef,
        workspace: { workspaceId: sessionRef.workspaceId, path: workspacePath, displayName: "Attention" },
        title: "Attention marker thread",
        status: "idle",
        updatedAt: timestamp(5_000),
        preview: "Complete",
      },
    });

    const nav = window.getByTestId("timeline-attention-nav");
    await expect(nav).toBeVisible();
    await expect(nav).toContainText("Direction");
    const countText = await nav.locator(".timeline-attention-nav__current span").textContent();
    const markerCount = Number(countText?.match(/of\s+(\d+)/)?.[1] ?? 0);
    expect(markerCount).toBeGreaterThanOrEqual(7);

    const group = window.getByTestId("timeline-semantic-group");
    await expect(group).toHaveCount(1);
    const groupRow = group.locator("xpath=ancestor::*[@data-timeline-row-id][1]");
    await expect(groupRow).toHaveAttribute("data-attention-types", /milestone/);

    await nav.getByRole("button", { name: "Next attention marker" }).click();
    await expect(nav).toContainText("Milestone");
    await expect(groupRow).toHaveClass(/timeline-attention-target/);
    await expect(groupRow).toHaveCSS("outline-style", "none");
    expect(await groupRow.evaluate((element) => getComputedStyle(element).boxShadow)).toContain("inset");

    await window.keyboard.press("Alt+ArrowDown");
    await expect(nav.locator(".timeline-attention-nav__current span")).toContainText("3 of");
    await window.keyboard.press("Alt+ArrowUp");
    await expect(nav.locator(".timeline-attention-nav__current span")).toContainText("2 of");

    await harness.close();
    harness = await launchDesktop(userDataDir, {
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    window = await harness.firstWindow();
    await expect(window.locator(".topbar__session")).toHaveText("Attention marker thread");
    const relaunchedNav = window.getByTestId("timeline-attention-nav");
    await expect(relaunchedNav).toBeVisible();
    await expect(relaunchedNav.locator(".timeline-attention-nav__current span")).toContainText(`of ${markerCount}`);
    await expect(window.getByTestId("timeline-semantic-group").locator("xpath=ancestor::*[@data-timeline-row-id][1]"))
      .toHaveAttribute("data-attention-types", /milestone/);
  } finally {
    await harness.close();
  }
});

function testToolEvent(
  sessionRef: { readonly workspaceId: string; readonly sessionId: string },
  index: number,
  type: "toolStarted" | "toolFinished",
): Extract<SessionDriverEvent, { type: "toolStarted" | "toolFinished" }> {
  if (type === "toolStarted") {
    return {
      type,
      sessionRef,
      timestamp: timestamp(index * 1_000),
      toolName: "bash",
      callId: `test-command-${index}`,
      input: { command: `pnpm test -- suite-${index}` },
    };
  }
  return {
    type,
    sessionRef,
    timestamp: timestamp(index * 1_000 + 500),
    callId: `test-command-${index}`,
    success: true,
    output: { exitCode: 0 },
  };
}

function timestamp(offsetMs: number): string {
  return new Date(Date.UTC(2026, 6, 24, 0, 0, 0, offsetMs)).toISOString();
}
