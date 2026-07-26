import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  commitAllInGitRepo,
  createNamedThread,
  initGitRepo,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedTranscriptMessages,
} from "../helpers/electron-app";

test("shows only safe contextual actions for assistant file and shell results", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("contextual-result-actions");
  await initGitRepo(workspacePath);
  await mkdir(join(workspacePath, "src"), { recursive: true });
  await writeFile(join(workspacePath, "src/a.ts"), "export const a = 1;\n");
  await commitAllInGitRepo(workspacePath, "initial");
  await writeFile(join(workspacePath, "src/a.ts"), "export const a = 2;\n");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Contextual actions");
    await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => [
        "Inspect `src/a.ts:1`.",
        "",
        "```bash",
        "pnpm test src/a.ts",
        "```",
        "",
        "```diff",
        "+unsafe patch without provenance",
        "```",
      ].join("\n"),
    });
    const assistant = window.locator(".timeline-item--assistant").last();
    await assistant.getByRole("button", { name: "Open" }).click();
    await expect(window.locator('.diff-panel__file[data-file-path="src/a.ts"]')).toHaveClass(/selected/);
    await expect(assistant.getByRole("button", { name: "Copy code block" })).toHaveCount(2);
    await expect(assistant.getByRole("button", { name: "Preview Apply" })).toHaveCount(0);
    await assistant.getByRole("button", { name: "Preview Run" }).click();
    const preview = window.getByTestId("command-preview-dialog");
    await expect(preview).toContainText("Agent-proposed command");
    await expect(preview).toContainText("pnpm test src/a.ts");
    await expect(preview).toContainText(workspacePath);
    await preview.getByRole("button", { name: "Deny" }).click();
    await expect(preview).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
