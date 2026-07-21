import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "@playwright/test";
import { createSessionViaIpc, desktopShortcut, emitTestSessionEvent, type DesktopHarness, getDesktopState, launchDesktop } from "../helpers/electron-app";

interface CatalogSessionRecord {
  readonly sessionRef?: {
    readonly workspaceId?: string;
    readonly sessionId?: string;
  };
  readonly sessionFilePath?: string;
}

async function seedLogs(userDataDir: string, agentDir: string, workspacePath: string): Promise<void> {
  await mkdir(join(userDataDir, "logs"), { recursive: true });
  await mkdir(join(agentDir, "logs"), { recursive: true });
  await writeFile(
    join(userDataDir, "logs", "desktop.log"),
    `${JSON.stringify({
      timestamp: "2026-05-21T08:31:31.000Z",
      event: "main-unhandled-rejection",
      message: "Summarization failed: terminated",
    })}\n${JSON.stringify({
      timestamp: "2026-05-21T08:31:32.000Z",
      event: "renderer-diagnostic",
      payload: {
        payload: {
          kind: "timeline-long-task",
          message: "Timeline render took 120ms",
        },
      },
    })}\n${JSON.stringify({
      timestamp: "2026-05-21T08:31:33.000Z",
      event: "renderer-console-message",
      payload: {
        level: 3,
        message: "Maximum update depth exceeded. This can happen when a component repeatedly calls setState.",
      },
    })}\n${JSON.stringify({
      timestamp: "2026-05-21T08:31:34.000Z",
      event: "renderer-console-message",
      payload: {
        level: 2,
        message: "%cElectron Security Warning (Insecure Content-Security-Policy) font-weight: bold; This renderer process has either no Content Security Policy set or a policy with unsafe-eval enabled.",
      },
    })}\n`,
    "utf8",
  );
  await writeFile(
    join(agentDir, "logs", "subagents-audit.jsonl"),
    `${JSON.stringify({
      ts: "2026-05-21T08:32:31.000Z",
      event: "subagent_spawn_blocked",
      agentId: "agent-1",
      type: "scout",
      description: "Wrong repo check",
      cwd: workspacePath,
      workspaceRoot: workspacePath,
      reason: "Prompt references /repo/lago outside workspace",
      path: "/repo/lago",
    })}\n${JSON.stringify({
      ts: "2026-05-21T08:32:41.000Z",
      event: "subagent_tool_blocked",
      agentId: "agent-1",
      type: "scout",
      toolName: "bash",
      toolCallId: "blocked-bash-call",
      cwd: workspacePath,
      workspaceRoot: workspacePath,
      reason: "Blocked bash command path outside workspace root: /dev/null",
      path: "/dev/null",
    })}\n${JSON.stringify({
      ts: "2026-05-21T08:32:41.000Z",
      event: "subagent_tool_end",
      agentId: "agent-1",
      type: "scout",
      toolName: "bash",
      toolCallId: "blocked-bash-call",
      cwd: workspacePath,
      workspaceRoot: workspacePath,
      isError: true,
    })}\n${JSON.stringify({
      ts: "2026-05-21T08:33:31.000Z",
      event: "subagent_tool_blocked",
      agentId: "agent-2",
      type: "scout",
      toolName: "bash",
      cwd: "/repo/other-project",
      workspaceRoot: "/repo/other-project",
      reason: "Other repo failure should stay out of current thread scope",
      path: "/repo/pi-gui",
    })}\n`,
    "utf8",
  );
}

async function sessionFileFor(userDataDir: string, workspaceId: string, sessionId: string): Promise<string> {
  const catalogsPath = join(userDataDir, "catalogs.json");
  return expect.poll(async () => {
    const catalogs = JSON.parse(await readFile(catalogsPath, "utf8"));
    return catalogs.sessionFiles?.[`${workspaceId}:${sessionId}`]
      ?? (catalogs.sessions as CatalogSessionRecord[] | undefined)?.find((session) =>
        session.sessionRef?.workspaceId === workspaceId && session.sessionRef?.sessionId === sessionId,
      )?.sessionFilePath
      ?? "";
  }, { timeout: 10_000 }).not.toBe("").then(async () => {
    const catalogs = JSON.parse(await readFile(catalogsPath, "utf8"));
    return catalogs.sessionFiles?.[`${workspaceId}:${sessionId}`]
      ?? (catalogs.sessions as CatalogSessionRecord[] | undefined)?.find((session) =>
        session.sessionRef?.workspaceId === workspaceId && session.sessionRef?.sessionId === sessionId,
      )?.sessionFilePath;
  });
}

