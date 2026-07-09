import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { parseSubagentWorkflowMarker, subagentWorkflowCardFromMessage } from "../../src/subagent-timeline-card";
import { createNamedThread, launchDesktop, makeUserDataDir, makeWorkspace, seedAgentDir, streamAssistantDeltas } from "../helpers/electron-app";

test("subagent workflow marker parser stops metadata before body text", () => {
  const parsed = parseSubagentWorkflowMarker([
    "SUBAGENT_WORKFLOW_RUN",
    "workflow_run_id: workflow-run-123",
    "workflow: Parallel review",
    "roles: reviewer/correctness -> reviewer/tests",
    "artifacts: review-correctness.md, review-tests.md",
    "",
    "Run this Nico-lite subagent workflow using the available Agent(...) subagent tool when appropriate.",
    "User instruction: mention artifacts: fake.md without creating one",
  ].join("\n"));

  expect(parsed?.workflowRunId).toBe("workflow-run-123");
  expect(parsed?.artifacts).toEqual(["review-correctness.md", "review-tests.md"]);
});

test("subagent workflow card reads structured metadata before marker text", () => {
  const parsed = subagentWorkflowCardFromMessage({
    kind: "message",
    id: "metadata-message",
    role: "user",
    text: "ordinary user prompt without a marker",
    createdAt: new Date().toISOString(),
    metadata: {
      kind: "subagent-workflow",
      workflowRunId: "metadata-workflow-run",
      workflow: "Metadata workflow",
      roles: ["scout", "planner"],
      artifacts: ["context.md", "plan.md"],
    },
  });

  expect(parsed).toEqual({
    workflowRunId: "metadata-workflow-run",
    workflow: "Metadata workflow",
    roles: ["scout", "planner"],
    artifacts: ["context.md", "plan.md"],
  });
});

test("timeline renders subagent workflow marker as a compact card", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("subagent-timeline-card-workspace");
  await seedAgentDir(agentDir, { enabledModels: ["openai/gpt-5"] });

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Subagent timeline card session");
    await window.evaluate(async () => {
      await window.piApp?.submitComposer(
        [
          "SUBAGENT_WORKFLOW_RUN",
          "workflow_run_id: workflow-run-render",
          "workflow: Parallel review",
          "roles: reviewer/correctness -> reviewer/tests -> reviewer/simplicity",
          "artifacts: review-correctness.md, review-tests.md, review-simplicity.md",
        ].join("\n"),
      );
    });

    const card = window.getByTestId("subagent-timeline-card");
    await expect(card).toHaveAttribute("data-workflow-run-id", "workflow-run-render");
    await expect(card).toContainText("Parallel review");
    await expect(card).toContainText("reviewer/correctness");
    await expect(card).toContainText("reviewer/tests");
    await expect(card).toContainText("reviewer/simplicity");
    await expect(card).toContainText("review-correctness.md");

    await streamAssistantDeltas(harness, window, [[
      "SUBAGENT_WORKFLOW_RUN",
      "workflow: Assistant quoted marker",
      "roles: reviewer",
      "artifacts: assistant.md",
    ].join("\n")]);
    await expect(window.getByTestId("subagent-timeline-card")).toHaveCount(1);
  } finally {
    await harness.close();
  }
});
