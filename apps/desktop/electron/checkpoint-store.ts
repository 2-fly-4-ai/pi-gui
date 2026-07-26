import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  buildCheckpointRestorePreview,
  CHECKPOINT_SCHEMA_VERSION,
  DEFAULT_CHECKPOINT_MAX_FILE_BYTES,
  type CheckpointEntryOperation,
  type CheckpointFileKind,
  type CheckpointFileSnapshot,
  type CheckpointManifest,
  type CheckpointManifestEntry,
  type CheckpointOwnership,
  type CheckpointRestorePreview,
  type CheckpointRestoreOutcome,
  type CheckpointRestoreResult,
  type CheckpointRetentionInput,
  type CheckpointRetentionPolicy,
  type CheckpointWorkspaceIdentity,
  type CurrentCheckpointEntryState,
  sameWorkspaceIdentity,
} from "../src/product-experience/checkpoint-contract";
import {
  applyHunkRejections,
  buildHunkRestorePreview,
  type CheckpointHunkPreview,
  type RejectCheckpointHunksResult,
} from "../src/product-experience/hunk-restoration";

const STORE_SCHEMA_VERSION = 1 as const;
const DEFAULT_MAX_CHECKPOINTS = 100;

interface PersistedCheckpointManifest {
  readonly storeSchemaVersion: typeof STORE_SCHEMA_VERSION;
  readonly manifest: CheckpointManifest;
}

export interface CheckpointCapturePath {
  readonly path: string;
  readonly operation?: CheckpointEntryOperation;
  readonly ownership: CheckpointOwnership;
  readonly expectedAfterHash?: string;
  readonly renamedFrom?: string;
}

export interface CreateCheckpointInput {
  readonly workspace: CheckpointWorkspaceIdentity;
  readonly sessionId: string;
  readonly runId?: string;
  readonly reason: CheckpointManifest["reason"];
  readonly paths: readonly CheckpointCapturePath[];
}

export interface CheckpointStoreOptions {
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly maxFileBytes?: number;
  readonly maxCheckpoints?: number;
  readonly beforeRestoreApply?: (path: string) => void | Promise<void>;
  readonly beforeRestoreCommit?: (path: string, temporaryPath: string) => void | Promise<void>;
}

export interface RestoreCheckpointInput {
  readonly checkpointId: string;
  readonly workspace: CheckpointWorkspaceIdentity;
  readonly selectedPaths: readonly string[];
  readonly confirmedPaths?: readonly string[];
}

export class CheckpointStore {
  private readonly rootPath: string;
  private readonly manifestDirectory: string;
  private readonly blobDirectory: string;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly maxFileBytes: number;
  private readonly maxCheckpoints: number;
  private readonly beforeRestoreApply?: (path: string) => void | Promise<void>;
  private readonly beforeRestoreCommit?: (path: string, temporaryPath: string) => void | Promise<void>;
  private readonly retentionPath: string;
  private retentionLoaded = false;
  private retentionPolicy: CheckpointRetentionPolicy;
  private pending = Promise.resolve();

  constructor(userDataPath: string, options: CheckpointStoreOptions = {}) {
    this.rootPath = join(userDataPath, "checkpoints");
    this.manifestDirectory = join(this.rootPath, "manifests");
    this.blobDirectory = join(this.rootPath, "blobs");
    this.retentionPath = join(this.rootPath, "retention.json");
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.maxFileBytes = positiveInteger(
      options.maxFileBytes,
      DEFAULT_CHECKPOINT_MAX_FILE_BYTES,
    );
    this.maxCheckpoints = positiveInteger(options.maxCheckpoints, DEFAULT_MAX_CHECKPOINTS);
    this.beforeRestoreApply = options.beforeRestoreApply;
    this.beforeRestoreCommit = options.beforeRestoreCommit;
    this.retentionPolicy = {
      maxCheckpoints: this.maxCheckpoints,
      protectedCheckpointIds: [],
      pendingRestoreCheckpointIds: [],
    };
  }

