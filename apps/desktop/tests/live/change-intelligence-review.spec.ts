import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  commitAllInGitRepo,
  getDesktopState,
  getRealAuthConfig,
  initGitRepo,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

test("maps a real provider file write and test to guided review evidence", async () => {
  test.setTimeout(300_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("live-change-intelligence-review");
  await initGitRepo(workspacePath);
  await writeFile(join(workspacePath, ".gitignore"), "node_modules/\n", "utf8");
  await commitAllInGitRepo(workspacePath, "initial");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    realAuthSourceDir: realAuth.sourceDir,
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Live change intelligence");
    const composer = window.getByTestId("composer");
    await composer.fill([
      "Use your structured write or edit tool (not shell redirection) to create src/px6-live.test.ts.",
      "Its exact contents must be:",
      'import { expect, test } from "vitest";',
      'test("px6 live proof", () => expect(2 + 2).toBe(4));',
      "Then use your bash tool to run exactly: pnpm exec vitest run src/px6-live.test.ts",
      "After the test passes, reply with exactly PX6_LIVE_VERIFIED.",
    ].join("\n"));
    await composer.press("Enter");

    await expect(window.getByTestId("transcript")).toContainText("PX6_LIVE_VERIFIED", { timeout: 240_000 });
    await expect.poll(async () => {
      const state = await getDesktopState(window);
      const workspace = state.workspaces.find((candidate) => candidate.path === workspacePath);
      return workspace?.sessions.find((session) => session.title === "Live change intelligence")?.status;
    }, { timeout: 240_000 }).toBe("idle");
    await expect.poll(async () => readFile(join(workspacePath, "src/px6-live.test.ts"), "utf8").catch(() => ""))
      .toContain("px6 live proof");

    const writeTool = window.locator(".timeline-tool").filter({ hasText: /Edited .*px6-live\.test\.ts/ }).last();
    await expect(writeTool).toBeVisible();
    await writeTool.getByTestId("timeline-tool-view-in-diff").click();
    await expect(window.locator('.diff-panel__file[data-file-path="src/px6-live.test.ts"]')).toHaveClass(/selected/);

    await composer.fill("/review");
    await composer.press("Escape");
    await composer.press("Enter");
    const review = window.getByTestId("review-surface");
    await expect(review).toBeVisible();
    await expect(review.locator(".review-mode__file", { hasText: "src/px6-live.test.ts" })).toBeVisible();
    const evidence = review.getByTestId("review-group-evidence");
    await expect(evidence).toContainText("request ");
    await expect(evidence).toContainText("run ");
    await expect(evidence).toContainText("tool ");
    await expect(evidence).toContainText("Verification · unrelated");
    await expect(evidence).toContainText("A trusted test explicitly references this path.");
    await expect(evidence).toContainText("Tests passed, but none explicitly link to this path.");
    await expect(evidence).toContainText("pnpm exec vitest run src/px6-live.test.ts");
  } finally {
    await harness.close();
  }
});
