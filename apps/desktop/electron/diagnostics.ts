import { app, crashReporter, type BrowserWindow, type IpcMainEvent } from "electron";
import type { Dirent } from "node:fs";
import { appendFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { RendererDiagnosticPayload } from "../src/ipc";

const MAX_LOG_FIELD_LENGTH = 8_000;
const MAX_LOG_LINE_LENGTH = 32_000;
const MAX_CRASH_REPORT_ARTIFACTS = 20;
const MAX_CRASH_REPORT_SCAN_DEPTH = 3;

let userDataDir = "";
let registeredProcessDiagnostics = false;
let nativeCrashReporterStarted = false;

export interface NativeCrashReportArtifact {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
}

export function configureDesktopDiagnostics(options: { readonly userDataDir: string }): void {
  userDataDir = options.userDataDir;
}

export function attachWindowDiagnostics(window: BrowserWindow): void {
  const webContents = window.webContents;
  const base = () => ({
    windowId: window.id,
    webContentsId: webContents.id,
    url: safeCall(() => webContents.getURL()),
    title: safeCall(() => webContents.getTitle()),
  });

  webContents.on("render-process-gone", (_event, details) => {
    void logDesktopDiagnostic("render-process-gone", {
      ...base(),
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });

  webContents.on("unresponsive", () => {
    void logDesktopDiagnostic("renderer-unresponsive", base());
  });

  webContents.on("responsive", () => {
    void logDesktopDiagnostic("renderer-responsive", base());
  });

  webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) {
      return;
    }
    void logDesktopDiagnostic("renderer-did-fail-load", {
      ...base(),
      errorCode,
      errorDescription,
      validatedURL,
    });
  });

  webContents.on("did-finish-load", () => {
    void logDesktopDiagnostic("renderer-did-finish-load", base());
  });

  webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level < 2) {
      return;
    }
    void logDesktopDiagnostic("renderer-console-message", {
      ...base(),
      level,
      message,
      line,
      sourceId,
    });
  });
}

export function registerProcessDiagnostics(): void {
  if (registeredProcessDiagnostics) {
    return;
  }
  registeredProcessDiagnostics = true;

  app.on("child-process-gone", (_event, details) => {
    void logDesktopDiagnostic("child-process-gone", details);
  });

  process.on("uncaughtExceptionMonitor", (error) => {
    void logDesktopDiagnostic("main-uncaught-exception", serializeError(error));
  });

  process.on("unhandledRejection", (reason) => {
    void logDesktopDiagnostic("main-unhandled-rejection", serializeError(reason));
  });
}

export function startNativeCrashReporter(reason: string): void {
  if (nativeCrashReporterStarted) {
    return;
  }
  nativeCrashReporterStarted = true;
  try {
    crashReporter.start({
      productName: app.getName(),
      uploadToServer: false,
      globalExtra: {
        appVersion: app.getVersion(),
        electron: process.versions.electron ?? "unknown",
        platform: process.platform,
      },
    });
    crashReporter.setUploadToServer(false);
    void logDesktopDiagnostic("native-crash-reporter-started", {
      uploadToServer: crashReporter.getUploadToServer(),
      crashDumpsPath: safeCall(() => app.getPath("crashDumps")),
      reason,
    });
  } catch (error) {
    nativeCrashReporterStarted = false;
    void logDesktopDiagnostic("native-crash-reporter-start-failed", serializeError(error));
  }
}

export function isNativeCrashReporterStarted(): boolean {
  return nativeCrashReporterStarted;
}

export async function listNativeCrashReportArtifacts(): Promise<readonly NativeCrashReportArtifact[]> {
  const crashDumpsPath = safeCall(() => app.getPath("crashDumps"));
  if (!crashDumpsPath) {
    return [];
  }
  const artifacts: NativeCrashReportArtifact[] = [];
  await collectCrashReportArtifacts(crashDumpsPath, 0, artifacts);
  return artifacts
    .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))
    .slice(0, MAX_CRASH_REPORT_ARTIFACTS);
}

export function reportRendererDiagnostic(event: IpcMainEvent, payload: RendererDiagnosticPayload): void {
  void logDesktopDiagnostic("renderer-diagnostic", {
    webContentsId: event.sender.id,
    frameUrl: event.senderFrame?.url,
    payload,
  });
}

export async function logDesktopDiagnostic(event: string, payload: unknown): Promise<void> {
  const logPath = getDesktopLogPath();
  try {
    await mkdir(path.dirname(logPath), { recursive: true });
    await appendFile(logPath, formatDiagnosticLine(event, payload), "utf8");
  } catch (error) {
    console.error("[desktop-diagnostics] failed to write diagnostic log", error);
  }
}

export function logIgnoredError(scope: string, error: unknown): void {
  void logDesktopDiagnostic("ignored-error", {
    scope,
    error: serializeError(error),
  });
}

export function getDesktopLogPath(): string {
  return path.join(userDataDir || app.getPath("userData"), "logs", "desktop.log");
}

function formatDiagnosticLine(event: string, payload: unknown): string {
  const entry = {
    timestamp: new Date().toISOString(),
    pid: process.pid,
    event,
    payload: sanitizeForLog(payload),
  };
  const line = JSON.stringify(entry);
  return `${line.length > MAX_LOG_LINE_LENGTH ? `${line.slice(0, MAX_LOG_LINE_LENGTH)}…` : line}\n`;
}

function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 5) {
    return "[MaxDepth]";
  }
  if (value instanceof Error) {
    return serializeError(value);
  }
  if (typeof value === "string") {
    return truncate(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeForLog(item, depth + 1));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = sanitizeForLog(nestedValue, depth + 1);
    }
    return output;
  }
  return truncate(String(value));
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: truncate(error.message),
      stack: truncate(error.stack || ""),
    };
  }
  return {
    message: truncate(String(error)),
  };
}

function truncate(value: string): string {
  return value.length > MAX_LOG_FIELD_LENGTH ? `${value.slice(0, MAX_LOG_FIELD_LENGTH)}…` : value;
}

function safeCall(callback: () => string): string {
  try {
    return callback();
  } catch {
    return "";
  }
}

async function collectCrashReportArtifacts(
  directory: string,
  depth: number,
  artifacts: NativeCrashReportArtifact[],
): Promise<void> {
  if (depth > MAX_CRASH_REPORT_SCAN_DEPTH || artifacts.length >= MAX_CRASH_REPORT_ARTIFACTS * 3) {
    return;
  }
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectCrashReportArtifacts(entryPath, depth + 1, artifacts);
      return;
    }
    if (!entry.isFile() || !isCrashReportArtifactName(entry.name)) {
      return;
    }
    try {
      const info = await stat(entryPath);
      artifacts.push({
        id: `${info.mtimeMs}:${info.size}:${entryPath}`,
        path: entryPath,
        name: entry.name,
        sizeBytes: info.size,
        modifiedAt: info.mtime.toISOString(),
      });
    } catch {
      // Crashpad rotates files while the app is running; ignore disappearing entries.
    }
  }));
}

function isCrashReportArtifactName(name: string): boolean {
  return /\.(dmp|dump|crash|ips|json|log|txt)$/i.test(name);
}
