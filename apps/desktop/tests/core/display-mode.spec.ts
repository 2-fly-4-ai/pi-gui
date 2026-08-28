import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import {
  createNamedThread,
  emitTestSessionEvent,
  getAppDiagnostics,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedTranscriptMessages,
  selectSession,
  toggleTopbarPanel,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

function readComposerSurfaceStyles(surfaceElement: Element) {
  const surface = surfaceElement as HTMLElement;
  const textarea = surface.querySelector("textarea");
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error("Composer surface did not contain a textarea");
  }
  const surfaceStyles = window.getComputedStyle(surface);
  const textareaStyles = window.getComputedStyle(textarea);
  return {
    surface: {
      backgroundColor: surfaceStyles.backgroundColor,
      borderRadius: surfaceStyles.borderRadius,
      boxShadow: surfaceStyles.boxShadow,
      padding: surfaceStyles.padding,
    },
    textarea: {
      fontSize: textareaStyles.fontSize,
      lineHeight: textareaStyles.lineHeight,
      maxHeight: textareaStyles.maxHeight,
      minHeight: textareaStyles.minHeight,
    },
  };
}

async function expectVSCodePanelSettled(panel: Locator): Promise<void> {
  const webview = panel.locator(".display-mode-vscode__webview");
  const error = panel.locator(".display-mode-vscode__error");
  // The backend intentionally gives VS Code up to 45 seconds to start before
  // surfacing its recoverable error state. Leave enough time for that state to
  // cross IPC and commit in React instead of racing the same deadline.
  await expect(webview.or(error)).toHaveCount(1, { timeout: 55_000 });
  if (await error.count()) {
    await expect(error).toContainText("Could not start VS Code");
    await expect(error.locator("p")).not.toBeEmpty();
    return;
  }
  await expect(webview).toHaveAttribute("title", "VS Code");
  await expect.poll(() => webview.evaluate((element) => element.tagName)).toBe("WEBVIEW");
}

async function runDisplayTileAction(tile: Locator, actionName: string): Promise<void> {
  await tile.getByRole("button", { name: "Thread actions" }).click();
  const menu = tile.getByRole("menu", { name: "Thread actions" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: actionName, exact: true }).click();
}

test("keeps the chat alive when the isolated VS Code renderer stops", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("vscode-renderer-isolation-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "VS Code renderer isolation");
    await toggleTopbarPanel(window, "VS Code");

    const panel = window.getByTestId("thread-vscode-panel");
    await expect(panel).toBeVisible();
    await expectVSCodePanelSettled(panel);
    if (await panel.locator(".display-mode-vscode__error").count()) {
      await expect(window.getByTestId("composer")).toBeVisible();
      return;
    }

    const processIds = await harness.electronApp.evaluate(({ BrowserWindow, webContents }) => {
      const host = BrowserWindow.getAllWindows()[0]?.webContents;
      const guest = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
      return {
        host: host?.getOSProcessId(),
        guest: guest?.getOSProcessId(),
      };
    });
    expect(processIds.host).toBeTruthy();
    expect(processIds.guest).toBeTruthy();
    expect(processIds.guest).not.toBe(processIds.host);

    await harness.electronApp.evaluate(({ webContents }) => {
      const guest = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
      if (!guest) throw new Error("Expected an isolated VS Code webview");
      guest.forcefullyCrashRenderer();
    });

    await expect(panel.locator(".display-mode-vscode__error")).toContainText("The chat is still safe");
    await expect(window.getByTestId("composer")).toBeVisible();
    await expect(window.locator(".topbar__session")).toHaveText("VS Code renderer isolation");
    await panel.getByRole("button", { name: "Retry" }).click();
    await expectVSCodePanelSettled(panel);
  } finally {
    await harness.close();
  }
});

test("opens a Display Mode tile back into Threads with its transcript hydrated", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("display-mode-open-thread");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Display mode open thread");
    await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => "Display mode open thread transcript sentinel",
    });

    const nav = window.locator(".sidebar__nav");
    await nav.getByRole("button", { name: "Display Mode" }).click();
    await expect.poll(async () => window.evaluate(() => window.piApp?.getState().then((state) => state.activeView) ?? "missing")).toBe("display-mode");

    const tile = window.getByTestId("display-mode-thread-tile").filter({ hasText: "Display mode open thread" });
    await expect(tile).toContainText("Display mode open thread transcript sentinel");
    await expect(tile.locator(".display-mode-tile__actions")).toHaveCount(0);
    await runDisplayTileAction(tile, "Open thread");

    await expect.poll(async () => window.evaluate(() => window.piApp?.getState().then((state) => state.activeView) ?? "missing")).toBe("threads");
    await expect(window.locator(".topbar__session")).toHaveText("Display mode open thread");
    await expect(window.getByTestId("transcript")).toContainText("Display mode open thread transcript sentinel");
  } finally {
    await harness.close();
  }
});

