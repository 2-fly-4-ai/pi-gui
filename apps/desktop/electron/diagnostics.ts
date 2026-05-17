import { app, type BrowserWindow, type IpcMainEvent } from "electron";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { RendererDiagnosticPayload } from "../src/ipc";

const MAX_LOG_FIELD_LENGTH = 8_000;
const MAX_LOG_LINE_LENGTH = 32_000;

let userDataDir = "";
let registeredProcessDiagnostics = false;

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
