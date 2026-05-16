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
  TINY_PNG_BASE64,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("opens a workspace terminal with persistent output, tabs, and takeover controls", async () => {
  test.setTimeout(90_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("terminal-root");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { NODE_ENV: "development" },
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Terminal host thread");

    await window.getByLabel("Toggle terminal").hover();
    const terminalTooltip = window.locator(".topbar__tooltip", { hasText: "Toggle terminal" });
    await expect(terminalTooltip).toContainText("Toggle terminal");
    await expect(terminalTooltip.locator("kbd")).toHaveText(/⌘J|Ctrl\+J/);

    await window.getByLabel("Toggle terminal").click();
    const terminal = window.getByTestId("integrated-terminal");
    await expect(terminal).toBeVisible();
    await expect(window.getByTestId("terminal-tab")).toHaveCount(1);

    await terminal.locator(".xterm").click();
    await window.keyboard.type("printf 'PI_TERMINAL_OK\\n'; pwd");
    await window.keyboard.press("Enter");
    await expect(terminal.locator(".xterm-rows")).toContainText("PI_TERMINAL_OK", { timeout: 15_000 });
    await expect(terminal.locator(".xterm-rows")).toContainText(basename(workspacePath), { timeout: 15_000 });

    await window.keyboard.type("node -e \"console.log(process.env.NODE_ENV ?? 'NODE_ENV_UNSET')\"");
    await window.keyboard.press("Enter");
    await expect(terminal.locator(".xterm-rows")).toContainText("NODE_ENV_UNSET", { timeout: 15_000 });

    await window.keyboard.press(desktopShortcut("J"));
    await expect(terminal).toHaveCount(0);
    await window.keyboard.press(desktopShortcut("J"));
    await expect(window.getByTestId("integrated-terminal").locator(".xterm-rows")).toContainText("PI_TERMINAL_OK", {
      timeout: 15_000,
    });

    await createNamedThread(window, "Terminal other thread");
    await expect(window.getByTestId("integrated-terminal")).toBeVisible();
    await expect(window.getByTestId("integrated-terminal").locator(".xterm-rows")).toContainText("PI_TERMINAL_OK", {
      timeout: 15_000,
    });
    await window.keyboard.press(desktopShortcut("J"));
    await expect(window.getByTestId("integrated-terminal")).toBeVisible();
    await expect(window.getByTestId("open-terminal-tab")).toHaveCount(2);
    await expect(window.getByTestId("integrated-terminal").locator(".xterm-rows")).not.toContainText("PI_TERMINAL_OK");
    await selectSession(window, "Terminal host thread");
    await expect(window.getByTestId("integrated-terminal")).toBeVisible();
    await expect(window.getByTestId("integrated-terminal").locator(".xterm-rows")).toContainText("PI_TERMINAL_OK", {
      timeout: 15_000,
    });

    await window.getByTestId("integrated-terminal").locator(".xterm").click();
    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toHaveCount(0);
    await window.keyboard.press(desktopShortcut("Shift+O"));
    await expect(window.getByTestId("new-thread-composer")).toHaveCount(0);
    await harness.electronApp.evaluate(({ clipboard }) => {
      clipboard.writeText('NODE_ENV=test node -e "console.log(process.env.NODE_ENV)"');
    });
    await window.keyboard.press(desktopShortcut("V"));
    await window.keyboard.press("Enter");
    await expect(terminal.locator(".xterm-rows")).toContainText("test", { timeout: 15_000 });
    await expect(terminal.locator(".xterm-rows")).not.toContainText('NODE_ENV=test node -e "console.log(process.env.NODE_ENV)"NODE_ENV=test');
    await expect(terminal.locator(".xterm-rows")).not.toContainText("SyntaxError");

    await harness.electronApp.evaluate(({ clipboard, nativeImage }, pngBase64) => {
      clipboard.writeImage(nativeImage.createFromDataURL(`data:image/png;base64,${pngBase64}`));
    }, TINY_PNG_BASE64);
    await window.keyboard.press(desktopShortcut("V"));
    await expect.poll(async () => (await getDesktopState(window)).composerAttachments.length).toBe(0);

    await window.getByLabel("New terminal").click();
    await expect(window.getByTestId("terminal-tab")).toHaveCount(2);
    await window.getByTestId("integrated-terminal").locator(".xterm").click();
    await window.keyboard.press(desktopShortcut("T"));
    await expect(window.getByTestId("terminal-tab")).toHaveCount(3);

    const beforeTakeover = await window.getByTestId("integrated-terminal").boundingBox();
    await window.getByLabel("Maximize terminal").click();
    await expect(window.getByTestId("integrated-terminal")).toHaveClass(/terminal-panel--takeover/);
    await expect(window.getByTestId("composer")).toHaveCount(0);
    const takeover = await window.getByTestId("integrated-terminal").boundingBox();
    expect(takeover?.height ?? 0).toBeGreaterThan(beforeTakeover?.height ?? 0);

    await window.getByLabel("Restore terminal").click();
    await expect(window.getByTestId("integrated-terminal")).not.toHaveClass(/terminal-panel--takeover/);
    await expect(window.getByTestId("composer")).toBeVisible();

    await window.getByLabel(/Close Terminal/).last().click();
    await expect(window.getByTestId("terminal-tab")).toHaveCount(2);
  } finally {
    await harness.close();
  }
});