test("loads Display Mode with clipped recent transcript rows", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("display-mode-clipped-transcript");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Display mode clipped transcript");
    await seedTranscriptMessages(harness, window, {
      count: 40,
      textFactory: (index) => `Display mode clipped transcript row ${index}`,
    });

    await window.locator(".sidebar__nav").getByRole("button", { name: "Display Mode" }).click();
    await expect.poll(async () => window.evaluate(() => window.piApp?.getState().then((state) => state.activeView) ?? "missing")).toBe("display-mode");

    await expect
      .poll(async () => window.evaluate(async () => {
        const app = window.piApp;
        const state = await app?.getState();
        const workspace = state?.workspaces.find((entry) =>
          entry.sessions.some((session) => session.title === "Display mode clipped transcript"));
        const session = workspace?.sessions.find((entry) => entry.title === "Display mode clipped transcript");
        if (!app || !workspace || !session) return -1;
        const response = await app.getDisplayModeThreadProjection({
          workspaceId: workspace.id,
          sessionId: session.id,
        });
        return response.kind === "projection" ? response.projection.excerptRows.length : -1;
      }))
      .toBeLessThanOrEqual(8);

    const tile = window.getByTestId("display-mode-thread-tile").filter({ hasText: "Display mode clipped transcript" });
    await expect(tile).toContainText("Display mode clipped transcript row 39");
    await expect(tile).not.toContainText("Display mode clipped transcript row 0");
  } finally {
    await harness.close();
  }
});

test("summarizes durable workflow runs when transcript lifecycle rows are absent", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("display-mode-durable-workflow");
  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    let window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Display mode durable workflow");

    const sessionRef = await window.evaluate(async () => {
      const state = await window.piApp?.getState();
      return {
        workspaceId: state?.selectedWorkspaceId ?? "",
        sessionId: state?.selectedSessionId ?? "",
      };
    });
    expect(sessionRef.workspaceId).not.toBe("");
    expect(sessionRef.sessionId).not.toBe("");

    const runsDir = join(userDataDir, "subagent-runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(
      join(runsDir, `${encodeURIComponent(sessionRef.workspaceId)}.json`),
      `${JSON.stringify([
        {
          id: "display-mode-durable-workflow-run",
          workflowRunId: "display-mode-durable-workflow-run",
          workflowId: "scout-then-plan",
          title: "Scout then plan",
          workspaceId: sessionRef.workspaceId,
          target: sessionRef,
          status: "running",
          roles: ["scout", "planner"],
          artifacts: ["context.md", "plan.md"],
          submittedAt: new Date().toISOString(),
        },
      ], null, 2)}\n`,
      "utf8",
    );
    await harness.close();
    harness = await launchDesktop(userDataDir, {
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    window = await harness.firstWindow();
    const runningTimestamp = new Date().toISOString();
    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef,
      timestamp: runningTimestamp,
      runId: "display-mode-durable-parent-run",
      snapshot: {
        ref: sessionRef,
        workspace: {
          workspaceId: sessionRef.workspaceId,
          path: workspacePath,
          displayName: basename(workspacePath),
        },
        title: "Display mode durable workflow",
        status: "running",
        updatedAt: runningTimestamp,
        preview: "Workflow running",
        runningRunId: "display-mode-durable-parent-run",
      },
    });

    await window.locator(".sidebar__nav").getByRole("button", { name: "Display Mode" }).click();
    await expect.poll(async () => window.evaluate(() => window.piApp?.getState().then((state) => state.activeView) ?? "missing")).toBe("display-mode");

    await expect
      .poll(async () => window.evaluate(async () => {
        const app = window.piApp;
        const state = await app?.getState();
        const workspace = state?.workspaces.find((entry) =>
          entry.sessions.some((session) => session.title === "Display mode durable workflow"));
        const session = workspace?.sessions.find((entry) => entry.title === "Display mode durable workflow");
        if (!app || !workspace || !session) return "";
        const response = await app.getDisplayModeThreadProjection({
          workspaceId: workspace.id,
          sessionId: session.id,
        });
        return response.kind === "projection" ? response.projection.subagentActivity?.label ?? "" : "";
      }))
      .toBe("1 Workflow needs attention · scout, planner");

    const tile = window.getByTestId("display-mode-thread-tile").filter({ hasText: "Display mode durable workflow" });
    await expect(tile).toContainText("1 Workflow needs attention");
  } finally {
    await harness.close();
  }
});

