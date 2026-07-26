import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  commitAllInGitRepo,
  createNamedThread,
  getDesktopState,
  initGitRepo,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

test("workspace hub converges palette, artifacts, handoff, shortcuts, and Settings search", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("workspace-productivity");
  await initGitRepo(workspacePath);
  await mkdir(join(workspacePath, "plans"), { recursive: true });
  await mkdir(join(workspacePath, "reports"), { recursive: true });
  await mkdir(join(workspacePath, "private"), { recursive: true });
  await writeFile(join(workspacePath, "README.md"), "# Workspace productivity\n");
  await commitAllInGitRepo(workspacePath, "initial");
  await writeFile(join(workspacePath, "plans", "active.md"), "# Active plan\n");
  await writeFile(join(workspacePath, "reports", "summary.md"), "# Report\n");
  await writeFile(join(workspacePath, "private", "runtime.log"), "SECRET=not-for-preview\n");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Productivity indexed thread");

    await window.keyboard.press("Meta+k");
    const palette = window.getByTestId("command-palette");
    await palette.getByPlaceholder("Search commands…").fill("Productivity indexed thread");
    await expect(palette.getByRole("option")).toContainText("Threads");
    await palette.getByRole("button", { name: "Pin selected command" }).click();
    await window.keyboard.press("Escape");

    await window.keyboard.press("Meta+k");
    await palette.getByPlaceholder("Search commands…").fill("plans/active.md");
    await expect(palette.getByRole("option")).toContainText("Artifacts");
    await window.keyboard.press("Escape");

    await window.keyboard.press("Meta+k");
    await palette.getByPlaceholder("Search commands…").fill("worker agent");
    await expect(palette.getByRole("option")).toContainText("Agents");
    await window.keyboard.press("Escape");

    await window.keyboard.press("Meta+k");
    await palette.getByPlaceholder("Search commands…").fill("workspace hub");
    await palette.getByRole("option", { name: /Workspace hub/ }).click();
    const hub = window.getByRole("dialog", { name: "Workspace hub" });
    await expect(hub).toBeVisible();
    const shelf = hub.getByTestId("artifact-shelf");
    await expect(shelf).toContainText("plans/active.md");
    await expect(shelf).toContainText("reports/summary.md");
    await expect(shelf).toContainText("private/runtime.log");
    await expect(shelf.locator(".workspace-hub__artifact", { hasText: "private/runtime.log" })).toContainText("private");

    const planArtifact = shelf.locator(".workspace-hub__artifact", { hasText: "plans/active.md" });
    await planArtifact.getByLabel("Include in handoff").check();
    await hub.getByRole("button", { name: "Handoff" }).click();
    const handoff = hub.getByTestId("workspace-handoff");
    await expect(handoff.locator("pre")).toContainText("plans/active.md");
    await expect(handoff.locator("pre")).not.toContainText("private/runtime.log");
    await expect(handoff.locator("pre")).not.toContainText(workspacePath);
    await handoff.getByRole("button", { name: "Save and attach to next message" }).click();
    await expect(window.locator(".composer-attachment")).toContainText(/handoff-.*\.md/);
    const attachedState = await getDesktopState(window);
    const attachedArtifact = attachedState.composerAttachments.find((attachment) => attachment.kind === "file");
    expect(attachedArtifact?.kind).toBe("file");
    if (attachedArtifact?.kind !== "file") throw new Error("Expected a file artifact attachment");
    expect(attachedArtifact.fsPath.startsWith(workspacePath)).toBe(false);
    expect(attachedArtifact.artifactReference?.version).toMatchObject({
      sizeBytes: expect.any(Number),
      modifiedAt: expect.any(String),
    });
    await expect(readFile(attachedArtifact.fsPath, "utf8")).resolves.toContain("Workspace handoff");
    const handoffDir = join(workspacePath, ".pi-gui", "handoffs");
    await expect.poll(async () => readFile(join(handoffDir, (await import("node:fs/promises").then(({ readdir }) => readdir(handoffDir)))[0] ?? ""), "utf8").catch(() => ""))
      .toContain("Workspace handoff");

    await window.keyboard.press("Meta+k");
    await palette.getByPlaceholder("Search commands…").fill("workspace hub");
    await palette.getByRole("option", { name: /Workspace hub/ }).click();
    await hub.getByRole("button", { name: "Worktree" }).click();
    await expect(hub.getByTestId("worktree-lifecycle-card")).toContainText("cleanup");
    await expect(hub.getByTestId("worktree-lifecycle-card")).toContainText("never deletes");

    await hub.getByRole("button", { name: "Shortcuts" }).click();
    await hub.getByLabel("Shortcut command").selectOption("toggle-changes");
    await hub.getByLabel("Shortcut keys").fill("Cmd+Shift+1");
    await hub.getByRole("button", { name: "Assign" }).click();
    await expect(hub.getByTestId("workspace-shortcuts")).toContainText("cmd+shift+1");
    await hub.getByRole("button", { name: "Close" }).click();
    await window.keyboard.press("Meta+Shift+1");
    await expect(window.locator(".diff-panel")).toBeVisible();

    await window.keyboard.press("Meta+k");
    await palette.getByPlaceholder("Search commands…").fill("appearance settings");
    await palette.getByRole("option", { name: /Appearance settings/ }).click();
    const settings = window.getByTestId("settings-surface");
    await settings.getByLabel("Search settings").fill("make text bigger");
    await settings.getByRole("option", { name: /Make text bigger/ }).click();
    await expect(settings.locator(".settings-search-target")).toBeVisible();
    await expect(settings).toContainText("Appearance");

    await window.keyboard.press("Meta+k");
    await palette.getByPlaceholder("Search commands…").fill("workspace hub");
    await palette.getByRole("option", { name: /Workspace hub/ }).click();
    await hub.getByRole("button", { name: "Close" }).click();
    await window.keyboard.press("Meta+k");
    const recommendation = palette.getByTestId("adaptive-recommendation");
    await expect(recommendation).toContainText("Pin Workspace hub?");
    await expect(recommendation).toContainText("3 times in this workspace");
    await expect(recommendation).toContainText("Nothing moves unless you apply it");
    await recommendation.getByRole("button", { name: "Apply" }).click();
    await expect(recommendation).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("workspace panel layouts survive switching and relaunch, clamp narrow windows, and reset explicitly", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const firstWorkspacePath = await makeWorkspace("layout-first");
  const secondWorkspacePath = await makeWorkspace("layout-second");
  const first = await launchDesktop(userDataDir, {
    initialWorkspaces: [firstWorkspacePath, secondWorkspacePath],
    testMode: "background",
  });

  try {
    const window = await first.firstWindow();
    await createNamedThread(window, "First layout thread", { workspaceName: basename(firstWorkspacePath) });
    await createNamedThread(window, "Second layout thread", { workspaceName: basename(secondWorkspacePath) });
    await window.locator(".session-row", { hasText: "First layout thread" }).click();

    await window.getByRole("button", { name: "Toggle changes" }).click();
    await window.getByRole("button", { name: "Toggle terminal" }).click();
    await window.getByRole("button", { name: "Open panels menu" }).click();
    await window.getByRole("menu", { name: "Panels and tools" }).getByText("App logs").click();
    await expect(window.locator(".diff-panel")).toBeVisible();
    await expect(window.getByTestId("integrated-terminal")).toBeVisible();
    await expect(window.getByTestId("logs-panel")).toBeVisible();

    await window.locator(".session-row", { hasText: "Second layout thread" }).click();
    await expect(window.locator(".diff-panel")).toHaveCount(0);
    await expect(window.getByTestId("integrated-terminal")).toHaveCount(0);
    await expect(window.getByTestId("logs-panel")).toHaveCount(0);

    await window.locator(".session-row", { hasText: "First layout thread" }).click();
    await expect(window.locator(".diff-panel")).toBeVisible();
    await expect(window.getByTestId("integrated-terminal")).toBeVisible();
    await expect(window.getByTestId("logs-panel")).toBeVisible();
    await window.setViewportSize({ width: 720, height: 760 });
    await expect.poll(() => window.evaluate(() => ({
      noWindowOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      logsInsideWindow: (() => {
        const bounds = document.querySelector<HTMLElement>("[data-testid='logs-panel']")?.getBoundingClientRect();
        return Boolean(bounds && bounds.left >= 0 && bounds.right <= window.innerWidth + 1);
      })(),
    }))).toEqual({ noWindowOverflow: true, logsInsideWindow: true });
  } finally {
    await first.close();
  }

  const relaunched = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await relaunched.firstWindow();
    await window.locator(".session-row", { hasText: "First layout thread" }).click();
    await expect(window.locator(".diff-panel")).toBeVisible();
    await expect(window.getByTestId("integrated-terminal")).toBeVisible();
    await expect(window.getByTestId("logs-panel")).toBeVisible();

    window.once("dialog", (dialog) => void dialog.accept());
    await window.keyboard.press("Meta+k");
    const palette = window.getByTestId("command-palette");
    await palette.getByPlaceholder("Search commands…").fill("reset workspace layout");
    await palette.getByRole("option", { name: /Reset workspace layout/ }).click();
    await expect(window.locator(".diff-panel")).toHaveCount(0);
    await expect(window.getByTestId("integrated-terminal")).toHaveCount(0);
    await expect(window.getByTestId("logs-panel")).toHaveCount(0);
  } finally {
    await relaunched.close();
  }
});
