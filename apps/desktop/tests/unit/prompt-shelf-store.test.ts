import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { PromptShelfStore } from "../../electron/prompt-shelf-store";

describe("prompt shelf store", () => {
  it("persists text and attachment snapshots without model or workspace configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-prompt-shelf-"));
    const source = join(root, "notes.txt");
    await writeFile(source, "hello", "utf8");
    const store = new PromptShelfStore(root);
    const entries = await store.stash({
      text: "Explain this",
      label: "Later",
      source: { workspaceId: "workspace", sessionId: "session" },
      attachments: [
        { id: "image", kind: "image", name: "shot.png", mimeType: "image/png", data: Buffer.from("png").toString("base64") },
        { id: "file", kind: "file", name: "notes.txt", mimeType: "text/plain", fsPath: source },
      ],
    });
    expect(entries).toMatchObject([{ label: "Later", attachmentCount: 2, source: { workspaceId: "workspace", sessionId: "session" } }]);
    const preview = await store.previewRestore(entries[0]!.id);
    expect(preview.text).toBe("Explain this");
    expect(preview.attachments).toHaveLength(2);
    expect(preview).not.toHaveProperty("model");
    expect(preview).not.toHaveProperty("provider");
  });

  it("reports expired assets and removes only after explicit completion", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-prompt-shelf-expiry-"));
    const store = new PromptShelfStore(root);
    const [entry] = await store.stash({ text: "Draft", attachments: [{ id: "image", kind: "image", name: "shot.png", mimeType: "image/png", data: Buffer.from("png").toString("base64") }] });
    await rm(join(root, "prompt-shelf-assets", entry!.id), { recursive: true, force: true });
    const preview = await store.previewRestore(entry!.id);
    expect(preview.missingAttachments).toEqual(["shot.png"]);
    expect(await store.list()).toHaveLength(1);
    expect(await store.completeRestore(entry!.id)).toHaveLength(0);
  });

  it("enforces the 20-entry cap and attachment quota", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-prompt-shelf-cap-"));
    await mkdir(root, { recursive: true });
    const store = new PromptShelfStore(root);
    for (let index = 0; index < 20; index += 1) await store.stash({ text: `Prompt ${index}`, attachments: [] });
    await expect(store.stash({ text: "Overflow", attachments: [] })).rejects.toThrow(/full/i);
    const oversized = Buffer.alloc(25 * 1024 * 1024 + 1).toString("base64");
    const emptyStore = new PromptShelfStore(await mkdtemp(join(tmpdir(), "pi-prompt-shelf-quota-")));
    await expect(emptyStore.stash({ text: "Image", attachments: [{ id: "image", kind: "image", name: "big.png", mimeType: "image/png", data: oversized }] })).rejects.toThrow(/too large/i);
  });

  it("ignores corrupt traversal metadata instead of reading outside its asset root", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-prompt-shelf-corrupt-"));
    await mkdir(join(root, "prompt-shelf"), { recursive: true });
    await writeFile(join(root, "prompt-shelf", "global.json"), JSON.stringify({ version: 1, entries: [{ id: "entry", text: "bad", attachments: [{ id: "a", kind: "file", name: "bad", mimeType: "text/plain", sizeBytes: 1, assetName: "../outside" }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] }), "utf8");
    expect(await new PromptShelfStore(root).list()).toEqual([]);
  });
});
