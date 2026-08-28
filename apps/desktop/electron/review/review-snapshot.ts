import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { CreateReviewSnapshotOptions, ReviewFileSnapshot, ReviewSnapshot } from "../../src/review/review-types";
import { parseReviewDiff } from "../../src/review/review-diff-parser";
import { getChangedFiles } from "../app-store-diff";

const execFileAsync = promisify(execFile);
export const MAX_REVIEW_SNAPSHOT_FILES = 250;
export const MAX_REVIEW_SNAPSHOT_BYTES = 32 * 1024 * 1024;

export async function createReviewSnapshot(
  workspaceId: string,
  workspacePath: string,
  options: CreateReviewSnapshotOptions = {},
): Promise<ReviewSnapshot> {
  const files = options.base
    ? await createBaseSnapshotFiles(workspacePath, options.base)
    : await createWorkingTreeSnapshotFiles(workspacePath);
  assertReviewSnapshotBudget(files);

  return {
    id: randomUUID(),
    workspaceId,
    createdAt: new Date().toISOString(),
    source: options.base ? { kind: "base", base: options.base, agent: options.agent } : { kind: "working-tree", agent: options.agent },
    files,
  };
}

async function createWorkingTreeSnapshotFiles(workspacePath: string): Promise<ReviewFileSnapshot[]> {
  const changedFiles = await getChangedFiles(workspacePath);
  const files: ReviewFileSnapshot[] = [];

  for (const file of changedFiles) {
    const diff = await getFrozenFileDiff(workspacePath, file.path);
    if (!diff.trim()) {
      continue;
    }
    files.push(toReviewFile(file.path, file.status, diff));
    assertReviewSnapshotBudget(files);
  }

  return files;
}

async function createBaseSnapshotFiles(workspacePath: string, base: string): Promise<ReviewFileSnapshot[]> {
  const byPath = new Map<string, ReviewFileSnapshot>();
  const baseDiff = await runGitDiff(workspacePath, ["diff", `${base}...HEAD`]);
  for (const file of splitUnifiedDiffByFile(baseDiff)) {
    byPath.set(file.path, toReviewFile(file.path, inferStatus(file.diff), file.diff));
    assertReviewSnapshotBudget([...byPath.values()]);
  }

  for (const file of await createWorkingTreeSnapshotFiles(workspacePath)) {
    const existing = byPath.get(file.path);
    byPath.set(file.path, existing ? toReviewFile(file.path, file.status, `${existing.diff.trimEnd()}\n${file.diff}`) : file);
    assertReviewSnapshotBudget([...byPath.values()]);
  }

  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function assertReviewSnapshotBudget(files: readonly ReviewFileSnapshot[]): void {
  if (files.length > MAX_REVIEW_SNAPSHOT_FILES) {
    throw new Error(`Review snapshots support up to ${MAX_REVIEW_SNAPSHOT_FILES} changed files.`);
  }
  let bytes = 0;
  for (const file of files) {
    bytes += Buffer.byteLength(file.path, "utf8") + Buffer.byteLength(file.diff, "utf8");
    if (bytes > MAX_REVIEW_SNAPSHOT_BYTES) {
      throw new Error("Review snapshots must be 32 MB or smaller.");
    }
  }
}

function toReviewFile(path: string, status: ReviewFileSnapshot["status"], diff: string): ReviewFileSnapshot {
  const parsed = parseReviewDiff(path, diff);
  return { path, status, diff, anchors: parsed.anchors };
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

function splitUnifiedDiffByFile(diff: string): Array<{ readonly path: string; readonly diff: string }> {
  const files: Array<{ path: string; lines: string[] }> = [];
  let current: { path: string; lines: string[] } | undefined;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = parseDiffGitPath(line);
      if (path) {
        current = { path, lines: [line] };
        files.push(current);
        continue;
      }
    }
    current?.lines.push(line);
  }

  return files.map((file) => ({ path: file.path, diff: file.lines.join("\n") }));
}

function parseDiffGitPath(line: string): string | undefined {
  const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
  return match?.[2];
}

function inferStatus(diff: string): ReviewFileSnapshot["status"] {
  if (diff.includes("new file mode")) return "added";
  if (diff.includes("deleted file mode")) return "deleted";
  return "modified";
}

function isExpectedNoIndexDiff(error: unknown): error is { readonly code: number; readonly stdout: string } {
  return typeof error === "object" && error !== null && "code" in error && "stdout" in error && (error as { readonly code: number }).code === 1;
}
