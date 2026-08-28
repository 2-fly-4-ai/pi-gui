import { basename, isAbsolute, relative } from "node:path";
import type {
  TaskEvidenceKind,
  TaskEvidencePage,
  TaskEvidenceQuery,
  TaskEvidenceRecord,
} from "../src/product-experience/task-evidence";
import { TASK_EVIDENCE_SCHEMA_VERSION } from "../src/product-experience/task-evidence";
import { compactTaskEvidence } from "../src/product-experience/task-evidence";
import { sanitizeContextDisplayValue } from "../src/product-experience/context-manifest";
import { JsonFileStore } from "./json-file-store";

const LEDGER_STORE_SCHEMA_VERSION = 1 as const;
const DEFAULT_MAX_RECORDS = 2_000;
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_QUERY_LIMIT = 200;
const MAX_QUERY_LIMIT = 1_000;
const MAX_SUMMARY_LENGTH = 500;
const DEFAULT_WRITE_DEBOUNCE_MS = 1_000;
const DEFAULT_MAX_RESIDENT_WORKSPACES = 8;

interface PersistedTaskEvidenceLedger {
  readonly schemaVersion: typeof LEDGER_STORE_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly updatedAt: string;
  readonly records: readonly TaskEvidenceRecord[];
}

export interface TaskEvidenceLedgerOptions {
  readonly maxRecords?: number;
  readonly maxAgeMs?: number;
  readonly now?: () => Date;
  readonly homePath?: string;
  readonly workspacePath?: (workspaceId: string) => string | undefined;
  readonly onRecordsAppended?: (
    workspaceId: string,
    records: readonly TaskEvidenceRecord[],
  ) => void;
  readonly maxResidentWorkspaces?: number;
}

export class TaskEvidenceLedger {
  private readonly fileStore: JsonFileStore<unknown>;
  private readonly recordsByWorkspace = new Map<string, TaskEvidenceRecord[]>();
  private readonly loadPromises = new Map<string, Promise<void>>();
  private readonly writeQueues = new Map<string, Promise<void>>();
  private readonly writeTimers = new Map<string, NodeJS.Timeout>();
  private readonly dirtyWorkspaces = new Set<string>();
  private readonly workspaceAccessOrder = new Map<string, true>();
  private readonly maxRecords: number;
  private readonly maxAgeMs: number;
  private readonly now: () => Date;
  private readonly maxResidentWorkspaces: number;

  constructor(
    userDataDir: string,
    private readonly options: TaskEvidenceLedgerOptions = {},
  ) {
    this.fileStore = new JsonFileStore<unknown>(userDataDir, "task-evidence");
    this.maxRecords = positiveInteger(options.maxRecords, DEFAULT_MAX_RECORDS);
    this.maxAgeMs = positiveInteger(options.maxAgeMs, DEFAULT_MAX_AGE_MS);
    this.maxResidentWorkspaces = positiveInteger(
      options.maxResidentWorkspaces,
      DEFAULT_MAX_RESIDENT_WORKSPACES,
    );
    this.now = options.now ?? (() => new Date());
  }

  async append(record: TaskEvidenceRecord): Promise<TaskEvidenceRecord | undefined> {
    const normalized = this.normalizeRecord(record, record.workspaceId);
    if (!normalized) return undefined;

    await this.ensureLoaded(normalized.workspaceId);
    const records = this.recordsByWorkspace.get(normalized.workspaceId) ?? [];
    const duplicateIndex = records.findIndex((entry) => entry.id === normalized.id);
    if (duplicateIndex >= 0) {
      return records[duplicateIndex];
    }

    records.push(normalized);
    records.sort(compareEvidenceAscending);
    this.recordsByWorkspace.set(normalized.workspaceId, this.applyRetention(records));
    await this.enqueueWrite(normalized.workspaceId);
    this.options.onRecordsAppended?.(normalized.workspaceId, [normalized]);
    return normalized;
  }

