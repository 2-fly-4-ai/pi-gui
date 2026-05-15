import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import {
  emitTestSessionEvent,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedTranscriptMessages,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("opens Display Mode from the sidebar and renders thread command-center tiles", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("display-mode-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    await waitForWorkspaceByPath(window, workspacePath);
    await window.evaluate(async ({ targetPath, title }) => {
      const app = window.piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      const state = await app.getState();
      const workspace = state.workspaces.find((entry) => entry.path === targetPath);
      if (!workspace) {
        throw new Error(`Workspace not found: ${targetPath}`);
      }
      await app.createSession({ workspaceId: workspace.id, title });
    }, { targetPath: workspacePath, title: "Display mode seed thread" });
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

    await window.getByRole("button", { name: "Toggle VS Code panel" }).click();
    await expect(window.getByTestId("thread-vscode-panel")).toBeVisible();
    await expect(window.locator(".thread-vscode-panel .display-mode-vscode__webview")).toHaveAttribute("title", "VS Code", { timeout: 45_000 });
    await window.getByRole("button", { name: "Toggle VS Code panel" }).click();
    await expect(window.getByTestId("thread-vscode-panel")).toHaveCount(0);
    await window.getByRole("button", { name: "Open VS Code for thread" }).click();
    await expect(window.getByTestId("thread-vscode-panel")).toBeVisible();
    await window.getByRole("button", { name: "Toggle VS Code panel" }).click();
    await expect(window.getByTestId("thread-vscode-panel")).toHaveCount(0);

    const nav = window.locator(".sidebar__nav");
    await expect(nav.getByRole("button", { name: "Threads" })).toBeVisible();
    await nav.getByRole("button", { name: "Display Mode" }).click();

    await expect.poll(async () => window.evaluate(() => window.piApp?.getState().then((state) => state.activeView) ?? "missing")).toBe("display-mode");
    await expect(window.getByTestId("display-mode-surface")).toBeVisible();
    await expect(window.getByRole("heading", { name: "Command center" })).toBeVisible();
    await expect(window.locator(".display-mode-drawer")).toContainText("Preview");
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
    await firstTile.locator("textarea").fill("");

    await window.getByTestId("display-mode-thread-tile").first().getByRole("button", { name: "Terminal" }).click();
    await expect(window.locator(".display-mode-tile__terminal").first()).toBeVisible();
    await expect(window.locator(".terminal-stack")).toHaveCount(0);

    await window.getByRole("button", { name: "Automatic columns" }).click();
    await expect.poll(async () => window.evaluate(() => {
      const grid = document.querySelector<HTMLElement>(".display-mode__grid");
      return grid ? window.getComputedStyle(grid).gridTemplateColumns : "";
    })).toContain("px");

    await window.getByTestId("display-mode-thread-tile").first().getByRole("button", { name: "VS Code" }).click();
    await expect(window.locator(".display-mode-vscode")).toBeVisible();
    await expect(window.locator(".display-mode-vscode__webview")).toHaveAttribute("title", "VS Code");
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
    const settings = JSON.parse(await readFile(join(userDataDir, "vscode-serve-web", "user-data", "User", "settings.json"), "utf8")) as Record<string, unknown>;
    expect(settings["security.workspace.trust.enabled"]).toBe(false);
    expect(settings["workbench.colorTheme"]).toBe("Default Dark Modern");
    const displayVsCodeFrame = window.frameLocator(".display-mode-vscode__webview");
    await expect(displayVsCodeFrame.getByText("workbench failed to connect")).toHaveCount(0);
    await expect(displayVsCodeFrame.getByText("Do you trust the authors")).toHaveCount(0);
    await expect(displayVsCodeFrame.getByText("README.md")).toBeVisible({ timeout: 45_000 });
  } finally {
    await harness.close();
  }
});
