import type { WorktreeRecord, WorkspaceRecord } from "../desktop-state";
import type { DecisionRecord } from "./project-knowledge";
import type { TaskEvidenceRecord } from "./task-evidence";
import type { SubagentRunRecord } from "../subagent-workflows";

export type ArtifactState = "available" | "missing" | "moved" | "private" | "export-excluded";

export interface WorkspaceArtifactReference {
  readonly id: string;
  readonly path: string;
  readonly type: "plan" | "screenshot" | "report" | "asset" | "log" | "file";
  readonly source: "evidence" | "subagent" | "workspace";
  readonly sessionId?: string;
  readonly runId?: string;
  readonly state: ArtifactState;
  readonly sensitivity: "normal" | "private";
}

export interface WorkspaceShortcutAssignment {
  readonly id: string;
  readonly commandId: string;
  readonly label: string;
  readonly keys: string;
  readonly enabled: boolean;
  readonly significant: boolean;
}

export interface HandoffInput {
  readonly workspace: WorkspaceRecord;
  readonly decisions: readonly DecisionRecord[];
  readonly changedPaths: readonly string[];
  readonly evidence: readonly TaskEvidenceRecord[];
  readonly artifacts: readonly WorkspaceArtifactReference[];
  readonly includedArtifactIds: ReadonlySet<string>;
  readonly narrative?: string;
}

const RESERVED_SHORTCUTS = new Set(["cmd+q", "cmd+w", "cmd+h", "cmd+m", "cmd+,", "cmd+k", "cmd+n"]);

export function indexWorkspaceArtifacts(input: {
  readonly workspacePaths: readonly string[];
  readonly evidence: readonly TaskEvidenceRecord[];
  readonly subagentRuns: readonly SubagentRunRecord[];
}): readonly WorkspaceArtifactReference[] {
  const known = new Set(input.workspacePaths.map(normalizePath));
  const candidates: Array<Omit<WorkspaceArtifactReference, "id" | "state" | "sensitivity" | "type">> = [];
  for (const record of input.evidence) {
    const path = record.artifact?.path;
    if (path) candidates.push({
      path,
      source: "evidence",
      ...(record.sessionId ? { sessionId: record.sessionId } : {}),
      ...(record.runId ? { runId: record.runId } : {}),
    });
  }
  for (const run of input.subagentRuns) {
    for (const path of run.artifactPaths ?? run.artifacts) {
      candidates.push({
        path,
        source: "subagent",
        sessionId: run.target.sessionId,
        runId: run.id,
      });
    }
  }
  for (const path of input.workspacePaths.filter(isLikelyArtifact).slice(0, 200)) {
    candidates.push({ path, source: "workspace" });
  }

  const unique = new Map<string, WorkspaceArtifactReference>();
  for (const candidate of candidates) {
    const path = normalizePath(candidate.path);
    if (!path || unique.has(path)) continue;
    const sensitivity = isSensitiveArtifact(path) ? "private" : "normal";
    const declared = candidate.source !== "workspace";
    const available = known.has(path);
    const moved = declared && !available && [...known].some((knownPath) => (
      knownPath !== path && knownPath.split("/").at(-1) === path.split("/").at(-1)
    ));
    unique.set(path, {
      ...candidate,
      id: `artifact:${path}`,
      path,
      type: artifactType(path),
      sensitivity,
      state: sensitivity === "private"
        ? "private"
        : available
          ? isExportExcludedArtifact(path) ? "export-excluded" : "available"
          : moved
            ? "moved"
          : declared
            ? "missing"
            : "export-excluded",
    });
  }
  return [...unique.values()].sort((left, right) => (
    left.type.localeCompare(right.type) || left.path.localeCompare(right.path)
  ));
}

