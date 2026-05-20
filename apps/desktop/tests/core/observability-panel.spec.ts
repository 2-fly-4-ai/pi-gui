import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "@playwright/test";
import { launchDesktop } from "../helpers/electron-app";

async function seedLogs(userDataDir: string, agentDir: string): Promise<void> {
  await mkdir(join(userDataDir, "logs"), { recursive: true });
  await mkdir(join(agentDir, "logs"), { recursive: true });
  await writeFile(
    join(userDataDir, "logs", "desktop.log"),
    `${JSON.stringify({
      timestamp: "2026-05-21T08:31:31.000Z",
      event: "main-unhandled-rejection",
      message: "Summarization failed: terminated",
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
      cwd: "/repo/pi-gui",
      workspaceRoot: "/repo/pi-gui",
      reason: "Prompt references /repo/lago outside workspace",
      path: "/repo/lago",
    })}\n`,
    "utf8",
  );
}

test("logs panel opens on threads and shows seeded failures", async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-observability-"));
  const agentDir = join(userDataDir, "agent");
  await seedLogs(userDataDir, agentDir);
  const app = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [userDataDir], testMode: "background" });

  try {
    const page = await app.firstWindow();
    await page.getByLabel("Toggle logs panel").click();
    await expect(page.getByTestId("logs-panel")).toBeVisible();
    await expect(page.locator(".logs-panel__event-title", { hasText: "Subagent blocked: prompt targets another repo" })).toBeVisible();
    await expect(page.locator(".logs-panel__event-title", { hasText: "Main process unhandled rejection" })).toBeVisible();
    await expect(page.getByTestId("logs-failure-count")).toContainText("2 failures");
  } finally {
    await app.close();
  }
});

test("logs panel stays open when switching threads and display mode", async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-observability-view-"));
  const agentDir = join(userDataDir, "agent");
  await seedLogs(userDataDir, agentDir);
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