test("logs panel opens on threads and splits task/app seeded failures", async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-observability-"));
  const agentDir = join(userDataDir, "agent");
  await seedLogs(userDataDir, agentDir, userDataDir);
  const app = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [userDataDir], testMode: "background" });

  try {
    const page = await app.firstWindow();
    await page.getByLabel("Toggle logs panel").click();
    await expect(page.getByTestId("logs-panel")).toBeVisible();
    const logsPanelBox = await page.getByTestId("logs-panel").boundingBox();
    expect(logsPanelBox?.width).toBeGreaterThanOrEqual(430);
    await expect(page.getByRole("tab", { name: "Runtime" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("logs-failure-count")).toContainText("0 jobs");

    await page.getByRole("tab", { name: "Task logs" }).click();
    await expect(page.locator(".logs-panel__event-title", { hasText: "Subagent blocked: prompt targets another repo" })).toBeVisible();
    await expect(page.locator(".logs-panel__event-title", { hasText: "Tool blocked: bash" })).toBeVisible();
    await expect(page.locator(".logs-panel__event-title", { hasText: "Tool failed: bash" })).toHaveCount(0);
    await expect(page.locator(".logs-panel__event-title", { hasText: "Main process unhandled rejection" })).toHaveCount(0);
    await expect(page.locator(".logs-panel__event-message", { hasText: "Other repo failure" })).toHaveCount(0);
    await expect(page.locator(".logs-panel__warning", { hasText: "agent-activity.jsonl" })).toHaveCount(0);
    await expect(page.getByTestId("logs-failure-count")).toContainText("2 failures");
    await expect(page.getByLabel("Filter by run")).toBeVisible();
    await expect(page.getByLabel("Filter by role")).toBeVisible();

    const state = await getDesktopState(page);
    const sessionRef = { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
    await emitTestSessionEvent(app, {
      type: "subagentRunUpdated",
      sessionRef,
      parentSession: sessionRef,
      timestamp: new Date().toISOString(),
      subagentRunId: "live-observability-agent",
      toolCallId: "live-observability-tool-call",
      role: "planner",
      status: "progress",
      summary: "Live typed lifecycle proof",
    });
    await page.getByLabel("Log severity").selectOption("all");
    await expect(page.locator(".logs-panel__event-title", { hasText: "planner progress" })).toBeVisible();
    await page.getByLabel("Filter by role").fill("planner");
    await page.getByLabel("Filter by run").fill("live-observability-agent");
    await expect(page.locator(".logs-panel__event-title", { hasText: "planner progress" })).toBeVisible();
    await expect(page.locator(".logs-panel__event-title", { hasText: "Tool blocked: bash" })).toHaveCount(0);

    await page.getByRole("tab", { name: "App logs" }).click();
    await expect(page.locator(".logs-panel__event-title", { hasText: "Main process unhandled rejection" })).toBeVisible();
    await expect(page.locator(".logs-panel__event-title", { hasText: "React render loop" })).toBeVisible();
    await expect(page.locator(".logs-panel__event-message", { hasText: "Maximum update depth exceeded" })).toBeVisible();
    await expect(page.locator(".logs-panel__event-title", { hasText: "Tool blocked: bash" })).toHaveCount(0);
    await expect(page.getByTestId("logs-failure-count")).toContainText("2 failures");
  } finally {
    await app.close();
  }
});

test("logs panel renders object payloads as useful messages", async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-observability-object-"));
  const agentDir = join(userDataDir, "agent");
  await seedLogs(userDataDir, agentDir, userDataDir);
  const app = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [userDataDir], testMode: "background" });

  try {
    const page = await app.firstWindow();
    await page.getByLabel("Toggle logs panel").click();
    await page.getByRole("tab", { name: "App logs" }).click();
    await page.getByLabel("Log severity").selectOption("all");
    await expect(page.locator(".logs-panel__event-message", { hasText: "Timeline render took 120ms" })).toBeVisible();
    await expect(page.locator(".logs-panel__event-title", { hasText: "Electron security warning" }).first()).toBeVisible();
    await expect(page.locator(".logs-panel__event-message", { hasText: "[object Object]" })).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("app logs can open a redacted diagnostic issue draft", async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-observability-issue-"));
  const agentDir = join(userDataDir, "agent");
  await seedLogs(userDataDir, agentDir, userDataDir);
  await appendFile(
    join(userDataDir, "logs", "desktop.log"),
    `${JSON.stringify({
      timestamp: "2026-05-21T08:31:35.000Z",
      event: "renderer-console-message",
      payload: {
        level: 3,
        message: `Failed in ${join(userDataDir, "private-project", "src", "secret.ts")} with token=sk-abcdefghijklmnopqrstuvwxyz`,
        prompt: "Do not include prompt text",
      },
    })}\n`,
    "utf8",
  );
  const app = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [userDataDir], testMode: "background" });

  try {
    await stubExternalOpens(app);
    const page = await app.firstWindow();
    await page.keyboard.press(desktopShortcut(","));
    await expect(page.getByTestId("settings-surface")).toBeVisible();
    await page.getByRole("button", { name: "General", exact: true }).click();
    await page.getByRole("checkbox", { name: "Enable diagnostic issue drafts" }).click();
    await expect(page.getByRole("checkbox", { name: "Enable diagnostic issue drafts" })).toBeChecked();
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await page.getByLabel("Toggle logs panel").click();
    await page.getByRole("tab", { name: "App logs" }).click();
    await page.getByRole("button", { name: "Draft issue" }).click();

    const urls = await readExternalOpens(app);
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0]);
    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/minghinmatthewlam/pi-gui/issues/new");
    expect(url.searchParams.get("title")).toContain("Diagnostics report:");
    const body = url.searchParams.get("body") ?? "";
    expect(body).toContain("Electron:");
    expect(body).toContain("Renderer console error");
    expect(body).toContain("[path]");
    expect(body).toContain("token=[secret]");
    expect(body).not.toContain(userDataDir);
    expect(body).not.toContain("secret.ts");
    expect(body).not.toContain("Do not include prompt text");
    await expect(page.locator(".logs-panel__runtime-note", { hasText: "Draft opened in the browser." })).toBeVisible();
  } finally {
    await app.close();
  }
});

