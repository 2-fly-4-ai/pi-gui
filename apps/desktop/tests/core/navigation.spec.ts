import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  desktopShortcut,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSession,
  seedTranscriptMessages,
  streamAssistantDeltas,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("persists workspace, selected session, and draft across app restart", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("codex-style-folder");
  const draft = "Now summarize the project title in one sentence.";

  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await firstRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    await createNamedThread(window, "Persistence session");

    const composer = window.getByTestId("composer");
    await composer.fill(draft);
    await expect(composer).toHaveValue(draft);
    await expect.poll(async () => (await getDesktopState(window)).composerDraft).toBe(draft);
  } finally {
    await firstRun.close();
  }

  const secondRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await secondRun.firstWindow();
    const persistedWorkspace = await waitForWorkspaceByPath(window, workspacePath);
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return {
          selectedWorkspaceId: state.selectedWorkspaceId,
          selectedSessionId: state.selectedSessionId,
          hasPersistenceSession: state.workspaces.some((workspace) =>
            workspace.sessions.some((session) => session.title === "Persistence session"),
          ),
        };
      }, { timeout: 15_000 })
      .toMatchObject({
        selectedWorkspaceId: persistedWorkspace.id,
        hasPersistenceSession: true,
      });
    await expect(window.getByTestId("workspace-list")).toContainText(basename(workspacePath));
    await expect(window.locator(".session-row--active")).toContainText("Persistence session");
    await expect(window.getByTestId("composer")).toHaveValue(draft);

    const state = await getDesktopState(window);
    const selectedWorkspace = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
    expect(selectedWorkspace?.path).toBeTruthy();
    expect(state.selectedSessionId).not.toBe("");
    expect(state.workspaces.some((workspace) => workspace.path === selectedWorkspace?.path)).toBe(true);
    expect(state.workspaces.some((workspace) => workspace.sessions.some((session) => session.title === "Persistence session"))).toBe(
      true,
    );
  } finally {
    await secondRun.close();
  }
});

test("navigates across folders and sessions through the sidebar", async () => {
  const userDataDir = await makeUserDataDir();
  const alphaPath = await makeWorkspace("alpha-workspace");
  const betaPath = await makeWorkspace("beta-workspace");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [alphaPath, betaPath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, alphaPath);
    await waitForWorkspaceByPath(window, betaPath);

    await createNamedThread(window, "Alpha session one", { workspaceName: basename(alphaPath) });
    await expect(window.locator(".session-row", { hasText: "Alpha session one" })).toHaveAttribute(
      "data-sidebar-indicator",
      "none",
    );

    await createNamedThread(window, "Alpha session two", { workspaceName: basename(alphaPath) });
    await createNamedThread(window, "Beta session one", { workspaceName: basename(betaPath) });

    await expect(window.locator(".topbar__session")).toHaveText("Beta session one");
    await expect(window.locator(".session-row", { hasText: "Alpha session two" })).toHaveAttribute(
      "data-sidebar-indicator",
      "none",
    );

    await expect(window.getByTestId("workspace-list")).toContainText(basename(alphaPath));
    await expect(window.getByTestId("workspace-list")).toContainText(basename(betaPath));

    await selectSession(window, "Alpha session one");
    await selectSession(window, "Beta session one");

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return {
          alphaSessions: state.workspaces.find((workspace) => workspace.path === alphaPath)?.sessions.length ?? 0,
          betaSessions: state.workspaces.find((workspace) => workspace.path === betaPath)?.sessions.length ?? 0,
        };
      })
      .toEqual({
        alphaSessions: 2,
        betaSessions: 1,
      });

    const state = await getDesktopState(window);
    const selectedWorkspace = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
    expect(selectedWorkspace?.path).toBeTruthy();
    expect(state.selectedSessionId).not.toBe("");
  } finally {
    await harness.close();
  }
});

test("renders markdown session previews as plain text in the sidebar", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("sidebar-preview-markdown-workspace");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Markdown preview session");

    await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => "## Implementation Plan\n\n- [ ] Inspect `src/sidebar.tsx`\n- Use [docs](https://example.com)",
    });

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces.flatMap((workspace) => workspace.sessions).find((session) => session.title === "Markdown preview session")
          ?.preview;
      })
      .toBe("Implementation Plan Inspect src/sidebar.tsx Use docs");

    const preview = window.locator(".session-row", { hasText: "Markdown preview session" }).locator(".session-row__preview");
    await expect(preview).toHaveText("Implementation Plan Inspect src/sidebar.tsx Use docs");
    await expect(preview).not.toContainText("##");
    await expect(preview).not.toContainText("`");
    await expect(preview).not.toContainText("[");
  } finally {
    await harness.close();
  }
});

test("switching sessions republishes the selected transcript", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("session-switch-transcript-workspace");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    await createNamedThread(window, "Thread one");
    await streamAssistantDeltas(harness, window, ["alpha response"]);
    await expect(window.getByTestId("transcript")).toContainText("alpha response");

    await createNamedThread(window, "Thread two");
    await streamAssistantDeltas(harness, window, ["beta response"]);
    await expect(window.getByTestId("transcript")).toContainText("beta response");

    await selectSession(window, "Thread one");
    await expect(window.locator(".topbar__session")).toHaveText("Thread one");
    await expect(window.getByTestId("transcript")).toContainText("alpha response");
    await expect(window.getByTestId("transcript")).not.toContainText("Loading transcript");

    await selectSession(window, "Thread two");
    await expect(window.locator(".topbar__session")).toHaveText("Thread two");
    await expect(window.getByTestId("transcript")).toContainText("beta response");
    await expect(window.getByTestId("transcript")).not.toContainText("Loading transcript");
  } finally {
    await harness.close();
  }
});

test("opens and runs actions from the command palette", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("command-palette-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Palette host thread");

    await window.keyboard.press(desktopShortcut("K"));
    const palette = window.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    await expect(window.getByRole("option", { name: /New thread/ })).toBeVisible();

    await window.getByPlaceholder("Search commands…").fill("terminal");
    await expect(window.getByRole("option", { name: /Toggle terminal/ })).toBeVisible();
    await window.keyboard.press("Enter");
    await expect(window.getByTestId("integrated-terminal")).toBeVisible();

    await window.keyboard.press(desktopShortcut("K"));
    await window.getByPlaceholder("Search commands…").fill("new thread");
    await window.keyboard.press("Enter");
    await expect(window.getByTestId("new-thread-composer")).toBeVisible();

    await window.keyboard.press(desktopShortcut("K"));
    await expect(palette).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
