import type { RendererDiagnosticPayload } from "./ipc";

const MAX_FIELD_LENGTH = 8_000;
const CONSOLE_DIAGNOSTIC_DEDUPE_MS = 10_000;
const WINDOW_ERROR_DIAGNOSTIC_DEDUPE_MS = 60_000;
const diagnosticConsole = console as Console & {
  __piOriginalConsoleError?: typeof console.error;
  __piConsoleDiagnosticsInstalled?: boolean;
};
const originalConsoleError = (diagnosticConsole.__piOriginalConsoleError ?? console.error).bind(console);
diagnosticConsole.__piOriginalConsoleError = originalConsoleError;
const lastConsoleDiagnosticAtByMessage = new Map<string, number>();
const lastWindowDiagnosticAtByMessage = new Map<string, number>();

export function installRendererDiagnostics(): void {
  installConsoleErrorDiagnostics();

  window.addEventListener("error", (event) => {
    const serialized = serializeErrorLike(event.error ?? event.message);
    if (isResizeObserverLoopMessage(serialized.message)) {
      event.preventDefault();
      return;
    }
    const message = serialized.message ?? "window-error";
    const now = Date.now();
    const previous = lastWindowDiagnosticAtByMessage.get(message) ?? 0;
    if (now - previous < WINDOW_ERROR_DIAGNOSTIC_DEDUPE_MS) {
      return;
    }
    lastWindowDiagnosticAtByMessage.set(message, now);
    reportRendererDiagnostic({
      kind: "window-error",
      ...serialized,
      ...(event.filename ? { filename: event.filename } : {}),
      ...(typeof event.lineno === "number" ? { lineno: event.lineno } : {}),
      ...(typeof event.colno === "number" ? { colno: event.colno } : {}),
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportRendererDiagnostic({
      kind: "unhandled-rejection",
      ...serializeErrorLike(event.reason),
    });
  });
}

function installConsoleErrorDiagnostics(): void {
  if (diagnosticConsole.__piConsoleDiagnosticsInstalled) {
    return;
  }
  diagnosticConsole.__piConsoleDiagnosticsInstalled = true;
  console.error = (...args: unknown[]) => {
    originalConsoleError(...args);
    const message = truncate(args.map(formatConsoleArgument).join(" ").trim() || "console.error");
    const now = Date.now();
    const previous = lastConsoleDiagnosticAtByMessage.get(message) ?? 0;
    if (now - previous < CONSOLE_DIAGNOSTIC_DEDUPE_MS) {
      return;
    }
    lastConsoleDiagnosticAtByMessage.set(message, now);

    const componentStack = args.find((arg): arg is string => typeof arg === "string" && /\n\s+at\s+/.test(arg));
    reportRendererDiagnostic({
      kind: "console-error",
      message,
      stack: truncate(new Error("console.error caller").stack ?? ""),
      ...(componentStack ? { componentStack: truncate(componentStack) } : {}),
    });
  };
}

export function reportRendererDiagnostic(payload: RendererDiagnosticPayload): void {
  const enrichedPayload: RendererDiagnosticPayload = {
    ...payload,
    ...(window.location.href ? { href: window.location.href } : {}),
    ...(window.navigator.userAgent ? { userAgent: window.navigator.userAgent } : {}),
    timestamp: new Date().toISOString(),
  };

  try {
    window.piApp?.reportRendererDiagnostic(enrichedPayload);
  } catch (error) {
    originalConsoleError("[renderer-diagnostics] failed to report diagnostic", error);
  }
}

export function logIgnoredError(scope: string, error: unknown): void {
  reportRendererDiagnostic({
    kind: "ignored-error",
    message: `Ignored error in ${scope}`,
    details: {
      scope,
      error: serializeErrorLike(error),
    },
  });
}

export function serializeErrorLike(error: unknown): Pick<RendererDiagnosticPayload, "message" | "stack"> {
  if (error instanceof Error) {
    return {
      message: truncate(error.message || error.name),
      ...(error.stack ? { stack: truncate(error.stack) } : {}),
    };
  }
  return {
    message: truncate(String(error)),
  };
}

function formatConsoleArgument(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.stack || value.message || value.name;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string): string {
  return value.length > MAX_FIELD_LENGTH ? `${value.slice(0, MAX_FIELD_LENGTH)}…` : value;
}

function isResizeObserverLoopMessage(message: string | undefined): boolean {
  return message === "ResizeObserver loop completed with undelivered notifications." ||
    message === "ResizeObserver loop limit exceeded";
}
