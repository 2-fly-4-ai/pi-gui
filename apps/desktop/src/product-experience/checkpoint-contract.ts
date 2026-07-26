export const CHECKPOINT_SCHEMA_VERSION = 1 as const;
export const DEFAULT_CHECKPOINT_MAX_FILE_BYTES = 8 * 1024 * 1024;

export type CheckpointOwnership = "pi" | "user" | "pre-existing" | "external" | "unknown";
export type CheckpointFileKind = "text" | "binary" | "symlink";
export type CheckpointEntryOperation = "restore" | "remove-created" | "rename";

export interface CheckpointWorkspaceIdentity {
  readonly workspaceId: string;
  readonly rootPath: string;
  readonly checkoutPath: string;
  readonly branchName?: string;
}

export interface CheckpointFileSnapshot {
  readonly exists: boolean;
  readonly kind: CheckpointFileKind;
  readonly sizeBytes: number;
  readonly contentHash?: string;
  readonly blobId?: string;
  readonly executable?: boolean;
  readonly symlinkTarget?: string;
}

export interface CheckpointManifestEntry {
  readonly path: string;
  readonly operation: CheckpointEntryOperation;
  readonly ownership: CheckpointOwnership;
  readonly before: CheckpointFileSnapshot;
  readonly expectedAfterHash?: string;
  readonly expectedAfterBlobId?: string;
  readonly renamedFrom?: string;
}

export interface CheckpointManifest {
  readonly schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  readonly id: string;
  readonly sessionId: string;
  readonly runId?: string;
  readonly reason: "before-run-mutation" | "before-restore" | "before-hunk-reject" | "manual";
  readonly createdAt: string;
  readonly workspace: CheckpointWorkspaceIdentity;
  readonly entries: readonly CheckpointManifestEntry[];
  readonly manifestHash: string;
}

export interface CurrentCheckpointEntryState {
  readonly path: string;
  readonly exists: boolean;
  readonly kind?: CheckpointFileKind;
  readonly sizeBytes?: number;
  readonly contentHash?: string;
  readonly executable?: boolean;
  readonly modifiedAfterCheckpoint?: boolean;
}

export type CheckpointRestoreStatus =
  | "safe"
  | "noop"
  | "conflict"
  | "unsupported"
  | "wrong-workspace";

export interface CheckpointRestorePreviewEntry {
  readonly path: string;
  readonly operation: CheckpointEntryOperation;
  readonly ownership: CheckpointOwnership;
  readonly status: CheckpointRestoreStatus;
  readonly defaultSelected: boolean;
  readonly requiresConfirmation: boolean;
  readonly reason: string;
}

export interface CheckpointRestorePreview {
  readonly checkpointId: string;
  readonly workspaceMatches: boolean;
  readonly requiresRollbackCheckpoint: boolean;
  readonly entries: readonly CheckpointRestorePreviewEntry[];
}

export interface CheckpointRestoreOutcome {
  readonly path: string;
  readonly status: "applied" | "skipped" | "failed";
  readonly error?: string;
}

export interface CheckpointRestoreResult {
  readonly checkpointId: string;
  readonly rollbackCheckpointId: string;
  readonly partial: boolean;
  readonly outcomes: readonly CheckpointRestoreOutcome[];
}

export interface CheckpointRestoreRequest {
  readonly checkpointId: string;
  readonly workspaceId: string;
  readonly selectedPaths: readonly string[];
  readonly confirmedPaths?: readonly string[];
}

export interface CheckpointRetentionPolicy {
  readonly maxCheckpoints: number;
  readonly protectedCheckpointIds: readonly string[];
  readonly pendingRestoreCheckpointIds: readonly string[];
}

export interface CheckpointRetentionInput {
  readonly maxCheckpoints: number;
  readonly protectedCheckpointIds: readonly string[];
}

