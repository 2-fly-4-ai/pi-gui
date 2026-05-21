import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "@playwright/test";
import { createSessionViaIpc, getDesktopState, launchDesktop } from "../helpers/electron-app";

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
      ?? catalogs.sessions?.find((session: any) =>
        session.sessionRef?.workspaceId === workspaceId && session.sessionRef?.sessionId === sessionId,
      )?.sessionFilePath
      ?? "";
  }, { timeout: 10_000 }).not.toBe("").then(async () => {
    const catalogs = JSON.parse(await readFile(catalogsPath, "utf8"));
    return catalogs.sessionFiles?.[`${workspaceId}:${sessionId}`]
      ?? catalogs.sessions?.find((session: any) =>
        session.sessionRef?.workspaceId === workspaceId && session.sessionRef?.sessionId === sessionId,
      )?.sessionFilePath;
  });
}

test("logs panel opens on threads and shows current-scope seeded failures", async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-observability-"));
  const agentDir = join(userDataDir, "agent");
  await seedLogs(userDataDir, agentDir, userDataDir);
  const app = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [userDataDir], testMode: "background" });

  try {
    const page = await app.firstWindow();
    await page.getByLabel("Toggle logs panel").click();
    await expect(page.getByTestId("logs-panel")).toBeVisible();
    await expect(page.locator(".logs-panel__event-title", { hasText: "Subagent blocked: prompt targets another repo" })).toBeVisible();
    await expect(page.locator(".logs-panel__event-title", { hasText: "Main process unhandled rejection" })).toBeVisible();
    await expect(page.locator(".logs-panel__event-message", { hasText: "Other repo failure" })).toHaveCount(0);
    await expect(page.locator(".logs-panel__warning", { hasText: "agent-activity.jsonl" })).toHaveCount(0);
    await expect(page.locator(".logs-panel__event-title", { hasText: "Renderer console error" })).toBeVisible();
    await expect(page.locator(".logs-panel__event-message", { hasText: "Maximum update depth exceeded" })).toBeVisible();
    await expect(page.getByTestId("logs-failure-count")).toContainText("3 failures");
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
    await page.getByLabel("Log severity").selectOption("all");
    await expect(page.locator(".logs-panel__event-message", { hasText: "Timeline render took 120ms" })).toBeVisible();
    await expect(page.locator(".logs-panel__event-message", { hasText: "Timeline render took 120ms" })).toBeVisible();
    await expect(page.locator(".logs-panel__event-message", { hasText: "[object Object]" })).toHaveCount(0);
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
    await page.getByLabel("Log scope").selectOption("global");
    await expect(page.locator(".logs-panel__event-message", { hasText: "Other repo failure" })).toBeVisible();
    await expect(page.getByTestId("logs-failure-count")).toContainText("4 failures");
  } finally {
    await app.close();
  }
});

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
    await expect(page.locator(".logs-panel__event-title", { hasText: "Tool failed: bash" })).toBeVisible();
    await expect(page.locator(".logs-panel__event-message", { hasText: "Command failed with exit code 1" })).toBeVisible();
    await expect(page.getByTestId("logs-failure-count")).toContainText("4 failures");
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
