import type { ErrorEvidenceDetails, TaskErrorCategory } from "./task-evidence";
import { sanitizeContextDisplayValue } from "./context-manifest";

export interface ClassifiedTaskError extends ErrorEvidenceDetails {
  readonly title: string;
}

export function classifyTaskError(input: {
  readonly message: string;
  readonly code?: string;
  readonly attemptCount?: number;
  readonly originalEvidenceId?: string;
}): ClassifiedTaskError {
  const category = errorCategory(input.code, input.message);
  const base = {
    category,
    attemptCount: Math.max(1, input.attemptCount ?? 1),
    ...(input.code ? { code: input.code } : {}),
    ...(input.originalEvidenceId ? { originalEvidenceId: input.originalEvidenceId } : {}),
  };
  switch (category) {
    case "provider-auth":
      return { ...base, title: "Provider authentication required", recoveryActions: ["reauthenticate", "open-settings", "copy-diagnostics"] };
    case "rate-limit":
      return { ...base, title: "Provider rate limit reached", recoveryActions: ["retry", "continue", "copy-diagnostics"] };
    case "runtime-crash":
      return { ...base, title: "Runtime stopped unexpectedly", recoveryActions: ["retry", "open-logs", "copy-diagnostics"] };
    case "permission":
      return { ...base, title: "Permission required", recoveryActions: ["open-settings", "continue", "copy-diagnostics"] };
    case "missing-file":
      return { ...base, title: "A required file is missing", recoveryActions: ["continue", "open-logs", "copy-diagnostics"] };
    case "stale-workspace":
      return { ...base, title: "Workspace state is stale", recoveryActions: ["retry", "continue", "open-logs"] };
    case "test-failure":
      return { ...base, title: "Tests failed", recoveryActions: ["retry", "open-logs", "continue"] };
    case "command-failure":
      return { ...base, title: "Command failed", recoveryActions: ["retry", "open-logs", "continue"] };
    case "tool-failure":
      return { ...base, title: "Tool failed", recoveryActions: ["retry", "open-logs", "continue"] };
    default:
      return { ...base, title: "Run failed", recoveryActions: ["retry", "open-logs", "copy-diagnostics"] };
  }
}

export function redactedTaskErrorDiagnostics(input: {
  readonly message: string;
  readonly classified: ClassifiedTaskError;
}): string {
  const message = sanitizeContextDisplayValue(input.message)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*["']?[^"',\s)]+/gi, "$1=[redacted]")
    .replace(/(?:\/Users|\/private|\/var|\/tmp|\/Volumes|[A-Za-z]:\\)[^\s"',)]+/g, "[path]");
  return [
    `Category: ${input.classified.category}`,
    ...(input.classified.code ? [`Code: ${input.classified.code}`] : []),
    `Attempt: ${input.classified.attemptCount}`,
    `Message: ${message}`,
  ].join("\n");
}

function errorCategory(code: string | undefined, message: string): TaskErrorCategory {
  const value = `${code ?? ""} ${message}`.toLowerCase();
  if (/(auth|unauthorized|invalid[_ -]?api|credential|login)/.test(value)) return "provider-auth";
  if (/(rate.?limit|too many requests|429|quota)/.test(value)) return "rate-limit";
  if (/(runtime.*(?:crash|exit|stopped)|worker.*exit|econnreset)/.test(value)) return "runtime-crash";
  if (/(permission|denied|eacces|eperm|not allowed)/.test(value)) return "permission";
  if (/(missing file|not found|enoent|no such file)/.test(value)) return "missing-file";
  if (/(stale|wrong worktree|workspace.*(?:moved|missing|changed))/.test(value)) return "stale-workspace";
  if (/(test|vitest|jest|playwright|pytest).*(fail|error)/.test(value)) return "test-failure";
  if (/(command|shell|exit code).*(fail|error|non-zero)/.test(value)) return "command-failure";
  if (/(tool).*(fail|error)/.test(value)) return "tool-failure";
  return "unknown";
}
