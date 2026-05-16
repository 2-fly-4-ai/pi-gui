import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createSessionViaIpc,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedCompactedSessionFixture,
  seedTranscriptMessages,
  selectSession,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("keeps assistant markdown from widening the chat surface", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-layout-overflow-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Wide assistant markdown");

    const longToken = "x".repeat(2_400);
    const longPath = ["workspace", "generated", `${"deep".repeat(160)}.ts`].join("/");
    await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => [
        `A long inline token must wrap: ${longToken}`,
        "",
        "```ts",
        `const generatedIdentifier = \"${longToken}\";`,
        "```",
        "",
        "| file | note |",
        "| --- | --- |",
        `| ${longPath} | ${longToken} |`,
      ].join("\n"),
    });

    await expect(window.getByTestId("transcript")).toContainText("A long inline token must wrap");

    await expect
      .poll(async () => {
        return window.evaluate(() => {
          const pane = document.querySelector<HTMLElement>("[data-testid='timeline-pane']");
          const transcript = document.querySelector<HTMLElement>("[data-testid='transcript']");
          const main = document.querySelector<HTMLElement>(".main");
          if (!pane || !transcript || !main) {
            return null;
          }
          const paneRect = pane.getBoundingClientRect();
          const transcriptRect = transcript.getBoundingClientRect();
          const mainRect = main.getBoundingClientRect();
          const widestMessageRight = Math.max(
            ...Array.from(document.querySelectorAll<HTMLElement>(".timeline-item, .timeline-tool"), (node) =>
              node.getBoundingClientRect().right,
            ),
          );
          return {
            documentOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
            paneOverflows: pane.scrollWidth > pane.clientWidth + 1,
            transcriptWithinPane: transcriptRect.right <= paneRect.right + 1,
            messagesWithinMain: widestMessageRight <= mainRect.right + 1,
          };
        });
      })
      .toEqual({
        documentOverflows: false,
        paneOverflows: false,
        transcriptWithinPane: true,
        messagesWithinMain: true,
      });
  } finally {
    await harness.close();
  }
});

test("keeps compacted session context collapsed until requested", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-compaction-workspace");
  const title = "Compacted history thread";
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir);
  const longArtifactPath = "/Users/brianfarley/Desktop/Githhub-project/serp-extensions-v2-app-factory/runtime/probes/browser-inspect-artifacts/stragglers-1/network-interesting.json";
  const summaryText = [
    "## Goal",
    "False-pass rerun recap should stay readable after compaction.",
    "",
    "<read-files>",
    Array.from({ length: 16 }, () => longArtifactPath).join("\n"),
    "</read-files>",
  ].join("\n");
  await seedCompactedSessionFixture(agentDir, workspacePath, title, summaryText);

  const secondRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    agentDir,
  });

  try {
    const window = await secondRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await selectSession(window, title);

    const card = window.getByTestId("timeline-compaction-summary");
    await expect(card).toBeVisible();
    await expect(card).toContainText("False-pass rerun recap should stay readable");
    await expect(card).not.toContainText(longArtifactPath);
    await expect
      .poll(async () => card.evaluate((node) => Math.round(node.getBoundingClientRect().height)))
      .toBeLessThan(180);

    await card.getByRole("button", { name: "Show compacted context" }).click();
    await expect(card).toContainText(longArtifactPath);
    await expect(card.getByRole("button", { name: "Hide compacted context" })).toBeVisible();
  } finally {
    await secondRun.close();
  }
});

test("opens the latest assistant plan in a side panel and queues an implementation prompt", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("plan-panel-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Plan panel thread");
    await seedTranscriptMessages(harness, window, {
      count: 2,
      textFactory: (index) =>
        index === 0
          ? "# Old Plan\n\n1. Old plan step\n\n- [ ] Do old thing"
          : "# Implementation Plan\n\n1. Add the model.\n2. Add the UI.\n\n- [ ] Write tests\n- [ ] Implement feature",
    });

    const composer = window.getByTestId("composer");
    await composer.fill("draft before plan prompt");

    await expect(window.getByLabel("Toggle plan")).toBeVisible();
    await window.getByLabel("Toggle plan").click();
    const panel = window.getByTestId("plan-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Implementation Plan");
    await expect(panel).toContainText("Write tests");
    await expect(panel).not.toContainText("Old plan step");

    await panel.getByRole("button", { name: "Ask pi to implement this plan" }).click();
    await expect(composer).toHaveValue(/draft before plan prompt/);
    await expect(composer).toHaveValue(/Please implement this plan/);
    await expect(composer).toHaveValue(/Add the model/);
    await expect(composer).not.toHaveValue(/Old plan step/);
    await expect(composer).toBeFocused();
  } finally {
    await harness.close();
  }
});
