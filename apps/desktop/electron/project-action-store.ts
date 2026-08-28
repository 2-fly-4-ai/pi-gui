import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  LegacyProjectAction,
  ProjectActionIcon,
  ProjectActionRecord,
  ProjectActionSource,
  SaveProjectActionInput,
  ProjectActionExportPreview,
  ProjectActionImportPreview,
} from "../src/project-actions";
import { JsonFileStore } from "./json-file-store";

const MAX_ACTIONS_PER_WORKSPACE = 50;
const MAX_ACTION_BYTES = 512 * 1024;
const MAX_PACKAGE_JSON_BYTES = 2 * 1024 * 1024;
const REPOSITORY_ACTION_FILE = ".pi/actions.json";

interface PersistedProjectActions {
  readonly version: 2;
  readonly actions: readonly ProjectActionRecord[];
}

export class ProjectActionStore {
  private readonly store: JsonFileStore<PersistedProjectActions>;

  constructor(
    userDataDir: string,
    private readonly workspacePath: (workspaceId: string) => string | undefined,
  ) {
    this.store = new JsonFileStore<PersistedProjectActions>(userDataDir, "project-actions-v2");
  }

  async list(workspaceId: string): Promise<readonly ProjectActionRecord[]> {
    const persisted = await this.store.read(validateId(workspaceId, "Workspace ID"));
    if (persisted?.version !== 2 || !Array.isArray(persisted.actions)) return [];
    return persisted.actions.flatMap((value, index) => normalizePersistedAction(value, workspaceId, index)).sort(compareActions);
  }

