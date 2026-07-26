export const TASK_EVIDENCE_SCHEMA_VERSION = 1 as const;

export type TaskEvidenceKind =
  | "activity"
  | "file-read"
  | "file-write"
  | "command"
  | "test"
  | "verification"
  | "approval"
  | "decision"
  | "artifact"
  | "checkpoint"
  | "error"
  | "completion";

export type TaskEvidenceStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "skipped"
  | "cancelled"
  | "unknown";

export type TaskEvidenceAuthority =
  | "desktop-observed"
  | "runtime-observed"
  | "tool-observed"
  | "user-declared"
  | "assistant-narrative";

export type TaskEvidenceSource =
  | "desktop"
  | "runtime"
  | "tool"
  | "subagent"
  | "user"
  | "assistant";

export type TaskActivityType =
  | "reading"
  | "editing"
  | "running-command"
  | "running-tests"
  | "waiting-approval"
  | "waiting-provider"
  | "waiting-subagent"
  | "retrying"
  | "blocked"
  | "working";

export type VerificationScope =
  | "unit"
  | "package"
  | "electron-core"
  | "electron-live"
  | "native"
  | "packaged"
  | "external";

export interface TaskEvidenceCorrelation {
  readonly toolCallId?: string;
  readonly subagentRunId?: string;
  readonly commandId?: string;
  readonly checkpointId?: string;
  readonly parentEvidenceId?: string;
}

export interface FileChangeProvenance {
  readonly path: string;
  readonly operation: "create" | "modify" | "delete" | "rename" | "unknown";
  readonly ownership: "pi" | "user" | "pre-existing" | "external" | "unknown";
  readonly intent?: string;
  readonly originatingUserRequestId?: string;
  readonly beforeHash?: string;
  readonly afterHash?: string;
  readonly renamedFrom?: string;
}

export interface VerificationEvidenceDetails {
  readonly scope: VerificationScope;
  readonly command?: string;
  readonly cwd?: string;
  readonly exitCode?: number | null;
  readonly durationMs?: number;
  readonly testIdentifiers?: readonly string[];
  readonly relatedPaths?: readonly string[];
}

export interface ActivityEvidenceDetails {
  readonly type: TaskActivityType;
  readonly startedAt?: string;
  readonly progress?: number;
}

export interface ApprovalEvidenceDetails {
  readonly requestId: string;
  readonly requestKind: "confirm" | "input" | "select" | "editor" | "permission" | "boundary";
  readonly decision?: "approved" | "denied" | "cancelled" | "expired";
  readonly risk?: "routine" | "significant" | "destructive";
}

export interface ArtifactEvidenceDetails {
  readonly artifactId: string;
  readonly artifactType: string;
  readonly path?: string;
  readonly sensitivity?: "normal" | "private" | "restricted";
}

export interface DecisionEvidenceDetails {
  readonly decisionId: string;
  readonly state: "proposed" | "active" | "superseded" | "withdrawn";
  readonly scope?: "thread" | "workspace" | "global";
}

export interface CompletionEvidenceDetails {
  readonly outcome: "completed" | "partial" | "failed" | "cancelled" | "interrupted" | "blocked";
  readonly elapsedMs?: number;
  readonly checkoutPath?: string;
  readonly branchName?: string;
  readonly changedPaths?: readonly string[];
  readonly verificationEvidenceIds?: readonly string[];
  readonly childRunIds?: readonly string[];
  readonly approvalEvidenceIds?: readonly string[];
  readonly blockerEvidenceIds?: readonly string[];
}

export type TaskErrorCategory =
  | "provider-auth"
  | "rate-limit"
  | "runtime-crash"
  | "tool-failure"
  | "command-failure"
  | "test-failure"
  | "permission"
  | "missing-file"
  | "stale-workspace"
  | "unknown";

