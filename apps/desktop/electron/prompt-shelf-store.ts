import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { ComposerAttachment } from "../src/desktop-state";
import type { PromptShelfEntrySummary, PromptShelfRestorePreview, StashPromptInput } from "../src/prompt-shelf-types";
import { JsonFileStore } from "./json-file-store";

const MAX_ENTRIES = 20;
const MAX_STORE_BYTES = 4 * 1024 * 1024;
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 100 * 1024 * 1024;

interface StoredAttachment {
  readonly id: string;
  readonly kind: "image" | "file";
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly assetName: string;
}

interface StoredPromptShelfEntry {
  readonly id: string;
  readonly label?: string;
  readonly text: string;
  readonly attachments: readonly StoredAttachment[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source?: { readonly workspaceId: string; readonly sessionId: string };
}

interface PersistedPromptShelf {
  readonly version: 1;
  readonly entries: readonly StoredPromptShelfEntry[];
}

export class PromptShelfStore {
  private readonly store: JsonFileStore<PersistedPromptShelf>;
  private readonly assetRoot: string;

  constructor(userDataDir: string) {
    this.store = new JsonFileStore<PersistedPromptShelf>(userDataDir, "prompt-shelf");
    this.assetRoot = join(userDataDir, "prompt-shelf-assets");
  }

  async list(): Promise<readonly PromptShelfEntrySummary[]> {
    return (await this.read()).entries.map(toSummary);
  }

  async stash(input: StashPromptInput): Promise<readonly PromptShelfEntrySummary[]> {
    const text = validateText(input.text);
    if (!text && input.attachments.length === 0) throw new Error("There is no prompt or attachment to stash.");
    const current = await this.read();
    if (current.entries.length >= MAX_ENTRIES) throw new Error(`Prompt Shelf is full (${MAX_ENTRIES} entries). Restore or delete an entry first.`);
    const id = randomUUID();
    const entryDir = join(this.assetRoot, id);
    await mkdir(entryDir, { recursive: true });
    const attachments: StoredAttachment[] = [];
    try {
      for (const [index, attachment] of input.attachments.entries()) attachments.push(await persistAttachment(entryDir, attachment, index));
      const now = new Date().toISOString();
      const entry: StoredPromptShelfEntry = {
        id,
        label: validateLabel(input.label),
        text,
        attachments,
        createdAt: now,
        updatedAt: now,
        source: input.source ? { workspaceId: validateSourceId(input.source.workspaceId), sessionId: validateSourceId(input.source.sessionId) } : undefined,
      };
      const next = { version: 1 as const, entries: [entry, ...current.entries] };
      await this.assertBounds(next);
      await this.store.write("global", next);
      return next.entries.map(toSummary);
    } catch (error) {
      await rm(entryDir, { recursive: true, force: true });
      throw error;
    }
  }

  async previewRestore(entryId: string): Promise<PromptShelfRestorePreview> {
    const entry = await this.requireEntry(entryId);
    const attachments: ComposerAttachment[] = [];
    const missingAttachments: string[] = [];
    for (const attachment of entry.attachments) {
      const path = join(this.assetRoot, entry.id, attachment.assetName);
      try {
        const metadata = await stat(path);
        if (!metadata.isFile() || metadata.size !== attachment.sizeBytes) throw new Error("Asset changed");
        if (attachment.kind === "image") {
          attachments.push({ id: attachment.id, kind: "image", name: attachment.name, mimeType: attachment.mimeType, data: (await readFile(path)).toString("base64"), status: "ready" });
        } else {
          attachments.push({ id: attachment.id, kind: "file", name: attachment.name, mimeType: attachment.mimeType, fsPath: path, sizeBytes: attachment.sizeBytes, status: "ready" });
        }
      } catch {
        missingAttachments.push(attachment.name);
      }
    }
    return { entry: toSummary(entry), text: entry.text, attachments, missingAttachments };
  }

  async completeRestore(entryId: string): Promise<readonly PromptShelfEntrySummary[]> {
    return this.remove(entryId);
  }

  async rename(entryId: string, label: string): Promise<readonly PromptShelfEntrySummary[]> {
    const current = await this.read();
    let found = false;
    const entries = current.entries.map((entry) => {
      if (entry.id !== entryId) return entry;
      found = true;
      return { ...entry, label: validateLabel(label), updatedAt: new Date().toISOString() };
    });
    if (!found) throw new Error("Prompt Shelf entry was not found.");
    await this.store.write("global", { version: 1, entries });
    return entries.map(toSummary);
  }

  async reorder(orderedIds: readonly string[]): Promise<readonly PromptShelfEntrySummary[]> {
    const current = await this.read();
    if (orderedIds.length !== current.entries.length || new Set(orderedIds).size !== current.entries.length) throw new Error("Prompt Shelf order is incomplete.");
    const byId = new Map(current.entries.map((entry) => [entry.id, entry]));
    const entries = orderedIds.map((id) => {
      const entry = byId.get(id);
      if (!entry) throw new Error("Prompt Shelf order contains an unknown entry.");
      return entry;
    });
    await this.store.write("global", { version: 1, entries });
    return entries.map(toSummary);
  }

  async remove(entryId: string): Promise<readonly PromptShelfEntrySummary[]> {
    const current = await this.read();
    const entries = current.entries.filter((entry) => entry.id !== entryId);
    if (entries.length === current.entries.length) throw new Error("Prompt Shelf entry was not found.");
    await this.store.write("global", { version: 1, entries });
    await rm(join(this.assetRoot, validateId(entryId)), { recursive: true, force: true });
    return entries.map(toSummary);
  }

