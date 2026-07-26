import type { SessionDriverEvent } from "@pi-gui/session-driver";
import { randomUUID } from "node:crypto";
import type {
  TaskActivityType,
  TaskEvidenceKind,
  TaskEvidenceRecord,
  VerificationScope,
} from "../src/product-experience/task-evidence";
import { TASK_EVIDENCE_SCHEMA_VERSION } from "../src/product-experience/task-evidence";
import { classifyTaskError } from "../src/product-experience/task-errors";
import type { TaskEvidenceLedger } from "./task-evidence-ledger";

interface ObservedTool {
  readonly kind: TaskEvidenceKind;
  readonly command?: string;
  readonly path?: string;
  readonly cwd?: string;
  readonly startedAt: string;
  readonly intent?: string;
  readonly originatingUserRequestId?: string;
}

export interface ObservedCommandClassification {
  readonly kind: "command" | "test";
  readonly scope?: VerificationScope;
}

interface ObservedActivityClassification {
  readonly kind: TaskEvidenceKind;
  readonly scope?: VerificationScope;
}

export class TaskEvidenceSessionObserver {
  private readonly tools = new Map<string, ObservedTool>();
  private readonly runStartedAt = new Map<string, string>();
  private readonly runWorkspacePaths = new Map<string, string>();
  private readonly failureAttempts = new Map<string, {
    readonly count: number;
    readonly originalEvidenceId: string;
  }>();
  private pending = Promise.resolve();

  constructor(
    private readonly ledger: TaskEvidenceLedger,
    private readonly createId: () => string = randomUUID,
    private readonly resolveOrigin?: (
      event: Extract<SessionDriverEvent, { type: "toolStarted" }>,
    ) => Promise<{ readonly id: string; readonly intent: string } | undefined>,
  ) {}

  observe(event: SessionDriverEvent): void {
    this.pending = this.pending
      .catch(() => undefined)
      .then(async () => {
        let records = await this.recordsForEvent(event);
        records = await this.enrichVerificationLinks(event, records);
        if (event.type === "runCompleted" || event.type === "runFailed") {
          records = await this.enrichTerminalRecords(event, records);
        }
        if (records.length > 0) await this.ledger.appendMany(records);
      });
  }

  async flush(): Promise<void> {
    await this.pending;
    await this.ledger.flush();
  }

  private async enrichVerificationLinks(
    event: SessionDriverEvent,
    records: readonly TaskEvidenceRecord[],
  ): Promise<readonly TaskEvidenceRecord[]> {
    const candidate = records.find((record) => (
      (record.kind === "test" || record.kind === "verification")
      && record.verification?.command
    ));
    const command = candidate?.verification?.command;
    if (!candidate || !command) return records;
    const page = await this.ledger.query({
      workspaceId: event.sessionRef.workspaceId,
      sessionId: event.sessionRef.sessionId,
      ...(event.runId ? { runId: event.runId } : {}),
      kinds: ["file-write"],
      limit: 1_000,
    });
    const normalizedCommand = command.replace(/\\/g, "/");
    const relatedPaths = [...new Set(page.records.flatMap((record) => {
      const path = record.fileChange?.path?.replace(/\\/g, "/");
      return path && normalizedCommand.includes(path) ? [record.fileChange?.path ?? path] : [];
    }))];
    if (relatedPaths.length === 0) return records;
    return records.map((record) => record.id === candidate.id && record.verification ? {
      ...record,
      verification: {
        ...record.verification,
        relatedPaths,
      },
    } : record);
  }

