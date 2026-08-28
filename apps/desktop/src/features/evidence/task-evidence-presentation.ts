import {
  deriveVerificationConfidence,
  type TaskEvidenceRecord,
  type VerificationConfidence,
} from "../../product-experience/task-evidence";
import type { SessionRecord } from "../../desktop-state";

export interface TaskEvidencePresentation {
  readonly activity?: {
    readonly label: string;
    readonly detail?: string;
    readonly tone: "working" | "waiting" | "blocked";
    readonly evidenceId?: string;
    readonly toolCallId?: string;
  };
  readonly completion?: TaskEvidenceRecord;
  readonly error?: TaskEvidenceRecord;
  readonly confidence: VerificationConfidence;
  readonly changedPathCount: number;
  readonly changedPaths: readonly string[];
  readonly failedCount: number;
  readonly pendingApprovalCount: number;
  readonly childRunCount: number;
  readonly runningJobCount: number;
  readonly unknownJobCount: number;
  readonly stale: boolean;
  readonly lastUpdatedAt?: string;
}

export interface TaskRecoveryPresentation {
  readonly evidenceId: string;
  readonly outcome: "failed" | "interrupted" | "blocked" | "partial";
  readonly title: string;
  readonly detail: string;
  readonly actionLabel: string;
  readonly prompt: string;
  readonly changedPaths: readonly string[];
}

export function deriveTaskRecoveryPresentation(
  records: readonly TaskEvidenceRecord[],
): TaskRecoveryPresentation | undefined {
  const latestCompletion = records.find((record) => record.kind === "completion");
  const outcome = latestCompletion?.completion?.outcome;
  if (outcome === "completed" || outcome === "cancelled") {
    return undefined;
  }
  if (latestCompletion && (outcome === "failed" || outcome === "interrupted" || outcome === "blocked" || outcome === "partial")) {
    return recoveryForOutcome(latestCompletion.id, outcome, latestCompletion.completion?.changedPaths ?? []);
  }

  const latestError = records.find((record) => record.kind === "error" && record.status === "failed");
  return latestError ? recoveryForOutcome(latestError.id, "failed", []) : undefined;
}

function recoveryForOutcome(
  evidenceId: string,
  outcome: TaskRecoveryPresentation["outcome"],
  changedPaths: readonly string[],
): TaskRecoveryPresentation {
  switch (outcome) {
    case "blocked":
      return {
        evidenceId,
        outcome,
        title: "Run blocked",
        detail: "The latest run stopped on an observed blocker.",
        actionLabel: "Draft recovery",
        prompt: "Recheck the latest observed blocker. If it has cleared, preserve completed work and continue with the safest next step.",
        changedPaths,
      };
    case "interrupted":
      return {
        evidenceId,
        outcome,
        title: "Run interrupted",
        detail: "The latest run ended before it reached a terminal result.",
        actionLabel: "Draft continuation",
        prompt: "Continue from the latest completed step. Preserve existing work, verify current state, and finish the remaining task.",
        changedPaths,
      };
    case "partial":
      return {
        evidenceId,
        outcome,
        title: "Run partially completed",
        detail: "The latest run completed some work but did not finish the task.",
        actionLabel: "Draft continuation",
        prompt: "Review the work already completed, preserve it, and continue with the remaining unfinished part of the task.",
        changedPaths,
      };
    case "failed":
      return {
        evidenceId,
        outcome,
        title: "Run failed",
        detail: "The latest run failed before it could finish.",
        actionLabel: "Draft recovery",
        prompt: "Inspect the latest observed failure, preserve completed work, and continue with the safest corrective step.",
        changedPaths,
      };
  }
}