  create(input: CreateCheckpointInput): Promise<CheckpointManifest> {
    return this.enqueue(() => this.createUnlocked(input));
  }

  finalizeExpectedAfter(
    checkpointId: string,
    checkpointPath: string,
  ): Promise<CheckpointManifest | undefined> {
    return this.enqueue(async () => {
      const manifest = await this.get(checkpointId);
      if (!manifest) return undefined;
      const normalizedPath = normalizeCheckpointPath(checkpointPath);
      const currentSnapshot = await this.captureFile(
        manifest.workspace.checkoutPath,
        normalizedPath,
      );
      const entries = manifest.entries.map((entry) => entry.path === normalizedPath ? {
        ...entry,
        ...(currentSnapshot.contentHash ? { expectedAfterHash: currentSnapshot.contentHash } : {}),
        ...(currentSnapshot.blobId ? { expectedAfterBlobId: currentSnapshot.blobId } : {}),
      } : entry);
      const { manifestHash: _manifestHash, ...unsignedManifest } = manifest;
      const unsigned = { ...unsignedManifest, entries };
      const finalized: CheckpointManifest = {
        ...unsigned,
        manifestHash: hashJson(unsigned),
      };
      await atomicWriteJson(this.manifestPath(finalized.id), {
        storeSchemaVersion: STORE_SCHEMA_VERSION,
        manifest: finalized,
      } satisfies PersistedCheckpointManifest);
      return finalized;
    });
  }

  async get(checkpointId: string): Promise<CheckpointManifest | undefined> {
    if (!safeIdentifier(checkpointId)) return undefined;
    try {
      const parsed = JSON.parse(await readFile(this.manifestPath(checkpointId), "utf8")) as unknown;
      return normalizePersistedManifest(parsed);
    } catch {
      return undefined;
    }
  }

  async list(workspaceId?: string): Promise<readonly CheckpointManifest[]> {
    let names: string[];
    try {
      names = await readdir(this.manifestDirectory);
    } catch {
      return [];
    }
    const manifests = await Promise.all(
      names.filter((name) => name.endsWith(".json"))
        .map((name) => this.get(name.slice(0, -5))),
    );
    return manifests
      .filter((manifest): manifest is CheckpointManifest => (
        manifest !== undefined
        && (!workspaceId || manifest.workspace.workspaceId === workspaceId)
      ))
      .sort((left, right) => (
        Date.parse(right.createdAt) - Date.parse(left.createdAt)
        || right.id.localeCompare(left.id)
      ));
  }

  async preview(
    checkpointId: string,
    currentWorkspace: CheckpointWorkspaceIdentity,
  ): Promise<CheckpointRestorePreview> {
    const manifest = await this.get(checkpointId);
    if (!manifest) throw new Error("Checkpoint is unavailable or malformed.");
    await this.acquireRestoreLease(checkpointId);
    const currentEntries = await Promise.all(
      manifest.entries.map(async (entry) => {
        const current = await this.inspectCurrentEntry(
          currentWorkspace.checkoutPath,
          entry.path,
          manifest.createdAt,
        );
        return entry.expectedAfterHash && current.contentHash === entry.expectedAfterHash
          ? { ...current, modifiedAfterCheckpoint: false }
          : current;
      }),
    );
    const preview = buildCheckpointRestorePreview(manifest, currentWorkspace, currentEntries, {
      maxFileBytes: this.maxFileBytes,
    });
    const entries = await Promise.all(preview.entries.map(async (entry, index) => {
      const manifestEntry = manifest.entries[index];
      if (
        !manifestEntry
        || !manifestEntry.before.exists
        || manifestEntry.before.kind === "symlink"
        || manifestEntry.before.sizeBytes > this.maxFileBytes
      ) return entry;
      if (
        !manifestEntry.before.blobId
        || !(await this.readBlob(manifestEntry.before.blobId))
      ) {
        return {
          ...entry,
          status: "unsupported" as const,
          defaultSelected: false,
          requiresConfirmation: true,
          reason: "Checkpoint content is unavailable or failed integrity verification.",
        };
      }
      return entry;
    }));
    return {
      ...preview,
      requiresRollbackCheckpoint: entries.some((entry) => entry.defaultSelected),
      entries,
    };
  }