  private async enrichTerminalRecords(
    event: Extract<SessionDriverEvent, { type: "runCompleted" | "runFailed" }>,
    records: readonly TaskEvidenceRecord[],
  ): Promise<readonly TaskEvidenceRecord[]> {
    const page = await this.ledger.query({
      workspaceId: event.sessionRef.workspaceId,
      sessionId: event.sessionRef.sessionId,
      ...(event.runId ? { runId: event.runId } : {}),
      limit: 1_000,
    });
    const changedPaths = [...new Set(page.records.flatMap((record) =>
      record.kind === "file-write" && record.fileChange?.path ? [record.fileChange.path] : []))];
    const verificationEvidenceIds = page.records
      .filter((record) => (
        (record.kind === "test" || record.kind === "verification")
        && record.status === "passed"
        && record.verification
      ))
      .map((record) => record.id);
    const childRunIds = [...new Set(page.records.flatMap((record) =>
      record.correlation?.subagentRunId ? [record.correlation.subagentRunId] : []))];
    const approvalEvidenceIds = page.records
      .filter((record) => record.kind === "approval")
      .map((record) => record.id);
    const blockerEvidenceIds = page.records
      .filter((record) => (
        record.status === "blocked"
        || (record.kind === "error" && record.status === "failed")
      ))
      .map((record) => record.id);
    const startedAt = this.runStartedAt.get(runObservationKey(event));
    const elapsedMs = startedAt
      ? Math.max(0, Date.parse(event.timestamp) - Date.parse(startedAt))
      : undefined;
    const checkoutPath = this.runWorkspacePaths.get(runObservationKey(event))
      ?? (event.type === "runCompleted" ? event.snapshot.workspace.path : undefined);

    const enriched = records.map((record) => record.kind === "completion" && record.completion ? {
      ...record,
      completion: {
        ...record.completion,
        ...(record.completion.outcome === "failed"
          && (changedPaths.length > 0 || verificationEvidenceIds.length > 0 || childRunIds.length > 0)
          ? { outcome: "partial" as const }
          : {}),
        ...(elapsedMs !== undefined && Number.isFinite(elapsedMs) ? { elapsedMs } : {}),
        ...(checkoutPath ? { checkoutPath } : {}),
        ...(changedPaths.length > 0 ? { changedPaths } : {}),
        ...(verificationEvidenceIds.length > 0 ? { verificationEvidenceIds } : {}),
        ...(childRunIds.length > 0 ? { childRunIds } : {}),
        ...(approvalEvidenceIds.length > 0 ? { approvalEvidenceIds } : {}),
        ...(blockerEvidenceIds.length > 0 ? { blockerEvidenceIds } : {}),
      },
    } : record);
    this.runStartedAt.delete(runObservationKey(event));
    this.runWorkspacePaths.delete(runObservationKey(event));
    if (event.type === "runCompleted") {
      this.failureAttempts.delete(sessionObservationKey(event));
    }
    return enriched;
  }

