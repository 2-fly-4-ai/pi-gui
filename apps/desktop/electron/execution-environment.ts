import { execFile } from "node:child_process";
import { readdir, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { ExecutionDirectoryEntry, ExecutionEnvironmentCapabilities, ExecutionGitStatusEntry } from "../src/execution-environment-types";

export interface ExecutionEnvironment {
  readonly capabilities: ExecutionEnvironmentCapabilities;
  canonicalRoot(): Promise<string>;
  listDirectory(relativePath?: string, signal?: AbortSignal): Promise<readonly ExecutionDirectoryEntry[]>;
  gitStatus(signal?: AbortSignal): Promise<readonly ExecutionGitStatusEntry[]>;
}

export const LOCAL_EXECUTION_CAPABILITIES: ExecutionEnvironmentCapabilities = {
  filesystem: "read-write", process: "spawn", terminal: true, git: "read-write",
  runtimeProvider: true, editorOpen: true, watch: true, reconnect: false,
};

export const LOOPBACK_EXECUTION_CAPABILITIES: ExecutionEnvironmentCapabilities = {
  filesystem: "read-only", process: "read-only", terminal: false, git: "status",
  runtimeProvider: false, editorOpen: false, watch: false, reconnect: true,
};

export class LocalExecutionEnvironment implements ExecutionEnvironment {
  readonly capabilities = LOCAL_EXECUTION_CAPABILITIES;
  private canonical?: Promise<string>;

  constructor(private readonly root: string) {}

  canonicalRoot(): Promise<string> {
    return this.canonical ??= realpath(this.root);
  }

  async listDirectory(relativePath = ".", signal?: AbortSignal): Promise<readonly ExecutionDirectoryEntry[]> {
    signal?.throwIfAborted();
    const root = await this.canonicalRoot();
    const target = resolveWithin(root, relativePath);
    const entries = await readdir(target, { withFileTypes: true });
    signal?.throwIfAborted();
    return entries.slice(0, 200).map((entry) => ({
      name: entry.name.slice(0, 255),
      kind: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "other",
    }));
  }

  gitStatus(signal?: AbortSignal): Promise<readonly ExecutionGitStatusEntry[]> {
    return readGitStatus(this.root, signal);
  }
}

export function readGitStatus(root: string, signal?: AbortSignal): Promise<readonly ExecutionGitStatusEntry[]> {
  return new Promise((complete) => {
    execFile("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: root, encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 10_000, signal,
    }, (error, stdout) => {
      if (error) { complete([]); return; }
      complete(parseGitStatus(stdout).slice(0, 2_000));
    });
  });
}

export function parseGitStatus(stdout: string): readonly ExecutionGitStatusEntry[] {
  const entries: ExecutionGitStatusEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const xy = line.slice(0, 2);
    let path = line.slice(3).trim();
    const arrow = path.indexOf(" -> ");
    if (arrow >= 0) path = path.slice(arrow + 4);
    const x = xy[0] ?? " ";
    const y = xy[1] ?? " ";
    entries.push({
      path: path.slice(0, 2_000),
      status: x === "?" && y === "?" ? "untracked" : x === "A" || y === "A" ? "added" : x === "D" || y === "D" ? "deleted" : "modified",
      staged: x !== "?" && x !== " " && y === " ",
    });
  }
  return entries;
}

export function resolveWithin(root: string, requested: string): string {
  if (requested.includes("\0")) throw new Error("Path contains a null byte.");
  const target = resolve(root, requested);
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new Error("Path escapes the negotiated workspace root.");
  return target;
}