  private async requireEntry(entryId: string): Promise<StoredPromptShelfEntry> {
    const entry = (await this.read()).entries.find((candidate) => candidate.id === validateId(entryId));
    if (!entry) throw new Error("Prompt Shelf entry was not found.");
    return entry;
  }

  private async read(): Promise<PersistedPromptShelf> {
    const persisted = await this.store.read("global");
    if (persisted?.version !== 1 || !Array.isArray(persisted.entries)) return { version: 1, entries: [] };
    return {
      version: 1,
      entries: persisted.entries.slice(0, MAX_ENTRIES).flatMap((entry) => normalizeStoredEntry(entry)),
    };
  }

  private async assertBounds(next: PersistedPromptShelf): Promise<void> {
    if (Buffer.byteLength(JSON.stringify(next), "utf8") > MAX_STORE_BYTES) throw new Error("Prompt Shelf metadata exceeds its storage budget.");
    let total = 0;
    for (const entry of next.entries) for (const attachment of entry.attachments) total += attachment.sizeBytes;
    if (total > MAX_TOTAL_ASSET_BYTES) throw new Error("Prompt Shelf attachments exceed the 100 MiB storage budget.");
  }
}

async function persistAttachment(entryDir: string, attachment: ComposerAttachment, index: number): Promise<StoredAttachment> {
  const name = safeName(attachment.name || `${attachment.kind}-${index + 1}`);
  const extension = safeExtension(name);
  const assetName = `${String(index).padStart(2, "0")}-${randomUUID()}${extension}`;
  const target = join(entryDir, assetName);
  if (attachment.kind === "image") {
    const data = Buffer.from(attachment.data, "base64");
    if (!data.length || data.byteLength > MAX_ASSET_BYTES) throw new Error(`Attachment ${name} is empty or too large.`);
    await writeFile(target, data);
    return { id: attachment.id, kind: "image", name, mimeType: attachment.mimeType, sizeBytes: data.byteLength, assetName };
  }
  const metadata = await stat(attachment.fsPath);
  if (!metadata.isFile() || metadata.size > MAX_ASSET_BYTES) throw new Error(`Attachment ${name} is missing or too large.`);
  await copyFile(attachment.fsPath, target);
  return { id: attachment.id, kind: "file", name, mimeType: attachment.mimeType, sizeBytes: metadata.size, assetName };
}

function toSummary(entry: StoredPromptShelfEntry): PromptShelfEntrySummary { return { id: entry.id, label: entry.label, preview: entry.text.replace(/\s+/g, " ").trim().slice(0, 160) || `${entry.attachments.length} attachment(s)`, createdAt: entry.createdAt, updatedAt: entry.updatedAt, textBytes: Buffer.byteLength(entry.text, "utf8"), attachmentCount: entry.attachments.length, source: entry.source }; }
function validateText(value: unknown): string { if (typeof value !== "string") throw new Error("Prompt text is invalid."); if (Buffer.byteLength(value, "utf8") > 256 * 1024) throw new Error("Prompt text exceeds 256 KiB."); return value; }
function validateLabel(value: unknown): string | undefined { if (typeof value !== "string" || !value.trim()) return undefined; if (value.trim().length > 120) throw new Error("Prompt label is too long."); return value.trim(); }
function validateId(value: unknown): string { if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,1000}$/.test(value)) throw new Error("Prompt Shelf identifier is invalid."); return value; }
function validateSourceId(value: unknown): string { if (typeof value !== "string" || !value || value.length > 4_096 || value.includes("\u0000")) throw new Error("Prompt Shelf source identifier is invalid."); return value; }
function safeName(value: string): string { const name = basename(value).replace(/[\u0000-\u001f]/g, "").slice(0, 255); return name || "attachment"; }
function safeExtension(value: string): string { const extension = extname(value).toLowerCase(); return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ""; }
function normalizeStoredEntry(value: unknown): readonly StoredPromptShelfEntry[] {
  if (!isRecord(value) || !Array.isArray(value.attachments)) return [];
  try {
    const id = validateId(value.id);
    const text = validateText(value.text);
    const attachments = value.attachments.flatMap((attachment) => normalizeStoredAttachment(attachment));
    if (attachments.length !== value.attachments.length) return [];
    const source = isRecord(value.source)
      ? { workspaceId: validateSourceId(value.source.workspaceId), sessionId: validateSourceId(value.source.sessionId) }
      : undefined;
    return [{
      id,
      text,
      attachments,
      label: validateLabel(value.label),
      createdAt: validIso(value.createdAt),
      updatedAt: validIso(value.updatedAt),
      source,
    }];
  } catch {
    return [];
  }
}

function normalizeStoredAttachment(value: unknown): readonly StoredAttachment[] {
  if (!isRecord(value)) return [];
  try {
    const kind = value.kind === "image" || value.kind === "file" ? value.kind : undefined;
    const sizeBytes = Number(value.sizeBytes);
    if (!kind || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_ASSET_BYTES) return [];
    return [{
      id: validateId(value.id),
      kind,
      name: safeName(typeof value.name === "string" ? value.name : "attachment"),
      mimeType: typeof value.mimeType === "string" ? value.mimeType.slice(0, 200) : "application/octet-stream",
      sizeBytes,
      assetName: validateAssetName(value.assetName),
    }];
  } catch {
    return [];
  }
}

function validateAssetName(value: unknown): string {
  if (typeof value !== "string" || value !== basename(value) || !/^[A-Za-z0-9._-]{1,255}$/.test(value)) {
    throw new Error("Prompt Shelf asset name is invalid.");
  }
  return value;
}

function validIso(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error("Prompt Shelf timestamp is invalid.");
  return new Date(value).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
