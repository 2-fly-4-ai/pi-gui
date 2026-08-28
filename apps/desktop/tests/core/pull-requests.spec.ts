import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { launchDesktop, makeGitWorkspace, makeUserDataDir, waitForWorkspaceByPath } from "../helpers/electron-app";

const execFileAsync = promisify(execFile);

test("pull request workbench loads bounded GitHub data and previews writes", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("pull-request-workbench");
  await execFileAsync("git", ["remote", "add", "origin", "git@github.example.com:acme/pi-app.git"], { cwd: workspacePath });
  const binDir = join(userDataDir, "fake-bin");
  await mkdir(binDir, { recursive: true });
  const ghPath = join(binDir, "gh");
  await writeFile(ghPath, `#!/bin/sh
case "$1 $2" in
  "--version ") echo "gh version 9.9.9" ;;
  "auth status") echo "Logged in" ;;
  "api user") echo "octocat" ;;
  "repo view") echo '{"defaultBranchRef":{"name":"main"}}' ;;
  "pr list") echo '[{"number":17,"title":"Improve runtime safety","url":"https://github.example.com/acme/pi-app/pull/17","state":"OPEN","isDraft":false,"headRefName":"feature/runtime","baseRefName":"main","updatedAt":"2026-08-28T00:00:00Z","author":{"login":"octocat"},"additions":42,"deletions":7,"changedFiles":3,"reviewDecision":"REVIEW_REQUIRED","statusCheckRollup":[{"name":"unit","conclusion":"SUCCESS"},{"name":"electron","status":"IN_PROGRESS"}]}]' ;;
  "pr view") echo '{"number":17,"title":"Improve runtime safety","url":"https://github.example.com/acme/pi-app/pull/17","state":"OPEN","isDraft":false,"headRefName":"feature/runtime","baseRefName":"main","updatedAt":"2026-08-28T00:00:00Z","createdAt":"2026-08-27T00:00:00Z","author":{"login":"octocat"},"additions":42,"deletions":7,"changedFiles":3,"reviewDecision":"REVIEW_REQUIRED","mergeable":"MERGEABLE","body":"Bounds background work.","statusCheckRollup":[{"name":"unit","conclusion":"SUCCESS"},{"name":"electron","status":"IN_PROGRESS"}],"reviews":[{"id":"r1","author":{"login":"reviewer"},"state":"COMMENTED","body":"Please verify memory bounds.","submittedAt":"2026-08-28T00:00:00Z"}],"comments":[{"id":"IC_own","author":{"login":"octocat"},"body":"My earlier note","createdAt":"2026-08-28T00:00:00Z"}],"files":[{"path":"src/runtime.ts","additions":40,"deletions":7}],"commits":[{"oid":"abcdef","messageHeadline":"Bound runtime","authoredDate":"2026-08-27T00:00:00Z","authors":[{"login":"octocat"}]}]}' ;;
  *) echo "unexpected gh invocation: $*" >&2; exit 2 ;;
esac
`, "utf8");
  await chmod(ghPath, 0o755);

  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` },
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await window.evaluate(async () => {
      const app = window.piApp;
      if (!app) throw new Error("Pi API unavailable");
      const snapshot = await app.getState();
      if (!snapshot.selectedWorkspaceId) throw new Error("Workspace selection unavailable");
      await app.createSession({ workspaceId: snapshot.selectedWorkspaceId, title: "PR workbench" });
    });
    await window.getByRole("button", { name: "GitHub actions" }).click();
    await window.getByRole("button", { name: "Pull requests" }).click();

    const workbench = window.getByTestId("pull-request-workbench");
    await expect(workbench).toBeVisible();
    await expect(workbench).toContainText("acme/pi-app");
    await expect(workbench).toContainText("Improve runtime safety");
    await workbench.getByRole("button", { name: "Checks" }).click();
    await expect(workbench).toContainText("electron");
    await workbench.getByRole("button", { name: "Files" }).click();
    await expect(workbench).toContainText("src/runtime.ts");
    await expect(workbench.getByRole("button", { name: "Edit details" })).toBeVisible();
    await workbench.getByRole("button", { name: "Reviews" }).click();
    await workbench.getByRole("button", { name: "Edit your comment" }).click();
    await expect(window.getByRole("heading", { name: "Edit your comment" })).toBeVisible();
    await window.getByRole("button", { name: "Cancel" }).click();

    await workbench.getByRole("button", { name: "Checkout" }).click();
    const preview = window.getByRole("dialog", { name: "Check out pull request #17?" });
    await expect(preview).toContainText("working-tree files can change");
    await preview.getByRole("button", { name: "Cancel" }).click();

    await workbench.getByRole("button", { name: "Link task" }).click();
    await expect(workbench.getByRole("button", { name: "Unlink task" })).toBeVisible();

    const snapshot = await window.evaluate(async () => window.piApp?.getSourceControlSnapshot((await window.piApp.getState()).selectedWorkspaceId!, false));
    expect(snapshot?.fromCache).toBe(true);
    expect(snapshot?.openPullRequests).toHaveLength(1);
    await harness.close();

    harness = await launchDesktop(userDataDir, {
      initialWorkspaces: [workspacePath],
      testMode: "background",
      envOverrides: { PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` },
    });
    const restarted = await harness.firstWindow();
    await waitForWorkspaceByPath(restarted, workspacePath);
    if (await restarted.getByTestId("pull-request-workbench").count() === 0) {
      await restarted.getByRole("button", { name: "GitHub actions" }).click();
      await restarted.getByRole("button", { name: "Pull requests", exact: true }).click();
    }
    await expect(restarted.getByTestId("pull-request-workbench").getByRole("button", { name: "Unlink task" })).toBeVisible();
  } finally {
    await harness.close().catch(() => undefined);
  }
});
