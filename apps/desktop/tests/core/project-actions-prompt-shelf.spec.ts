import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createNamedThread, launchDesktop, makeUserDataDir, makeWorkspace, openNewThread, waitForWorkspaceByPath } from "../helpers/electron-app";

test("project actions require explicit trust, run through terminal, and persist across restart", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("project-actions-v2");
  await writeFile(join(workspacePath, "package.json"), JSON.stringify({ scripts: { mark: "node -e \"require('fs').writeFileSync('action-ran.txt','ok')\"" } }), "utf8");
  let harness = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
  try {
    let window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Project action host");
    await openPaletteAction(window, "Manage project actions");
    const surface = window.getByTestId("project-actions-surface");
    await expect(surface).toBeVisible();
    await surface.getByRole("button", { name: "Discover scripts" }).click();
    await expect(surface).toContainText("untrusted previews");
    await surface.getByRole("button", { name: "Review and save…" }).click();
    await expect(surface.getByLabel("Command")).toHaveValue("npm run mark");
    expect(await readFile(join(workspacePath, "action-ran.txt"), "utf8").catch(() => "missing")).toBe("missing");
    await surface.getByRole("button", { name: "Save as trusted action" }).click();
    await expect(surface).toContainText("Action saved and trusted");
    await surface.getByRole("button", { name: "Run", exact: true }).click();
    await expect.poll(async () => readFile(join(workspacePath, "action-ran.txt"), "utf8").catch(() => "missing"), { timeout: 15_000 }).toBe("ok");
    await harness.close();

    harness = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
    window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await openPaletteAction(window, "Manage project actions");
    await expect(window.getByTestId("project-actions-surface")).toContainText("npm run mark");
    await expect(window.getByTestId("project-actions-surface")).toContainText("Primary");
  } finally {
    await harness.close().catch(() => undefined);
  }
});

test("Prompt Shelf persists before clearing and restores only into an explicit task", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("prompt-shelf");
  let harness = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
  try {
    let window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Shelf destination");
    const composer = window.getByTestId("composer");
    await composer.fill("A durable prompt for later");
    await window.getByRole("button", { name: "Stash prompt" }).click();
    await expect.poll(async () => (await window.evaluate(async () => window.piApp?.listPromptShelf()))?.length ?? 0).toBe(1);
    await expect(composer).toHaveValue("");
    const stored = await window.evaluate(async () => window.piApp?.listPromptShelf());
    expect(stored).toHaveLength(1);
    expect(stored?.[0]?.preview).toContain("durable prompt");
    await harness.close();

    harness = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
    window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await openPaletteAction(window, "Open Prompt Shelf");
    const shelf = window.getByTestId("prompt-shelf-surface");
    await expect(shelf).toContainText("A durable prompt for later");
    await shelf.getByRole("button", { name: "Restore…" }).click();
    const dialog = window.getByRole("dialog", { name: "Choose an explicit destination" });
    await expect(dialog.getByLabel("Workspace / task")).not.toHaveValue("");
    await dialog.getByRole("button", { name: "Copy into task" }).click();
    await shelf.getByRole("button", { name: "Back to app" }).click();
    await expect(window.getByTestId("composer")).toHaveValue("A durable prompt for later");
    expect(await window.evaluate(async () => window.piApp?.listPromptShelf())).toHaveLength(1);
  } finally {
    await harness.close().catch(() => undefined);
  }
});

test("Prompt Shelf stashes a new-task draft only after the main-owned write succeeds", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("prompt-shelf-new-task");
  const harness = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await openNewThread(window);
    const composer = window.getByTestId("new-thread-composer");
    await composer.fill("Keep this before creating a task");
    const stashButton = window.getByRole("button", { name: "Stash prompt" });
    if (await stashButton.count() === 0) {
      await window.getByRole("button", { name: "More composer controls" }).click();
    }
    await stashButton.click();
    await expect.poll(async () => (await window.evaluate(async () => window.piApp?.listPromptShelf()))?.length ?? 0).toBe(1);
    await expect(composer).toHaveValue("");
    const stored = await window.evaluate(async () => window.piApp?.listPromptShelf());
    expect(stored?.[0]?.preview).toContain("before creating a task");
    expect(stored?.[0]?.source).toBeUndefined();
  } finally {
    await harness.close();
  }
});

async function openPaletteAction(window: Page, label: string): Promise<void> {
  await window.keyboard.press("Meta+k");
  const palette = window.getByTestId("command-palette");
  await palette.getByPlaceholder("Search commands…").fill(label);
  await palette.getByRole("option", { name: new RegExp(label, "i") }).click();
}