export function buildCheckpointRestorePreview(
  manifest: CheckpointManifest,
  currentWorkspace: CheckpointWorkspaceIdentity,
  currentEntries: readonly CurrentCheckpointEntryState[],
  options: {
    readonly maxFileBytes?: number;
  } = {},
): CheckpointRestorePreview {
  const workspaceMatches = sameWorkspaceIdentity(manifest.workspace, currentWorkspace);
  const currentByPath = new Map(currentEntries.map((entry) => [entry.path, entry]));
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_CHECKPOINT_MAX_FILE_BYTES;
  const entries = manifest.entries.map((entry) => classifyRestoreEntry(
    entry,
    currentByPath.get(entry.path),
    workspaceMatches,
    maxFileBytes,
  ));

  return {
    checkpointId: manifest.id,
    workspaceMatches,
    requiresRollbackCheckpoint: entries.some((entry) => entry.defaultSelected),
    entries,
  };
}

export function sameWorkspaceIdentity(
  checkpoint: CheckpointWorkspaceIdentity,
  current: CheckpointWorkspaceIdentity,
): boolean {
  return (
    checkpoint.workspaceId === current.workspaceId
    && checkpoint.rootPath === current.rootPath
    && checkpoint.checkoutPath === current.checkoutPath
  );
}

function classifyRestoreEntry(
  entry: CheckpointManifestEntry,
  current: CurrentCheckpointEntryState | undefined,
  workspaceMatches: boolean,
  maxFileBytes: number,
): CheckpointRestorePreviewEntry {
  const base = {
    path: entry.path,
    operation: entry.operation,
    ownership: entry.ownership,
  };

  if (!workspaceMatches) {
    return {
      ...base,
      status: "wrong-workspace",
      defaultSelected: false,
      requiresConfirmation: true,
      reason: "The checkpoint belongs to a different workspace or checkout.",
    };
  }

  if (entry.before.kind === "symlink" || current?.kind === "symlink") {
    return {
      ...base,
      status: "unsupported",
      defaultSelected: false,
      requiresConfirmation: true,
      reason: "Symlink restoration requires an explicit implementation and cannot use the file-content path.",
    };
  }

  if (current?.exists && current.kind === undefined) {
    return {
      ...base,
      status: "unsupported",
      defaultSelected: false,
      requiresConfirmation: true,
      reason: "The current path is not a regular file.",
    };
  }

  if (entry.before.sizeBytes > maxFileBytes || (current?.sizeBytes ?? 0) > maxFileBytes) {
    return {
      ...base,
      status: "unsupported",
      defaultSelected: false,
      requiresConfirmation: true,
      reason: "The file exceeds the checkpoint size limit.",
    };
  }

  if (entry.operation === "rename" || entry.renamedFrom) {
    return {
      ...base,
      status: "conflict",
      defaultSelected: false,
      requiresConfirmation: true,
      reason: "Rename restoration requires both source and destination to be reviewed together.",
    };
  }

  if (isAlreadyAtCheckpoint(entry, current)) {
    return {
      ...base,
      status: "noop",
      defaultSelected: false,
      requiresConfirmation: false,
      reason: "The current file already matches the checkpoint.",
    };
  }

  if (entry.ownership !== "pi") {
    return {
      ...base,
      status: "conflict",
      defaultSelected: false,
      requiresConfirmation: true,
      reason: "Only Pi-attributed changes are selected for restore by default.",
    };
  }

  if (current?.modifiedAfterCheckpoint) {
    return {
      ...base,
      status: "conflict",
      defaultSelected: false,
      requiresConfirmation: true,
      reason: "The file changed after the checkpoint was created.",
    };
  }

  if (entry.expectedAfterHash && current?.contentHash && entry.expectedAfterHash !== current.contentHash) {
    return {
      ...base,
      status: "conflict",
      defaultSelected: false,
      requiresConfirmation: true,
      reason: "The current file does not match the Pi-attributed post-change state.",
    };
  }

  const removesFile = entry.operation === "remove-created";
  return {
    ...base,
    status: "safe",
    defaultSelected: true,
    requiresConfirmation: removesFile,
    reason: removesFile
      ? "Restoring this Pi-created path removes the current file."
      : "The current state matches the Pi-attributed change and can be restored.",
  };
}

function isAlreadyAtCheckpoint(
  entry: CheckpointManifestEntry,
  current: CurrentCheckpointEntryState | undefined,
): boolean {
  if (!entry.before.exists) {
    return current?.exists === false || current === undefined;
  }
  return (
    current?.exists === true
    && entry.before.contentHash !== undefined
    && entry.before.contentHash === current.contentHash
    && entry.before.executable === current.executable
  );
}