export interface ErrorEvidenceDetails {
  readonly category: TaskErrorCategory;
  readonly code?: string;
  readonly attemptCount: number;
  readonly recoveryActions: readonly (
    | "retry"
    | "reauthenticate"
    | "continue"
    | "open-logs"
    | "open-settings"
    | "copy-diagnostics"
  )[];
  readonly originalEvidenceId?: string;
}

export interface TaskEvidenceRecord {
  readonly schemaVersion: typeof TASK_EVIDENCE_SCHEMA_VERSION;
  readonly id: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly runId?: string;
  readonly timestamp: string;
  readonly kind: TaskEvidenceKind;
  readonly source: TaskEvidenceSource;
  readonly authority: TaskEvidenceAuthority;
  readonly status?: TaskEvidenceStatus;
  readonly summary: string;
  readonly correlation?: TaskEvidenceCorrelation;
  readonly activity?: ActivityEvidenceDetails;
  readonly fileChange?: FileChangeProvenance;
  readonly verification?: VerificationEvidenceDetails;
  readonly approval?: ApprovalEvidenceDetails;
  readonly artifact?: ArtifactEvidenceDetails;
  readonly decision?: DecisionEvidenceDetails;
  readonly completion?: CompletionEvidenceDetails;
  readonly error?: ErrorEvidenceDetails;
}

export interface TaskEvidenceQuery {
  readonly workspaceId: string;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly kinds?: readonly TaskEvidenceKind[];
  readonly since?: string;
  readonly before?: string;
  readonly limit?: number;
  readonly compact?: boolean;
}

export interface TaskEvidencePage {
  readonly records: readonly TaskEvidenceRecord[];
  readonly groups?: readonly TaskEvidenceGroup[];
  readonly hasMore: boolean;
  readonly newestTimestamp?: string;
  readonly oldestTimestamp?: string;
}

export interface TaskEvidenceDelta {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly records: readonly TaskEvidenceRecord[];
}

export interface TaskEvidenceGroup {
  readonly key: string;
  readonly kind: TaskEvidenceKind;
  readonly source: TaskEvidenceSource;
  readonly status?: TaskEvidenceStatus;
  readonly firstTimestamp: string;
  readonly lastTimestamp: string;
  readonly count: number;
  readonly evidenceIds: readonly string[];
  readonly records: readonly TaskEvidenceRecord[];
}

export interface VerificationConfidence {
  readonly highestPassedScope?: VerificationScope;
  readonly passedScopes: readonly VerificationScope[];
  readonly failedScopes: readonly VerificationScope[];
  readonly blockedScopes: readonly VerificationScope[];
  readonly evidenceIds: readonly string[];
}

const AUTHORITY_RANK: Readonly<Record<TaskEvidenceAuthority, number>> = {
  "assistant-narrative": 0,
  "user-declared": 1,
  "desktop-observed": 2,
  "runtime-observed": 3,
  "tool-observed": 4,
};

const VERIFICATION_SCOPE_RANK: Readonly<Record<VerificationScope, number>> = {
  unit: 0,
  package: 1,
  "electron-core": 2,
  "electron-live": 3,
  native: 4,
  packaged: 5,
  external: 6,
};

export function taskEvidenceAuthorityRank(authority: TaskEvidenceAuthority): number {
  return AUTHORITY_RANK[authority];
}

export function canSupportTrustedVerification(record: TaskEvidenceRecord): boolean {
  return (
    (record.kind === "test" || record.kind === "verification")
    && record.verification !== undefined
    && record.authority !== "assistant-narrative"
    && record.authority !== "user-declared"
  );
}

export function compareTaskEvidenceAuthority(
  left: TaskEvidenceRecord,
  right: TaskEvidenceRecord,
): number {
  return taskEvidenceAuthorityRank(right.authority) - taskEvidenceAuthorityRank(left.authority);
}