  async getRetentionPolicy(): Promise<CheckpointRetentionPolicy> {
    await this.ensureRetentionLoaded();
    return cloneRetentionPolicy(this.retentionPolicy);
  }

  setRetentionPolicy(input: CheckpointRetentionInput): Promise<CheckpointRetentionPolicy> {
    return this.enqueue(async () => {
      await this.ensureRetentionLoaded();
      this.retentionPolicy = {
        ...this.retentionPolicy,
        maxCheckpoints: Math.min(1_000, positiveInteger(input.maxCheckpoints, this.retentionPolicy.maxCheckpoints)),
        protectedCheckpointIds: [...new Set(input.protectedCheckpointIds.filter(safeIdentifier))].slice(0, 1_000),
      };
      await this.persistRetentionPolicy();
      await this.applyRetention();
      return cloneRetentionPolicy(this.retentionPolicy);
    });
  }

  releaseRestoreLease(checkpointId: string): Promise<CheckpointRetentionPolicy> {
    return this.enqueue(async () => {
      await this.ensureRetentionLoaded();
      this.retentionPolicy = {
        ...this.retentionPolicy,
        pendingRestoreCheckpointIds: this.retentionPolicy.pendingRestoreCheckpointIds.filter(
          (candidate) => candidate !== checkpointId,
        ),
      };
      await this.persistRetentionPolicy();
      await this.applyRetention();
      return cloneRetentionPolicy(this.retentionPolicy);
    });
  }

