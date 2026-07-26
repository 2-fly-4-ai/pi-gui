import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  initGitRepo,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

const execFileAsync = promisify(execFile);

test("Reveal opens the selected artifact in the real macOS Finder", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("artifact-reveal");
  const revealFolder = `native-reveal-${Date.now()}`;
  const relativePath = `${revealFolder}/summary.md`;
  const artifactPath = join(workspacePath, relativePath);
  await initGitRepo(workspacePath);
  await mkdir(join(workspacePath, revealFolder), { recursive: true });
  await writeFile(artifactPath, "# Native reveal proof\n");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "foreground",
  });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Artifact reveal");
    await window.keyboard.press("Meta+k");
    const palette = window.getByTestId("command-palette");
    await palette.getByPlaceholder("Search commands…").fill("workspace hub");
    await palette.getByRole("option", { name: /Workspace hub/ }).click();
    const artifact = window.locator(".workspace-hub__artifact", { hasText: relativePath });
    await expect(artifact).toBeVisible();
    await artifact.getByRole("button", { name: "Reveal" }).click();

    await expect.poll(async () => {
      const source = [
        "import CoreGraphics",
        "let windows = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []",
        "for window in windows {",
        "  if (window[kCGWindowOwnerName as String] as? String) == \"Finder\" {",
        "    print(window[kCGWindowName as String] as? String ?? \"\")",
        "  }",
        "}",
      ].join("\n");
      const result = await execFileAsync("swift", ["-e", source]);
      return result.stdout;
    }, { timeout: 15_000 }).toContain(revealFolder);
  } finally {
    await harness.close();
  }
});
