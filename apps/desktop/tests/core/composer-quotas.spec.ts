import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  stubNextOpenDialog,
} from "../helpers/electron-app";

test("oversized composer payloads fail visibly without silently discarding attachments or drafts", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("composer-quota-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Composer quotas");
    const paths = await Promise.all(Array.from({ length: 13 }, async (_, index) => {
      const filePath = join(workspacePath, `attachment-${index}.txt`);
      await writeFile(filePath, `attachment ${index}`);
      return filePath;
    }));
    await stubNextOpenDialog(harness, paths);
    await window.getByRole("button", { name: "Attach files" }).click();
    await expect(window.getByTestId("composer-error-banner")).toContainText("Attach up to 12");
    await expect(window.locator(".composer-attachment")).toHaveCount(0);

    const composer = window.getByTestId("composer");
    await composer.fill("Keep this unsent draft");
    const oversizedError = await window.evaluate(async () => {
      try {
        await window.piApp?.submitComposer("x".repeat(500_001));
        return "";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(oversizedError).toContain("500,000 characters or shorter");
    await expect(composer).toHaveValue("Keep this unsent draft");
  } finally {
    await harness.close();
  }
});
