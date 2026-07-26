import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextManifestStore } from "../../electron/context-manifest-store";
import {
  buildContextManifest,
  type ContextManifest,
} from "../../src/product-experience/context-manifest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

describe("ContextManifestStore", () => {
  it("persists metadata-only submitted manifests and rehydrates by session", async () => {
    const userData = await mkdtemp(join(tmpdir(), "pi-gui-context-manifests-"));
    temporaryDirectories.push(userData);
    const manifest = buildContextManifest({
      workspaceId: "workspace-1",
      sessionId: "session-1",
      provider: "openai",
      model: "gpt-5",
      generatedAt: "2026-07-24T12:00:00.000Z",
      fileMentions: ["src/app.ts"],
    });
    const store = new ContextManifestStore(
      userData,
      () => "manifest-1",
      () => new Date("2026-07-24T12:00:01.000Z"),
    );
    const snapshot = await store.snapshot(manifest);

    expect(snapshot).toMatchObject({
      id: "manifest-1",
      submittedAt: "2026-07-24T12:00:01.000Z",
      manifest: { workspaceId: "workspace-1", sessionId: "session-1" },
    });
    const relaunched = new ContextManifestStore(userData);
    expect(await relaunched.list("workspace-1", "session-1")).toEqual([snapshot]);
    expect(await relaunched.list("workspace-1", "other")).toEqual([]);
  });

  it("redacts secret-like labels again at the main-process persistence boundary", async () => {
    const userData = await mkdtemp(join(tmpdir(), "pi-gui-context-manifests-"));
    temporaryDirectories.push(userData);
    const store = new ContextManifestStore(userData, () => "manifest-1");
    const manifest = buildContextManifest({
      workspaceId: "workspace-1",
      generatedAt: "2026-07-24T12:00:00.000Z",
    });
    const unsafe = {
      ...manifest,
      entries: [{
        ...manifest.entries[0],
        label: "OPENAI_API_KEY=sk-abcdefghijklmnop",
      }],
    } as ContextManifest;
    await store.snapshot(unsafe);

    const directory = join(userData, "context-manifests");
    const [storedName] = await readdir(directory);
    const raw = await readFile(join(directory, storedName ?? ""), "utf8");
    expect(raw).not.toContain("sk-abcdefghijklmnop");
    expect(raw).toContain("[redacted]");
  });
});