test("loads Display Mode transcripts from persisted history after restart", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("display-mode-persisted-transcript");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Display mode persisted transcript");
    await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => "Persisted Display Mode transcript sentinel",
    });
    await createNamedThread(window, "Display mode selected after persisted target");
  } finally {
    await harness.close();
  }

  const restarted = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await restarted.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    const baseline = await getAppDiagnostics(restarted);
    await window.locator(".sidebar__nav").getByRole("button", { name: "Display Mode" }).click();
    await expect.poll(async () => window.evaluate(() => window.piApp?.getState().then((state) => state.activeView) ?? "missing")).toBe("display-mode");

    const tile = window.getByTestId("display-mode-thread-tile").filter({ hasText: "Display mode persisted transcript" });
    await expect(tile).toContainText("Persisted Display Mode transcript sentinel");
    const diagnostics = await getAppDiagnostics(restarted);
    expect(diagnostics.displayModeProjectionSidecarReads).toBeGreaterThan(baseline.displayModeProjectionSidecarReads);
    expect(
      diagnostics.displayModeLegacyTranscriptReads - baseline.displayModeLegacyTranscriptReads,
    ).toBeLessThanOrEqual(1);
    expect(diagnostics.fullTranscriptCacheEntries).toBe(baseline.fullTranscriptCacheEntries);
  } finally {
    await restarted.close();
  }
});

test("scales markdown headings inside Display Mode tiles", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("display-mode-markdown-heading");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Display mode markdown heading");
    await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => "## Display Tile Heading\n\nBody text under the heading.",
    });

    await window.locator(".sidebar__nav").getByRole("button", { name: "Display Mode" }).click();
    await expect.poll(async () => window.evaluate(() => window.piApp?.getState().then((state) => state.activeView) ?? "missing")).toBe("display-mode");

    const tile = window.getByTestId("display-mode-thread-tile").filter({ hasText: "Display mode markdown heading" });
    const heading = tile.locator(".display-mode-tile__transcript h2", { hasText: "Display Tile Heading" });
    await expect(heading).toBeVisible();
    await expect(tile.locator(".display-mode-tile__transcript")).toContainText("Body text under the heading.");

    const headingStyle = await heading.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
        marginBottom: Number.parseFloat(style.marginBottom),
        marginTop: Number.parseFloat(style.marginTop),
      };
    });

    expect(headingStyle.fontSize).toBeLessThanOrEqual(14);
    expect(headingStyle.lineHeight).toBeLessThanOrEqual(20);
    expect(headingStyle.marginTop).toBe(0);
    expect(headingStyle.marginBottom).toBe(0);
  } finally {
    await harness.close();
  }
});

