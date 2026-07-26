import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import {
  commitAllInGitRepo,
  createNamedThread,
  initGitRepo,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

const execFileAsync = promisify(execFile);

async function seedWorkspace(): Promise<string> {
  const workspacePath = await makeWorkspace("integrated-review-mode");
  await initGitRepo(workspacePath);
  await mkdir(join(workspacePath, "src"), { recursive: true });
  await writeFile(join(workspacePath, "src", "example.ts"), "export const value = 1;\nexport const other = 1;\n", "utf8");
  await commitAllInGitRepo(workspacePath, "init");
  await execFileAsync("git", ["checkout", "-b", "feature-review"], { cwd: workspacePath });
  await writeFile(join(workspacePath, "src", "example.ts"), "export const value = 2;\nexport const other = 2;\n", "utf8");
  return workspacePath;
}

test("/review opens in-app review surface and submits comments into composer", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await seedWorkspace();
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  const window = await harness.firstWindow();

  try {
    await createNamedThread(window, "Integrated review mode");
    const composer = window.getByTestId("composer");
    await composer.fill("/review");
    await composer.press("Enter");

    const reviewSurface = window.getByTestId("review-surface");
    await expect(reviewSurface).toBeVisible();
    await expect(reviewSurface.getByRole("button", { name: /src\/example\.ts/ })).toBeVisible();

    await reviewSurface.locator(".review-mode__line").first().click();
    await reviewSurface.getByLabel("Review comment").fill("Please avoid changing this constant without a named domain reason.");
    await reviewSurface.getByRole("button", { name: "Save comment" }).click();
    await reviewSurface.getByRole("button", { name: /Submit 1 comment/ }).click();

    await expect(composer).toHaveValue(/Please address this review/);
    await expect(composer).toHaveValue(/src\/example\.ts/);
    await expect(composer).toHaveValue(/Please avoid changing this constant/);
  } finally {
    await harness.close();
  }
});

test("review drafts persist when leaving and reopening the review surface", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await seedWorkspace();
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  const window = await harness.firstWindow();

  try {
    await createNamedThread(window, "Persistent review mode");
    const composer = window.getByTestId("composer");
    await composer.fill("/review");
    await composer.press("Enter");

    const reviewSurface = window.getByTestId("review-surface");
    await reviewSurface.getByLabel("Review comment").fill("Persist this review note.");
    await reviewSurface.getByRole("button", { name: "Save comment" }).click();
    await reviewSurface.getByRole("button", { name: "Cancel" }).click();

    await composer.fill("/review");
    await composer.press("Enter");
    await expect(window.getByTestId("review-surface").getByText("Persist this review note.")).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("asks about an exact frozen diff location without copying unrelated content", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await seedWorkspace();
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Inline review question");
    const composer = window.getByTestId("composer");
    await composer.fill("/review");
    await composer.press("Enter");
    const review = window.getByTestId("review-surface");
    await review.locator(".review-mode__line").filter({ hasText: "export const value = 2" }).click();
    await review.locator(".review-mode__line").filter({ hasText: "export const other = 2" }).click({ modifiers: ["Shift"] });
    await expect(review.locator(".review-mode__line--in-range")).toHaveCount(2);
    await review.getByRole("button", { name: "Ask Pi about selected location" }).click();
    await expect(composer).toHaveValue(/File: src\/example\.ts/);
    await expect(composer).toHaveValue(/Review snapshot:/);
    await expect(composer).toHaveValue(/Lines: 1–2/);
    await expect(composer).toHaveValue(/state if this mapping is stale/);
    await expect(composer).not.toHaveValue(/unrelated transcript/i);
    await composer.fill("/review");
    await composer.press("Enter");
    const reopened = window.getByTestId("review-surface");
    const questions = reopened.getByTestId("review-questions");
    await expect(questions).toContainText("Stale line mapping");
    await expect(questions.getByRole("button", { name: "Original checkpoint unavailable" })).toBeDisabled();
    await reopened.locator(".review-mode__line").filter({ hasText: "export const value" }).first().click();
    await questions.getByRole("button", { name: "Refresh mapping to selected line" }).click();
    await expect(questions).toContainText("Current mapping");
  } finally {
    await harness.close();
  }
});

test("/review --base includes branch and working-tree changes", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await seedWorkspace();
  await writeFile(join(workspacePath, "src", "committed.ts"), "export const committed = true;\n", "utf8");
  await execFileAsync("git", ["add", "src/committed.ts"], { cwd: workspacePath });
  await execFileAsync("git", ["commit", "-m", "add committed change"], { cwd: workspacePath });
  await writeFile(join(workspacePath, "src", "working.ts"), "export const working = true;\n", "utf8");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  const window = await harness.firstWindow();

  try {
    await createNamedThread(window, "Base review mode");
    const composer = window.getByTestId("composer");
    await composer.fill("/review --base main");
    await composer.press("Enter");

    const reviewSurface = window.getByTestId("review-surface");
    await expect(reviewSurface.getByText(/against main/)).toBeVisible();
    await expect(reviewSurface.getByRole("button", { name: /src\/committed\.ts/ })).toBeVisible();
    await expect(reviewSurface.getByRole("button", { name: /src\/working\.ts/ })).toBeVisible();
  } finally {
    await harness.close();
  }
});
