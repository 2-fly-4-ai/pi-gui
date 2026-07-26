import type { ProjectMemoryEntry } from "./context-manifest";

const STORAGE_KEY = "pi-gui.project-knowledge.v1";
const EXCLUSION_KEY = "pi-gui.project-memory-exclusions.v1";

export type DecisionStatus = "active" | "superseded" | "withdrawn";
export type DecisionKind = "decision" | "assumption";

export interface DecisionRevision {
  readonly text: string;
  readonly changedAt: string;
}

export interface DecisionRecord {
  readonly id: string;
  readonly kind: DecisionKind;
  readonly text: string;
  readonly status: DecisionStatus;
  readonly workspaceId: string;
  readonly sessionId?: string;
  readonly affectedScope: string;
  readonly sourceMessageId?: string;
  readonly sourceEvidence?: string;
  readonly createdBy: "user" | "assistant-proposal";
  readonly confirmedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revisions: readonly DecisionRevision[];
}

export interface ProjectKnowledge {
  readonly decisions: readonly DecisionRecord[];
  readonly memory: readonly ProjectMemoryEntry[];
}

export const PROJECT_KNOWLEDGE_CHANGED_EVENT = "pi-gui:project-knowledge-changed";

export function readProjectKnowledge(): ProjectKnowledge {
  if (typeof localStorage === "undefined") return { decisions: [], memory: [] };
  try {
    return normalizeKnowledge(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? ""));
  } catch {
    return { decisions: [], memory: [] };
  }
}