test("summarizes running subagents on Display Mode tiles", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("display-mode-subagent-activity");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Display mode subagent activity");
    await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => "Parent thread work in progress.",
    });

    const sessionRef = await window.evaluate(async () => {
      const state = await window.piApp?.getState();
      if (!state?.selectedWorkspaceId || !state.selectedSessionId) {
        throw new Error("No selected session available");
      }
      return {
        workspaceId: state.selectedWorkspaceId,
        sessionId: state.selectedSessionId,
      };
    });

    await emitTestSessionEvent(harness, {
      type: "subagentRunUpdated",
      sessionRef,
      timestamp: new Date().toISOString(),
      subagentRunId: "display-mode-agent-1",
      parentSession: sessionRef,
      toolCallId: "display-mode-agent-1",
      status: "started",
      role: "reviewer",
      description: "Review current diff",
    } satisfies Extract<SessionDriverEvent, { type: "subagentRunUpdated" }>);

    await seedTranscriptMessages(harness, window, {
      count: 14,
      textFactory: (index) => `Later parent update ${index}`,
    });

    await window.locator(".sidebar__nav").getByRole("button", { name: "Display Mode" }).click();
    await expect.poll(async () => window.evaluate(() => window.piApp?.getState().then((state) => state.activeView) ?? "missing")).toBe("display-mode");

    const tile = window.getByTestId("display-mode-thread-tile").filter({ hasText: "Display mode subagent activity" });
    await expect(tile.locator(".display-mode-tile__transcript")).toContainText("Later parent update 13");
    await expect(tile.locator(".display-mode-tile__transcript")).not.toContainText("Started reviewer");
    const activity = tile.getByTestId("display-mode-subagent-activity");
    await expect(activity).toBeVisible();
    await expect(activity).toHaveText("1 Agent running · reviewer");
    await expect(tile.locator(".display-mode-tile__head").getByTestId("display-mode-subagent-activity")).toHaveCount(0);
    await expect
      .poll(() => activity.evaluate((element) =>
        element.nextElementSibling?.classList.contains("display-mode-tile__reply") ?? false))
      .toBe(true);
  } finally {
    await harness.close();
  }
});

test("uses the thread composer input in Display Mode tiles", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("display-mode-composer-parity");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Display mode composer parity");

    await window.getByTestId("composer").evaluate((textarea) => textarea.blur());
    await window.waitForTimeout(200);
    const threadComposerStyles = await window.getByTestId("composer-surface").evaluate(readComposerSurfaceStyles);

    await window.locator(".sidebar__nav").getByRole("button", { name: "Display Mode" }).click();
    await expect.poll(async () => window.evaluate(() => window.piApp?.getState().then((state) => state.activeView) ?? "missing")).toBe("display-mode");

    const tile = window.getByTestId("display-mode-thread-tile").filter({ hasText: "Display mode composer parity" });
    await expect(tile.locator(".display-mode-tile__reply > .conversation--composer")).toHaveCount(1);
    await expect(tile).not.toContainText("No messages yet");
    await expect(tile).toContainText("Transcript not loaded yet");
    const displayComposerStyles = await tile.locator(".display-mode-tile__reply .composer__surface").evaluate(readComposerSurfaceStyles);
    const replySurfaceDelta = await tile.evaluate((tileElement) => {
      const reply = tileElement.querySelector<HTMLElement>(".display-mode-tile__reply");
      const surface = tileElement.querySelector<HTMLElement>(".display-mode-tile__reply .composer__surface");
      if (!reply || !surface) {
        return { height: Number.POSITIVE_INFINITY, width: Number.POSITIVE_INFINITY };
      }
      const replyBox = reply.getBoundingClientRect();
      const surfaceBox = surface.getBoundingClientRect();
      return {
        height: Math.abs(replyBox.height - surfaceBox.height),
        width: Math.abs(replyBox.width - surfaceBox.width),
      };
    });
    const replyOffsetRatio = await tile.evaluate((tileElement) => {
      const reply = tileElement.querySelector<HTMLElement>(".display-mode-tile__reply");
      if (!reply) {
        return 0;
      }
      const tileBox = tileElement.getBoundingClientRect();
      const replyBox = reply.getBoundingClientRect();
      return (replyBox.top - tileBox.top) / tileBox.height;
    });

    expect(displayComposerStyles.textarea).toEqual(threadComposerStyles.textarea);
    expect(displayComposerStyles.surface).toMatchObject({
      backgroundColor: threadComposerStyles.surface.backgroundColor,
      boxShadow: threadComposerStyles.surface.boxShadow,
      padding: threadComposerStyles.surface.padding,
    });
    expect(displayComposerStyles.surface.borderRadius).toMatch(/^0px 0px /);
    expect(replySurfaceDelta.width).toBeLessThanOrEqual(2);
    expect(replySurfaceDelta.height).toBeLessThanOrEqual(2);
    expect(replyOffsetRatio).toBeGreaterThan(0.55);

    const composerBar = tile.locator(".composer-control-bar");
    await expect(composerBar).toBeVisible();
    const modelButton = composerBar.locator(".model-selector__badge").first();
    await modelButton.click();
    const modelMenu = composerBar.locator(".model-selector__dropdown--models");
    await expect(modelMenu).toBeVisible();
    await expect(modelMenu.getByPlaceholder("Search models...")).toBeVisible();
    await window.keyboard.press("Escape");

    await expect(tile.getByTestId("composer-more-controls")).toBeVisible();
    await tile.getByTestId("composer-more-controls").click();
    const composerMenu = tile.getByTestId("composer-control-menu");
    await expect(composerMenu).toContainText("Reasoning");
    await expect(composerMenu).toContainText("Skills");
    await expect(composerMenu).toContainText("Access");
    await expect(composerMenu).toContainText("Thinking");
    await expect(composerMenu).toContainText("Context");
    await expect(composerMenu).toContainText("Attach files");
    await composerMenu.getByRole("button", { name: /^Skills profile:/ }).click();
    const skillProfileMenu = composerMenu.locator(".skill-profile-selector__popover");
    await expect(skillProfileMenu).toBeVisible();
    await expect(skillProfileMenu.getByRole("button", { name: "Manage profiles…" })).toBeVisible();
    await window.keyboard.press("Escape");

    const attachmentPath = join(workspacePath, "display-mode-note.txt");
    await writeFile(attachmentPath, "Display Mode attachment parity");
    await tile.locator('input[type="file"]').setInputFiles(attachmentPath);
    await expect(tile.locator(".composer-attachment")).toContainText("display-mode-note.txt");
    await tile.locator("textarea").fill("Review the attached Display Mode note.");
    await tile.getByRole("button", { name: "Send reply" }).click();
    await expect(tile.locator(".composer-attachment")).toHaveCount(0);
    await expect.poll(async () => window.evaluate(async () => {
      const app = window.piApp;
      const state = await app?.getState();
      const workspace = state?.workspaces.find((entry) =>
        entry.sessions.some((session) => session.title === "Display mode composer parity"));
      const session = workspace?.sessions.find((entry) => entry.title === "Display mode composer parity");
      if (!app || !workspace || !session) return false;
      const response = await app.getDisplayModeThreadProjection({
        workspaceId: workspace.id,
        sessionId: session.id,
      });
      return response.kind === "projection" &&
        JSON.stringify(response.projection.excerptRows).includes("display-mode-note.txt");
    })).toBe(true);

    await window.setViewportSize({ width: 860, height: 760 });
    await window.getByLabel("Grid columns").selectOption("4");
    await expect.poll(async () => window.evaluate(() => {
      const main = document.querySelector<HTMLElement>(".display-mode__main");
      const grid = document.querySelector<HTMLElement>(".display-mode__grid");
      if (!main || !grid) return false;
      const columnCount = window.getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
      return columnCount <= 2 && grid.scrollWidth <= grid.clientWidth + 1 && main.scrollWidth <= main.clientWidth + 1;
    })).toBe(true);
  } finally {
    await harness.close();
  }
});

