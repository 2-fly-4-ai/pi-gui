const STORAGE_KEY = "pi-gui:open-file-history:v1";
const MAX_ENTRIES = 100;

export interface OpenFileHistoryEntry {
  readonly workspaceId: string;
  readonly path: string;
  readonly line?: number;
  readonly endLine?: number;
  readonly source: "timeline" | "changes" | "review" | "context" | "artifact";
  readonly openedAt: string;
}

export function recordOpenedFile(entry: Omit<OpenFileHistoryEntry, "openedAt">): void {
  const current = readOpenFileHistory();
  const next: OpenFileHistoryEntry = {
    ...entry,
    openedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify([
    next,
    ...current.filter((candidate) => !(
      candidate.workspaceId === entry.workspaceId
      && candidate.path === entry.path
    )),
  ].slice(0, MAX_ENTRIES)));
}

export function readOpenFileHistory(workspaceId?: string): OpenFileHistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is OpenFileHistoryEntry => (
      typeof entry === "object"
      && entry !== null
      && "workspaceId" in entry
      && typeof entry.workspaceId === "string"
      && "path" in entry
      && typeof entry.path === "string"
      && "source" in entry
      && ["timeline", "changes", "review", "context", "artifact"].includes(String(entry.source))
      && "openedAt" in entry
      && typeof entry.openedAt === "string"
    )).filter((entry) => !workspaceId || entry.workspaceId === workspaceId);
  } catch {
    return [];
  }
}

export function pruneOpenFileHistory(workspaceId: string, availablePaths: ReadonlySet<string>): void {
  const current = readOpenFileHistory();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current.filter((entry) => (
    entry.workspaceId !== workspaceId || availablePaths.has(entry.path)
  ))));
}
