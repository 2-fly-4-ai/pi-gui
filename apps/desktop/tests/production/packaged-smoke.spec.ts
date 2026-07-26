import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  launchPackagedDesktop,
  makeGitWorkspace,
  makeUserDataDir,
  resolvePackagedAppExecutable,
} from "../helpers/electron-app";
import { assertPackagedAppCanStartThread } from "./packaged-smoke-assertions";

test("launches the packaged app bundle and starts a thread through the real UI", async () => {
  test.setTimeout(120_000);

  const userDataDir = await makeUserDataDir("pi-gui-packaged-user-data-");
  const workspacePath = await makeGitWorkspace("packaged-smoke-workspace");
  await mkdir(join(workspacePath, "plans"), { recursive: true });
  await writeFile(join(workspacePath, "plans", "active.md"), "# Packaged handoff plan\n");
  const promptText = "Packaged smoke thread";
  const expectedExecutablePath = await resolvePackagedAppExecutable();
  const harness = await launchPackagedDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await assertPackagedAppCanStartThread(harness, window, {
      expectedExecutablePath,
      promptText,
      workspacePath,
    });
    await window.getByRole("button", { name: "Toggle changes" }).click();
    await expect(window.locator(".diff-panel")).toBeVisible();
  } finally {
    await harness.close();
  }

  const relaunched = await launchPackagedDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await relaunched.firstWindow();
    await expect(window.locator(".diff-panel")).toBeVisible();
    await window.keyboard.press("Meta+k");
    const palette = window.getByTestId("command-palette");
    await palette.getByPlaceholder("Search commands…").fill("workspace hub");
    await palette.getByRole("option", { name: /Workspace hub/ }).click();
    const hub = window.getByRole("dialog", { name: "Workspace hub" });
    const artifact = hub.locator(".workspace-hub__artifact", { hasText: "plans/active.md" });
    await artifact.getByLabel("Include in handoff").check();
    await hub.getByRole("button", { name: "Handoff" }).click();
    await hub.getByRole("button", { name: "Save to workspace" }).click();
    await expect(hub.getByRole("status")).toContainText("Saved .pi-gui/handoffs/");
    const handoffDir = join(workspacePath, ".pi-gui", "handoffs");
    const handoffPath = join(handoffDir, (await readdir(handoffDir))[0] ?? "");
    const handoff = await readFile(handoffPath, "utf8");
    expect(handoff).toContain("plans/active.md");
    expect(handoff).not.toContain(workspacePath);
  } finally {
    await relaunched.close();
  }
});