  async save(input: SaveProjectActionInput): Promise<readonly ProjectActionRecord[]> {
    const workspaceId = validateId(input.workspaceId, "Workspace ID");
    const current = [...await this.list(workspaceId)];
    const existingIndex = input.id ? current.findIndex((action) => action.id === input.id) : -1;
    const existing = existingIndex >= 0 ? current[existingIndex] : undefined;
    const now = new Date().toISOString();
    const primary = input.primary ?? existing?.primary ?? current.length === 0;
    const record = normalizeAction({
      id: existing?.id ?? randomUUID(),
      workspaceId,
      name: input.name,
      command: input.command,
      keybinding: input.keybinding,
      runOnWorktreeCreation: input.runOnWorktreeCreation,
      icon: input.icon ?? existing?.icon ?? inferIcon(input.name, input.command),
      previewUrl: input.previewUrl,
      autoOpenPreview: input.autoOpenPreview ?? false,
      order: existing?.order ?? current.length,
      primary,
      trusted: true,
      source: input.source ?? existing?.source ?? "saved",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    if (primary) {
      for (let index = 0; index < current.length; index += 1) current[index] = { ...current[index]!, primary: false };
    }
    if (existingIndex >= 0) current[existingIndex] = record;
    else current.push(record);
    return this.persist(workspaceId, current);
  }

  async remove(workspaceId: string, actionId: string): Promise<readonly ProjectActionRecord[]> {
    validateId(actionId, "Action ID");
    const current = [...await this.list(workspaceId)];
    const next = current.filter((action) => action.id !== actionId);
    if (next.length === current.length) throw new Error("Project action was not found.");
    if (!next.some((action) => action.primary) && next[0]) next[0] = { ...next[0], primary: true };
    return this.persist(workspaceId, next);
  }

  async reorder(workspaceId: string, orderedIds: readonly string[]): Promise<readonly ProjectActionRecord[]> {
    const current = await this.list(workspaceId);
    if (orderedIds.length !== current.length || new Set(orderedIds).size !== current.length) throw new Error("Project action order is incomplete.");
    const byId = new Map(current.map((action) => [action.id, action]));
    const next = orderedIds.map((id, order) => {
      const action = byId.get(id);
      if (!action) throw new Error("Project action order contains an unknown action.");
      return { ...action, order, updatedAt: new Date().toISOString() };
    });
    return this.persist(workspaceId, next);
  }

  async migrateLegacy(input: Readonly<Record<string, readonly LegacyProjectAction[]>>): Promise<number> {
    let migrated = 0;
    for (const [workspaceId, values] of Object.entries(input).slice(0, 100)) {
      if (await this.list(workspaceId).then((actions) => actions.length > 0)) continue;
      const now = new Date().toISOString();
      const actions = values.slice(0, MAX_ACTIONS_PER_WORKSPACE).flatMap((value, index) => {
        try {
          return [normalizeAction({
            id: value.id?.trim() || randomUUID(), workspaceId, name: value.name, command: value.command,
            keybinding: value.keybinding, runOnWorktreeCreation: value.runOnWorktreeCreation,
            icon: inferIcon(value.name, value.command), autoOpenPreview: false, order: index, primary: index === 0,
            trusted: true, source: "legacy-migration", createdAt: now, updatedAt: now,
          })];
        } catch { return []; }
      });
      if (actions.length) {
        await this.persist(workspaceId, actions);
        migrated += actions.length;
      }
    }
    return migrated;
  }

  async discover(workspaceId: string): Promise<readonly ProjectActionRecord[]> {
    const root = this.requireWorkspace(workspaceId);
    let raw: string;
    try {
      raw = await readBounded(join(root, "package.json"), MAX_PACKAGE_JSON_BYTES);
    } catch {
      return [];
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return []; }
    const scripts = isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts : {};
    const manager = await detectPackageManager(root);
    const now = new Date().toISOString();
    return Object.entries(scripts).slice(0, 500).flatMap(([name, command], index) => {
      if (typeof command !== "string" || !name.trim() || command.length > 32_000) return [];
      return [normalizeAction({
        id: `discovered:${name}`, workspaceId, name, command: `${manager} run ${quoteScript(name)}`,
        runOnWorktreeCreation: false, icon: inferIcon(name, command), autoOpenPreview: false,
        order: index, primary: false, trusted: false, source: "discovered-script", createdAt: now, updatedAt: now,
      })];
    });
  }

  async previewImport(workspaceId: string): Promise<ProjectActionImportPreview> {
    const root = this.requireWorkspace(workspaceId);
    const raw = await readBounded(join(root, REPOSITORY_ACTION_FILE), MAX_ACTION_BYTES);
    const parsed: unknown = JSON.parse(raw);
    const values = isRecord(parsed) && Array.isArray(parsed.actions) ? parsed.actions : [];
    const now = new Date().toISOString();
    const actions = values.slice(0, MAX_ACTIONS_PER_WORKSPACE).flatMap((value, index) => {
      if (!isRecord(value)) return [];
      try {
        return [normalizeAction({
          id: randomUUID(), workspaceId, name: value.name, command: value.command,
          keybinding: value.keybinding, runOnWorktreeCreation: value.runOnWorktreeCreation === true,
          icon: normalizeIcon(value.icon), previewUrl: value.previewUrl, autoOpenPreview: value.autoOpenPreview === true,
          order: index, primary: value.primary === true, trusted: false, source: "repository-import",
          createdAt: now, updatedAt: now,
        })];
      } catch { return []; }
    });
    if (!actions.length) throw new Error(`${REPOSITORY_ACTION_FILE} contains no valid actions.`);
    return {
      relativePath: REPOSITORY_ACTION_FILE,
      actions,
      warnings: ["Imported actions are untrusted previews. Review each command and explicitly save it before running."],
    };
  }

  async previewExport(workspaceId: string): Promise<ProjectActionExportPreview> {
    const root = this.requireWorkspace(workspaceId);
    const actions = await this.list(workspaceId);
    const serialized = serializeRepositoryActions(actions);
    let overwritesExistingFile = false;
    try { await readFile(join(root, REPOSITORY_ACTION_FILE), "utf8"); overwritesExistingFile = true; } catch { /* absent */ }
    return { relativePath: REPOSITORY_ACTION_FILE, actionCount: actions.length, bytes: Buffer.byteLength(serialized, "utf8"), overwritesExistingFile };
  }

  async export(workspaceId: string): Promise<string> {
    const root = this.requireWorkspace(workspaceId);
    const actions = await this.list(workspaceId);
    if (!actions.length) throw new Error("There are no saved project actions to export.");
    const target = join(root, REPOSITORY_ACTION_FILE);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, serializeRepositoryActions(actions), "utf8");
    return REPOSITORY_ACTION_FILE;
  }

  private async persist(workspaceId: string, values: readonly ProjectActionRecord[]): Promise<readonly ProjectActionRecord[]> {
    if (values.length > MAX_ACTIONS_PER_WORKSPACE) throw new Error(`A workspace can store at most ${MAX_ACTIONS_PER_WORKSPACE} project actions.`);
    const actions = values.map((value, index) => ({ ...normalizeAction(value), order: index })).sort(compareActions);
    const persisted: PersistedProjectActions = { version: 2, actions };
    if (Buffer.byteLength(JSON.stringify(persisted), "utf8") > MAX_ACTION_BYTES) throw new Error("Project actions exceed the storage budget.");
    await this.store.write(workspaceId, persisted);
    return actions;
  }

  private requireWorkspace(workspaceId: string): string {
    const root = this.workspacePath(validateId(workspaceId, "Workspace ID"));
    if (!root) throw new Error("Workspace is unavailable.");
    return root;
  }
}

function normalizePersistedAction(value: unknown, workspaceId: string, index: number): readonly ProjectActionRecord[] {
  if (!isRecord(value)) return [];
  try { return [normalizeAction({ ...value, workspaceId, order: index })]; } catch { return []; }
}

function normalizeAction(value: Record<string, unknown> | ProjectActionRecord): ProjectActionRecord {
  const id = validateId(value.id, "Action ID");
  const workspaceId = validateId(value.workspaceId, "Workspace ID");
  const name = validateText(value.name, "Action name", 200);
  const command = validateText(value.command, "Action command", 32_000);
  const previewUrl = validatePreviewUrl(value.previewUrl);
  return {
    id, workspaceId, name, command,
    keybinding: typeof value.keybinding === "string" && value.keybinding.trim() ? value.keybinding.trim().slice(0, 100) : undefined,
    runOnWorktreeCreation: value.runOnWorktreeCreation === true,
    icon: normalizeIcon(value.icon), previewUrl,
    autoOpenPreview: value.autoOpenPreview === true && Boolean(previewUrl),
    order: Number.isSafeInteger(value.order) && Number(value.order) >= 0 ? Number(value.order) : 0,
    primary: value.primary === true,
    trusted: value.trusted === true,
    source: normalizeSource(value.source),
    createdAt: validIso(value.createdAt), updatedAt: validIso(value.updatedAt),
  };
}

function normalizeIcon(value: unknown): ProjectActionIcon { return ["play", "test", "build", "deploy", "preview", "terminal"].includes(String(value)) ? value as ProjectActionIcon : "play"; }
function normalizeSource(value: unknown): ProjectActionSource { return ["saved", "legacy-migration", "discovered-script", "repository-import"].includes(String(value)) ? value as ProjectActionSource : "saved"; }
function inferIcon(name: unknown, command: unknown): ProjectActionIcon { const value = `${String(name)} ${String(command)}`.toLowerCase(); if (/test|vitest|jest|playwright/.test(value)) return "test"; if (/build|compile/.test(value)) return "build"; if (/deploy|publish|release/.test(value)) return "deploy"; if (/dev|serve|preview/.test(value)) return "preview"; return "play"; }
function validatePreviewUrl(value: unknown): string | undefined { if (typeof value !== "string" || !value.trim()) return undefined; const parsed = new URL(value.trim()); if (parsed.username || parsed.password) throw new Error("Preview URL cannot contain credentials."); const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname); if (parsed.protocol !== "https:" && !localHttp) throw new Error("Preview URL must use HTTPS or loopback HTTP."); return parsed.toString(); }
function validateId(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim() || value.length > 1_000) throw new Error(`${label} is invalid.`); return value.trim(); }
function validateText(value: unknown, label: string, max: number): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`); if (Buffer.byteLength(value, "utf8") > max) throw new Error(`${label} is too large.`); return value.trim(); }
function validIso(value: unknown): string { return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : new Date().toISOString(); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function compareActions(left: ProjectActionRecord, right: ProjectActionRecord): number { return left.order - right.order || left.name.localeCompare(right.name); }
async function readBounded(path: string, limit: number): Promise<string> { const raw = await readFile(path); if (raw.byteLength > limit) throw new Error("Project action file is too large."); return raw.toString("utf8"); }
async function detectPackageManager(root: string): Promise<string> { for (const [file, command] of [["pnpm-lock.yaml", "pnpm"], ["bun.lockb", "bun"], ["bun.lock", "bun"], ["yarn.lock", "yarn"]] as const) { try { await readFile(join(root, file)); return command; } catch { /* continue */ } } return "npm"; }
function quoteScript(value: string): string { return /^[A-Za-z0-9:_-]+$/.test(value) ? value : JSON.stringify(value); }
function serializeRepositoryActions(actions: readonly ProjectActionRecord[]): string { return `${JSON.stringify({ version: 1, actions: actions.map(({ name, command, keybinding, runOnWorktreeCreation, icon, previewUrl, autoOpenPreview, primary }) => ({ name, command, ...(keybinding ? { keybinding } : {}), runOnWorktreeCreation, icon, ...(previewUrl ? { previewUrl } : {}), autoOpenPreview, primary })) }, null, 2)}\n`; }
