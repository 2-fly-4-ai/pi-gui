import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { parseSubagentWorkflowMarker } from "../../src/subagent-timeline-card";
import { createNamedThread, launchDesktop, makeUserDataDir, makeWorkspace, seedAgentDir, streamAssistantDeltas } from "../helpers/electron-app";

test("subagent workflow marker parser stops metadata before body text", () => {
  const parsed = parseSubagentWorkflowMarker([
    "SUBAGENT_WORKFLOW_RUN",
    "workflow: Parallel review",
    "roles: reviewer/correctness -> reviewer/tests",
    "artifacts: review-correctness.md, review-tests.md",
    "",
    "Run this Nico-lite subagent workflow using the available Agent(...) subagent tool when appropriate.",
    "User instruction: mention artifacts: fake.md without creating one",
  ].join("\n"));

  expect(parsed?.artifacts).toEqual(["review-correctness.md", "review-tests.md"]);
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
          "workflow: Parallel review",
          "roles: reviewer/correctness -> reviewer/tests -> reviewer/simplicity",
          "artifacts: review-correctness.md, review-tests.md, review-simplicity.md",
        ].join("\n"),
      );
    });

    const card = window.getByTestId("subagent-timeline-card");
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