test("opens Display Mode from the sidebar and renders thread command-center tiles", async () => {
  const userDataDir = await makeUserDataDir();
  const staleMachineSettingsDir = join(userDataDir, "vscode-serve-web", "user-data", "Machine");
  await mkdir(staleMachineSettingsDir, { recursive: true });
  await writeFile(join(staleMachineSettingsDir, "settings.json"), JSON.stringify({
    "window.autoDetectColorScheme": true,
    "workbench.colorTheme": "Default Dark Modern",
    "workbench.preferredDarkColorTheme": "Default Dark Modern",
    "workbench.preferredLightColorTheme": "Default Dark Modern",
  }, null, 2));
  const staleWorkspaceSettingsDir = join(userDataDir, "vscode-serve-web", "Users", "example", "project", "User");
  await mkdir(staleWorkspaceSettingsDir, { recursive: true });
  await writeFile(join(staleWorkspaceSettingsDir, "settings.json"), JSON.stringify({
    "window.autoDetectColorScheme": true,
    "workbench.colorTheme": "Default Dark Modern",
    "workbench.preferredDarkColorTheme": "Default Dark Modern",
    "workbench.preferredLightColorTheme": "Default Dark Modern",
  }, null, 2));
  const workspacePath = await makeWorkspace("display-mode-workspace");
  const tmpDir = dirname(workspacePath);
  await writeFile(join(workspacePath, "README.md"), "first workspace readme");
  const secondWorkspacePath = join(tmpDir, "second-workspace");
  await mkdir(secondWorkspacePath, { recursive: true });
  await writeFile(join(secondWorkspacePath, "README.md"), "second workspace readme");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    await waitForWorkspaceByPath(window, workspacePath);
    await window.evaluate((workspacePath) => window.piApp?.addWorkspacePath(workspacePath), secondWorkspacePath);
    await waitForWorkspaceByPath(window, secondWorkspacePath);
    await window.evaluate(async ({ firstPath, secondPath, firstTitle, secondTitle }) => {
      const app = window.piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      const state = await app.getState();
      const firstWorkspace = state.workspaces.find((entry) => entry.path === firstPath);
      const secondWorkspace = state.workspaces.find((entry) => entry.path === secondPath);
      if (!firstWorkspace) {
        throw new Error(`Workspace not found: ${firstPath}`);
      }
      if (!secondWorkspace) {
        throw new Error(`Workspace not found: ${secondPath}`);
      }
      await app.createSession({ workspaceId: secondWorkspace.id, title: secondTitle });
      await app.createSession({ workspaceId: firstWorkspace.id, title: firstTitle });
    }, {
      firstPath: workspacePath,
      secondPath: secondWorkspacePath,
      firstTitle: "Display mode seed thread",
      secondTitle: "Second workspace seed thread",
    });
    await expect.poll(async () => {
      return window.evaluate(({ targetPath, title }) => window.piApp?.getState().then((state) => {
        const workspace = state.workspaces.find((entry) => entry.path === targetPath);
        return workspace?.sessions.some((session) => session.title === title) ?? false;
      }) ?? false, { targetPath: workspacePath, title: "Display mode seed thread" });
    }).toBe(true);
    const seeded = await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => "Display mode assistant tile transcript",
    });
    const toolTimestamp = new Date().toISOString();
    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef: seeded.sessionRef,
      timestamp: toolTimestamp,
      toolName: "Read",
      callId: "display-mode-read-1",
      input: { path: "README.md" },
    } satisfies Extract<SessionDriverEvent, { type: "toolStarted" }>);
    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef: seeded.sessionRef,
      timestamp: toolTimestamp,
      callId: "display-mode-read-1",
      success: true,
      output: "README contents visible in display tile",
    } satisfies Extract<SessionDriverEvent, { type: "toolFinished" }>);

    await toggleTopbarPanel(window, "VS Code");
    const threadVsCodePanel = window.getByTestId("thread-vscode-panel");
    await expect(threadVsCodePanel).toBeVisible();
    await expect(threadVsCodePanel.getByRole("button", { name: "Hard close" })).toHaveCount(0);
    await expect(threadVsCodePanel).toHaveAttribute("data-vscode-folder-path", workspacePath);
    await expectVSCodePanelSettled(threadVsCodePanel);

    await selectSession(window, "Second workspace seed thread");
    await expect(threadVsCodePanel).toHaveCount(0);
    await toggleTopbarPanel(window, "VS Code");
    await expect(threadVsCodePanel).toBeVisible();
    await expect(threadVsCodePanel).toHaveAttribute("data-vscode-folder-path", secondWorkspacePath);
    await expectVSCodePanelSettled(threadVsCodePanel);

    await selectSession(window, "Display mode seed thread");
    await expect(threadVsCodePanel).toBeVisible();
    await expect(threadVsCodePanel).toHaveAttribute("data-vscode-folder-path", workspacePath);
    await expectVSCodePanelSettled(threadVsCodePanel);
    await toggleTopbarPanel(window, "VS Code");
    await expect(window.getByTestId("thread-vscode-panel")).toHaveCount(0);
    await toggleTopbarPanel(window, "VS Code");
    await expect(window.getByTestId("thread-vscode-panel")).toBeVisible();
    await toggleTopbarPanel(window, "VS Code");
    await expect(window.getByTestId("thread-vscode-panel")).toHaveCount(0);

    await selectSession(window, "Second workspace seed thread");

    const nav = window.locator(".sidebar__nav");
    await expect(nav.getByRole("button", { name: "Threads" })).toBeVisible();
    await nav.getByRole("button", { name: "Display Mode" }).click();

    await expect.poll(async () => window.evaluate(() => window.piApp?.getState().then((state) => state.activeView) ?? "missing")).toBe("display-mode");
    await expect(window.getByTestId("display-mode-surface")).toBeVisible();
    await expect(window.getByRole("heading", { name: "Command center" })).toBeVisible();
    await expect(window.locator(".display-mode-drawer")).toHaveAttribute("aria-hidden", "true");
    await window.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(window.locator(".display-mode-drawer")).toHaveAttribute("aria-hidden", "false");
    await expect(window.locator(".display-mode-drawer")).toContainText("Preview");
    await expect(window.locator(".display-mode-preview iframe")).toHaveCount(0);
    await expect(window.locator(".display-mode-drawer__meta").first()).toContainText("Second workspace seed thread");
    await expect(window.getByTestId("display-mode-thread-tile").first()).toContainText(basename(workspacePath));
    await expect(window.getByTestId("display-mode-thread-tile").first()).toContainText("Display mode seed thread");
    const firstTile = window.getByTestId("display-mode-thread-tile").first();
    await expect(firstTile).toContainText("Display mode assistant tile transcript");
    const displayToolHeader = firstTile.locator(".timeline-tool__header").first();
    await expect(displayToolHeader).toHaveAttribute("aria-expanded", "false");
    await displayToolHeader.click();
    await expect(displayToolHeader).toHaveAttribute("aria-expanded", "true");
    await expect(firstTile.locator(".timeline-tool__pre")).toContainText("README contents visible in display tile");
    await displayToolHeader.click();
    await expect(displayToolHeader).toHaveAttribute("aria-expanded", "false");
    await expect(window.getByPlaceholder("Reply to Display mode seed thread…")).toBeVisible();

    const sidebarToggle = window.getByTestId("sidebar-toggle");
    await sidebarToggle.click();
    await expect.poll(async () => window.evaluate(() => window.piApp?.getState().then((state) => state.sidebarCollapsed) ?? false)).toBe(true);
    await expect(window.locator(".sidebar")).toHaveCount(0);
    await expect(sidebarToggle).toBeVisible();
    await sidebarToggle.click();
    await expect.poll(async () => window.evaluate(() => window.piApp?.getState().then((state) => state.sidebarCollapsed) ?? true)).toBe(false);
    await expect(window.locator(".sidebar")).toBeVisible();

    await firstTile.locator("textarea").fill("/");
    await expect(firstTile.getByTestId("slash-menu")).toContainText("Host Actions");
    await expect.poll(async () => firstTile.evaluate((tile) => {
      const menu = tile.querySelector<HTMLElement>("[data-testid='slash-menu']");
      const reply = tile.querySelector<HTMLElement>(".display-mode-tile__reply");
      if (!menu || !reply) return false;
      const tileOverflow = window.getComputedStyle(tile).overflow;
      const replyZIndex = Number(window.getComputedStyle(reply).zIndex);
      return tileOverflow === "visible" && replyZIndex > 0;
    })).toBe(true);
    await firstTile.locator("textarea").fill("/reload");
    await firstTile.getByRole("button", { name: "Send reply" }).click();
    await expect(firstTile).toContainText("Reloaded session resources");
    await expect(firstTile).not.toContainText("You need to type");
    await firstTile.locator("textarea").fill("");

    await runDisplayTileAction(window.getByTestId("display-mode-thread-tile").first(), "Terminal");
    await expect(window.locator(".display-mode-tile__terminal").first()).toBeVisible();
    await expect(window.locator(".terminal-stack")).toHaveCount(0);

    await window.getByLabel("Grid columns").selectOption("auto");
    await expect.poll(async () => window.evaluate(() => {
      const grid = document.querySelector<HTMLElement>(".display-mode__grid");
      return grid ? window.getComputedStyle(grid).gridTemplateColumns : "";
    })).toContain("px");

    await runDisplayTileAction(window.getByTestId("display-mode-thread-tile").first(), "VS Code");
    await expect(window.locator(".display-mode-vscode")).toBeVisible();
    const displayVsCodePanel = window.getByTestId("display-mode-vscode-panel");
    await expect(displayVsCodePanel).toHaveAttribute("data-vscode-folder-path", workspacePath);
    await expectVSCodePanelSettled(displayVsCodePanel);

    const secondWorkspaceTile = window.getByTestId("display-mode-thread-tile").filter({ hasText: "Second workspace seed thread" });
    await runDisplayTileAction(secondWorkspaceTile, "Pin preview");
    await expect(window.locator(".display-mode-drawer__meta").first()).toContainText("Second workspace seed thread");
    await expect(displayVsCodePanel).toHaveAttribute("data-vscode-folder-path", secondWorkspacePath);
    await expectVSCodePanelSettled(displayVsCodePanel);
    const displayVsCodeRuntimeAvailable = (await displayVsCodePanel.locator(".display-mode-vscode__webview").count()) > 0;
    if (displayVsCodeRuntimeAvailable) {
      await expect.poll(async () => window.evaluate(() => {
        const surface = document.querySelector<HTMLElement>(".display-mode");
        const panel = document.querySelector<HTMLElement>(".display-mode-vscode");
        const webview = document.querySelector<HTMLElement>(".display-mode-vscode__webview");
        if (!surface || !panel || !webview) return 0;
        const surfaceHeight = surface.getBoundingClientRect().height;
        const panelHeight = panel.getBoundingClientRect().height;
        const webviewHeight = webview.getBoundingClientRect().height;
        return Math.abs(surfaceHeight - panelHeight) <= 2 && Math.abs(panelHeight - webviewHeight) <= 2 && webviewHeight > 500
          ? webviewHeight
          : 0;
      })).toBeGreaterThan(500);
    }

    const displayPanelBeforeResize = await displayVsCodePanel.boundingBox();
    const displayResizeHandle = await window.locator(".display-mode-vscode__resize").boundingBox();
    expect(displayPanelBeforeResize).not.toBeNull();
    expect(displayResizeHandle).not.toBeNull();
    await window.mouse.move(displayResizeHandle!.x + displayResizeHandle!.width / 2, displayResizeHandle!.y + displayResizeHandle!.height / 2);
    await window.mouse.down();
    await window.mouse.move(displayResizeHandle!.x - 220, displayResizeHandle!.y + displayResizeHandle!.height / 2, { steps: 6 });
    await window.mouse.up();
    await expect.poll(async () => (await displayVsCodePanel.boundingBox())?.width ?? 0).toBeGreaterThan(
      (displayPanelBeforeResize?.width ?? 0) + 100,
    );
    const displayPanelWidth = (await displayVsCodePanel.boundingBox())?.width ?? 0;

    await nav.getByRole("button", { name: "Threads" }).click();
    await expect.poll(async () => window.evaluate(() => window.piApp?.getState().then((state) => state.activeView) ?? "missing")).toBe("threads");
    const reopenedThreadPanel = window.getByTestId("thread-vscode-panel");
    await expect(reopenedThreadPanel).toBeVisible();
    await expect.poll(async () => {
      const box = await reopenedThreadPanel.boundingBox();
      return box ? Math.abs(box.width - displayPanelWidth) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(4);
    if (displayVsCodeRuntimeAvailable) {
      const settings = JSON.parse(await readFile(join(userDataDir, "vscode-serve-web", "user-data", "User", "settings.json"), "utf8")) as Record<string, unknown>;
      const machineSettings = JSON.parse(await readFile(join(userDataDir, "vscode-serve-web", "user-data", "Machine", "settings.json"), "utf8")) as Record<string, unknown>;
      const workspaceSettings = JSON.parse(await readFile(join(staleWorkspaceSettingsDir, "settings.json"), "utf8")) as Record<string, unknown>;
      expect(settings["security.workspace.trust.enabled"]).toBe(false);
      expect(settings["window.autoDetectColorScheme"]).toBe(false);
      expect(settings["workbench.colorTheme"]).toBe("Dark Modern");
      expect(settings["workbench.preferredDarkColorTheme"]).toBe("Dark Modern");
      expect(settings["workbench.preferredLightColorTheme"]).toBe("Dark Modern");
      expect(machineSettings["window.autoDetectColorScheme"]).toBe(false);
      expect(machineSettings["workbench.colorTheme"]).toBe("Dark Modern");
      expect(machineSettings["workbench.preferredDarkColorTheme"]).toBe("Dark Modern");
      expect(machineSettings["workbench.preferredLightColorTheme"]).toBe("Dark Modern");
      expect(workspaceSettings["window.autoDetectColorScheme"]).toBe(false);
      expect(workspaceSettings["workbench.colorTheme"]).toBe("Dark Modern");
      expect(workspaceSettings["workbench.preferredDarkColorTheme"]).toBe("Dark Modern");
      expect(workspaceSettings["workbench.preferredLightColorTheme"]).toBe("Dark Modern");
    }
  } finally {
    await harness.close();
  }
});
