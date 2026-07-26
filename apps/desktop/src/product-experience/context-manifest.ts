export const CONTEXT_MANIFEST_SCHEMA_VERSION = 1 as const;

export type ContextEntrySource =
  | "attachment"
  | "file-mention"
  | "desktop-instruction"
  | "workspace-instruction"
  | "skill"
  | "decision"
  | "project-memory"
  | "runtime";

export type ContextEntryScope = "message" | "thread" | "workspace" | "global" | "runtime";
export type ContextContentAccess = "content" | "metadata-only" | "opaque";
export type ContextEntryAvailability = "available" | "missing" | "stale";

export interface ContextEntry {
  readonly id: string;
  readonly source: ContextEntrySource;
  readonly scope: ContextEntryScope;
  readonly label: string;
  readonly reason: string;
  readonly removable: boolean;
  readonly providerVisible: boolean;
  readonly persistent: boolean;
  readonly contentAccess: ContextContentAccess;
  readonly availability: ContextEntryAvailability;
  readonly path?: string;
}

export interface ContextManifest {
  readonly schemaVersion: typeof CONTEXT_MANIFEST_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly sessionId?: string;
  readonly model: string;
  readonly provider: string;
  readonly checkout?: string;
  readonly generatedAt: string;
  readonly entries: readonly ContextEntry[];
}

export interface ContextManifestSnapshot {
  readonly id: string;
  readonly submittedAt: string;
  readonly manifest: ContextManifest;
}

export interface ProjectMemoryEntry {
  readonly id: string;
  readonly key: string;
  readonly text: string;
  readonly scope: "global" | "workspace" | "thread";
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly enabled: boolean;
  readonly updatedAt: string;
  readonly createdBy: "user" | "assistant-proposal";
  readonly confirmedAt?: string;
}

export interface BuildContextManifestInput {
  readonly workspaceId: string;
  readonly sessionId?: string;
  readonly model?: string;
  readonly provider?: string;
  readonly checkout?: string;
  readonly generatedAt: string;
  readonly attachments?: readonly {
    readonly id: string;
    readonly label: string;
    readonly availability: ContextEntryAvailability;
  }[];
  readonly fileMentions?: readonly string[];
  readonly desktopInstructionsEnabled?: boolean;
  readonly activeSkillProfile?: string;
  readonly projectMemory?: readonly ProjectMemoryEntry[];
  readonly decisions?: readonly {
    readonly id: string;
    readonly kind: "decision" | "assumption";
    readonly text: string;
    readonly affectedScope: string;
  }[];
}

const MEMORY_SCOPE_RANK: Readonly<Record<ProjectMemoryEntry["scope"], number>> = {
  global: 0,
  workspace: 1,
  thread: 2,
};

const SECRET_PATTERNS = [
  /\b(?:sk|pk)-[a-z0-9_-]{12,}\b/gi,
  /\b(?:ghp|github_pat|glpat|xox[baprs])_[a-z0-9_-]{8,}\b/gi,
  /\b(Bearer\s+)[a-z0-9._~+/-]{12,}\b/gi,
  /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*=\s*)[^\s]+/g,
] as const;

export function resolveProjectMemory(
  entries: readonly ProjectMemoryEntry[],
  target: {
    readonly workspaceId: string;
    readonly sessionId?: string;
  },
): ProjectMemoryEntry[] {
  const applicable = entries.filter((entry) => (
    entry.enabled
    && (entry.createdBy === "user" || entry.confirmedAt !== undefined)
    && (entry.scope !== "workspace" || entry.workspaceId === target.workspaceId)
    && (entry.scope !== "thread" || entry.sessionId === target.sessionId)
  ));
  const selected = new Map<string, ProjectMemoryEntry>();

  for (const entry of applicable) {
    const current = selected.get(entry.key);
    if (!current || compareMemoryPriority(entry, current) > 0) {
      selected.set(entry.key, entry);
    }
  }

  return [...selected.values()].sort((left, right) => (
    left.key.localeCompare(right.key) || left.id.localeCompare(right.id)
  ));
}

export function sanitizeContextDisplayValue(
  value: string,
  options: {
    readonly homePath?: string;
  } = {},
): string {
  let sanitized = value;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, (_match, prefix?: string) => `${prefix ?? ""}[redacted]`);
  }
  if (options.homePath) {
    const normalizedHome = options.homePath.replace(/\/+$/, "");
    sanitized = sanitized.split(normalizedHome).join("~");
  }
  return sanitized;
}

export function removableContextEntries(manifest: ContextManifest): ContextEntry[] {
  return manifest.entries.filter((entry) => entry.removable);
}

