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

export function deriveTaskEvidencePresentation(
  records: readonly TaskEvidenceRecord[],
  sessionStatus: SessionRecord["status"],
): TaskEvidencePresentation {
  const latestByOwner = new Map<string, TaskEvidenceRecord>();
  for (const record of records) {
    const owner = evidenceOwner(record);
    if (owner && !latestByOwner.has(owner)) latestByOwner.set(owner, record);
  }
  const activeRecord = records.find((record) => (
    (record.status === "running" || record.status === "pending" || record.status === "blocked")
    && (!evidenceOwner(record) || latestByOwner.get(evidenceOwner(record)!)?.id === record.id)
  ));
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
