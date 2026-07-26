import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { SubagentRunRecord, SubagentWorkflowTemplate } from "../../src/subagent-workflows";
import { BUILTIN_SUBAGENT_WORKFLOWS } from "../../src/subagent-workflows";
import {
  createNamedThread,
  getDesktopState,
  getRealAuthConfig,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

async function listRuns(window: Page, workspaceId: string): Promise<readonly SubagentRunRecord[]> {
  return window.evaluate(async (id) => (await window.piApp?.listSubagentRuns(id)) ?? [], workspaceId);
}

async function openWorkflows(window: Page): Promise<void> {
  const settingsButton = window.getByRole("button", { name: "Settings", exact: true });
  if (await settingsButton.count()) await settingsButton.click();
  await window.getByRole("button", { name: "Subagents", exact: true }).click();
  await window.getByRole("tab", { name: "Workflows" }).click();
}

async function startWorkflow(window: Page, workspaceId: string, workflow: SubagentWorkflowTemplate): Promise<string> {
  const previousIds = new Set((await listRuns(window, workspaceId)).map((run) => run.id));
  const card = window.getByTestId(`subagent-workflow-${workflow.id}`);
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "Run workflow" })).toBeEnabled();
  await card.getByRole("button", { name: "Run workflow" }).click();
  await expect.poll(async () => (await listRuns(window, workspaceId)).find((run) => !previousIds.has(run.id))?.id).toBeTruthy();
  return (await listRuns(window, workspaceId)).find((run) => !previousIds.has(run.id))!.id;
}

async function waitForCompletedWorkflow(
  window: Page,
  workspaceId: string,
  runId: string,
  workflow: SubagentWorkflowTemplate,
): Promise<SubagentRunRecord> {
  await expect.poll(
    async () => (await listRuns(window, workspaceId)).find((run) => run.id === runId)?.status,
    { timeout: 600_000 },
  ).toMatch(/completed|failed/);
  await expect.poll(async () => {
    const state = await getDesktopState(window);
    return state.workspaces
      .find((workspace) => workspace.id === workspaceId)
      ?.sessions.find((session) => session.id === state.selectedSessionId)?.status;
  }, { timeout: 600_000 }).toBe("idle");

  const run = (await listRuns(window, workspaceId)).find((entry) => entry.id === runId);
  expect(run).toBeDefined();
  expect(run?.status, run?.error).toBe("completed");
  expect(run?.childRuns).toHaveLength(workflow.roles.length);
  expect(run?.childRuns?.every((child) => child.status === "completed")).toBe(true);
  expect(run?.toolUseCount).toBeGreaterThanOrEqual(0);

  await window.getByRole("tab", { name: "Runs" }).click();
  const row = window.getByTestId("subagent-run-row").filter({ hasText: workflow.title }).first();
  await expect(row).toContainText("completed");
  await expect(row).toContainText(`Agent runs: ${workflow.roles.length}/${workflow.roles.length}`);
  await expect(row.getByRole("button", { name: "Open transcript" })).toBeVisible();
  return run!;
}

test("runs every built-in workflow against a real provider and hydrates durable child state", async () => {
  test.setTimeout(2_400_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);

  const userDataDir = await makeUserDataDir("pi-gui-real-subagent-workflows-");
  const workspacePath = await makeWorkspace("real-subagent-workflows");
  await writeFile(
    `${workspacePath}/WORKFLOW-PROOF.md`,
    "# Workflow proof fixture\n\nThis is a bounded verification fixture. Invoke each requested Agent role exactly once. A blocked or no-change result is acceptable and must not be retried. Do not modify files.\n",
    "utf8",
  );
  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    realAuthSourceDir: realAuth.sourceDir,
  });

  try {
    let window = await harness.firstWindow();
    await createNamedThread(window, "Real built-in workflow proof");
    const workspaceId = await window.evaluate(async () => (await window.piApp?.getState())?.selectedWorkspaceId ?? "");
    expect(workspaceId).not.toBe("");
    await openWorkflows(window);

    for (const [index, workflow] of BUILTIN_SUBAGENT_WORKFLOWS.entries()) {
      let runId = await startWorkflow(window, workspaceId, workflow);
      await window.getByRole("tab", { name: "Runs" }).click();
      const row = window.getByTestId("subagent-run-row").filter({ hasText: workflow.title }).first();
      await expect(row).toContainText(/submitted|running/);

      if (index === 0) {
        await expect.poll(
          async () => (await listRuns(window, workspaceId)).find((run) => run.id === runId)?.childRuns?.length ?? 0,
          { timeout: 180_000 },
        ).toBeGreaterThan(0);
        await harness.close();
        harness = await launchDesktop(userDataDir, {
          initialWorkspaces: [workspacePath],
          testMode: "background",
          realAuthSourceDir: realAuth.sourceDir,
        });
        window = await harness.firstWindow();
        await openWorkflows(window);
        await window.getByRole("tab", { name: "Runs" }).click();
        const interruptedRow = window.getByTestId("subagent-run-row").filter({ hasText: workflow.title }).first();
        await expect(interruptedRow).toContainText("interrupted");
        await expect(interruptedRow).toContainText("Agent runs:");
        await window.getByRole("tab", { name: "Workflows" }).click();
        runId = await startWorkflow(window, workspaceId, workflow);
      }

      await waitForCompletedWorkflow(window, workspaceId, runId, workflow);
      await window.getByRole("tab", { name: "Workflows" }).click();
    }
  } finally {
    await harness.close();
  }
});