export function providerVisibleContextEntries(manifest: ContextManifest): ContextEntry[] {
  return manifest.entries.filter((entry) => entry.providerVisible);
}

export function extractFileMentions(value: string): string[] {
  const matches = value.matchAll(/(?:^|\s)@([^\s]+)/g);
  return [...new Set([...matches].flatMap((match) => match[1] ? [match[1]] : []))];
}

export function buildContextManifest(input: BuildContextManifestInput): ContextManifest {
  const memory = resolveProjectMemory(input.projectMemory ?? [], {
    workspaceId: input.workspaceId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });
  const entries: ContextEntry[] = [
    ...(input.attachments ?? []).map((attachment): ContextEntry => ({
      id: `attachment:${attachment.id}`,
      source: "attachment",
      scope: "message",
      label: sanitizeContextDisplayValue(attachment.label),
      reason: "Attached explicitly to the next message",
      removable: true,
      providerVisible: true,
      persistent: false,
      contentAccess: "content",
      availability: attachment.availability,
    })),
    ...(input.fileMentions ?? []).map((path, index): ContextEntry => ({
      id: `file-mention:${index}:${path}`,
      source: "file-mention",
      scope: "message",
      label: sanitizeContextDisplayValue(path),
      path: sanitizeContextDisplayValue(path),
      reason: "Mentioned explicitly in the next message",
      removable: true,
      providerVisible: true,
      persistent: false,
      contentAccess: "metadata-only",
      availability: "available",
    })),
    ...(input.desktopInstructionsEnabled ? [{
      id: "desktop-instructions",
      source: "desktop-instruction" as const,
      scope: "global" as const,
      label: "Desktop custom instructions",
      reason: "Enabled in Pi GUI settings",
      removable: true,
      providerVisible: true,
      persistent: true,
      contentAccess: "content" as const,
      availability: "available" as const,
    }] : []),
    ...(input.activeSkillProfile ? [{
      id: "active-skill-profile",
      source: "skill" as const,
      scope: "workspace" as const,
      label: sanitizeContextDisplayValue(input.activeSkillProfile),
      reason: "Selected skill profile for this workspace",
      removable: true,
      providerVisible: true,
      persistent: true,
      contentAccess: "metadata-only" as const,
      availability: "available" as const,
    }] : []),
    ...(input.decisions ?? []).map((decision): ContextEntry => ({
      id: `decision:${decision.id}`,
      source: "decision",
      scope: "workspace",
      label: sanitizeContextDisplayValue(decision.text),
      reason: `Active ${decision.kind} · ${sanitizeContextDisplayValue(decision.affectedScope)}`,
      removable: false,
      providerVisible: true,
      persistent: true,
      contentAccess: "content",
      availability: "available",
    })),
    ...memory.map((entry): ContextEntry => ({
      id: `project-memory:${entry.id}`,
      source: "project-memory",
      scope: entry.scope,
      label: sanitizeContextDisplayValue(entry.key),
      reason: `Explicit ${entry.scope} memory`,
      removable: true,
      providerVisible: true,
      persistent: true,
      contentAccess: "content",
      availability: "available",
    })),
    {
      id: "workspace-instructions",
      source: "workspace-instruction",
      scope: "workspace",
      label: "Workspace instruction discovery",
      reason: "Resolved by the runtime; content assembly is not exposed to Pi GUI",
      removable: false,
      providerVisible: true,
      persistent: true,
      contentAccess: "opaque",
      availability: "available",
    },
    {
      id: "runtime-managed",
      source: "runtime",
      scope: "runtime",
      label: "Runtime-managed context",
      reason: "Provider and upstream runtime context may be included; details are unavailable",
      removable: false,
      providerVisible: true,
      persistent: false,
      contentAccess: "opaque",
      availability: "available",
    },
  ];
  return {
    schemaVersion: CONTEXT_MANIFEST_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    model: sanitizeContextDisplayValue(input.model ?? "Not selected"),
    provider: sanitizeContextDisplayValue(input.provider ?? "Not selected"),
    ...(input.checkout ? { checkout: sanitizeContextDisplayValue(input.checkout) } : {}),
    generatedAt: input.generatedAt,
    entries,
  };
}

function compareMemoryPriority(left: ProjectMemoryEntry, right: ProjectMemoryEntry): number {
  const scopeDifference = MEMORY_SCOPE_RANK[left.scope] - MEMORY_SCOPE_RANK[right.scope];
  if (scopeDifference !== 0) {
    return scopeDifference;
  }
  const timeDifference = Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
  if (Number.isFinite(timeDifference) && timeDifference !== 0) {
    return timeDifference;
  }
  return left.id.localeCompare(right.id);
}