  private async recordsForEvent(event: SessionDriverEvent): Promise<readonly TaskEvidenceRecord[]> {
    switch (event.type) {
      case "sessionUpdated":
        if (event.snapshot.status === "running") {
          const key = runObservationKey(event);
          if (!this.runStartedAt.has(key)) this.runStartedAt.set(key, event.timestamp);
          this.runWorkspacePaths.set(key, event.snapshot.workspace.path);
          const retry = this.failureAttempts.get(sessionObservationKey(event));
          return [this.record(event, {
              kind: "activity",
              source: "runtime",
              authority: "runtime-observed",
              status: "running",
              summary: retry ? `Retrying after attempt ${retry.count}` : "Waiting for provider",
              activity: {
                type: retry ? "retrying" : "waiting-provider",
                startedAt: event.timestamp,
              },
            })];
        }
        return [];
      case "toolStarted":
        return [await this.toolStarted(event)];
      case "toolUpdated":
        return [this.record(event, {
          kind: this.tools.get(toolKey(event))?.kind ?? "activity",
          source: "tool",
          authority: "tool-observed",
          status: "running",
          summary: event.text?.trim() || "Tool activity updated",
          correlation: { toolCallId: event.callId },
          activity: {
            type: activityTypeForKind(this.tools.get(toolKey(event))?.kind ?? "activity"),
            ...(typeof event.progress === "number" ? { progress: event.progress } : {}),
          },
        })];
      case "toolFinished":
        return [this.toolFinished(event)];
      case "subagentRunUpdated":
        return [this.record(event, {
          kind: event.status === "failed" ? "error" : "activity",
          source: "subagent",
          authority: "runtime-observed",
          status: subagentStatus(event.status),
          summary: event.summary?.trim()
            || `${event.role ?? event.agentName ?? "Subagent"} ${event.status}`,
          correlation: {
            subagentRunId: event.subagentRunId,
            ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
          },
          activity: {
            type: event.status === "failed" ? "blocked" : "waiting-subagent",
            ...(typeof event.progress === "number" ? { progress: event.progress } : {}),
          },
        })];
      case "runtimeJobUpdated":
        return [this.record(event, {
          kind: "activity",
          source: "runtime",
          authority: "runtime-observed",
          status: runtimeJobStatus(event.job.status),
          summary: event.job.title?.trim() || "Runtime job updated",
          correlation: {
            ...(event.job.toolCallId ? { toolCallId: event.job.toolCallId } : {}),
            ...(event.job.id ? { commandId: event.job.id } : {}),
          },
          activity: {
            type: event.job.status === "unknown" ? "blocked" : "running-command",
            startedAt: event.job.startedAt,
          },
        })];
      case "hostUiRequest":
        return approvalRecordForEvent(event, this.record.bind(this));
      case "runCompleted":
        return [this.record(event, {
          kind: "completion",
          source: "runtime",
          authority: "runtime-observed",
          status: "passed",
          summary: "Run completed",
          completion: { outcome: "completed" },
        }, `completion:${runKey(event)}`)];
      case "runFailed": {
        const cancelled = event.error.code?.toUpperCase() === "ABORTED";
        const sessionKey = sessionObservationKey(event);
        const previousFailure = this.failureAttempts.get(sessionKey);
        const errorId = `${event.sessionRef.workspaceId}:${event.sessionRef.sessionId}:error:${runKey(event)}`;
        const attemptCount = (previousFailure?.count ?? 0) + 1;
        this.failureAttempts.set(sessionKey, {
          count: attemptCount,
          originalEvidenceId: previousFailure?.originalEvidenceId ?? errorId,
        });
        const classifiedError = classifyTaskError({
          message: event.error.message,
          ...(event.error.code ? { code: event.error.code } : {}),
          attemptCount,
          ...(previousFailure ? { originalEvidenceId: previousFailure.originalEvidenceId } : {}),
        });
        const outcome = terminalFailureOutcome(
          event.error.code,
          classifiedError.category,
          cancelled,
        );
        return [
          this.record(event, {
            kind: "error",
            source: "runtime",
            authority: "runtime-observed",
            status: cancelled ? "cancelled" : "failed",
            summary: event.error.message || "Run failed",
            error: classifiedError,
          }, `error:${runKey(event)}`),
          this.record(event, {
            kind: "completion",
            source: "runtime",
            authority: "runtime-observed",
            status: outcome === "cancelled"
              ? "cancelled"
              : outcome === "blocked" ? "blocked" : "failed",
            summary: outcome === "cancelled"
              ? "Run cancelled"
              : outcome === "interrupted"
                ? "Run interrupted"
                : outcome === "blocked" ? "Run blocked" : "Run failed",
            completion: { outcome },
          }, `completion:${runKey(event)}`),
        ];
      }
      case "extensionCompatibilityIssue":
        return [this.record(event, {
          kind: "error",
          source: "runtime",
          authority: "runtime-observed",
          status: "blocked",
          summary: event.issue.message,
          activity: { type: "blocked" },
        })];
      default:
        return [];
    }
  }

  private async toolStarted(
    event: Extract<SessionDriverEvent, { type: "toolStarted" }>,
  ): Promise<TaskEvidenceRecord> {
    const command = extractString(event.input, ["command", "cmd"]);
    const path = extractString(event.input, ["file_path", "filePath", "path"]);
    const cwd = extractString(event.input, ["cwd", "working_directory", "workingDirectory"]);
    const classification: ObservedActivityClassification = command
      ? classifyObservedCommand(command)
      : classifyToolName(event.toolName);
    const origin = classification.kind === "file-write"
      ? await this.resolveOrigin?.(event).catch(() => undefined)
      : undefined;
    this.tools.set(toolKey(event), {
      kind: classification.kind,
      ...(command ? { command } : {}),
      ...(path ? { path } : {}),
      ...(cwd ? { cwd } : {}),
      startedAt: event.timestamp,
      ...(origin ? { intent: origin.intent, originatingUserRequestId: origin.id } : {}),
    });
    return this.record(event, {
      kind: classification.kind,
      source: "tool",
      authority: "tool-observed",
      status: "running",
      summary: activitySummary(classification.kind, event.toolName),
      correlation: {
        toolCallId: event.callId,
        ...((classification.kind === "command" || classification.kind === "test")
          ? { commandId: event.callId }
          : {}),
      },
      ...(path && (classification.kind === "file-read" || classification.kind === "file-write") ? {
        fileChange: {
          path,
          operation: classification.kind === "file-write" ? "unknown" : "unknown",
          ownership: classification.kind === "file-write" ? "pi" : "unknown",
          ...(origin ? {
            intent: origin.intent,
            originatingUserRequestId: origin.id,
          } : {}),
        },
      } : {}),
      ...(command ? {
        verification: {
          scope: classification.scope ?? "package",
          command,
          ...(cwd ? { cwd } : {}),
          ...(classification.kind === "test" ? {
            testIdentifiers: extractTestIdentifiers(command),
          } : {}),
        },
      } : {}),
      activity: {
        type: activityTypeForKind(classification.kind),
        startedAt: event.timestamp,
      },
    });
  }