test("persists the integrated terminal shell setting", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("terminal-settings");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "General", exact: true }).click();
    const shellInput = window.getByLabel("Shell of integrated terminal");
    await shellInput.fill("/bin/zsh");
    await shellInput.press("Enter");
    await expect.poll(async () => (await getDesktopState(window)).integratedTerminalShell).toBe("/bin/zsh");
  } finally {
    await harness.close();
  }
});

test("adds selected terminal output to the current composer", async () => {
  test.setTimeout(90_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("terminal-selection-context");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Terminal selection host");

    const composer = window.getByTestId("composer");
    await composer.fill("draft before terminal context");

    await window.getByLabel("Toggle terminal").click();
    const terminal = window.getByTestId("integrated-terminal");
    await expect(terminal).toBeVisible();
    await terminal.locator(".xterm").click();
    await window.keyboard.type(
      "printf 'TERMINAL_BEFORE_CONTEXT\\n'; printf 'SELECT_ME_FROM_TERMINAL\\n'; printf 'TERMINAL_AFTER_CONTEXT\\n'",
    );
    await window.keyboard.press("Enter");
    await expect(terminal.locator(".xterm-rows")).toContainText("TERMINAL_BEFORE_CONTEXT", { timeout: 15_000 });
    await expect(terminal.locator(".xterm-rows")).toContainText("SELECT_ME_FROM_TERMINAL", { timeout: 15_000 });
    await expect(terminal.locator(".xterm-rows")).toContainText("TERMINAL_AFTER_CONTEXT", { timeout: 15_000 });

    const selectedOutputRow = terminal
      .locator(".xterm-rows div")
      .filter({ hasText: /^SELECT_ME_FROM_TERMINAL\s*$/ })
      .last();
    await selectedOutputRow.selectText();
    await expect(window.getByRole("button", { name: "Add terminal selection to chat" })).toBeVisible();
    await window.getByRole("button", { name: "Add terminal selection to chat" }).click();

    await expect(composer).toHaveValue(/draft before terminal context/);
    await expect(composer).toHaveValue(/Terminal context from/);
    await expect(composer).toHaveValue(/SELECT_ME_FROM_TERMINAL/);
    await expect(composer).toHaveValue(/```terminal/);
    await expect(composer).not.toHaveValue(/TERMINAL_BEFORE_CONTEXT/);
    await expect(composer).not.toHaveValue(/TERMINAL_AFTER_CONTEXT/);
  } finally {
    await harness.close();
  }
});