  async appendMany(
    records: readonly TaskEvidenceRecord[],
    options: { readonly deferPersistence?: boolean } = {},
  ): Promise<readonly TaskEvidenceRecord[]> {
    const appended: TaskEvidenceRecord[] = [];
    const grouped = new Map<string, TaskEvidenceRecord[]>();

    for (const candidate of records) {
      const normalized = this.normalizeRecord(candidate, candidate.workspaceId);
      if (!normalized) continue;
      const workspaceRecords = grouped.get(normalized.workspaceId) ?? [];
      workspaceRecords.push(normalized);
      grouped.set(normalized.workspaceId, workspaceRecords);
    }

    for (const [workspaceId, candidates] of grouped) {
      await this.ensureLoaded(workspaceId);
      const current = this.recordsByWorkspace.get(workspaceId) ?? [];
      const indexById = new Map(current.map((record, index) => [record.id, index] as const));
      const changed: TaskEvidenceRecord[] = [];
      for (const record of candidates) {
        const existingIndex = indexById.get(record.id);
        if (existingIndex === undefined) {
          indexById.set(record.id, current.length);
          current.push(record);
          changed.push(record);
          continue;
        }
        const existing = current[existingIndex];
        if (existing?.status === "running" && record.status === "running") {
          current[existingIndex] = record;
          changed.push(record);
        }
      }
      if (changed.length === 0) continue;
      current.sort(compareEvidenceAscending);
      this.recordsByWorkspace.set(workspaceId, this.applyRetention(current));
      if (options.deferPersistence) {
        this.scheduleWrite(workspaceId);
      } else {
        await this.enqueueWrite(workspaceId);
      }
      appended.push(...changed);
      this.options.onRecordsAppended?.(workspaceId, changed);
    }

    return appended;
  }

  async query(input: TaskEvidenceQuery): Promise<TaskEvidencePage> {
    await this.ensureLoaded(input.workspaceId);
    this.touchWorkspace(input.workspaceId);
    const limit = Math.min(positiveInteger(input.limit, DEFAULT_QUERY_LIMIT), MAX_QUERY_LIMIT);
    const kinds = input.kinds ? new Set<TaskEvidenceKind>(input.kinds) : undefined;
    const sinceMs = parseOptionalTime(input.since);
    const beforeMs = parseOptionalTime(input.before);
    const matching = (this.recordsByWorkspace.get(input.workspaceId) ?? [])
      .filter((record) => (
        (!input.sessionId || record.sessionId === input.sessionId)
        && (!input.runId || record.runId === input.runId)
        && (!kinds || kinds.has(record.kind))
        && (sinceMs === undefined || Date.parse(record.timestamp) >= sinceMs)
        && (beforeMs === undefined || Date.parse(record.timestamp) < beforeMs)
      ))
      .sort(compareEvidenceDescending);
    const records = matching.slice(0, limit);

    return {
      records,
      ...(input.compact ? { groups: compactTaskEvidence([...records].reverse()) } : {}),
      hasMore: matching.length > records.length,
      ...(records[0] ? { newestTimestamp: records[0].timestamp } : {}),
      ...(records.at(-1) ? { oldestTimestamp: records.at(-1)?.timestamp } : {}),
    };
  }

  async flush(): Promise<void> {
    for (const [workspaceId, timer] of this.writeTimers) {
      clearTimeout(timer);
      this.writeTimers.delete(workspaceId);
    }
    await Promise.all([...this.dirtyWorkspaces].map((workspaceId) => this.enqueueWrite(workspaceId)));
    await Promise.all(this.writeQueues.values());
    this.pruneResidentWorkspaces();
  }

  getResidentWorkspaceCount(): number {
    return this.recordsByWorkspace.size;
  }

  private async ensureLoaded(workspaceId: string): Promise<void> {
    if (this.recordsByWorkspace.has(workspaceId)) {
      this.touchWorkspace(workspaceId);
      return;
    }
    const existing = this.loadPromises.get(workspaceId);
    if (existing) return existing;

    const loading = this.loadWorkspace(workspaceId);
    this.loadPromises.set(workspaceId, loading);
    try {
      await loading;
    } finally {
      this.loadPromises.delete(workspaceId);
    }
  }

