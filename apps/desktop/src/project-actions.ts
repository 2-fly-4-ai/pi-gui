export type ProjectActionIcon = "play" | "test" | "build" | "deploy" | "preview" | "terminal";
export type ProjectActionSource = "saved" | "legacy-migration" | "discovered-script" | "repository-import";

export interface ProjectActionRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly command: string;
  readonly keybinding?: string;
  readonly runOnWorktreeCreation: boolean;
  readonly icon: ProjectActionIcon;
  readonly previewUrl?: string;
  readonly autoOpenPreview: boolean;
  readonly order: number;
  readonly primary: boolean;
  readonly trusted: boolean;
  readonly source: ProjectActionSource;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveProjectActionInput {
  readonly id?: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly command: string;
  readonly keybinding?: string;
  readonly runOnWorktreeCreation: boolean;
  readonly icon?: ProjectActionIcon;
  readonly previewUrl?: string;
  readonly autoOpenPreview?: boolean;
  readonly primary?: boolean;
  readonly source?: ProjectActionSource;
}

export type ProjectActionsByWorkspace = Readonly<Record<string, readonly ProjectActionRecord[]>>;
export const LEGACY_PROJECT_ACTIONS_STORAGE_KEY = "pi-gui:project-actions:v1";

export function loadLegacyProjectActions(): Readonly<Record<string, readonly LegacyProjectAction[]>> {
  try {
    const raw = window.localStorage.getItem(LEGACY_PROJECT_ACTIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const output: Record<string, LegacyProjectAction[]> = {};
    for (const [workspaceId, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      output[workspaceId] = value.flatMap((entry) => normalizeLegacyProjectAction(entry));
    }
    return output;
  } catch {
    return {};
  }
}

export function clearLegacyProjectActions(): void {
  try {
    window.localStorage.removeItem(LEGACY_PROJECT_ACTIONS_STORAGE_KEY);
  } catch {
    // Main persistence already succeeded; a stale migration source is harmless.
  }
}

export interface LegacyProjectAction {
  readonly id?: string;
  readonly name: string;
  readonly command: string;
  readonly keybinding?: string;
  readonly runOnWorktreeCreation: boolean;
}

export interface ProjectActionImportPreview {
  readonly relativePath: string;
  readonly actions: readonly ProjectActionRecord[];
  readonly warnings: readonly string[];
}

export interface ProjectActionExportPreview {
  readonly relativePath: string;
  readonly actionCount: number;
  readonly bytes: number;
  readonly overwritesExistingFile: boolean;
}

function normalizeLegacyProjectAction(value: unknown): readonly LegacyProjectAction[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Partial<LegacyProjectAction>;
  if (!record.name?.trim() || !record.command?.trim()) return [];
  return [{
    id: record.id,
    name: record.name.trim(),
    command: record.command.trim(),
    keybinding: record.keybinding?.trim() || undefined,
    runOnWorktreeCreation: Boolean(record.runOnWorktreeCreation),
  }];
}
