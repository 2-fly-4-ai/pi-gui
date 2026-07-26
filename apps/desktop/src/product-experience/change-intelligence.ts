import type { ReviewFileSnapshot } from "../review/review-types";
import {
  canSupportTrustedVerification,
  taskEvidenceAuthorityRank,
  type TaskEvidenceRecord,
} from "./task-evidence";

export type VerificationCoverage =
  | "verified"
  | "failed"
  | "unrelated"
  | "not-run"
  | "scope-unknown";

export interface ChangeReviewFile {
  readonly file: ReviewFileSnapshot;
  readonly attribution: "pi" | "user" | "external" | "unknown";
  readonly intent: string;
  readonly runId?: string;
  readonly toolCallId?: string;
  readonly checkpointId?: string;
  readonly originatingUserRequestId?: string;
  readonly subagentRunId?: string;
  readonly verification: VerificationCoverage;
  readonly verificationReason: string;
  readonly relatedTests: readonly TaskEvidenceRecord[];
}

export interface ChangeReviewGroup {
  readonly id: string;
  readonly intent: string;
  readonly files: readonly ChangeReviewFile[];
  readonly risk: "low" | "medium" | "high" | "unknown";
  readonly verification: VerificationCoverage;
}

export function buildChangeReviewGroups(
  files: readonly ReviewFileSnapshot[],
  evidence: readonly TaskEvidenceRecord[],
): readonly ChangeReviewGroup[] {
  const latestChanges = latestChangeByPath(evidence);
  const latestCheckpoints = latestCheckpointByPath(evidence);
  const verification = evidence
    .filter((record) => record.kind === "test" || record.kind === "verification")
    .sort((left, right) => (
      taskEvidenceAuthorityRank(right.authority) - taskEvidenceAuthorityRank(left.authority)
      || Date.parse(right.timestamp) - Date.parse(left.timestamp)
    ));
  const mapped = files.map((file): ChangeReviewFile => {
    const change = latestChanges.get(file.path);
    const checkpoint = latestCheckpoints.get(file.path);
    const relatedTests = verification.filter((record) => record.verification?.relatedPaths?.includes(file.path));
    const coverage = deriveCoverage(verification, relatedTests);
    return {
      file,
      attribution: normalizeOwnership(change?.fileChange?.ownership),
      intent: change?.fileChange?.intent?.trim() || "Unknown / external changes",
      ...(change?.runId ? { runId: change.runId } : {}),
      ...(change?.correlation?.toolCallId ? { toolCallId: change.correlation.toolCallId } : {}),
      ...(checkpoint?.correlation?.checkpointId ? { checkpointId: checkpoint.correlation.checkpointId } : {}),
      ...(change?.fileChange?.originatingUserRequestId ? {
        originatingUserRequestId: change.fileChange.originatingUserRequestId,
      } : {}),
      ...(change?.correlation?.subagentRunId ? { subagentRunId: change.correlation.subagentRunId } : {}),
      verification: coverage.status,
      verificationReason: coverage.reason,
      relatedTests,
    };
  });
  const groups = new Map<string, ChangeReviewFile[]>();
  for (const file of mapped) {
    const current = groups.get(file.intent) ?? [];
    current.push(file);
    groups.set(file.intent, current);
  }
  return [...groups].map(([intent, groupFiles]) => ({
    id: intent.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown",
    intent,
    files: groupFiles,
    risk: deriveRisk(groupFiles),
    verification: aggregateCoverage(groupFiles.map((file) => file.verification)),
  })).sort((left, right) => (
    Number(left.intent === "Unknown / external changes") - Number(right.intent === "Unknown / external changes")
    || left.intent.localeCompare(right.intent)
  ));
}

function latestChangeByPath(evidence: readonly TaskEvidenceRecord[]): Map<string, TaskEvidenceRecord> {
  const result = new Map<string, TaskEvidenceRecord>();
  for (const record of [...evidence].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))) {
    const path = record.kind === "file-write" ? record.fileChange?.path : undefined;
    if (path && !result.has(path)) result.set(path, record);
  }
  return result;
}

function latestCheckpointByPath(evidence: readonly TaskEvidenceRecord[]): Map<string, TaskEvidenceRecord> {
  const result = new Map<string, TaskEvidenceRecord>();
  for (const record of [...evidence].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))) {
    const path = record.kind === "checkpoint" ? record.fileChange?.path : undefined;
    if (path && record.correlation?.checkpointId && !result.has(path)) result.set(path, record);
  }
  return result;
}

function deriveCoverage(
  allVerification: readonly TaskEvidenceRecord[],
  related: readonly TaskEvidenceRecord[],
): { readonly status: VerificationCoverage; readonly reason: string } {
  const decisive = related.find((record) => (
    record.status === "failed"
    || record.status === "passed"
    || record.status === "skipped"
  ));
  if (decisive?.status === "failed") {
    return { status: "failed", reason: "An explicitly linked test failed." };
  }
  if (decisive?.status === "passed" && canSupportTrustedVerification(decisive)) {
    return { status: "verified", reason: "A trusted test explicitly references this path." };
  }
  if (decisive?.status === "skipped") {
    return { status: "scope-unknown", reason: "An explicitly linked test was skipped." };
  }
  if (allVerification.length === 0) {
    return { status: "not-run", reason: "No test or verification evidence was observed." };
  }
  if (allVerification.some((record) => record.status === "passed")) {
    return { status: "unrelated", reason: "Tests passed, but none explicitly link to this path." };
  }
  return { status: "scope-unknown", reason: "Verification evidence exists, but its path coverage is unknown." };
}

function normalizeOwnership(value: string | undefined): ChangeReviewFile["attribution"] {
  if (value === "pi" || value === "user" || value === "external") return value;
  return "unknown";
}

function deriveRisk(files: readonly ChangeReviewFile[]): ChangeReviewGroup["risk"] {
  if (files.some(({ file }) => file.status === "deleted")) return "high";
  if (files.some(({ file }) => /(?:lock|config|security|auth|migration)/i.test(file.path))) return "medium";
  if (files.every((file) => file.attribution === "pi" && file.verification === "verified")) return "low";
  return "unknown";
}

function aggregateCoverage(values: readonly VerificationCoverage[]): VerificationCoverage {
  if (values.includes("failed")) return "failed";
  if (values.every((value) => value === "verified")) return "verified";
  if (values.includes("not-run")) return "not-run";
  if (values.includes("unrelated")) return "unrelated";
  return "scope-unknown";
}
