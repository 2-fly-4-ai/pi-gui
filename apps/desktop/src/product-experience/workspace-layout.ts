export interface WorkspacePanelLayout {
  readonly terminalOpen: boolean;
  readonly terminalHeight: number;
  readonly changesOpen: boolean;
  readonly browserOpen: boolean;
  readonly browserWidth: number;
  readonly logsOpen: boolean;
  readonly planOpen: boolean;
  readonly drawerOpen: boolean;
  readonly vsCodeOpen: boolean;
  readonly vsCodeWidth: number;
}

export const DEFAULT_WORKSPACE_PANEL_LAYOUT: WorkspacePanelLayout = {
  terminalOpen: false,
  terminalHeight: 340,
  changesOpen: false,
  browserOpen: false,
  browserWidth: 420,
  logsOpen: false,
  planOpen: false,
  drawerOpen: false,
  vsCodeOpen: false,
  vsCodeWidth: 480,
};

export function readWorkspacePanelLayout(workspaceId: string): WorkspacePanelLayout {
  if (!workspaceId || typeof localStorage === "undefined") return DEFAULT_WORKSPACE_PANEL_LAYOUT;
  try {
    return normalizeLayout(JSON.parse(localStorage.getItem(storageKey(workspaceId)) ?? ""));
  } catch {
    return DEFAULT_WORKSPACE_PANEL_LAYOUT;
  }
}

export function updateWorkspacePanelLayout(
  workspaceId: string,
  patch: Partial<WorkspacePanelLayout>,
): WorkspacePanelLayout {
  const next = normalizeLayout({ ...readWorkspacePanelLayout(workspaceId), ...patch });
  if (workspaceId && typeof localStorage !== "undefined") {
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(next));
  }
  return next;
}

export function resetWorkspacePanelLayout(workspaceId: string): WorkspacePanelLayout {
  if (workspaceId && typeof localStorage !== "undefined") localStorage.removeItem(storageKey(workspaceId));
  return DEFAULT_WORKSPACE_PANEL_LAYOUT;
}

function normalizeLayout(value: unknown): WorkspacePanelLayout {
  const candidate = typeof value === "object" && value !== null
    ? value as Partial<WorkspacePanelLayout>
    : {};
  return {
    terminalOpen: candidate.terminalOpen === true,
    terminalHeight: clamp(candidate.terminalHeight, 180, 720, DEFAULT_WORKSPACE_PANEL_LAYOUT.terminalHeight),
    changesOpen: candidate.changesOpen === true,
    browserOpen: candidate.browserOpen === true,
    browserWidth: clamp(candidate.browserWidth, 280, 960, DEFAULT_WORKSPACE_PANEL_LAYOUT.browserWidth),
    logsOpen: candidate.logsOpen === true,
    planOpen: candidate.planOpen === true,
    drawerOpen: candidate.drawerOpen === true,
    vsCodeOpen: candidate.vsCodeOpen === true,
    vsCodeWidth: clamp(candidate.vsCodeWidth, 280, 960, DEFAULT_WORKSPACE_PANEL_LAYOUT.vsCodeWidth),
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function storageKey(workspaceId: string): string {
  return `pi-gui:workspace-layout:v1:${workspaceId}`;
}
