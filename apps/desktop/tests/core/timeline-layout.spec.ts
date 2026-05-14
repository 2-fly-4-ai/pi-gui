import { expect, test } from "@playwright/test";
import {
  createSessionViaIpc,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedTranscriptMessages,
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
