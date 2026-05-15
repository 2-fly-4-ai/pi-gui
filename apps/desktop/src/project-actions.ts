export interface ProjectActionRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly command: string;
  readonly keybinding?: string;
  readonly runOnWorktreeCreation: boolean;
}

export type ProjectActionsByWorkspace = Readonly<Record<string, readonly ProjectActionRecord[]>>;

const STORAGE_KEY = "pi-gui:project-actions:v1";

export function loadProjectActions(): ProjectActionsByWorkspace {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const output: Record<string, ProjectActionRecord[]> = {};
    for (const [workspaceId, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      output[workspaceId] = value.flatMap((entry) => normalizeProjectAction(entry, workspaceId));
    }
    return output;
  } catch {
    return {};
  }
}

export function saveProjectActions(actions: ProjectActionsByWorkspace): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
  } catch {
    // Project actions are renderer convenience state; ignore storage failures.
  }
}

export function createProjectAction(input: {
  readonly workspaceId: string;
  readonly name: string;
  readonly command: string;
  readonly keybinding?: string;
  readonly runOnWorktreeCreation: boolean;
}): ProjectActionRecord {
  return {
    id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: input.workspaceId,
    name: input.name.trim(),
    command: input.command.trim(),
    ...(input.keybinding?.trim() ? { keybinding: input.keybinding.trim() } : {}),
    runOnWorktreeCreation: input.runOnWorktreeCreation,
  };
}

function normalizeProjectAction(value: unknown, fallbackWorkspaceId: string): readonly ProjectActionRecord[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Partial<ProjectActionRecord>;
  if (!record.name?.trim() || !record.command?.trim()) return [];
  return [{
    id: record.id || `action-${record.name}`,
    workspaceId: record.workspaceId || fallbackWorkspaceId,
    name: record.name.trim(),
    command: record.command.trim(),
    ...(record.keybinding?.trim() ? { keybinding: record.keybinding.trim() } : {}),
    runOnWorktreeCreation: Boolean(record.runOnWorktreeCreation),
  }];
}
