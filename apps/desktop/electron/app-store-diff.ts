import { execFile } from "node:child_process";
import path from "node:path";
import { LocalExecutionEnvironment } from "./execution-environment";

function validateFilePath(workspacePath: string, filePath: string): string {
  const resolved = path.resolve(workspacePath, filePath);
  if (!resolved.startsWith(workspacePath + path.sep) && resolved !== workspacePath) {
    throw new Error("Path escapes workspace");
  }
  return filePath;
}

export interface ChangedFileEntry {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly staged: boolean;
}

export function getChangedFiles(workspacePath: string): Promise<ChangedFileEntry[]> {
  return new LocalExecutionEnvironment(workspacePath).gitStatus().then((entries) => [...entries]);
}

export function getFileDiff(workspacePath: string, filePath: string): Promise<string> {
  validateFilePath(workspacePath, filePath);
  return new Promise((resolve) => {
    execFile(
      "git",
      ["diff", "--", filePath],
      { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          // Try staged diff
          execFile(
            "git",
            ["diff", "--cached", "--", filePath],
            { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024 },
            (error2, stdout2) => {
              if (!error2 && stdout2.trim()) {
                resolve(stdout2);
                return;
              }
              // Untracked file — show content as all-additions diff
              execFile(
                "git",
                ["diff", "--no-index", "--", "/dev/null", filePath],
                { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024 },
                (_error3, stdout3) => {
                  // git diff --no-index exits 1 when files differ, which is expected
                  resolve(stdout3 || "");
                },
              );
            },
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export function stageFile(workspacePath: string, filePath: string): Promise<void> {
  validateFilePath(workspacePath, filePath);
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["add", "--", filePath],
      { cwd: workspacePath },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
  });
}