test("app logs include local native crash artifacts only after opt-in", async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-observability-crash-"));
  const agentDir = join(userDataDir, "agent");
  await seedLogs(userDataDir, agentDir, userDataDir);
  const app = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [userDataDir], testMode: "background" });

  try {
    const crashDumpsPath = await app.electronApp.evaluate(({ app: electronApp }) => electronApp.getPath("crashDumps"));
    await mkdir(join(crashDumpsPath, "completed"), { recursive: true });
    await writeFile(join(crashDumpsPath, "completed", "local-native-crash.dmp"), "minidump", "utf8");

    const page = await app.firstWindow();
    await page.getByLabel("Toggle logs panel").click();
    await page.getByRole("tab", { name: "App logs" }).click();
    await expect(page.locator(".logs-panel__event-title", { hasText: "Native crash report artifact" })).toHaveCount(0);

    await page.keyboard.press(desktopShortcut(","));
    await expect(page.getByTestId("settings-surface")).toBeVisible();
    await page.getByRole("button", { name: "General", exact: true }).click();
    await page.getByRole("checkbox", { name: "Enable local native crash reports" }).click();
    await expect(page.getByRole("checkbox", { name: "Enable local native crash reports" })).toBeChecked();
    await expect.poll(async () => (await getDesktopState(page)).diagnosticReporting.nativeCrashReportsEnabled).toBe(true);
    const crashReporterState = await app.electronApp.evaluate(({ crashReporter }) => ({
      uploadToServer: crashReporter.getUploadToServer(),
    }));
    expect(crashReporterState.uploadToServer).toBe(false);

    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(page.getByTestId("logs-panel")).toBeVisible();
    await page.getByRole("tab", { name: "App logs" }).click();
    await page.getByLabel("Refresh logs").click();
    await expect(page.locator(".logs-panel__event-title", { hasText: "Native crash report artifact" })).toBeVisible();
    await expect(page.locator(".logs-panel__event-message", { hasText: "local-native-crash.dmp" })).toBeVisible();
  } finally {
    await app.close();
  }
});