  private toolFinished(
    event: Extract<SessionDriverEvent, { type: "toolFinished" }>,
  ): TaskEvidenceRecord {
    const key = toolKey(event);
    const observed = this.tools.get(key);
    this.tools.delete(key);
    const kind = observed?.kind ?? "activity";
    const durationMs = observed
      ? Math.max(0, Date.parse(event.timestamp) - Date.parse(observed.startedAt))
      : undefined;
    const exitCode = extractNumber(event.output, ["exitCode", "exit_code", "code"]);
    return this.record(event, {
      kind,
      source: "tool",
      authority: "tool-observed",
      status: event.success ? "passed" : "failed",
      summary: `${labelForKind(kind)} ${event.success ? "completed" : "failed"}`,
      correlation: {
        toolCallId: event.callId,
        ...((kind === "command" || kind === "test") ? { commandId: event.callId } : {}),
      },
      ...(observed?.path && (kind === "file-read" || kind === "file-write") ? {
        fileChange: {
          path: observed.path,
          operation: kind === "file-write" ? "unknown" : "unknown",
          ownership: kind === "file-write" ? "pi" : "unknown",
          ...(observed.intent ? { intent: observed.intent } : {}),
          ...(observed.originatingUserRequestId ? {
            originatingUserRequestId: observed.originatingUserRequestId,
          } : {}),
        },
      } : {}),
      ...(observed?.command ? {
        verification: {
          scope: classifyObservedCommand(observed.command).scope ?? "package",
          command: observed.command,
          ...(observed.cwd ? { cwd: observed.cwd } : {}),
          ...(exitCode !== undefined ? { exitCode } : {}),
          ...(durationMs !== undefined && Number.isFinite(durationMs) ? { durationMs } : {}),
          ...(kind === "test" ? { testIdentifiers: extractTestIdentifiers(observed.command) } : {}),
        },
      } : {}),
    });
  }

  private record(
    event: SessionDriverEvent,
    input: Omit<TaskEvidenceRecord, "schemaVersion" | "id" | "sessionId" | "workspaceId" | "runId" | "timestamp">,
    stableSuffix?: string,
  ): TaskEvidenceRecord {
    return {
      schemaVersion: TASK_EVIDENCE_SCHEMA_VERSION,
      id: stableSuffix
        ? `${event.sessionRef.workspaceId}:${event.sessionRef.sessionId}:${stableSuffix}`
        : this.createId(),
      workspaceId: event.sessionRef.workspaceId,
      sessionId: event.sessionRef.sessionId,
      ...(event.runId ? { runId: event.runId } : {}),
      timestamp: event.timestamp,
      ...input,
    };
  }
}

export function classifyObservedCommand(command: string): ObservedCommandClassification {
  const normalized = command.trim().toLowerCase();
  if (/\bplaywright\s+test\b/.test(normalized) || /\btest:e2e(?::(?:core|live|native))?\b/.test(normalized)) {
    const scope = normalized.includes("live")
      ? "electron-live"
      : normalized.includes("native")
        ? "native"
        : "electron-core";
    return { kind: "test", scope };
  }
  if (
    /\b(?:vitest|jest|pytest|rspec|cargo\s+test|go\s+test|pnpm\s+(?:run\s+)?test(?::[\w-]+)?|npm\s+(?:run\s+)?test(?::[\w-]+)?|yarn\s+(?:run\s+)?test(?::[\w-]+)?)\b/.test(normalized)
  ) {
    return { kind: "test", scope: "package" };
  }
  return { kind: "command" };
}