  async readBlob(blobId: string): Promise<Buffer | undefined> {
    if (!/^[a-f0-9]{64}$/.test(blobId)) return undefined;
    try {
      const content = await readFile(join(this.blobDirectory, blobId));
      return sha256(content) === blobId ? content : undefined;
    } catch {
      return undefined;
    }
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  restore(input: RestoreCheckpointInput): Promise<CheckpointRestoreResult> {
    return this.enqueue(async () => {
      const manifest = await this.get(input.checkpointId);
      if (!manifest) throw new Error("Checkpoint is unavailable or malformed.");
      const preview = await this.preview(input.checkpointId, input.workspace);
      if (!preview.workspaceMatches) {
        throw new Error("The checkpoint belongs to a different workspace or checkout.");
      }
      const selectedPaths = new Set(input.selectedPaths.map(normalizeCheckpointPath));
      const confirmedPaths = new Set((input.confirmedPaths ?? []).map(normalizeCheckpointPath));
      const selectedEntries = manifest.entries.filter((entry) => selectedPaths.has(entry.path));
      if (selectedEntries.length === 0) throw new Error("No checkpoint paths were selected.");
      const previewByPath = new Map(preview.entries.map((entry) => [entry.path, entry]));
      for (const entry of selectedEntries) {
        const classification = previewByPath.get(entry.path);
        if (!classification || classification.status === "unsupported" || classification.status === "wrong-workspace") {
          throw new Error(`Checkpoint path cannot be restored: ${entry.path}`);
        }
        if (
          classification.status === "conflict"
          && !confirmedPaths.has(entry.path)
        ) {
          throw new Error(`Checkpoint conflict requires confirmation: ${entry.path}`);
        }
        if (classification.requiresConfirmation && !confirmedPaths.has(entry.path)) {
          throw new Error(`Checkpoint change requires confirmation: ${entry.path}`);
        }
        if (entry.operation === "rename" || entry.renamedFrom) {
          throw new Error(`Rename restore is not implemented safely: ${entry.path}`);
        }
      }

      const rollback = await this.createUnlocked({
        workspace: input.workspace,
        sessionId: manifest.sessionId,
        ...(manifest.runId ? { runId: manifest.runId } : {}),
        reason: "before-restore",
        paths: selectedEntries.map((entry) => ({
          path: entry.path,
          ownership: "pi",
          ...(entry.before.exists && entry.before.contentHash ? {
            expectedAfterHash: entry.before.contentHash,
          } : {}),
        })),
      });
      const rollbackByPath = new Map(rollback.entries.map((entry) => [entry.path, entry]));
      const outcomes: CheckpointRestoreOutcome[] = [];
      for (const entry of selectedEntries) {
        const classification = previewByPath.get(entry.path);
        if (classification?.status === "noop") {
          outcomes.push({ path: entry.path, status: "skipped" });
          continue;
        }
        try {
          await this.beforeRestoreApply?.(entry.path);
          const current = await this.inspectCurrentEntry(
            input.workspace.checkoutPath,
            entry.path,
            rollback.createdAt,
          );
          const rollbackEntry = rollbackByPath.get(entry.path);
          if (!rollbackEntry || !sameSnapshotState(rollbackEntry.before, current)) {
            throw new Error("The file changed after restore preview.");
          }
          await this.applyRestoreEntry(input.workspace.checkoutPath, entry);
          outcomes.push({ path: entry.path, status: "applied" });
        } catch (error) {
          outcomes.push({
            path: entry.path,
            status: "failed",
            error: safeRestoreError(error),
          });
        }
      }
      const result = {
        checkpointId: manifest.id,
        rollbackCheckpointId: rollback.id,
        partial: outcomes.some((outcome) => outcome.status === "failed"),
        outcomes,
      };
      await this.removeRestoreLeaseUnlocked(manifest.id);
      return result;
    });
  }

  async previewHunks(
    checkpointId: string,
    workspace: CheckpointWorkspaceIdentity,
    checkpointPath: string,
  ): Promise<CheckpointHunkPreview> {
    const path = normalizeCheckpointPath(checkpointPath);
    const manifest = await this.get(checkpointId);
    const unavailable = (reason: string, ownership: CheckpointOwnership = "unknown"): CheckpointHunkPreview => ({
      checkpointId,
      workspaceId: workspace.workspaceId,
      path,
      ownership,
      available: false,
      reason,
    });
    if (!manifest) return unavailable("Checkpoint is unavailable or malformed.");
    if (!sameWorkspaceIdentity(manifest.workspace, workspace)) {
      return unavailable("The checkpoint belongs to a different workspace or checkout.");
    }
    const entry = manifest.entries.find((candidate) => candidate.path === path);
    if (!entry) return unavailable("This file is not present in the checkpoint.");
    if (entry.ownership !== "pi") {
      return unavailable("Only Pi-attributed checkpoint hunks can be rejected.", entry.ownership);
    }
    if (
      !entry.before.exists
      || entry.before.kind !== "text"
      || !entry.before.blobId
      || !entry.expectedAfterBlobId
      || entry.operation !== "restore"
    ) {
      return unavailable(
        "Hunk rejection requires text snapshots from before and after Pi's edit; creations, deletions, renames, and binary files require file-level review.",
        entry.ownership,
      );
    }
    const [before, after] = await Promise.all([
      this.readBlob(entry.before.blobId),
      this.readBlob(entry.expectedAfterBlobId),
    ]);
    if (!before || !after) {
      return unavailable("Checkpoint text failed integrity verification.", entry.ownership);
    }
    let current: Buffer;
    try {
      current = await readFile(resolveCheckpointFile(workspace.checkoutPath, path));
    } catch {
      return unavailable("The current file is missing or unreadable.", entry.ownership);
    }
    if (current.includes(0)) {
      return unavailable("Binary files cannot use hunk rejection.", entry.ownership);
    }
    return {
      checkpointId,
      workspaceId: workspace.workspaceId,
      path,
      ownership: entry.ownership,
      available: true,
      reason: "Pi-attributed text hunks are compared with the current file and surrounding context.",
      preview: buildHunkRestorePreview(
        before.toString("utf8"),
        after.toString("utf8"),
        current.toString("utf8"),
      ),
    };
  }

  rejectHunks(input: {
    readonly checkpointId: string;
    readonly workspace: CheckpointWorkspaceIdentity;
    readonly path: string;
    readonly hunkIds: readonly string[];
  }): Promise<RejectCheckpointHunksResult> {
    return this.enqueue(async () => {
      const preview = await this.previewHunks(input.checkpointId, input.workspace, input.path);
      if (!preview.available || !preview.preview) throw new Error(preview.reason);
      const selected = new Set(input.hunkIds);
      if (selected.size === 0) throw new Error("Select at least one hunk to reject.");
      const selectedHunks = preview.preview.hunks.filter((hunk) => selected.has(hunk.id));
      if (selectedHunks.length !== selected.size) throw new Error("One or more selected hunks are unavailable.");
      const unsafe = selectedHunks.find((hunk) => hunk.status !== "safe");
      if (unsafe) throw new Error(`Hunk rejection is blocked: ${unsafe.reason}`);

      const manifest = await this.get(input.checkpointId);
      const entry = manifest?.entries.find((candidate) => candidate.path === preview.path);
      if (!manifest || !entry?.expectedAfterBlobId) throw new Error("Checkpoint changed before hunk rejection.");
      const absolutePath = resolveCheckpointFile(input.workspace.checkoutPath, preview.path);
      const current = await readFile(absolutePath, "utf8");
      const next = applyHunkRejections(current, preview.preview, [...selected]);
      const rollback = await this.createUnlocked({
        workspace: input.workspace,
        sessionId: manifest.sessionId,
        ...(manifest.runId ? { runId: manifest.runId } : {}),
        reason: "before-hunk-reject",
        paths: [{
          path: preview.path,
          ownership: "pi",
          expectedAfterHash: sha256(Buffer.from(next)),
        }],
      });
      await this.beforeRestoreApply?.(preview.path);
      const rollbackEntry = rollback.entries[0];
      if (!rollbackEntry?.before.contentHash || rollbackEntry.before.contentHash !== sha256(Buffer.from(current))) {
        throw new Error("The file changed before the rollback checkpoint was secured.");
      }
      await this.writeTextAtomically(absolutePath, preview.path, next);
      return {
        checkpointId: input.checkpointId,
        rollbackCheckpointId: rollback.id,
        path: preview.path,
        rejectedHunkIds: [...selected],
      };
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.catch(() => undefined).then(operation);
    this.pending = next.then(() => undefined, () => undefined);
    return next;
  }

  private async createUnlocked(input: CreateCheckpointInput): Promise<CheckpointManifest> {
    validateWorkspaceIdentity(input.workspace);
    if (!input.sessionId.trim()) throw new Error("Checkpoint session ID is required.");
    if (input.paths.length === 0) throw new Error("A checkpoint must include at least one path.");

    await this.ensureDirectories();
    const createdAt = this.now().toISOString();
    const entries: CheckpointManifestEntry[] = [];
    const seen = new Set<string>();
    for (const capture of input.paths) {
      const normalizedPath = normalizeCheckpointPath(capture.path);
      if (seen.has(normalizedPath)) continue;
      seen.add(normalizedPath);
      const before = await this.captureFile(input.workspace.checkoutPath, normalizedPath);
      entries.push({
        path: normalizedPath,
        operation: capture.operation ?? (before.exists ? "restore" : "remove-created"),
        ownership: capture.ownership,
        before,
        ...(capture.expectedAfterHash ? { expectedAfterHash: capture.expectedAfterHash } : {}),
        ...(capture.renamedFrom ? {
          renamedFrom: normalizeCheckpointPath(capture.renamedFrom),
        } : {}),
      });
    }

    const unsigned = {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      id: this.createId(),
      sessionId: input.sessionId,
      ...(input.runId ? { runId: input.runId } : {}),
      reason: input.reason,
      createdAt,
      workspace: input.workspace,
      entries,
    } satisfies Omit<CheckpointManifest, "manifestHash">;
    const manifest: CheckpointManifest = {
      ...unsigned,
      manifestHash: hashJson(unsigned),
    };
    await atomicWriteJson(this.manifestPath(manifest.id), {
      storeSchemaVersion: STORE_SCHEMA_VERSION,
      manifest,
    } satisfies PersistedCheckpointManifest);
    await this.applyRetention();
    return manifest;
  }

  private async ensureDirectories(): Promise<void> {
    await Promise.all([
      mkdir(this.manifestDirectory, { recursive: true }),
      mkdir(this.blobDirectory, { recursive: true }),
    ]);
  }

  private async captureFile(
    checkoutPath: string,
    checkpointPath: string,
  ): Promise<CheckpointFileSnapshot> {
    const absolutePath = resolveCheckpointFile(checkoutPath, checkpointPath);
    let metadata;
    try {
      metadata = await lstat(absolutePath);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        return { exists: false, kind: "text", sizeBytes: 0 };
      }
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      return {
        exists: true,
        kind: "symlink",
        sizeBytes: metadata.size,
        symlinkTarget: await readlink(absolutePath),
      };
    }
    if (!metadata.isFile()) {
      throw new Error(`Checkpoint paths must be regular files: ${checkpointPath}`);
    }

    const contentHash = await hashFile(absolutePath);
    const kind = await detectFileKind(absolutePath);
    const executable = (metadata.mode & 0o111) !== 0;
    if (metadata.size > this.maxFileBytes) {
      return {
        exists: true,
        kind,
        sizeBytes: metadata.size,
        contentHash,
        executable,
      };
    }
    const content = await readFile(absolutePath);
    const blobId = sha256(content);
    await writeBlobOnce(join(this.blobDirectory, blobId), content);
    return {
      exists: true,
      kind,
      sizeBytes: metadata.size,
      contentHash,
      blobId,
      executable,
    };
  }

  private async inspectCurrentEntry(
    checkoutPath: string,
    checkpointPath: string,
    checkpointCreatedAt: string,
  ): Promise<CurrentCheckpointEntryState> {
    const absolutePath = resolveCheckpointFile(checkoutPath, checkpointPath);
    let metadata;
    try {
      metadata = await lstat(absolutePath);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return { path: checkpointPath, exists: false };
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      return {
        path: checkpointPath,
        exists: true,
        kind: "symlink",
        sizeBytes: metadata.size,
        modifiedAfterCheckpoint: metadata.mtimeMs > Date.parse(checkpointCreatedAt),
      };
    }
    if (!metadata.isFile()) {
      return {
        path: checkpointPath,
        exists: true,
        modifiedAfterCheckpoint: true,
      };
    }
    return {
      path: checkpointPath,
      exists: true,
      kind: await detectFileKind(absolutePath),
      sizeBytes: metadata.size,
      contentHash: await hashFile(absolutePath),
      executable: (metadata.mode & 0o111) !== 0,
      modifiedAfterCheckpoint: metadata.mtimeMs > Date.parse(checkpointCreatedAt),
    };
  }

  private async applyRestoreEntry(
    checkoutPath: string,
    entry: CheckpointManifestEntry,
  ): Promise<void> {
    const absolutePath = resolveCheckpointFile(checkoutPath, entry.path);
    if (!entry.before.exists || entry.operation === "remove-created") {
      await unlink(absolutePath);
      return;
    }
    if (entry.before.kind === "symlink" || !entry.before.blobId) {
      throw new Error("Checkpoint content is unavailable for this file.");
    }
    const content = await this.readBlob(entry.before.blobId);
    if (!content || sha256(content) !== entry.before.contentHash) {
      throw new Error("Checkpoint content failed integrity verification.");
    }
    const parent = dirname(absolutePath);
    const parentMetadata = await stat(parent);
    if (!parentMetadata.isDirectory()) throw new Error("The restore parent is not a directory.");
    const temporaryPath = join(parent, `.${entry.path.split("/").at(-1)}.${randomUUID()}.restore`);
    try {
      await writeFile(temporaryPath, content, { flag: "wx", mode: 0o600 });
      await chmod(temporaryPath, entry.before.executable ? 0o755 : 0o644);
      await this.beforeRestoreCommit?.(entry.path, temporaryPath);
      await rename(temporaryPath, absolutePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  private async writeTextAtomically(
    absolutePath: string,
    checkpointPath: string,
    content: string,
  ): Promise<void> {
    const metadata = await stat(absolutePath);
    const parent = dirname(absolutePath);
    const temporaryPath = join(parent, `.${checkpointPath.split("/").at(-1)}.${randomUUID()}.hunk-reject`);
    try {
      await writeFile(temporaryPath, content, { flag: "wx", mode: 0o600 });
      await chmod(temporaryPath, metadata.mode & 0o777);
      await this.beforeRestoreCommit?.(checkpointPath, temporaryPath);
      await rename(temporaryPath, absolutePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  private async applyRetention(): Promise<void> {
    await this.ensureRetentionLoaded();
    const manifests = await this.list();
    if (manifests.length <= this.retentionPolicy.maxCheckpoints) return;
    // Retention is intentionally manifest-only for now. Blob garbage collection is
    // deferred until pending-restore leases exist, so a retained manifest can never
    // silently lose content required for recovery.
    const { unlink } = await import("node:fs/promises");
    const retained = new Set([
      ...this.retentionPolicy.protectedCheckpointIds,
      ...this.retentionPolicy.pendingRestoreCheckpointIds,
    ]);
    let removableCount = manifests.length - this.retentionPolicy.maxCheckpoints;
    const removable = [...manifests].reverse().filter((manifest) => {
      if (removableCount <= 0 || retained.has(manifest.id)) return false;
      removableCount -= 1;
      return true;
    });
    await Promise.all(removable.map((manifest) =>
      unlink(this.manifestPath(manifest.id)).catch(() => undefined)));
  }

  private async acquireRestoreLease(checkpointId: string): Promise<void> {
    if (!safeIdentifier(checkpointId)) return;
    await this.ensureRetentionLoaded();
    if (this.retentionPolicy.pendingRestoreCheckpointIds.includes(checkpointId)) return;
    this.retentionPolicy = {
      ...this.retentionPolicy,
      pendingRestoreCheckpointIds: [
        ...this.retentionPolicy.pendingRestoreCheckpointIds,
        checkpointId,
      ],
    };
    await this.persistRetentionPolicy();
  }

  private async removeRestoreLeaseUnlocked(checkpointId: string): Promise<void> {
    await this.ensureRetentionLoaded();
    if (!this.retentionPolicy.pendingRestoreCheckpointIds.includes(checkpointId)) return;
    this.retentionPolicy = {
      ...this.retentionPolicy,
      pendingRestoreCheckpointIds: this.retentionPolicy.pendingRestoreCheckpointIds.filter(
        (candidate) => candidate !== checkpointId,
      ),
    };
    await this.persistRetentionPolicy();
  }

  private async ensureRetentionLoaded(): Promise<void> {
    if (this.retentionLoaded) return;
    this.retentionLoaded = true;
    try {
      const raw = JSON.parse(await readFile(this.retentionPath, "utf8")) as unknown;
      if (!isObject(raw) || raw.schemaVersion !== 1) return;
      this.retentionPolicy = {
        maxCheckpoints: Math.min(1_000, positiveInteger(
          typeof raw.maxCheckpoints === "number" ? raw.maxCheckpoints : undefined,
          this.maxCheckpoints,
        )),
        protectedCheckpointIds: Array.isArray(raw.protectedCheckpointIds)
          ? [...new Set(raw.protectedCheckpointIds.filter(safeIdentifier))].slice(0, 1_000)
          : [],
        pendingRestoreCheckpointIds: Array.isArray(raw.pendingRestoreCheckpointIds)
          ? [...new Set(raw.pendingRestoreCheckpointIds.filter(safeIdentifier))].slice(0, 1_000)
          : [],
      };
    } catch {
      // Missing or malformed retention state falls back to the safe default.
    }
  }

  private async persistRetentionPolicy(): Promise<void> {
    await atomicWriteJson(this.retentionPath, {
      schemaVersion: 1,
      ...this.retentionPolicy,
    });
  }

  private manifestPath(checkpointId: string): string {
    return join(this.manifestDirectory, `${checkpointId}.json`);
  }
}

function normalizePersistedManifest(value: unknown): CheckpointManifest | undefined {
  if (!isObject(value) || value.storeSchemaVersion !== STORE_SCHEMA_VERSION) return undefined;
  const manifest = value.manifest;
  if (!isObject(manifest) || manifest.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) return undefined;
  if (
    !safeIdentifier(manifest.id)
    || typeof manifest.sessionId !== "string"
    || !Array.isArray(manifest.entries)
    || typeof manifest.manifestHash !== "string"
  ) return undefined;
  const { manifestHash: _manifestHash, ...unsigned } = manifest;
  if (hashJson(unsigned) !== manifest.manifestHash) return undefined;
  return manifest as unknown as CheckpointManifest;
}

function validateWorkspaceIdentity(workspace: CheckpointWorkspaceIdentity): void {
  if (!workspace.workspaceId.trim()) throw new Error("Checkpoint workspace ID is required.");
  if (!isAbsolute(workspace.rootPath) || !isAbsolute(workspace.checkoutPath)) {
    throw new Error("Checkpoint workspace paths must be absolute.");
  }
  const checkoutRelative = relative(workspace.rootPath, workspace.checkoutPath);
  if (checkoutRelative.startsWith("..") || isAbsolute(checkoutRelative)) {
    throw new Error("Checkpoint checkout must belong to the workspace root.");
  }
}

function normalizeCheckpointPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (
    !normalized
    || normalized === "."
    || normalized.includes("\0")
    || isAbsolute(normalized)
    || normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error(`Unsafe checkpoint path: ${value}`);
  }
  return normalized;
}

function resolveCheckpointFile(checkoutPath: string, checkpointPath: string): string {
  const absolutePath = resolve(checkoutPath, normalizeCheckpointPath(checkpointPath));
  const relativePath = relative(checkoutPath, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Checkpoint path escapes its checkout: ${checkpointPath}`);
  }
  return absolutePath;
}

async function detectFileKind(path: string): Promise<CheckpointFileKind> {
  const handle = await import("node:fs/promises").then(({ open }) => open(path, "r"));
  try {
    const buffer = Buffer.alloc(8_192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0) ? "binary" : "text";
  } finally {
    await handle.close();
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function writeBlobOnce(path: string, content: Buffer): Promise<void> {
  try {
    await writeFile(path, content, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
    const metadata = await stat(path);
    if (metadata.size !== content.byteLength || sha256(await readFile(path)) !== sha256(content)) {
      throw new Error("Checkpoint blob hash collision or corruption detected.");
    }
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporaryPath, path);
}

function hashJson(value: unknown): string {
  return sha256(Buffer.from(stableJson(value)));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function sameSnapshotState(
  snapshot: CheckpointFileSnapshot,
  current: CurrentCheckpointEntryState,
): boolean {
  if (snapshot.exists !== current.exists) return false;
  if (!snapshot.exists) return true;
  return (
    snapshot.kind === current.kind
    && snapshot.sizeBytes === current.sizeBytes
    && snapshot.contentHash === current.contentHash
    && snapshot.executable === current.executable
  );
}

function safeRestoreError(error: unknown): string {
  if (!(error instanceof Error)) return "Restore failed.";
  const code = "code" in error && typeof error.code === "string" ? ` (${error.code})` : "";
  return `${error.message.replace(/(?:\/Users|\/private|\/var|\/tmp|\/Volumes)[^\s"',)]+/g, "[path]")}${code}`;
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]+$/.test(value);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function cloneRetentionPolicy(policy: CheckpointRetentionPolicy): CheckpointRetentionPolicy {
  return {
    maxCheckpoints: policy.maxCheckpoints,
    protectedCheckpointIds: [...policy.protectedCheckpointIds],
    pendingRestoreCheckpointIds: [...policy.pendingRestoreCheckpointIds],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
