import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { ReviewFileSnapshot, ReviewSnapshot } from "../../src/review/review-types";
import { parseReviewDiff } from "../../src/review/review-diff-parser";
import { getChangedFiles } from "../app-store-diff";

const execFileAsync = promisify(execFile);

export async function createReviewSnapshot(workspaceId: string, workspacePath: string): Promise<ReviewSnapshot> {
  const changedFiles = await getChangedFiles(workspacePath);
  const files: ReviewFileSnapshot[] = [];

  for (const file of changedFiles) {
    const diff = await getFrozenFileDiff(workspacePath, file.path);
    if (!diff.trim()) {
      continue;
    }

    const parsed = parseReviewDiff(file.path, diff);
    files.push({
      path: file.path,
      status: file.status,
      diff,
      anchors: parsed.anchors,
    });
  }

  return {
    id: randomUUID(),
    workspaceId,
    createdAt: new Date().toISOString(),
    files,
  };
}

async function getFrozenFileDiff(workspacePath: string, filePath: string): Promise<string> {
  const unstaged = await runGitDiff(workspacePath, ["diff", "--", filePath]);
  if (unstaged.trim()) {
    return unstaged;
  }

  const staged = await runGitDiff(workspacePath, ["diff", "--cached", "--", filePath]);
  if (staged.trim()) {
    return staged;
  }

  return runGitDiff(workspacePath, ["diff", "--no-index", "--", "/dev/null", filePath], true);
}

async function runGitDiff(workspacePath: string, args: readonly string[], allowExitOne = false): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [...args], { cwd: workspacePath, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    if (allowExitOne && isExpectedNoIndexDiff(error)) {
      return error.stdout;
    }
    return "";
  }
}

function isExpectedNoIndexDiff(error: unknown): error is { readonly code: number; readonly stdout: string } {
  return typeof error === "object" && error !== null && "code" in error && "stdout" in error && (error as { readonly code: number }).code === 1;
}
