import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExecutionBoundaryStore } from "../../electron/execution-boundary-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

describe("ExecutionBoundaryStore", () => {
  it("persists per-thread revisions and rehydrates without exposing the workspace path", async () => {
    const userData = await mkdtemp(join(tmpdir(), "pi-gui-boundary-"));
    temporaryDirectories.push(userData);
    const workspaceId = "/private/tmp/sensitive-workspace";
    const store = new ExecutionBoundaryStore(userData);

    expect(await store.get(workspaceId, "session-1")).toMatchObject({
      enabled: false,
      revision: 0,
    });
    const first = await store.set(workspaceId, "session-1", {
      enabled: true,
      maxFiles: 3,
      denyPaths: [".env"],
      toolAccess: { mode: "read-only", tools: ["read"] },
    });
    const second = await store.set(workspaceId, "session-1", {
      ...first,
      maxFiles: 4,
    });
    await store.set(workspaceId, "session-2", { enabled: false });

    expect(second.revision).toBe(2);
    const relaunched = new ExecutionBoundaryStore(userData);
    expect(await relaunched.get(workspaceId, "session-1")).toMatchObject({
      enabled: true,
      maxFiles: 4,
      revision: 2,
      denyPaths: [".env"],
    });
    expect(await relaunched.get(workspaceId, "session-2")).toMatchObject({
      enabled: false,
      revision: 1,
    });

    const directory = join(userData, "execution-boundaries");
    const [storedName] = await readdir(directory);
    const raw = await readFile(join(directory, storedName ?? ""), "utf8");
    expect(storedName).not.toContain("sensitive-workspace");
    expect(raw).not.toContain(workspaceId);
  });

  it("fails closed on malformed persisted state", async () => {
    const userData = await mkdtemp(join(tmpdir(), "pi-gui-boundary-"));
    temporaryDirectories.push(userData);
    const store = new ExecutionBoundaryStore(userData);
    await store.set("workspace", "session", { enabled: true, maxFiles: 2 });
    const directory = join(userData, "execution-boundaries");
    const [storedName] = await readdir(directory);
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(join(directory, storedName ?? ""), "{\"schemaVersion\":999}", "utf8"));

    expect(await new ExecutionBoundaryStore(userData).get("workspace", "session")).toMatchObject({
      enabled: false,
      revision: 0,
    });
  });
});