  private async loadWorkspace(workspaceId: string): Promise<void> {
    const raw = await this.fileStore.read(workspaceId);
    const records = normalizePersistedLedger(raw, workspaceId)
      .map((record) => this.normalizeRecord(record, workspaceId))
      .filter((record): record is TaskEvidenceRecord => record !== undefined)
      .sort(compareEvidenceAscending);
    this.recordsByWorkspace.set(workspaceId, this.applyRetention(records));
    this.touchWorkspace(workspaceId);
    this.pruneResidentWorkspaces();
  }

  private enqueueWrite(workspaceId: string): Promise<void> {
    const pendingTimer = this.writeTimers.get(workspaceId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.writeTimers.delete(workspaceId);
    }
    this.dirtyWorkspaces.delete(workspaceId);
    const previous = this.writeQueues.get(workspaceId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const records = this.recordsByWorkspace.get(workspaceId) ?? [];
        await this.fileStore.write(workspaceId, {
          schemaVersion: LEDGER_STORE_SCHEMA_VERSION,
          workspaceId,
          updatedAt: this.now().toISOString(),
          records,
        } satisfies PersistedTaskEvidenceLedger);
      })
      .finally(() => {
        if (this.writeQueues.get(workspaceId) === next) {
          this.writeQueues.delete(workspaceId);
        }
        this.pruneResidentWorkspaces();
      });
    this.writeQueues.set(workspaceId, next);
    return next;
  }

  private scheduleWrite(workspaceId: string): void {
    this.dirtyWorkspaces.add(workspaceId);
    if (this.writeTimers.has(workspaceId)) {
      return;
    }
    const timer = setTimeout(() => {
      this.writeTimers.delete(workspaceId);
      void this.enqueueWrite(workspaceId);
    }, DEFAULT_WRITE_DEBOUNCE_MS);
    timer.unref?.();
    this.writeTimers.set(workspaceId, timer);
  }

  private applyRetention(records: readonly TaskEvidenceRecord[]): TaskEvidenceRecord[] {
    const cutoff = this.now().getTime() - this.maxAgeMs;
    const retained = records.filter((record) => {
      const timestamp = Date.parse(record.timestamp);
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    });
    return retained.slice(Math.max(0, retained.length - this.maxRecords));
  }

  private touchWorkspace(workspaceId: string): void {
    this.workspaceAccessOrder.delete(workspaceId);
    this.workspaceAccessOrder.set(workspaceId, true);
  }

  private pruneResidentWorkspaces(): void {
    if (this.recordsByWorkspace.size <= this.maxResidentWorkspaces) return;
    for (const workspaceId of this.workspaceAccessOrder.keys()) {
      if (this.recordsByWorkspace.size <= this.maxResidentWorkspaces) break;
      if (
        this.dirtyWorkspaces.has(workspaceId)
        || this.writeTimers.has(workspaceId)
        || this.writeQueues.has(workspaceId)
      ) {
        continue;
      }
      this.recordsByWorkspace.delete(workspaceId);
      this.workspaceAccessOrder.delete(workspaceId);
    }
  }

  private normalizeRecord(
    candidate: TaskEvidenceRecord,
    expectedWorkspaceId: string,
  ): TaskEvidenceRecord | undefined {
    if (!isTaskEvidenceRecord(candidate) || candidate.workspaceId !== expectedWorkspaceId) {
      return undefined;
    }

    const workspacePath = this.options.workspacePath?.(candidate.workspaceId);
    const sanitize = (value: string) => sanitizeEvidenceText(value, this.options.homePath);
    return {
      ...candidate,
      summary: sanitize(candidate.summary).slice(0, MAX_SUMMARY_LENGTH),
      ...(candidate.fileChange ? {
        fileChange: {
          ...candidate.fileChange,
          path: sanitizeEvidencePath(candidate.fileChange.path, workspacePath, this.options.homePath),
          ...(candidate.fileChange.renamedFrom ? {
            renamedFrom: sanitizeEvidencePath(
              candidate.fileChange.renamedFrom,
              workspacePath,
              this.options.homePath,
            ),
          } : {}),
        },
      } : {}),
      ...(candidate.verification ? {
        verification: {
          ...candidate.verification,
          ...(candidate.verification.command ? {
            command: sanitize(candidate.verification.command),
          } : {}),
          ...(candidate.verification.cwd ? {
            cwd: sanitizeEvidencePath(candidate.verification.cwd, workspacePath, this.options.homePath),
          } : {}),
          ...(candidate.verification.relatedPaths ? {
            relatedPaths: candidate.verification.relatedPaths.map((path) =>
              sanitizeEvidencePath(path, workspacePath, this.options.homePath)),
          } : {}),
        },
      } : {}),
      ...(candidate.artifact?.path ? {
        artifact: {
          ...candidate.artifact,
          path: sanitizeEvidencePath(candidate.artifact.path, workspacePath, this.options.homePath),
        },
      } : {}),
      ...(candidate.completion ? {
        completion: {
          ...candidate.completion,
          ...(candidate.completion.checkoutPath ? {
            checkoutPath: sanitizeEvidencePath(
              candidate.completion.checkoutPath,
              workspacePath,
              this.options.homePath,
            ),
          } : {}),
          ...(candidate.completion.changedPaths ? {
            changedPaths: candidate.completion.changedPaths.map((path) =>
              sanitizeEvidencePath(path, workspacePath, this.options.homePath)),
          } : {}),
        },
      } : {}),
    };
  }
}