export function saveDecision(input: {
  readonly id?: string;
  readonly kind: DecisionKind;
  readonly text: string;
  readonly workspaceId: string;
  readonly sessionId?: string;
  readonly affectedScope: string;
  readonly sourceMessageId?: string;
  readonly sourceEvidence?: string;
  readonly createdBy?: "user" | "assistant-proposal";
  readonly confirmed?: boolean;
}): DecisionRecord {
  const text = validatedKnowledgeText(input.text);
  const knowledge = readProjectKnowledge();
  const existing = input.id ? knowledge.decisions.find((record) => record.id === input.id) : undefined;
  const now = new Date().toISOString();
  const decision: DecisionRecord = {
    id: existing?.id ?? crypto.randomUUID(),
    kind: input.kind,
    text,
    status: existing?.status ?? "active",
    workspaceId: input.workspaceId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    affectedScope: input.affectedScope.trim() || "Current workspace",
    ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
    ...(input.sourceEvidence ? { sourceEvidence: input.sourceEvidence } : {}),
    createdBy: input.createdBy ?? existing?.createdBy ?? "user",
    ...((input.confirmed || existing?.confirmedAt) ? { confirmedAt: existing?.confirmedAt ?? now } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    revisions: existing && existing.text !== text
      ? [...existing.revisions, { text: existing.text, changedAt: now }]
      : existing?.revisions ?? [],
  };
  writeKnowledge({
    ...knowledge,
    decisions: [decision, ...knowledge.decisions.filter((record) => record.id !== decision.id)],
  });
  return decision;
}

export function updateDecisionStatus(id: string, status: DecisionStatus): void {
  const knowledge = readProjectKnowledge();
  const now = new Date().toISOString();
  writeKnowledge({
    ...knowledge,
    decisions: knowledge.decisions.map((record) => record.id === id
      ? {
          ...record,
          status,
          updatedAt: now,
          revisions: [...record.revisions, { text: `${record.status} → ${status}`, changedAt: now }],
        }
      : record),
  });
}

export function confirmDecision(id: string): void {
  const knowledge = readProjectKnowledge();
  const now = new Date().toISOString();
  writeKnowledge({
    ...knowledge,
    decisions: knowledge.decisions.map((record) => record.id === id
      ? { ...record, confirmedAt: now, updatedAt: now }
      : record),
  });
}

export function saveMemory(input: {
  readonly id?: string;
  readonly key: string;
  readonly text: string;
  readonly scope: ProjectMemoryEntry["scope"];
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly createdBy?: ProjectMemoryEntry["createdBy"];
  readonly confirmed?: boolean;
}): ProjectMemoryEntry {
  const key = validatedKnowledgeText(input.key);
  const text = validatedKnowledgeText(input.text);
  const knowledge = readProjectKnowledge();
  const existing = input.id ? knowledge.memory.find((entry) => entry.id === input.id) : undefined;
  const now = new Date().toISOString();
  const memory: ProjectMemoryEntry = {
    id: existing?.id ?? crypto.randomUUID(),
    key,
    text,
    scope: input.scope,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    enabled: existing?.enabled ?? true,
    updatedAt: now,
    createdBy: input.createdBy ?? existing?.createdBy ?? "user",
    ...((input.confirmed || existing?.confirmedAt) ? { confirmedAt: existing?.confirmedAt ?? now } : {}),
  };
  writeKnowledge({
    ...knowledge,
    memory: [memory, ...knowledge.memory.filter((entry) => entry.id !== memory.id)],
  });
  return memory;
}

export function setMemoryEnabled(id: string, enabled: boolean): void {
  const knowledge = readProjectKnowledge();
  writeKnowledge({
    ...knowledge,
    memory: knowledge.memory.map((entry) => entry.id === id
      ? { ...entry, enabled, updatedAt: new Date().toISOString() }
      : entry),
  });
}

export function deleteMemory(id: string): void {
  const knowledge = readProjectKnowledge();
  writeKnowledge({ ...knowledge, memory: knowledge.memory.filter((entry) => entry.id !== id) });
}

export function setMemoryTemporarilyExcluded(id: string, excluded: boolean): void {
  if (typeof sessionStorage === "undefined") return;
  const current = readTemporaryExclusions();
  if (excluded) current.add(id);
  else current.delete(id);
  sessionStorage.setItem(EXCLUSION_KEY, JSON.stringify([...current]));
  window.dispatchEvent(new Event(PROJECT_KNOWLEDGE_CHANGED_EVENT));
}

export function clearTemporaryMemoryExclusions(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(EXCLUSION_KEY);
  window.dispatchEvent(new Event(PROJECT_KNOWLEDGE_CHANGED_EVENT));
}

export function resolveInjectableMemory(target: {
  readonly workspaceId: string;
  readonly sessionId?: string;
}): ProjectMemoryEntry[] {
  const exclusions = readTemporaryExclusions();
  return readProjectKnowledge().memory.filter((entry) => !exclusions.has(entry.id)).filter((entry) => (
    entry.enabled
    && (entry.createdBy === "user" || entry.confirmedAt !== undefined)
    && (entry.scope !== "workspace" || entry.workspaceId === target.workspaceId)
    && (entry.scope !== "thread" || entry.sessionId === target.sessionId)
  ));
}

export function activeDecisions(target: {
  readonly workspaceId: string;
  readonly sessionId?: string;
}): DecisionRecord[] {
  return readProjectKnowledge().decisions.filter((record) => (
    record.status === "active"
    && (record.createdBy === "user" || record.confirmedAt !== undefined)
    && record.workspaceId === target.workspaceId
    && (!record.sessionId || record.sessionId === target.sessionId)
  ));
}

export function hasLikelySecret(value: string): boolean {
  return [
    /\b(?:sk|pk)-[a-z0-9_-]{12,}\b/i,
    /\b(?:ghp|github_pat|glpat|xox[baprs])_[a-z0-9_-]{8,}\b/i,
    /\bBearer\s+[a-z0-9._~+/-]{12,}\b/i,
    /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*=\s*\S+/,
  ].some((pattern) => pattern.test(value));
}

function validatedKnowledgeText(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) throw new Error("Knowledge text cannot be empty.");
  if (hasLikelySecret(trimmed)) {
    throw new Error("This looks like a credential or secret and was not stored.");
  }
  return trimmed;
}

function readTemporaryExclusions(): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    const parsed = JSON.parse(sessionStorage.getItem(EXCLUSION_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeKnowledge(knowledge: ProjectKnowledge): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(knowledge));
  window.dispatchEvent(new Event(PROJECT_KNOWLEDGE_CHANGED_EVENT));
}

function normalizeKnowledge(value: unknown): ProjectKnowledge {
  if (!isObject(value)) return { decisions: [], memory: [] };
  return {
    decisions: Array.isArray(value.decisions)
      ? value.decisions.filter((record): record is DecisionRecord => (
          isObject(record)
          && typeof record.id === "string"
          && typeof record.text === "string"
          && typeof record.workspaceId === "string"
          && (record.kind === "decision" || record.kind === "assumption")
          && ["active", "superseded", "withdrawn"].includes(String(record.status))
          && !hasLikelySecret(record.text)
        ))
      : [],
    memory: Array.isArray(value.memory)
      ? value.memory.filter((entry): entry is ProjectMemoryEntry => (
          isObject(entry)
          && typeof entry.id === "string"
          && typeof entry.key === "string"
          && typeof entry.text === "string"
          && ["global", "workspace", "thread"].includes(String(entry.scope))
          && !hasLikelySecret(`${entry.key} ${entry.text}`)
        ))
      : [],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
