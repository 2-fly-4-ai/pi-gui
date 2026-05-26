import { execFile } from "node:child_process";
import { platform } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProcessInfo {
  readonly pid: number;
  readonly parentPid: number;
  readonly processGroupId?: number;
  readonly command: string;
}

export function isProcessAlive(pid: number | undefined): boolean {
  if (pid === undefined || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function signalProcessGroup(pid: number | undefined, signal: NodeJS.Signals): boolean {
  if (platform() === "win32" || pid === undefined || pid <= 0) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

export async function snapshotProcessTree(rootPid: number | undefined): Promise<readonly ProcessInfo[]> {
  if (rootPid === undefined || rootPid <= 0 || platform() === "win32") return [];
  const processes = await listProcesses();
  const byParent = new Map<number, ProcessInfo[]>();
  for (const item of processes) {
    const current = byParent.get(item.parentPid) ?? [];
    current.push(item);
    byParent.set(item.parentPid, current);
  }

  const result: ProcessInfo[] = [];
  const queue = [rootPid];
  const seen = new Set<number>(queue);
  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid === undefined) continue;
    for (const child of byParent.get(pid) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      result.push(child);
      queue.push(child.pid);
    }
  }
  return result;
}

async function listProcesses(): Promise<readonly ProcessInfo[]> {
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,pgid=,command="], {
      maxBuffer: 1024 * 1024,
    });
    return stdout
      .split("\n")
      .map(parsePsLine)
      .filter((item): item is ProcessInfo => item !== undefined);
  } catch {
    return [];
  }
}

function parsePsLine(line: string): ProcessInfo | undefined {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
  if (!match) return undefined;
  return {
    pid: Number(match[1]),
    parentPid: Number(match[2]),
    processGroupId: Number(match[3]),
    command: match[4] ?? "",
  };
}