function normalizePersistedLedger(raw: unknown, workspaceId: string): readonly TaskEvidenceRecord[] {
  if (!isObject(raw)) return [];
  if (raw.schemaVersion !== LEDGER_STORE_SCHEMA_VERSION) return [];
  if (raw.workspaceId !== workspaceId || !Array.isArray(raw.records)) return [];
  return raw.records.filter(isTaskEvidenceRecord);
}

function isTaskEvidenceRecord(value: unknown): value is TaskEvidenceRecord {
  if (!isObject(value) || value.schemaVersion !== TASK_EVIDENCE_SCHEMA_VERSION) return false;
  return (
    nonEmptyString(value.id)
    && nonEmptyString(value.sessionId)
    && nonEmptyString(value.workspaceId)
    && nonEmptyString(value.timestamp)
    && Number.isFinite(Date.parse(value.timestamp))
    && nonEmptyString(value.kind)
    && nonEmptyString(value.source)
    && nonEmptyString(value.authority)
    && nonEmptyString(value.summary)
  );
}

function sanitizeEvidenceText(value: string, homePath?: string): string {
  return sanitizeContextDisplayValue(value, { homePath })
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*["']?[^"',\s)]+/gi, "$1=[redacted]")
    .replace(/(?:\/Users|\/private|\/var|\/tmp|\/Volumes|[A-Za-z]:\\)[^\s"',)]+/g, "[path]");
}

function sanitizeEvidencePath(
  value: string,
  workspacePath?: string,
  homePath?: string,
): string {
  if (!isAbsolute(value)) return sanitizeEvidenceText(value, homePath);
  if (workspacePath) {
    const relativePath = relative(workspacePath, value);
    if (relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)) {
      return relativePath;
    }
    if (relativePath === "") return ".";
  }
  if (homePath) {
    const relativeHomePath = relative(homePath, value);
    if (relativeHomePath && !relativeHomePath.startsWith("..") && !isAbsolute(relativeHomePath)) {
      return `~/${relativeHomePath}`;
    }
  }
  const leaf = basename(value);
  return leaf ? `[path]/${leaf}` : "[path]";
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseOptionalTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compareEvidenceAscending(left: TaskEvidenceRecord, right: TaskEvidenceRecord): number {
  return Date.parse(left.timestamp) - Date.parse(right.timestamp) || left.id.localeCompare(right.id);
}

function compareEvidenceDescending(left: TaskEvidenceRecord, right: TaskEvidenceRecord): number {
  return compareEvidenceAscending(right, left);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