function classifyToolName(toolName: string): ObservedActivityClassification {
  const normalized = toolName.trim().toLowerCase();
  if (/^(?:read|read_file|grep|glob|search|find)$/.test(normalized)) return { kind: "file-read" };
  if (/^(?:write|write_file|edit|apply_patch|patch)$/.test(normalized)) return { kind: "file-write" };
  if (/^(?:bash|shell|exec|exec_command|run_command|terminal)$/.test(normalized)) return { kind: "command" };
  return { kind: "activity" };
}

function approvalRecordForEvent(
  event: Extract<SessionDriverEvent, { type: "hostUiRequest" }>,
  record: (
    event: SessionDriverEvent,
    input: Omit<TaskEvidenceRecord, "schemaVersion" | "id" | "sessionId" | "workspaceId" | "runId" | "timestamp">,
  ) => TaskEvidenceRecord,
): readonly TaskEvidenceRecord[] {
  if (!["confirm", "input", "select", "editor"].includes(event.request.kind)) return [];
  return [record(event, {
    kind: "approval",
    source: "runtime",
    authority: "runtime-observed",
    status: "pending",
    summary: "Input requested",
    activity: { type: "waiting-approval" },
    approval: {
      requestId: event.request.requestId,
      requestKind: event.request.kind as "confirm" | "input" | "select" | "editor",
      risk: "routine",
    },
  })];
}

function toolKey(event: Pick<SessionDriverEvent, "sessionRef"> & { readonly callId: string }): string {
  return `${event.sessionRef.workspaceId}:${event.sessionRef.sessionId}:${event.callId}`;
}

function runKey(event: SessionDriverEvent): string {
  return event.runId ?? `${event.timestamp}:unknown-run`;
}

function runObservationKey(event: SessionDriverEvent): string {
  return `${sessionObservationKey(event)}:${event.runId ?? "unknown-run"}`;
}

function sessionObservationKey(event: SessionDriverEvent): string {
  return `${event.sessionRef.workspaceId}:${event.sessionRef.sessionId}`;
}

function extractString(input: unknown, keys: readonly string[]): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function extractNumber(input: unknown, keys: readonly string[]): number | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function activitySummary(kind: TaskEvidenceKind, toolName: string): string {
  switch (kind) {
    case "file-read": return "Reading files";
    case "file-write": return "Editing files";
    case "test": return "Running tests";
    case "command": return "Running command";
    default: return `Running ${toolName || "tool"}`;
  }
}

function activityTypeForKind(kind: TaskEvidenceKind): TaskActivityType {
  switch (kind) {
    case "file-read": return "reading";
    case "file-write": return "editing";
    case "test": return "running-tests";
    case "command": return "running-command";
    case "approval": return "waiting-approval";
    default: return "working";
  }
}

export function extractTestIdentifiers(command: string): readonly string[] {
  const identifiers = command
    .split(/\s+/)
    .map((value) => value.replace(/^["']|["'],?$/g, ""))
    .filter((value) => (
      /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(value)
      || /(?:^|\/)tests?\/[^ ]+/.test(value)
    ));
  return [...new Set(identifiers)].slice(0, 20);
}

function labelForKind(kind: TaskEvidenceKind): string {
  switch (kind) {
    case "file-read": return "File read";
    case "file-write": return "File edit";
    case "test": return "Tests";
    case "command": return "Command";
    default: return "Tool";
  }
}

function subagentStatus(
  status: Extract<SessionDriverEvent, { type: "subagentRunUpdated" }>["status"],
): TaskEvidenceRecord["status"] {
  if (status === "started" || status === "progress") return "running";
  if (status === "completed") return "passed";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

function runtimeJobStatus(status: string): TaskEvidenceRecord["status"] {
  if (status === "running") return "running";
  if (status === "completed" || status === "exited") return "passed";
  if (status === "failed") return "failed";
  return "unknown";
}

function terminalFailureOutcome(
  code: string | undefined,
  category: ReturnType<typeof classifyTaskError>["category"],
  cancelled: boolean,
): NonNullable<TaskEvidenceRecord["completion"]>["outcome"] {
  if (cancelled) return "cancelled";
  if (/(interrupt|shutdown|terminated|runtime[_ -]?stopped)/i.test(code ?? "")) return "interrupted";
  if (category === "provider-auth" || category === "rate-limit" || category === "permission") {
    return "blocked";
  }
  return "failed";
}