export function deriveWorktreeLifecycle(
  workspace: WorkspaceRecord,
  worktree: WorktreeRecord | undefined,
  changedPathCount: number,
  runningTaskCount: number,
): {
  readonly status: "active" | "ready" | "stale" | "missing" | "cleanup-eligible";
  readonly dirty: boolean;
  readonly cleanupAdvisory: string;
} {
  const dirty = changedPathCount > 0;
  if (worktree?.status === "missing") {
    return { status: "missing", dirty, cleanupAdvisory: "Path is missing. Resolve the target before any cleanup." };
  }
  if (worktree?.status === "error") {
    return { status: "stale", dirty, cleanupAdvisory: "Worktree metadata is stale or unreadable. Refresh and resolve the target before cleanup." };
  }
  if (runningTaskCount > 0) {
    return { status: "active", dirty, cleanupAdvisory: "Running tasks make cleanup ineligible." };
  }
  if (dirty) {
    return { status: "ready", dirty, cleanupAdvisory: "Uncommitted changes make cleanup ineligible." };
  }
  const updatedAt = Date.parse(worktree?.updatedAt ?? "");
  const stale = Number.isFinite(updatedAt) && Date.now() - updatedAt > 14 * 24 * 60 * 60 * 1_000;
  return stale
    ? { status: "cleanup-eligible", dirty, cleanupAdvisory: "Advisory only: verify merge, branch, artifacts, and local state before deletion." }
    : { status: "ready", dirty, cleanupAdvisory: "Clean does not mean safe to delete; merge and local state still require review." };
}

export function buildWorkspaceHandoff(input: HandoffInput): string {
  const workspaceRoot = normalizePath(input.workspace.path);
  const rel = (value: string) => redactPath(value, workspaceRoot);
  const exportableChangedPaths = input.changedPaths.filter((path) => !isSensitiveArtifact(rel(path)));
  const observed = input.evidence.filter((record) => (
    record.kind === "completion"
    || record.kind === "test"
    || record.kind === "verification"
    || record.kind === "error"
  )).slice(-40);
  const blockers = observed.filter((record) => record.status === "failed" || record.status === "blocked");
  const includedArtifacts = input.artifacts.filter((artifact) => (
    input.includedArtifactIds.has(artifact.id)
    && artifact.sensitivity === "normal"
    && artifact.state === "available"
  ));
  return [
    `# Workspace handoff — ${sanitizeText(input.workspace.name)}`,
    "",
    "## Narrative summary",
    "",
    sanitizeText(input.narrative?.trim() || "No narrative summary was added."),
    "",
    "## Decisions selected by the user",
    "",
    ...(input.decisions.length
      ? input.decisions.map((decision) => `- ${sanitizeText(decision.text)} (${decision.kind}; ${decision.status})`)
      : ["- None selected."]),
    "",
    "## Observed changes",
    "",
    ...(exportableChangedPaths.length
      ? exportableChangedPaths.map((path) => `- \`${rel(path)}\``)
      : ["- No export-safe changed paths observed."]),
    "",
    "## Observed verification",
    "",
    ...(observed.length ? observed.map((record) => (
      `- ${record.status ?? "unknown"} · ${sanitizeText(record.summary)}${record.verification?.command ? ` · \`${sanitizeCommand(record.verification.command)}\`` : ""}`
    )) : ["- No verification evidence observed."]),
    "",
    "## Observed blockers",
    "",
    ...(blockers.length ? blockers.map((record) => `- ${sanitizeText(record.summary)}`) : ["- None observed."]),
    "",
    "## Included artifact references",
    "",
    ...(includedArtifacts.length
      ? includedArtifacts.map((artifact) => `- ${artifact.type} · \`${rel(artifact.path)}\``)
      : ["- None. Private, missing, logs, and export-excluded artifacts stay excluded by default."]),
    "",
    "> Evidence above is observed metadata. Transcript bodies, log bodies, environment values, binary contents, and secrets are excluded.",
    "",
  ].join("\n");
}

