import type { RendererDiagnosticPayload } from "./ipc";

const MAX_FIELD_LENGTH = 8_000;

export function installRendererDiagnostics(): void {
  window.addEventListener("error", (event) => {
    reportRendererDiagnostic({
      kind: "window-error",
      ...serializeErrorLike(event.error ?? event.message),
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
    console.error("[renderer-diagnostics] failed to report diagnostic", error);
  }
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

function truncate(value: string): string {
  return value.length > MAX_FIELD_LENGTH ? `${value.slice(0, MAX_FIELD_LENGTH)}…` : value;
}