test("logs panel can opt into global subagent audit history", async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-observability-global-"));
  const agentDir = join(userDataDir, "agent");
  await seedLogs(userDataDir, agentDir, userDataDir);
  const app = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [userDataDir], testMode: "background" });

  try {
    const page = await app.firstWindow();
    await page.getByLabel("Toggle logs panel").click();
    await page.getByRole("tab", { name: "Task logs" }).click();
    await page.getByLabel("Log scope").selectOption("global");
    await expect(page.locator(".logs-panel__event-message", { hasText: "Other repo failure" })).toBeVisible();
    await expect(page.getByTestId("logs-failure-count")).toContainText("3 failures");
  } finally {
    await app.close();
  }
});

async function stubExternalOpens(harness: DesktopHarness): Promise<void> {
  await harness.electronApp.evaluate(({ shell }) => {
    const state = globalThis as typeof globalThis & { __piExternalUrls?: string[] };
    state.__piExternalUrls = [];
    shell.openExternal = ((url: string) => {
      state.__piExternalUrls?.push(url);
      return Promise.resolve();
    }) as typeof shell.openExternal;
  });
}

async function readExternalOpens(harness: DesktopHarness): Promise<readonly string[]> {
  return harness.electronApp.evaluate(() => {
    const state = globalThis as typeof globalThis & { __piExternalUrls?: string[] };
    return state.__piExternalUrls ?? [];
  });
}

test("logs panel includes current thread tool failures", async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-observability-tools-"));
  const agentDir = join(userDataDir, "agent");
  await seedLogs(userDataDir, agentDir, userDataDir);
  const app = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [userDataDir], testMode: "background" });

  try {
    const page = await app.firstWindow();
    const initialState = await getDesktopState(page);
    await createSessionViaIpc(page, initialState.selectedWorkspaceId, "Failed tool thread");
    const state = await getDesktopState(page);
    const sessionFile = await sessionFileFor(userDataDir, state.selectedWorkspaceId, state.selectedSessionId);
    await appendFile(sessionFile, `${JSON.stringify({
      type: "message",
      id: "tool-result-1",
      parentId: "assistant-1",
      timestamp: "2026-05-21T08:34:31.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call-failed-bash",
        toolName: "bash",
        content: [{ type: "text", text: "Command failed with exit code 1" }],
        isError: true,
        timestamp: 1779337531051,
      },
    })}\n`, "utf8");

    await page.getByLabel("Toggle logs panel").click();
    await page.getByRole("tab", { name: "Task logs" }).click();
    await expect(page.locator(".logs-panel__event-title", { hasText: "Tool failed: bash" })).toBeVisible();
    await expect(page.locator(".logs-panel__event-message", { hasText: "Command failed with exit code 1" })).toBeVisible();
    await expect(page.getByTestId("logs-failure-count")).toContainText("3 failures");
  } finally {
    await app.close();
  }
});

test("logs panel stays open when switching threads and display mode", async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-observability-view-"));
  const agentDir = join(userDataDir, "agent");
  await seedLogs(userDataDir, agentDir, userDataDir);
  const app = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [userDataDir], testMode: "background" });

  try {
    const page = await app.firstWindow();
    await page.getByLabel("Toggle logs panel").click();
    await expect(page.getByTestId("logs-panel")).toBeVisible();
    await page.getByRole("button", { name: "Display Mode" }).click();
    await expect(page.getByTestId("logs-panel")).toBeVisible();
    await page.getByRole("button", { name: "Threads" }).click();
    await expect(page.getByTestId("logs-panel")).toBeVisible();
  } finally {
    await app.close();
  }
});
