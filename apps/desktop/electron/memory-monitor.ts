import { app, type BrowserWindow, type ProcessMemoryInfo } from "electron";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { logIgnoredError } from "./diagnostics";

const MEMORY_MONITOR_ENV = "PI_APP_MEMORY_MONITOR";
const DEFAULT_INTERVAL_MS = 1_000;

type AppMetric = ReturnType<typeof app.getAppMetrics>[number];

export interface MemoryMonitorStoreSnapshot {
  readonly activeView: string;
  readonly revision: number;
  readonly selectedWorkspaceId: string;
  readonly selectedSessionId: string;
  readonly selectedSessionStatus?: string;
  readonly selectedTranscript?: {
    readonly loaded: boolean;
    readonly itemCount: number;
    readonly approximateBytes: number;
    readonly largestItemBytes: number;
    readonly largestItemKind?: string;
    readonly toolItemCount: number;
    readonly messageItemCount: number;
    readonly thinkingItemCount: number;
  };
}

export interface MemoryMonitorOptions {
  readonly userDataDir: string;
  readonly getWindow: () => BrowserWindow | null;
  readonly getStoreSnapshot: () => MemoryMonitorStoreSnapshot;
  readonly intervalMs?: number;
}

export function startMemoryMonitor(options: MemoryMonitorOptions): (() => void) | undefined {
  if (process.env[MEMORY_MONITOR_ENV] !== "1") {
    return undefined;
  }

  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const logPath = path.join(options.userDataDir, "logs", `memory-monitor-${process.pid}.jsonl`);
  let stopped = false;
  let writeChain: Promise<void> = Promise.resolve();

  const sample = async () => {
    if (stopped) {
      return;
    }

    const entry = await buildMemorySample(options);
    writeChain = writeChain
      .catch((error) => logIgnoredError("memory-monitor.previous-write", error))
      .then(async () => {
        await mkdir(path.dirname(logPath), { recursive: true });
        await appendFile(logPath, `${JSON.stringify({ ...entry, logPath })}\n`, "utf8");
      })
      .catch((error) => {
        console.error("[memory-monitor] failed to write memory sample", error);
      });
  };

  void sample();
  const timer = setInterval(() => {
    void sample();
  }, intervalMs);
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function buildMemorySample(options: MemoryMonitorOptions) {
  const window = options.getWindow();
  const mainProcessMemory = await process
    .getProcessMemoryInfo()
    .catch((error) => {
      logIgnoredError("memory-monitor.main-process-memory", error);
      return undefined;
    });
  const metrics = app.getAppMetrics().map(formatMetric);
  const focusedMetric = window ? metrics.find((metric) => metric.pid === window.webContents.getOSProcessId()) : undefined;

  return {
    timestamp: new Date().toISOString(),
    pid: process.pid,
    mainProcessMemory: mainProcessMemory ? formatProcessMemory(mainProcessMemory) : undefined,
    window: window ? describeWindow(window) : null,
    selectedProcess: focusedMetric,
    metrics,
    store: safeStoreSnapshot(options.getStoreSnapshot),
  };
}

function describeWindow(window: BrowserWindow) {
  const webContents = window.webContents;
  return {
    id: window.id,
    webContentsId: webContents.id,
    osProcessId: safeNumber(() => webContents.getOSProcessId()),
    destroyed: window.isDestroyed(),
    webContentsDestroyed: webContents.isDestroyed(),
    url: safeString(() => webContents.getURL()),
    title: safeString(() => webContents.getTitle()),
    devToolsOpened: safeBoolean(() => webContents.isDevToolsOpened()),
    devToolsFocused: safeBoolean(() => webContents.isDevToolsFocused()),
  };
}

function formatProcessMemory(memory: ProcessMemoryInfo) {
  return {
    privateMB: kbToMb(memory.private),
    residentSetMB: kbToMb(memory.residentSet),
    sharedMB: kbToMb(memory.shared),
    raw: memory,
  };
}

function formatMetric(metric: AppMetric) {
  return {
    pid: metric.pid,
    type: metric.type,
    serviceName: "serviceName" in metric ? metric.serviceName : undefined,
    name: "name" in metric ? metric.name : undefined,
    cpu: metric.cpu,
    memory: {
      workingSetSizeMB: kbToMb(metric.memory.workingSetSize),
      peakWorkingSetSizeMB: kbToMb(metric.memory.peakWorkingSetSize),
      privateBytesMB: metric.memory.privateBytes === undefined ? undefined : kbToMb(metric.memory.privateBytes),
      raw: metric.memory,
    },
  };
}

function safeStoreSnapshot(getSnapshot: () => MemoryMonitorStoreSnapshot): MemoryMonitorStoreSnapshot | { readonly error: string } {
  try {
    return getSnapshot();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function kbToMb(value: number): number {
  return Math.round((value / 1024) * 100) / 100;
}

function safeString(callback: () => string): string {
  try {
    return callback();
  } catch {
    return "";
  }
}

function safeNumber(callback: () => number): number | undefined {
  try {
    const value = callback();
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function safeBoolean(callback: () => boolean): boolean {
  try {
    return callback();
  } catch {
    return false;
  }
}
