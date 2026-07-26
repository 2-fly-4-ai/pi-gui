import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CheckpointStore } from "../../electron/checkpoint-store";
import type { CheckpointWorkspaceIdentity } from "../../src/product-experience/checkpoint-contract";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

async function setup(options: ConstructorParameters<typeof CheckpointStore>[1] = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-checkpoint-store-"));
  const checkout = join(root, "workspace");
  const userData = join(root, "user-data");
  await mkdir(join(checkout, "src"), { recursive: true });
  temporaryDirectories.push(root);
  const workspace: CheckpointWorkspaceIdentity = {
    workspaceId: "workspace-1",
    rootPath: checkout,
    checkoutPath: checkout,
    branchName: "main",
  };
  let nextId = 0;
  const store = new CheckpointStore(userData, {
    createId: () => `checkpoint-${++nextId}`,
    ...options,
  });
  return { checkout, root, store, userData, workspace };
}

describe("CheckpointStore", () => {
  it("persists content-addressed text, binary, executable, and missing snapshots", async () => {
    const { checkout, store, workspace } = await setup();
    await writeFile(join(checkout, "src/app.ts"), "export const value = 1;\n");
    await writeFile(join(checkout, "src/data.bin"), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(checkout, "run.sh"), "#!/bin/sh\nexit 0\n");
    await chmod(join(checkout, "run.sh"), 0o755);

    const manifest = await store.create({
      workspace,
      sessionId: "session-1",
      runId: "run-1",
      reason: "before-run-mutation",
      paths: [
        { path: "src/app.ts", ownership: "pi" },
        { path: "src/data.bin", ownership: "pi" },
        { path: "run.sh", ownership: "pi" },
        { path: "src/new.ts", ownership: "pi" },
      ],
    });

    expect(manifest.entries).toMatchObject([
      { path: "src/app.ts", operation: "restore", before: { exists: true, kind: "text" } },
      { path: "src/data.bin", operation: "restore", before: { exists: true, kind: "binary" } },
      { path: "run.sh", operation: "restore", before: { exists: true, executable: true } },
      { path: "src/new.ts", operation: "remove-created", before: { exists: false } },
    ]);
    const appBlob = manifest.entries[0]?.before.blobId;
    expect(appBlob).toMatch(/^[a-f0-9]{64}$/);
    expect((await store.readBlob(appBlob ?? ""))?.toString()).toBe("export const value = 1;\n");
    expect(await store.get(manifest.id)).toEqual(manifest);
    expect(await store.list("workspace-1")).toEqual([manifest]);
  });

  it("rescans current state and classifies safe, conflicted, symlink, large, and wrong-workspace restores", async () => {
    const { checkout, store, workspace } = await setup({ maxFileBytes: 16 });
    await writeFile(join(checkout, "src/safe.ts"), "before\n");
    await writeFile(join(checkout, "src/conflict.ts"), "before\n");
    await writeFile(join(checkout, "src/large.txt"), "this file is larger than sixteen bytes\n");
    await symlink("safe.ts", join(checkout, "src/link.ts"));
    const manifest = await store.create({
      workspace,
      sessionId: "session-1",
      reason: "before-run-mutation",
      paths: [
        { path: "src/safe.ts", ownership: "pi", expectedAfterHash: "after-safe" },
        { path: "src/conflict.ts", ownership: "user" },
        { path: "src/large.txt", ownership: "pi" },
        { path: "src/link.ts", ownership: "pi" },
      ],
    });
    const safeEntry = manifest.entries[0];
    expect(safeEntry).toBeDefined();
    await writeFile(join(checkout, "src/safe.ts"), "after\n");
    const afterHash = await import("node:crypto").then(({ createHash }) =>
      createHash("sha256").update("after\n").digest("hex"));
    const corrected = await store.create({
      workspace,
      sessionId: "session-1",
      reason: "manual",
      paths: [{
        path: "src/safe.ts",
        ownership: "pi",
        expectedAfterHash: afterHash,
      }],
    });
    // The second checkpoint captures "after"; restore to it is a noop. Use the
    // first checkpoint's manifest hash only to prove current-state conflict paths.
    expect((await store.preview(corrected.id, workspace)).entries[0]?.status).toBe("noop");

    const preview = await store.preview(manifest.id, workspace);
    expect(preview.entries.map((entry) => [entry.path, entry.status])).toEqual([
      ["src/safe.ts", "conflict"],
      ["src/conflict.ts", "noop"],
      ["src/large.txt", "unsupported"],
      ["src/link.ts", "unsupported"],
    ]);
    const wrongWorkspace = await store.preview(manifest.id, {
      ...workspace,
      checkoutPath: join(checkout, "other"),
    });
    expect(wrongWorkspace.workspaceMatches).toBe(false);
    expect(wrongWorkspace.entries.every((entry) => entry.status === "wrong-workspace")).toBe(true);
  });

  it("rejects traversal, absolute paths, directories, and workspaces outside their root", async () => {
    const { checkout, store, workspace } = await setup();
    await expect(store.create({
      workspace,
      sessionId: "session-1",
      reason: "manual",
      paths: [{ path: "../outside", ownership: "pi" }],
    })).rejects.toThrow("Unsafe checkpoint path");
    await expect(store.create({
      workspace,
      sessionId: "session-1",
      reason: "manual",
      paths: [{ path: join(checkout, "src/app.ts"), ownership: "pi" }],
    })).rejects.toThrow("Unsafe checkpoint path");
    await expect(store.create({
      workspace,
      sessionId: "session-1",
      reason: "manual",
      paths: [{ path: "src", ownership: "pi" }],
    })).rejects.toThrow("regular files");
    await expect(store.create({
      workspace: { ...workspace, checkoutPath: join(checkout, "..", "other") },
      sessionId: "session-1",
      reason: "manual",
      paths: [{ path: "src/app.ts", ownership: "pi" }],
    })).rejects.toThrow("must belong");
  });

  it("refuses tampered manifests and corrupted blobs", async () => {
    const { checkout, store, userData, workspace } = await setup();
    await writeFile(join(checkout, "src/app.ts"), "original\n");
    const manifest = await store.create({
      workspace,
      sessionId: "session-1",
      reason: "manual",
      paths: [{ path: "src/app.ts", ownership: "pi" }],
    });
    const blobId = manifest.entries[0]?.before.blobId ?? "";
    await writeFile(join(userData, "checkpoints", "blobs", blobId), "corrupt\n");
    expect(await store.readBlob(blobId)).toBeUndefined();

    const manifestPath = join(userData, "checkpoints", "manifests", `${manifest.id}.json`);
    const persisted = JSON.parse(await readFile(manifestPath, "utf8")) as {
      manifest: { sessionId: string };
    };
    persisted.manifest.sessionId = "tampered";
    await writeFile(manifestPath, JSON.stringify(persisted));
    expect(await store.get(manifest.id)).toBeUndefined();
  });

  it("bounds retained manifests without deleting shared recovery blobs", async () => {
    const { checkout, store, userData, workspace } = await setup({ maxCheckpoints: 2 });
    await writeFile(join(checkout, "src/app.ts"), "same content\n");
    for (let index = 0; index < 3; index += 1) {
      await store.create({
        workspace,
        sessionId: `session-${index}`,
        reason: "manual",
        paths: [{ path: "src/app.ts", ownership: "pi" }],
      });
    }
    const retained = await store.list();
    expect(retained).toHaveLength(2);
    const blobNames = await import("node:fs/promises").then(({ readdir }) =>
      readdir(join(userData, "checkpoints", "blobs")));
    expect(blobNames).toHaveLength(1);
  });

  it("persists retention controls and never removes a protected or pending-restore checkpoint", async () => {
    const { checkout, store, userData, workspace } = await setup({ maxCheckpoints: 2 });
    await writeFile(join(checkout, "src/app.ts"), "retained\n");
    const first = await store.create({
      workspace,
      sessionId: "session-1",
      reason: "manual",
      paths: [{ path: "src/app.ts", ownership: "pi" }],
    });
    await store.preview(first.id, workspace);
    await store.create({
      workspace,
      sessionId: "session-2",
      reason: "manual",
      paths: [{ path: "src/app.ts", ownership: "pi" }],
    });
    const third = await store.create({
      workspace,
      sessionId: "session-3",
      reason: "manual",
      paths: [{ path: "src/app.ts", ownership: "pi" }],
    });
    expect((await store.list()).map((manifest) => manifest.id)).toEqual([third.id, first.id]);
    expect((await store.getRetentionPolicy()).pendingRestoreCheckpointIds).toEqual([first.id]);

    const relaunched = new CheckpointStore(userData, {
      createId: () => "checkpoint-relaunched",
      maxCheckpoints: 2,
    });
    expect((await relaunched.getRetentionPolicy()).pendingRestoreCheckpointIds).toEqual([first.id]);
    await relaunched.setRetentionPolicy({
      maxCheckpoints: 2,
      protectedCheckpointIds: [third.id],
    });
    await relaunched.releaseRestoreLease(first.id);
    await relaunched.create({
      workspace,
      sessionId: "session-4",
      reason: "manual",
      paths: [{ path: "src/app.ts", ownership: "pi" }],
    });
    expect((await relaunched.list()).map((manifest) => manifest.id)).toEqual([
      "checkpoint-relaunched",
      third.id,
    ]);
  });

  it("restores atomically only after creating a usable rollback checkpoint", async () => {
    const { checkout, store, workspace } = await setup();
    const before = "before restore\n";
    const after = "after Pi edit\n";
    await writeFile(join(checkout, "src/app.ts"), before);
    await chmod(join(checkout, "src/app.ts"), 0o755);
    const checkpoint = await store.create({
      workspace,
      sessionId: "session-1",
      runId: "run-1",
      reason: "before-run-mutation",
      paths: [{
        path: "src/app.ts",
        ownership: "pi",
        expectedAfterHash: sha256Text(after),
      }],
    });
    await writeFile(join(checkout, "src/app.ts"), after);
    await chmod(join(checkout, "src/app.ts"), 0o644);

    const preview = await store.preview(checkpoint.id, workspace);
    expect(preview.entries[0]).toMatchObject({
      status: "safe",
      defaultSelected: true,
      requiresConfirmation: false,
    });
    const result = await store.restore({
      checkpointId: checkpoint.id,
      workspace,
      selectedPaths: ["src/app.ts"],
    });
    expect(result).toMatchObject({
      checkpointId: checkpoint.id,
      partial: false,
      outcomes: [{ path: "src/app.ts", status: "applied" }],
    });
    expect(await readFile(join(checkout, "src/app.ts"), "utf8")).toBe(before);
    const restoredMode = await import("node:fs/promises").then(({ stat }) =>
      stat(join(checkout, "src/app.ts")));
    expect((restoredMode.mode & 0o111) !== 0).toBe(true);

    const rollbackPreview = await store.preview(result.rollbackCheckpointId, workspace);
    expect(rollbackPreview.entries[0]?.status).toBe("safe");
    const rollbackResult = await store.restore({
      checkpointId: result.rollbackCheckpointId,
      workspace,
      selectedPaths: ["src/app.ts"],
    });
    expect(rollbackResult.partial).toBe(false);
    expect(await readFile(join(checkout, "src/app.ts"), "utf8")).toBe(after);
  });

  it("requires explicit confirmation to remove a Pi-created file and can roll it back", async () => {
    const { checkout, store, workspace } = await setup();
    const checkpoint = await store.create({
      workspace,
      sessionId: "session-1",
      reason: "before-run-mutation",
      paths: [{ path: "src/generated.ts", ownership: "pi" }],
    });
    await writeFile(join(checkout, "src/generated.ts"), "generated\n");
    await expect(store.restore({
      checkpointId: checkpoint.id,
      workspace,
      selectedPaths: ["src/generated.ts"],
    })).rejects.toThrow("requires confirmation");

    const result = await store.restore({
      checkpointId: checkpoint.id,
      workspace,
      selectedPaths: ["src/generated.ts"],
      confirmedPaths: ["src/generated.ts"],
    });
    await expect(readFile(join(checkout, "src/generated.ts"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await store.restore({
      checkpointId: result.rollbackCheckpointId,
      workspace,
      selectedPaths: ["src/generated.ts"],
    });
    expect(await readFile(join(checkout, "src/generated.ts"), "utf8")).toBe("generated\n");
  });

  it("previews and rejects only safe Pi-attributed text hunks after securing a rollback checkpoint", async () => {
    const { checkout, store, workspace } = await setup();
    const path = "src/hunks.ts";
    const before = "const one = 1;\nconst two = 2;\n";
    const after = "const one = 10;\nconst two = 2;\nconst three = 3;\n";
    await writeFile(join(checkout, path), before);
    const checkpoint = await store.create({
      workspace,
      sessionId: "session-1",
      runId: "run-1",
      reason: "before-run-mutation",
      paths: [{ path, ownership: "pi" }],
    });
    await writeFile(join(checkout, path), after);
    await store.finalizeExpectedAfter(checkpoint.id, path);

    const preview = await store.previewHunks(checkpoint.id, workspace, path);
    expect(preview).toMatchObject({ available: true, ownership: "pi" });
    expect(preview.preview?.safeCount).toBeGreaterThan(0);
    const hunkIds = preview.preview?.hunks.filter((hunk) => hunk.status === "safe").map((hunk) => hunk.id) ?? [];
    expect(hunkIds.length).toBeGreaterThan(0);
    const result = await store.rejectHunks({
      checkpointId: checkpoint.id,
      workspace,
      path,
      hunkIds,
    });
    expect(result.rollbackCheckpointId).toBe("checkpoint-2");
    expect(await store.get(result.rollbackCheckpointId)).toMatchObject({ reason: "before-hunk-reject" });
    expect(await readFile(join(checkout, path), "utf8")).toBe(before);
  });

  it("blocks hunk rejection for user ownership and overlapping concurrent edits", async () => {
    const { checkout, store, workspace } = await setup();
    const path = "src/ownership.ts";
    await writeFile(join(checkout, path), "before\n");
    const userCheckpoint = await store.create({
      workspace,
      sessionId: "session-1",
      reason: "before-run-mutation",
      paths: [{ path, ownership: "user" }],
    });
    await writeFile(join(checkout, path), "after\n");
    await store.finalizeExpectedAfter(userCheckpoint.id, path);
    expect(await store.previewHunks(userCheckpoint.id, workspace, path)).toMatchObject({
      available: false,
      ownership: "user",
    });

    await writeFile(join(checkout, path), "before\n");
    const piCheckpoint = await store.create({
      workspace,
      sessionId: "session-1",
      reason: "before-run-mutation",
      paths: [{ path, ownership: "pi" }],
    });
    await writeFile(join(checkout, path), "after\n");
    await store.finalizeExpectedAfter(piCheckpoint.id, path);
    await writeFile(join(checkout, path), "user overlap\n");
    const conflict = await store.previewHunks(piCheckpoint.id, workspace, path);
    expect(conflict.preview?.conflictCount).toBeGreaterThan(0);
    await expect(store.rejectHunks({
      checkpointId: piCheckpoint.id,
      workspace,
      path,
      hunkIds: [conflict.preview?.hunks[0]?.id ?? ""],
    })).rejects.toThrow("blocked");
  });

  it("reports partial failure and leaves the rollback checkpoint intact after a concurrent edit", async () => {
    let checkoutPath = "";
    const setupResult = await setup({
      beforeRestoreApply: async (path) => {
        if (path === "src/b.ts") {
          await writeFile(join(checkoutPath, path), "concurrent user edit\n");
        }
      },
    });
    const { checkout, store, workspace } = setupResult;
    checkoutPath = checkout;
    await writeFile(join(checkout, "src/a.ts"), "a-before\n");
    await writeFile(join(checkout, "src/b.ts"), "b-before\n");
    const checkpoint = await store.create({
      workspace,
      sessionId: "session-1",
      reason: "before-run-mutation",
      paths: [
        { path: "src/a.ts", ownership: "pi", expectedAfterHash: sha256Text("a-after\n") },
        { path: "src/b.ts", ownership: "pi", expectedAfterHash: sha256Text("b-after\n") },
      ],
    });
    await writeFile(join(checkout, "src/a.ts"), "a-after\n");
    await writeFile(join(checkout, "src/b.ts"), "b-after\n");

    const result = await store.restore({
      checkpointId: checkpoint.id,
      workspace,
      selectedPaths: ["src/a.ts", "src/b.ts"],
    });
    expect(result.partial).toBe(true);
    expect(result.outcomes).toEqual([
      { path: "src/a.ts", status: "applied" },
      {
        path: "src/b.ts",
        status: "failed",
        error: "The file changed after restore preview.",
      },
    ]);
    expect(await readFile(join(checkout, "src/a.ts"), "utf8")).toBe("a-before\n");
    expect(await readFile(join(checkout, "src/b.ts"), "utf8")).toBe("concurrent user edit\n");
    expect(await store.get(result.rollbackCheckpointId)).toBeDefined();
  });

  it("contains permission, disk-full, and pre-commit write faults without partial replacement", async () => {
    const setupResult = await setup({
      beforeRestoreCommit: (path) => {
        if (path === "src/permission.ts") throw nodeFault("EACCES", "permission denied");
        if (path === "src/disk.ts") throw nodeFault("ENOSPC", "disk full");
        if (path === "src/partial.ts") throw nodeFault("EIO", "partial write fault");
      },
    });
    const { checkout, store, workspace } = setupResult;
    const paths = ["safe.ts", "permission.ts", "disk.ts", "partial.ts"];
    for (const path of paths) await writeFile(join(checkout, "src", path), `${path}-before\n`);
    const checkpoint = await store.create({
      workspace,
      sessionId: "session-1",
      reason: "before-run-mutation",
      paths: paths.map((path) => ({
        path: `src/${path}`,
        ownership: "pi" as const,
        expectedAfterHash: sha256Text(`${path}-after\n`),
      })),
    });
    for (const path of paths) await writeFile(join(checkout, "src", path), `${path}-after\n`);

    const result = await store.restore({
      checkpointId: checkpoint.id,
      workspace,
      selectedPaths: paths.map((path) => `src/${path}`),
    });
    expect(result.partial).toBe(true);
    expect(result.outcomes).toEqual([
      { path: "src/safe.ts", status: "applied" },
      expect.objectContaining({ path: "src/permission.ts", status: "failed", error: expect.stringContaining("EACCES") }),
      expect.objectContaining({ path: "src/disk.ts", status: "failed", error: expect.stringContaining("ENOSPC") }),
      expect.objectContaining({ path: "src/partial.ts", status: "failed", error: expect.stringContaining("EIO") }),
    ]);
    expect(await readFile(join(checkout, "src/safe.ts"), "utf8")).toBe("safe.ts-before\n");
    expect(await readFile(join(checkout, "src/permission.ts"), "utf8")).toBe("permission.ts-after\n");
    expect(await readFile(join(checkout, "src/disk.ts"), "utf8")).toBe("disk.ts-after\n");
    expect(await readFile(join(checkout, "src/partial.ts"), "utf8")).toBe("partial.ts-after\n");
    expect(await store.get(result.rollbackCheckpointId)).toBeDefined();
  });
});

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function nodeFault(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}
