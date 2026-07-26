import type { PiDesktopApi } from "../../ipc";
import { classifyTaskError, redactedTaskErrorDiagnostics } from "../../product-experience/task-errors";

interface TaskErrorRecoveryProps {
  readonly api: PiDesktopApi;
  readonly message: string;
  readonly onOpenLogs: () => void;
  readonly onOpenSettings: () => void;
  readonly attemptCount?: number;
  readonly onRetry?: (prompt: string) => void;
}

export function TaskErrorRecovery({
  api,
  message,
  onOpenLogs,
  onOpenSettings,
  attemptCount,
  onRetry,
}: TaskErrorRecoveryProps) {
  const classified = classifyTaskError({ message, attemptCount });
  const retryAvailable = classified.recoveryActions.includes("retry")
    && classified.attemptCount < 3
    && onRetry;
  return (
    <section className="task-error-recovery" data-testid="composer-error-banner" role="alert">
      <div>
        <strong>{classified.title}</strong>
        <span>{message}</span>
      </div>
      <span className="task-error-recovery__meta">
        {categoryLabel(classified.category)} · attempt {classified.attemptCount}
      </span>
      <div className="task-error-recovery__actions">
        {retryAvailable ? (
          <button
            type="button"
            onClick={() => onRetry(`Retry the last failed action once. Inspect the original failure first and do not repeat it if the same condition persists.\n\nOriginal failure: ${message}`)}
          >
            Retry once
          </button>
        ) : null}
        {classified.recoveryActions.includes("retry") && classified.attemptCount >= 3 ? (
          <span className="task-error-recovery__retry-limit">
            Retry paused after {classified.attemptCount} attempts
          </span>
        ) : null}
        {classified.recoveryActions.includes("continue") && onRetry ? (
          <button
            type="button"
            onClick={() => onRetry(`Continue from the last failure without repeating the failed action. Use a different safe approach or explain the blocker.\n\nOriginal failure: ${message}`)}
          >
            Continue safely
          </button>
        ) : null}
        {classified.recoveryActions.includes("open-settings") || classified.recoveryActions.includes("reauthenticate") ? (
          <button type="button" onClick={onOpenSettings}>Open Settings</button>
        ) : null}
        {classified.recoveryActions.includes("open-logs") ? (
          <button type="button" onClick={onOpenLogs}>Open logs</button>
        ) : null}
        <button
          type="button"
          onClick={() => void api.copyText(redactedTaskErrorDiagnostics({ message, classified }))}
        >
          Copy redacted details
        </button>
      </div>
    </section>
  );
}

function categoryLabel(category: string): string {
  return category.split("-").map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ");
}
