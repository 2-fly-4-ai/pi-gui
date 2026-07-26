import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_SCHEMA_VERSION,
  buildCheckpointRestorePreview,
  type CheckpointFileSnapshot,
  type CheckpointManifest,
  type CheckpointManifestEntry,
  type CheckpointWorkspaceIdentity,
  type CurrentCheckpointEntryState,
} from "../../src/product-experience/checkpoint-contract";

const workspace: CheckpointWorkspaceIdentity = {
  workspaceId: "workspace-1",
  rootPath: "/tmp/root",
  checkoutPath: "/tmp/root",
  branchName: "main",
};

const before: CheckpointFileSnapshot = {
  exists: true,
  kind: "text",
  sizeBytes: 10,
  contentHash: "before",
  blobId: "blob-before",
  executable: false,
};

function manifest(entries: readonly CheckpointManifestEntry[]): CheckpointManifest {
  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    id: "checkpoint-1",
    sessionId: "session-1",
    runId: "run-1",
    reason: "before-run-mutation",
    createdAt: "2026-07-24T00:00:00.000Z",
    workspace,
    entries,
    manifestHash: "manifest-hash",
  };
}

function entry(overrides: Partial<CheckpointManifestEntry> = {}): CheckpointManifestEntry {
  return {
    path: "src/app.ts",
    operation: "restore",
    ownership: "pi",
    before,
    expectedAfterHash: "after",
    ...overrides,
  };
}

function current(overrides: Partial<CurrentCheckpointEntryState> = {}): CurrentCheckpointEntryState {
  return {
    path: "src/app.ts",
    exists: true,
    kind: "text",
    sizeBytes: 12,
    contentHash: "after",
    executable: false,
    ...overrides,
  };
}

describe("buildCheckpointRestorePreview", () => {
  it("selects only an unchanged Pi-attributed post-change file by default", () => {
    const preview = buildCheckpointRestorePreview(manifest([entry()]), workspace, [current()]);

    expect(preview).toMatchObject({
      workspaceMatches: true,
      requiresRollbackCheckpoint: true,
      entries: [{
        status: "safe",
        defaultSelected: true,
        requiresConfirmation: false,
      }],
    });
  });

  it("does not select user-owned, externally changed, or mismatched files", () => {
    const preview = buildCheckpointRestorePreview(manifest([
      entry({ path: "src/user.ts", ownership: "user" }),
      entry({ path: "src/later.ts" }),
      entry({ path: "src/mismatch.ts" }),
    ]), workspace, [
      current({ path: "src/user.ts" }),
      current({ path: "src/later.ts", modifiedAfterCheckpoint: true }),
      current({ path: "src/mismatch.ts", contentHash: "unexpected" }),
    ]);

    expect(preview.entries.map((item) => ({
      path: item.path,
      status: item.status,
      selected: item.defaultSelected,
    }))).toEqual([
      { path: "src/user.ts", status: "conflict", selected: false },
      { path: "src/later.ts", status: "conflict", selected: false },
      { path: "src/mismatch.ts", status: "conflict", selected: false },
    ]);
  });

  it("requires confirmation before removing a Pi-created file", () => {
    const preview = buildCheckpointRestorePreview(manifest([
      entry({
        operation: "remove-created",
        before: { exists: false, kind: "text", sizeBytes: 0 },
      }),
    ]), workspace, [current()]);

    expect(preview.entries[0]).toMatchObject({
      status: "safe",
      defaultSelected: true,
      requiresConfirmation: true,
    });
  });

  it("treats symlinks, large files, and renames as unsupported or conflicted", () => {
    const preview = buildCheckpointRestorePreview(manifest([
      entry({
        path: "linked",
        before: { exists: true, kind: "symlink", sizeBytes: 4, symlinkTarget: "target" },
      }),
      entry({
        path: "large.bin",
        before: { exists: true, kind: "binary", sizeBytes: 9_000_000, contentHash: "before", blobId: "large" },
      }),
      entry({
        path: "renamed.ts",
        operation: "rename",
        renamedFrom: "old.ts",
      }),
    ]), workspace, [
      current({ path: "linked", kind: "symlink" }),
      current({ path: "large.bin", kind: "binary", sizeBytes: 9_000_000 }),
      current({ path: "renamed.ts" }),
    ]);

    expect(preview.entries.map((item) => item.status)).toEqual([
      "unsupported",
      "unsupported",
      "conflict",
    ]);
  });

  it("rejects the entire preview when the checkout identity differs", () => {
    const preview = buildCheckpointRestorePreview(manifest([entry()]), {
      ...workspace,
      checkoutPath: "/tmp/other-worktree",
    }, [current()]);

    expect(preview.workspaceMatches).toBe(false);
    expect(preview.requiresRollbackCheckpoint).toBe(false);
    expect(preview.entries[0]).toMatchObject({
      status: "wrong-workspace",
      defaultSelected: false,
      requiresConfirmation: true,
    });
  });

  it("does nothing when the current state already matches the checkpoint", () => {
    const preview = buildCheckpointRestorePreview(manifest([entry()]), workspace, [
      current({ contentHash: "before" }),
    ]);

    expect(preview.entries[0]).toMatchObject({
      status: "noop",
      defaultSelected: false,
      requiresConfirmation: false,
    });
  });
});