export function validateWorkspaceShortcut(
  keys: string,
  existing: readonly WorkspaceShortcutAssignment[],
  currentId?: string,
): string | undefined {
  const normalized = normalizeShortcut(keys);
  if (!normalized) return "Enter a shortcut.";
  if (RESERVED_SHORTCUTS.has(normalized)) return "This shortcut is reserved by the app or macOS.";
  if (!/^(?:cmd|ctrl|alt|shift)(?:\+(?:cmd|ctrl|alt|shift))*\+[a-z0-9]$/.test(normalized)) {
    return "Use modifiers plus one letter or number.";
  }
  if (existing.some((entry) => entry.id !== currentId && entry.enabled && normalizeShortcut(entry.keys) === normalized)) {
    return "This workspace shortcut is already assigned.";
  }
  return undefined;
}

export function readWorkspaceShortcuts(workspaceId: string): readonly WorkspaceShortcutAssignment[] {
  if (!workspaceId || typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(shortcutStorageKey(workspaceId)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is WorkspaceShortcutAssignment => (
      typeof value === "object"
      && value !== null
      && "id" in value
      && typeof value.id === "string"
      && "commandId" in value
      && typeof value.commandId === "string"
      && "label" in value
      && typeof value.label === "string"
      && "keys" in value
      && typeof value.keys === "string"
      && "enabled" in value
      && typeof value.enabled === "boolean"
      && "significant" in value
      && typeof value.significant === "boolean"
    ));
  } catch {
    return [];
  }
}

export function saveWorkspaceShortcuts(
  workspaceId: string,
  assignments: readonly WorkspaceShortcutAssignment[],
): void {
  if (!workspaceId || typeof localStorage === "undefined") return;
  localStorage.setItem(shortcutStorageKey(workspaceId), JSON.stringify(assignments));
  window.dispatchEvent(new CustomEvent("pi-gui:workspace-shortcuts-changed", { detail: workspaceId }));
}

export function normalizeShortcut(value: string): string {
  return value.toLowerCase()
    .replace(/command|meta|⌘/g, "cmd")
    .replace(/control|⌃/g, "ctrl")
    .replace(/option|⌥/g, "alt")
    .replace(/⇧/g, "shift")
    .replace(/\s+/g, "")
    .replace(/-+/g, "+");
}

function shortcutStorageKey(workspaceId: string): string {
  return `pi-gui:workspace-shortcuts:v1:${workspaceId}`;
}

function artifactType(path: string): WorkspaceArtifactReference["type"] {
  if (/(?:^|\/)(?:plan|plans)(?:\/|[-_.])/i.test(path)) return "plan";
  if (/\.(?:png|jpe?g|webp|gif)$/i.test(path)) return "screenshot";
  if (/(?:report|review|handoff|summary).*\.(?:md|html|pdf)$/i.test(path)) return "report";
  if (/\.(?:log|jsonl|trace)$/i.test(path)) return "log";
  if (/\.(?:svg|pdf|zip|mp4|mov)$/i.test(path)) return "asset";
  return "file";
}

function isLikelyArtifact(path: string): boolean {
  return artifactType(path) !== "file" || /(?:artifact|output|result)/i.test(path);
}

function isSensitiveArtifact(path: string): boolean {
  return /(?:^|\/)(?:\.env|private|secrets?|credentials?|auth)(?:[./_-]|$)|\.(?:log|jsonl|trace)$/i.test(path);
}

function isExportExcludedArtifact(path: string): boolean {
  return /\.(?:zip|mp4|mov)$/i.test(path);
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function redactPath(value: string, workspaceRoot: string): string {
  const normalized = normalizePath(value);
  if (normalized.startsWith(`${workspaceRoot}/`)) return normalized.slice(workspaceRoot.length + 1);
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return `[external path redacted]/${normalized.split("/").at(-1) ?? "artifact"}`;
  return normalized;
}

function sanitizeText(value: string): string {
  return value
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/gi, "[secret redacted]")
    .replace(/\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi, "$1=[secret redacted]")
    .replace(/\r?\n+/g, " ")
    .trim();
}

function sanitizeCommand(value: string): string {
  return sanitizeText(value).replace(/(?:^|\s)[A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD)=\S+/g, " [environment value redacted]");
}
