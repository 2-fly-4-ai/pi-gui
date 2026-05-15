import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function stageAllFiles(workspacePath: string): Promise<void> {
  await runCommand("git", ["add", "-A"], workspacePath);
}

export async function commitChanges(workspacePath: string, message: string): Promise<void> {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    throw new Error("Commit message is required.");
  }
  await runCommand("git", ["commit", "-m", trimmedMessage], workspacePath);
}

export async function pushBranch(workspacePath: string, options?: { readonly setUpstream?: boolean }): Promise<void> {
  const args = options?.setUpstream
    ? ["push", "--set-upstream", "origin", await currentBranch(workspacePath)]
    : ["push"];
  await runCommand("git", args, workspacePath);
}

export async function createPullRequest(
  workspacePath: string,
  input: { readonly title: string; readonly body: string; readonly base: string },
): Promise<{ readonly url?: string }> {
  const title = input.title.trim();
  const base = input.base.trim();
  if (!title) {
    throw new Error("Pull request title is required.");
  }
  if (!base) {
    throw new Error("Base branch is required.");
  }
  const { stdout } = await runCommand(
    "gh",
    ["pr", "create", "--title", title, "--body", input.body, "--base", base],
    workspacePath,
  );
  const url = stdout.split(/\s+/).find((token) => /^https:\/\//.test(token));
  return url ? { url } : {};
}

async function currentBranch(workspacePath: string): Promise<string> {
  const { stdout } = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], workspacePath);
  return stdout.trim();
}

async function runCommand(command: string, args: readonly string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(command, [...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (command === "gh" && code === "ENOENT") {
      throw new Error("GitHub CLI is required to create PRs from Pi. Install gh or create the PR in GitHub.");
    }
    const stderr = typeof error === "object" && error && "stderr" in error && typeof error.stderr === "string"
      ? error.stderr.trim()
      : "";
    const stdout = typeof error === "object" && error && "stdout" in error && typeof error.stdout === "string"
      ? error.stdout.trim()
      : "";
    const message = stderr || stdout || (error instanceof Error ? error.message : String(error));
    throw new Error(message);
  }
}
