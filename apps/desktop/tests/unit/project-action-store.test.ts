import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ProjectActionStore } from "../../electron/project-action-store";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-action-store-"));
  const workspace = join(root, "workspace");
  const userData = join(root, "user-data");
  await mkdir(workspace, { recursive: true });
  return { root, workspace, store: new ProjectActionStore(userData, (id) => id === "workspace" ? workspace : undefined) };
}

describe("project action store", () => {
  it("migrates legacy actions once and preserves worktree behavior", async () => {
    const { store } = await fixture();
    expect(await store.migrateLegacy({ workspace: [{ name: "Test", command: "pnpm test", keybinding: "cmd+t", runOnWorktreeCreation: true }] })).toBe(1);
    expect(await store.migrateLegacy({ workspace: [{ name: "Replace", command: "false", runOnWorktreeCreation: false }] })).toBe(0);
    expect(await store.list("workspace")).toMatchObject([{ name: "Test", command: "pnpm test", runOnWorktreeCreation: true, trusted: true, primary: true }]);
  });

  it("discovers hundreds of scripts as bounded untrusted previews", async () => {
    const { workspace, store } = await fixture();
    await writeFile(join(workspace, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await writeFile(join(workspace, "package.json"), JSON.stringify({ scripts: Object.fromEntries(Array.from({ length: 550 }, (_, index) => [`task:${index}`, `echo ${index}`])) }), "utf8");
    const discovered = await store.discover("workspace");
    expect(discovered).toHaveLength(500);
    expect(discovered[0]).toMatchObject({ command: "pnpm run task:0", trusted: false, source: "discovered-script" });
  });

  it("validates preview URLs, primary uniqueness, ordering, and limits", async () => {
    const { store } = await fixture();
    await expect(store.save({ workspaceId: "workspace", name: "Bad", command: "dev", runOnWorktreeCreation: false, previewUrl: "http://example.com" })).rejects.toThrow(/HTTPS or loopback/i);
    let actions = await store.save({ workspaceId: "workspace", name: "Dev", command: "pnpm dev", runOnWorktreeCreation: false, previewUrl: "http://localhost:3000", autoOpenPreview: true, primary: true });
    actions = await store.save({ workspaceId: "workspace", name: "Test", command: "pnpm test", runOnWorktreeCreation: false, primary: true });
    expect(actions.filter((action) => action.primary)).toHaveLength(1);
    expect(actions.find((action) => action.name === "Test")?.primary).toBe(true);
    const reordered = await store.reorder("workspace", [...actions].reverse().map((action) => action.id));
    expect(reordered.map((action) => action.name)).toEqual(["Test", "Dev"]);
  });

  it("imports only reviewed declarative data and exports without executable metadata", async () => {
    const { workspace, store } = await fixture();
    await mkdir(join(workspace, ".pi"), { recursive: true });
    await writeFile(join(workspace, ".pi", "actions.json"), JSON.stringify({ actions: [{ name: "Preview", command: "pnpm dev", previewUrl: "http://localhost:3000" }] }), "utf8");
    const preview = await store.previewImport("workspace");
    expect(preview.actions[0]).toMatchObject({ trusted: false, source: "repository-import" });
    expect(await store.list("workspace")).toEqual([]);
    await store.save({ ...preview.actions[0]!, workspaceId: "workspace" });
    expect((await store.previewExport("workspace")).overwritesExistingFile).toBe(true);
    await store.export("workspace");
    const exported = JSON.parse(await readFile(join(workspace, ".pi", "actions.json"), "utf8"));
    expect(exported.actions[0]).not.toHaveProperty("trusted");
    expect(exported.actions[0]).not.toHaveProperty("createdAt");
  });
});
