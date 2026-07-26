import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CONTEXT_MANIFEST_SCHEMA_VERSION,
  sanitizeContextDisplayValue,
  type ContextEntry,
  type ContextManifest,
  type ContextManifestSnapshot,
} from "../src/product-experience/context-manifest";

const STORE_SCHEMA_VERSION = 1 as const;
const MAX_SNAPSHOTS_PER_WORKSPACE = 500;

interface PersistedContextManifests {
  readonly storeSchemaVersion: typeof STORE_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly snapshots: readonly ContextManifestSnapshot[];
}

export class ContextManifestStore {
  private readonly directory: string;
  private pending = Promise.resolve();

  constructor(
    userDataPath: string,
    private readonly createId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.directory = join(userDataPath, "context-manifests");
  }

  snapshot(manifest: ContextManifest): Promise<ContextManifestSnapshot> {
    return this.enqueue(async () => {
      const normalized = normalizeManifest(manifest);
      if (!normalized) throw new Error("Context manifest is malformed.");
      const current = await this.readWorkspace(normalized.workspaceId);
      const snapshot: ContextManifestSnapshot = {
        id: this.createId(),
        submittedAt: this.now().toISOString(),
        manifest: normalized,
      };
      const snapshots = [...current, snapshot].slice(-MAX_SNAPSHOTS_PER_WORKSPACE);
      await this.writeWorkspace(normalized.workspaceId, snapshots);
      return snapshot;
    });
  }

  async list(
    workspaceId: string,
    sessionId?: string,
  ): Promise<readonly ContextManifestSnapshot[]> {
    return (await this.readWorkspace(workspaceId))
      .filter((snapshot) => !sessionId || snapshot.manifest.sessionId === sessionId)
      .sort((left, right) => (
        Date.parse(right.submittedAt) - Date.parse(left.submittedAt)
        || right.id.localeCompare(left.id)
      ));
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.catch(() => undefined).then(operation);
    this.pending = next.then(() => undefined, () => undefined);
    return next;
  }

  private async readWorkspace(workspaceId: string): Promise<readonly ContextManifestSnapshot[]> {
    if (!safeWorkspaceId(workspaceId)) return [];
    try {
      const parsed = JSON.parse(await readFile(this.filePath(workspaceId), "utf8")) as unknown;
      if (
        !isObject(parsed)
        || parsed.storeSchemaVersion !== STORE_SCHEMA_VERSION
        || parsed.workspaceId !== workspaceId
        || !Array.isArray(parsed.snapshots)
      ) return [];
      return parsed.snapshots.flatMap((value) => normalizeSnapshot(value, workspaceId));
    } catch {
      return [];
    }
  }

  private async writeWorkspace(
    workspaceId: string,
    snapshots: readonly ContextManifestSnapshot[],
  ): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.filePath(workspaceId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify({
      storeSchemaVersion: STORE_SCHEMA_VERSION,
      workspaceId,
      snapshots,
    } satisfies PersistedContextManifests)}\n`, { mode: 0o600 });
    await rename(temporary, target);
  }

  private filePath(workspaceId: string): string {
    if (!safeWorkspaceId(workspaceId)) throw new Error("Unsafe context workspace ID.");
    const digest = createHash("sha256").update(workspaceId).digest("hex");
    return join(this.directory, `${digest}.json`);
  }
}

function normalizeSnapshot(
  value: unknown,
  workspaceId: string,
): readonly ContextManifestSnapshot[] {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.submittedAt !== "string") return [];
  const manifest = normalizeManifest(value.manifest);
  if (!manifest || manifest.workspaceId !== workspaceId) return [];
  return [{ id: value.id, submittedAt: value.submittedAt, manifest }];
}

function normalizeManifest(value: unknown): ContextManifest | undefined {
  if (
    !isObject(value)
    || value.schemaVersion !== CONTEXT_MANIFEST_SCHEMA_VERSION
    || typeof value.workspaceId !== "string"
    || typeof value.model !== "string"
    || typeof value.provider !== "string"
    || typeof value.generatedAt !== "string"
    || !Array.isArray(value.entries)
  ) return undefined;
  const entries = value.entries.flatMap((entry) => {
    if (
      !isObject(entry)
      || typeof entry.id !== "string"
      || typeof entry.source !== "string"
      || typeof entry.scope !== "string"
      || typeof entry.label !== "string"
      || typeof entry.reason !== "string"
      || typeof entry.removable !== "boolean"
      || typeof entry.providerVisible !== "boolean"
      || typeof entry.persistent !== "boolean"
      || typeof entry.contentAccess !== "string"
      || typeof entry.availability !== "string"
      || !isContextSource(entry.source)
      || !isContextScope(entry.scope)
      || !isContentAccess(entry.contentAccess)
      || !isAvailability(entry.availability)
    ) return [];
    return [{
      id: entry.id,
      source: entry.source,
      scope: entry.scope,
      label: sanitizeContextDisplayValue(entry.label).slice(0, 500),
      reason: sanitizeContextDisplayValue(entry.reason).slice(0, 1_000),
      removable: entry.removable,
      providerVisible: entry.providerVisible,
      persistent: entry.persistent,
      contentAccess: entry.contentAccess,
      availability: entry.availability,
      ...(typeof entry.path === "string" ? {
        path: sanitizeContextDisplayValue(entry.path).slice(0, 1_000),
      } : {}),
    } satisfies ContextEntry];
  });
  return {
    schemaVersion: CONTEXT_MANIFEST_SCHEMA_VERSION,
    workspaceId: value.workspaceId,
    ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}),
    model: sanitizeContextDisplayValue(value.model).slice(0, 200),
    provider: sanitizeContextDisplayValue(value.provider).slice(0, 200),
    ...(typeof value.checkout === "string" ? {
      checkout: sanitizeContextDisplayValue(value.checkout).slice(0, 500),
    } : {}),
    generatedAt: value.generatedAt,
    entries,
  };
}

function isContextSource(value: string): value is ContextEntry["source"] {
  return [
    "attachment",
    "file-mention",
    "desktop-instruction",
    "workspace-instruction",
    "skill",
    "decision",
    "project-memory",
    "runtime",
  ].includes(value);
}

function isContextScope(value: string): value is ContextEntry["scope"] {
  return ["message", "thread", "workspace", "global", "runtime"].includes(value);
}

function isContentAccess(value: string): value is ContextEntry["contentAccess"] {
  return ["content", "metadata-only", "opaque"].includes(value);
}

function isAvailability(value: string): value is ContextEntry["availability"] {
  return ["available", "missing", "stale"].includes(value);
}

function safeWorkspaceId(value: string): boolean {
  return value.trim().length > 0 && !value.includes("\0");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
