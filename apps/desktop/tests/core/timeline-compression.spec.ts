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

test("groups repetitive timeline rows, expands raw evidence, and persists the display preference", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-compression-workspace");
  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    let window = await harness.firstWindow();
    await createNamedThread(window, "Timeline compression");
    const state = await getDesktopState(window);
    const sessionRef = { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };

    for (let index = 0; index < 30; index += 1) {
      await emitTestSessionEvent(harness, toolEvent(sessionRef, index, "toolStarted"));
      await emitTestSessionEvent(harness, toolEvent(sessionRef, index, "toolFinished"));
    }

    const group = window.getByTestId("timeline-semantic-group");
    await expect(group).toHaveCount(1);
    await expect(group).toContainText("Read 30 items");
    await expect(group).toContainText("Includes Read file-1.ts");
    const stableGroupId = await group.evaluate((element) => element.closest("[data-timeline-row-id]")?.getAttribute("data-timeline-row-id"));
    expect(stableGroupId).toMatch(/^semantic-group:/);

    await group.locator(".timeline-semantic-group__header").click();
    await expect(group.getByTestId("timeline-semantic-group-items").locator(".timeline-tool")).toHaveCount(30);
    await expect(group).toContainText("Read file-29.ts");

    await window.keyboard.press("Meta+f");
    await expect(window.getByPlaceholder("Search thread...")).toBeVisible();
    await expect(window.getByTestId("timeline-semantic-group")).toHaveCount(0);
    await expect(window.locator(".timeline-tool")).toHaveCount(30);
    await window.getByPlaceholder("Search thread...").fill("file-29.ts");
    await expect(window.locator("mark.thread-find-active")).toContainText("file-29.ts");
    await window.keyboard.press("Escape");

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByTestId("settings-surface").getByRole("button", { name: "Appearance", exact: true }).click();
    const compressionSelect = window.getByLabel("Timeline compression");
    await expect(compressionSelect.locator("option")).toHaveText(["Automatic", "Compact", "Fully expanded"]);
    await compressionSelect.selectOption("expanded");
    await window.getByRole("button", { name: "Back to app" }).click();

    await expect(window.getByTestId("timeline-semantic-group")).toHaveCount(0);
    await expect(window.locator(".timeline-tool")).toHaveCount(30);

    await harness.close();
    harness = await launchDesktop(userDataDir, {
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    window = await harness.firstWindow();
    await expect(window.locator(".topbar__session")).toHaveText("Timeline compression");
    await expect(window.getByTestId("timeline-semantic-group")).toHaveCount(0);
    await expect(window.locator(".timeline-tool")).toHaveCount(30);
  } finally {
    await harness.close();
  }
});

function toolEvent(
  sessionRef: { readonly workspaceId: string; readonly sessionId: string },
  index: number,
  type: "toolStarted" | "toolFinished",
): Extract<SessionDriverEvent, { type: "toolStarted" | "toolFinished" }> {
  const timestamp = new Date(Date.UTC(2026, 6, 24, 0, 0, 0, index * 100)).toISOString();
  if (type === "toolStarted") {
    return {
      type,
      sessionRef,
      timestamp,
      toolName: "read",
      callId: `compressed-read-${index}`,
      input: { path: `file-${index}.ts` },
    };
  }
  return {
    type,
    sessionRef,
    timestamp,
    callId: `compressed-read-${index}`,
    success: true,
    output: `contents-${index}`,
  };
}