export function deriveTaskEvidencePresentation(
  records: readonly TaskEvidenceRecord[],
  sessionStatus: SessionRecord["status"],
): TaskEvidencePresentation {
  const latestByOwner = new Map<string, TaskEvidenceRecord>();
  for (const record of records) {
    const owner = evidenceOwner(record);
    if (owner && !latestByOwner.has(owner)) latestByOwner.set(owner, record);
  }
  const isCurrentActiveRecord = (record: TaskEvidenceRecord) => (
    (record.status === "running" || record.status === "pending" || record.status === "blocked")
    && (!evidenceOwner(record) || latestByOwner.get(evidenceOwner(record)!)?.id === record.id)
  );
  // A generic run-level "Working" record remains active between provider
  // events. Prefer concrete tool/subagent/approval work while it is active.
  const activeRecord = records.find((record) => evidenceOwner(record) && isCurrentActiveRecord(record))
    ?? records.find(isCurrentActiveRecord);
  const completion = records.find((record) => record.kind === "completion");
  const error = records.find((record) => record.kind === "error" && record.status === "failed");
  const changedPaths = new Set(records.flatMap((record) => {
    if (record.fileChange?.path && record.kind === "file-write") return [record.fileChange.path];
    return record.completion?.changedPaths ?? [];
  }));
  const failedCount = records.filter((record) => (
    record.status === "failed"
    && record.kind !== "completion"
  )).length;
  const pendingApprovalCount = records.filter((record) => (
    record.kind === "approval" && record.status === "pending"
  )).length;
  const childRuns = new Set(records.flatMap((record) =>
    record.correlation?.subagentRunId ? [record.correlation.subagentRunId] : []));
  const latestCommands = [...latestByOwner.values()].filter((record) => record.correlation?.commandId);
  const runningJobCount = latestCommands.filter((record) => record.status === "running").length;
  const unknownJobCount = latestCommands.filter((record) => record.status === "unknown").length;
  const lastUpdatedAt = records[0]?.timestamp;
  const unresolved = [...latestByOwner.values()].some((record) =>
    record.status === "running" || record.status === "pending" || record.status === "unknown");
  const stale = Boolean(
    sessionStatus !== "running"
    && unresolved
    && lastUpdatedAt
    && Date.now() - Date.parse(lastUpdatedAt) > 2 * 60 * 1_000,
  );

  return {
    ...(sessionStatus === "running" ? {
      activity: activeRecord ? activityForRecord(activeRecord) : {
        label: "Working",
        tone: "working" as const,
      },
    } : {}),
    ...(completion ? { completion } : {}),
    ...(error ? { error } : {}),
    confidence: deriveVerificationConfidence(records),
    changedPathCount: changedPaths.size,
    changedPaths: [...changedPaths],
    failedCount,
    pendingApprovalCount,
    childRunCount: childRuns.size,
    runningJobCount,
    unknownJobCount,
    stale,
    ...(lastUpdatedAt ? { lastUpdatedAt } : {}),
  };
}

function evidenceOwner(record: TaskEvidenceRecord): string | undefined {
  if (record.correlation?.toolCallId) return `tool:${record.correlation.toolCallId}`;
  if (record.correlation?.subagentRunId) return `subagent:${record.correlation.subagentRunId}`;
  if (record.approval?.requestId) return `approval:${record.approval.requestId}`;
  return undefined;
}

function activityForRecord(record: TaskEvidenceRecord): NonNullable<TaskEvidencePresentation["activity"]> {
  const activityType = record.activity?.type;
  const label = activityType === "reading"
    ? "Reading files"
    : activityType === "editing"
      ? "Editing files"
      : activityType === "running-tests"
        ? "Running tests"
        : activityType === "running-command"
          ? "Running command"
          : activityType === "waiting-approval"
            ? "Waiting for approval"
            : activityType === "waiting-provider"
              ? "Waiting for provider"
              : activityType === "waiting-subagent"
                ? "Waiting for subagent"
                : activityType === "retrying"
                  ? "Retrying"
                  : activityType === "blocked" || record.status === "blocked"
                    ? "Blocked"
                    : record.kind === "file-read"
                      ? "Reading files"
                      : record.kind === "file-write"
                        ? "Editing files"
                        : record.kind === "test"
                          ? "Running tests"
                          : record.kind === "command"
                            ? "Running command"
                            : "Working";
  const tone = activityType === "blocked" || record.status === "blocked"
    ? "blocked"
    : activityType?.startsWith("waiting-")
      ? "waiting"
      : "working";
  return {
    label,
    ...(record.summary !== label ? { detail: record.summary } : {}),
    tone,
    evidenceId: record.id,
    ...(record.correlation?.toolCallId ? { toolCallId: record.correlation.toolCallId } : {}),
  };
}