export function compactTaskEvidence(
  records: readonly TaskEvidenceRecord[],
  options: {
    readonly maxGapMs?: number;
    readonly compactKinds?: readonly TaskEvidenceKind[];
  } = {},
): TaskEvidenceGroup[] {
  const maxGapMs = options.maxGapMs ?? 5_000;
  const compactKinds = new Set<TaskEvidenceKind>(
    options.compactKinds ?? ["activity", "file-read", "command"],
  );
  const sorted = [...records].sort(compareEvidenceTime);
  const groups: TaskEvidenceGroup[] = [];

  for (const record of sorted) {
    const previous = groups.at(-1);
    const previousRecord = previous?.records.at(-1);
    const shouldMerge = (
      previous !== undefined
      && previousRecord !== undefined
      && compactKinds.has(record.kind)
      && previous.kind === record.kind
      && previous.source === record.source
      && previous.status === record.status
      && sameRun(previousRecord, record)
      && sameCorrelationOwner(previousRecord, record)
      && elapsedMs(previous.lastTimestamp, record.timestamp) <= maxGapMs
    );

    if (!shouldMerge) {
      groups.push(toGroup(record));
      continue;
    }

    groups[groups.length - 1] = {
      ...previous,
      lastTimestamp: record.timestamp,
      count: previous.count + 1,
      evidenceIds: [...previous.evidenceIds, record.id],
      records: [...previous.records, record],
    };
  }

  return groups;
}

export function deriveVerificationConfidence(
  records: readonly TaskEvidenceRecord[],
): VerificationConfidence {
  const trusted = records.filter(canSupportTrustedVerification);
  const passedScopes = uniqueScopes(trusted, "passed");
  const failedScopes = uniqueScopes(trusted, "failed");
  const blockedScopes = uniqueScopes(trusted, "blocked");
  const highestPassedScope = [...passedScopes].sort(
    (left, right) => VERIFICATION_SCOPE_RANK[right] - VERIFICATION_SCOPE_RANK[left],
  )[0];

  return {
    ...(highestPassedScope ? { highestPassedScope } : {}),
    passedScopes,
    failedScopes,
    blockedScopes,
    evidenceIds: trusted.map((record) => record.id),
  };
}

function toGroup(record: TaskEvidenceRecord): TaskEvidenceGroup {
  return {
    key: `${record.sessionId}:${record.runId ?? "no-run"}:${record.kind}:${record.id}`,
    kind: record.kind,
    source: record.source,
    ...(record.status ? { status: record.status } : {}),
    firstTimestamp: record.timestamp,
    lastTimestamp: record.timestamp,
    count: 1,
    evidenceIds: [record.id],
    records: [record],
  };
}

function compareEvidenceTime(left: TaskEvidenceRecord, right: TaskEvidenceRecord): number {
  const difference = Date.parse(left.timestamp) - Date.parse(right.timestamp);
  return difference === 0 ? left.id.localeCompare(right.id) : difference;
}

function elapsedMs(left: string, right: string): number {
  const difference = Date.parse(right) - Date.parse(left);
  return Number.isFinite(difference) ? Math.max(0, difference) : Number.POSITIVE_INFINITY;
}

function sameRun(left: TaskEvidenceRecord, right: TaskEvidenceRecord): boolean {
  return left.sessionId === right.sessionId && left.runId === right.runId;
}

function sameCorrelationOwner(left: TaskEvidenceRecord, right: TaskEvidenceRecord): boolean {
  return (
    left.correlation?.subagentRunId === right.correlation?.subagentRunId
    && left.correlation?.toolCallId === right.correlation?.toolCallId
  );
}

function uniqueScopes(
  records: readonly TaskEvidenceRecord[],
  status: TaskEvidenceStatus,
): VerificationScope[] {
  return [...new Set(
    records
      .filter((record) => record.status === status)
      .flatMap((record) => record.verification ? [record.verification.scope] : []),
  )].sort((left, right) => VERIFICATION_SCOPE_RANK[left] - VERIFICATION_SCOPE_RANK[right]);
}
