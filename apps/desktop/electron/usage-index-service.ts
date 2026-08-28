import { open, stat } from "node:fs/promises";
import type { SessionCatalogEntry } from "@pi-gui/catalogs";
import type {
  UsageBucket,
  UsageCostKind,
  UsageDashboardSnapshot,
  UsageQuery,
  UsageRecord,
} from "../src/usage-types";
import { JsonFileStore } from "./json-file-store";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const RETENTION_DAYS = 90;
const INDEX_BYTE_LIMIT = 16 * 1024 * 1024;
const MAX_RECORDS = 100_000;
const READ_CHUNK_BYTES = 256 * 1024;
const MAX_LINE_BYTES = 2 * 1024 * 1024;
const MAX_SCAN_BYTES_PER_FILE = 64 * 1024 * 1024;

interface UsageFileState {
  readonly size: number;
  readonly modifiedAtMs: number;
  readonly offset: number;
  readonly provider?: string;
  readonly model?: string;
  readonly turnId?: string;
}

interface PersistedUsageIndex {
  readonly version: 1;
  readonly records: readonly UsageRecord[];
  readonly files: Readonly<Record<string, UsageFileState>>;
  readonly indexedAt: string;
  readonly prunedRecordCount: number;
}

interface MutableUsageIndex {
  records: UsageRecord[];
  files: Record<string, UsageFileState>;
  indexedAt: string;
  prunedRecordCount: number;
}

interface ScanResult {
  readonly records: readonly UsageRecord[];
  readonly offset: number;
  readonly provider?: string;
  readonly model?: string;
  readonly turnId?: string;
  readonly partial: boolean;
}

export class UsageIndexService {
  private readonly store: JsonFileStore<PersistedUsageIndex>;
  private state?: MutableUsageIndex;
  private refreshPromise?: Promise<{ scanned: number; unchanged: number; partial: boolean }>;

  constructor(
    userDataDir: string,
    private readonly listSessions: () => Promise<{ readonly sessions: readonly SessionCatalogEntry[] }>,
  ) {
    this.store = new JsonFileStore<PersistedUsageIndex>(userDataDir, "usage-index");
  }

  async getDashboard(query: UsageQuery, forceRefresh = false): Promise<UsageDashboardSnapshot> {
    validateQuery(query);
    const refresh = await this.refresh(forceRefresh);
    const state = await this.load();
    const now = Date.now();
    const threshold = query.window === "task"
      ? now - RETENTION_MS
      : now - windowDuration(query.window);
    const matching = state.records.filter((record) => (
      Date.parse(record.createdAt) >= threshold
      && (!query.workspaceId || record.workspaceId === query.workspaceId)
      && (!query.sessionId || record.sessionId === query.sessionId)
      && (!query.provider || record.provider === query.provider)
      && (!query.model || `${record.provider}:${record.model}` === query.model)
      && (query.window !== "task" || !query.sessionId || record.sessionId === query.sessionId)
    ));
    const snapshot = buildUsageDashboard(matching, query, state.indexedAt);
    return {
      ...snapshot,
      sourceFileCount: Object.keys(state.files).length,
      scannedFileCount: refresh.scanned,
      unchangedFileCount: refresh.unchanged,
      prunedRecordCount: state.prunedRecordCount,
      indexBytes: Buffer.byteLength(JSON.stringify(toPersisted(state)), "utf8"),
      indexByteLimit: INDEX_BYTE_LIMIT,
      retentionDays: RETENTION_DAYS,
      partial: refresh.partial,
      notes: [
        "Historical usage comes from Pi-owned assistant and compaction records and is deduplicated by stable session entry ID.",
        "Provider-reported cost is not a bill. Subscription usage and unpriced usage are kept separate; unknown models still count tokens.",
        ...(refresh.partial ? ["One or more unusually large files will continue indexing on the next refresh."] : []),
      ],
    };
  }

  async refresh(force = false): Promise<{ scanned: number; unchanged: number; partial: boolean }> {
    if (this.refreshPromise && !force) return this.refreshPromise;
    if (this.refreshPromise) await this.refreshPromise;
    const promise = this.runRefresh().finally(() => {
      if (this.refreshPromise === promise) this.refreshPromise = undefined;
    });
    this.refreshPromise = promise;
    return promise;
  }

  private async runRefresh(): Promise<{ scanned: number; unchanged: number; partial: boolean }> {
    const state = await this.load();
    const catalog = await this.listSessions();
    const recordIds = new Set(state.records.map((record) => record.id));
    let scanned = 0;
    let unchanged = 0;
    let partial = false;
    for (const session of catalog.sessions) {
      if (!session.sessionFilePath) continue;
      const key = fileKey(session.workspaceId, session.sessionRef.sessionId);
      let metadata;
      try {
        metadata = await stat(session.sessionFilePath);
      } catch {
        continue;
      }
      if (!metadata.isFile()) continue;
      const previous = state.files[key];
      if (previous && previous.size === metadata.size && previous.modifiedAtMs === metadata.mtimeMs && previous.offset >= metadata.size) {
        unchanged += 1;
        continue;
      }
      let offset = previous?.offset ?? 0;
      let provider = previous?.provider ?? session.config?.provider;
      let model = previous?.model ?? session.config?.modelId;
      let turnId = previous?.turnId;
      if (!previous || metadata.size < previous.offset || (metadata.size === previous.size && metadata.mtimeMs !== previous.modifiedAtMs)) {
        state.records = state.records.filter((record) => record.workspaceId !== session.workspaceId || record.sessionId !== session.sessionRef.sessionId);
        for (const id of [...recordIds]) {
          if (id.startsWith(`${session.workspaceId}:${session.sessionRef.sessionId}:`)) recordIds.delete(id);
        }
        offset = 0;
        provider = session.config?.provider;
        model = session.config?.modelId;
        turnId = undefined;
      }
      const result = await scanUsageFile(session.sessionFilePath, offset, {
        workspaceId: session.workspaceId,
        sessionId: session.sessionRef.sessionId,
        provider,
        model,
        turnId,
      });
      for (const record of result.records) {
        if (!recordIds.has(record.id)) {
          recordIds.add(record.id);
          state.records.push(record);
        }
      }
      state.files[key] = {
        size: metadata.size,
        modifiedAtMs: metadata.mtimeMs,
        offset: result.offset,
        provider: result.provider,
        model: result.model,
        turnId: result.turnId,
      };
      scanned += 1;
      partial ||= result.partial;
    }
    pruneState(state);
    state.indexedAt = new Date().toISOString();
    await this.store.write("global", toPersisted(state));
    return { scanned, unchanged, partial };
  }

  private async load(): Promise<MutableUsageIndex> {
    if (this.state) return this.state;
    const persisted = await this.store.read("global");
    this.state = persisted?.version === 1
      ? {
          records: persisted.records.filter(isUsageRecord).map((record) => ({ ...record })),
          files: { ...persisted.files },
          indexedAt: safeIso(persisted.indexedAt),
          prunedRecordCount: finiteNonNegative(persisted.prunedRecordCount),
        }
      : { records: [], files: {}, indexedAt: new Date(0).toISOString(), prunedRecordCount: 0 };
    pruneState(this.state);
    return this.state;
  }
}

export async function scanUsageFile(
  filePath: string,
  startOffset: number,
  identity: { readonly workspaceId: string; readonly sessionId: string; readonly provider?: string; readonly model?: string; readonly turnId?: string },
): Promise<ScanResult> {
  const handle = await open(filePath, "r");
  let offset = Math.max(0, startOffset);
  let committedOffset = offset;
  let buffer = "";
  let provider = identity.provider;
  let model = identity.model;
  let turnId = identity.turnId;
  let scannedBytes = 0;
  const records: UsageRecord[] = [];
  try {
    while (scannedBytes < MAX_SCAN_BYTES_PER_FILE) {
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, MAX_SCAN_BYTES_PER_FILE - scannedBytes));
      const result = await handle.read(chunk, 0, chunk.length, offset);
      if (result.bytesRead === 0) break;
      scannedBytes += result.bytesRead;
      offset += result.bytesRead;
      buffer += chunk.subarray(0, result.bytesRead).toString("utf8");
      if (Buffer.byteLength(buffer, "utf8") > MAX_LINE_BYTES && !buffer.includes("\n")) {
        throw new Error("Usage index encountered an over-sized session record.");
      }
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        const lineBytes = Buffer.byteLength(buffer.slice(0, newline + 1), "utf8");
        buffer = buffer.slice(newline + 1);
        committedOffset += lineBytes;
        const parsed = parseUsageLine(line, identity.workspaceId, identity.sessionId, provider, model, turnId);
        provider = parsed.provider;
        model = parsed.model;
        turnId = parsed.turnId;
        if (parsed.record) records.push(parsed.record);
        newline = buffer.indexOf("\n");
      }
    }
    return { records, offset: committedOffset, provider, model, turnId, partial: scannedBytes >= MAX_SCAN_BYTES_PER_FILE || buffer.length > 0 };
  } finally {
    await handle.close();
  }
}

export function parseUsageLine(
  line: string,
  workspaceId: string,
  sessionId: string,
  currentProvider?: string,
  currentModel?: string,
  currentTurnId?: string,
): { readonly record?: UsageRecord; readonly provider?: string; readonly model?: string; readonly turnId?: string } {
  if (!line.trim()) return { provider: currentProvider, model: currentModel, turnId: currentTurnId };
  let entry: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(line);
    if (!isRecord(value)) return { provider: currentProvider, model: currentModel, turnId: currentTurnId };
    entry = value;
  } catch {
    return { provider: currentProvider, model: currentModel, turnId: currentTurnId };
  }
  if (entry.type === "model_change") {
    return { provider: optionalString(entry.provider) ?? currentProvider, model: optionalString(entry.modelId) ?? currentModel, turnId: currentTurnId };
  }

  const entryId = optionalString(entry.id);
  if (!entryId) return { provider: currentProvider, model: currentModel, turnId: currentTurnId };
  let usage: Record<string, unknown> | undefined;
  let provider = currentProvider;
  let model = currentModel;
  let turnId = currentTurnId;
  let api: string | undefined;
  let sourceKind: UsageRecord["sourceKind"] | undefined;
  if (entry.type === "message") {
    const message = isRecord(entry.message) ? entry.message : undefined;
    if (message?.role === "user") return { provider, model, turnId: entryId };
    if (message?.role !== "assistant") return { provider, model, turnId };
    usage = isRecord(message.usage) ? message.usage : undefined;
    provider = optionalString(message.provider) ?? provider;
    model = optionalString(message.model) ?? model;
    api = optionalString(message.api);
    sourceKind = "assistant";
  } else if (entry.type === "compaction" || entry.type === "branch_summary") {
    usage = isRecord(entry.usage) ? entry.usage : undefined;
    sourceKind = entry.type === "compaction" ? "compaction" : "branch-summary";
  }
  if (!usage || !sourceKind) return { provider, model, turnId };

  const inputTokens = finiteNonNegative(usage.input);
  const outputTokens = finiteNonNegative(usage.output);
  const cacheReadTokens = finiteNonNegative(usage.cacheRead);
  const cacheWriteTokens = finiteNonNegative(usage.cacheWrite);
  const reasoning = typeof usage.reasoning === "number" && Number.isFinite(usage.reasoning) && usage.reasoning >= 0 ? usage.reasoning : undefined;
  const reportedTotal = finiteNonNegative(usage.totalTokens);
  const totalTokens = reportedTotal || inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const cost = isRecord(usage.cost) ? usage.cost : undefined;
  const reportedCost = cost && typeof cost.total === "number" && Number.isFinite(cost.total) && cost.total >= 0 ? cost.total : undefined;
  const subscription = provider === "openai-codex" || api?.includes("codex") === true;
  const costKind: UsageCostKind = subscription ? "subscription" : reportedCost !== undefined ? "provider-reported" : "unpriced";
  const createdAt = entryTimestamp(entry);
  const record: UsageRecord = {
    id: `${workspaceId}:${sessionId}:${entryId}:${sourceKind}`,
    workspaceId,
    sessionId,
    messageId: entryId,
    ...(turnId ? { turnId } : {}),
    createdAt,
    provider: provider ?? "unknown",
    model: model ?? "unknown",
    inputTokens,
    outputTokens,
    reasoningTokens: reasoning,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    costUsd: reportedCost,
    costKind,
    sourceKind,
  };
  return { record, provider, model, turnId };
}

export function buildUsageDashboard(records: readonly UsageRecord[], query: UsageQuery, indexedAt: string): Omit<UsageDashboardSnapshot, "sourceFileCount" | "scannedFileCount" | "unchangedFileCount" | "prunedRecordCount" | "indexBytes" | "indexByteLimit" | "retentionDays" | "partial" | "notes"> {
  const sorted = [...records].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  const costKinds: Record<UsageCostKind, number> = { "provider-reported": 0, subscription: 0, estimated: 0, unpriced: 0 };
  for (const record of sorted) costKinds[record.costKind] += 1;
  return {
    query,
    totals: aggregateBucket("total", "Total", sorted),
    trend: groupBuckets(sorted, (record) => record.createdAt.slice(0, 10)),
    providers: groupBuckets(sorted, (record) => record.provider),
    models: groupBuckets(sorted, (record) => `${record.provider}:${record.model}`),
    workspaces: groupBuckets(sorted, (record) => record.workspaceId),
    tasks: groupBuckets(sorted, (record) => `${record.workspaceId}:${record.sessionId}`),
    costKinds,
    indexedAt,
    recordCount: sorted.length,
  };
}

function groupBuckets(records: readonly UsageRecord[], keyFor: (record: UsageRecord) => string): UsageBucket[] {
  const grouped = new Map<string, UsageRecord[]>();
  for (const record of records) {
    const key = keyFor(record);
    const current = grouped.get(key) ?? [];
    current.push(record);
    grouped.set(key, current);
  }
  return [...grouped.entries()]
    .map(([key, values]) => aggregateBucket(key, key, values))
    .sort((left, right) => right.totalTokens - left.totalTokens || left.label.localeCompare(right.label));
}

function aggregateBucket(key: string, label: string, records: readonly UsageRecord[]): UsageBucket {
  const assistantTurns = new Set(records.filter((record) => record.sourceKind === "assistant").map((record) => (
    `${record.workspaceId}:${record.sessionId}:${record.turnId ?? `message:${record.messageId}`}`
  ))).size;
  return records.reduce<UsageBucket>((bucket, record) => ({
    ...bucket,
    inputTokens: bucket.inputTokens + record.inputTokens,
    outputTokens: bucket.outputTokens + record.outputTokens,
    reasoningTokens: bucket.reasoningTokens + (record.reasoningTokens ?? 0),
    cacheReadTokens: bucket.cacheReadTokens + record.cacheReadTokens,
    cacheWriteTokens: bucket.cacheWriteTokens + record.cacheWriteTokens,
    totalTokens: bucket.totalTokens + record.totalTokens,
    costUsd: bucket.costUsd + (record.costUsd ?? 0),
    pricedRecords: bucket.pricedRecords + (record.costKind === "provider-reported" || record.costKind === "estimated" ? 1 : 0),
    unpricedRecords: bucket.unpricedRecords + (record.costKind === "unpriced" || record.costKind === "subscription" ? 1 : 0),
  }), { key, label, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costUsd: 0, pricedRecords: 0, unpricedRecords: 0, turns: assistantTurns });
}

function pruneState(state: MutableUsageIndex): void {
  const threshold = Date.now() - RETENTION_MS;
  const before = state.records.length;
  state.records = state.records.filter((record) => Date.parse(record.createdAt) >= threshold).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  if (state.records.length > MAX_RECORDS) state.records.splice(0, state.records.length - MAX_RECORDS);
  while (state.records.length > 0 && Buffer.byteLength(JSON.stringify(toPersisted(state)), "utf8") > INDEX_BYTE_LIMIT) {
    state.records.splice(0, Math.max(1, Math.ceil(state.records.length * 0.05)));
  }
  state.prunedRecordCount += Math.max(0, before - state.records.length);
}

function toPersisted(state: MutableUsageIndex): PersistedUsageIndex {
  return { version: 1, records: state.records, files: state.files, indexedAt: state.indexedAt, prunedRecordCount: state.prunedRecordCount };
}

function isUsageRecord(value: unknown): value is UsageRecord {
  return isRecord(value) && typeof value.id === "string" && typeof value.workspaceId === "string" && typeof value.sessionId === "string" && typeof value.createdAt === "string" && typeof value.totalTokens === "number";
}

function validateQuery(query: UsageQuery): void {
  if (!["task", "24h", "7d", "30d", "90d"].includes(query.window)) throw new Error("Invalid usage window.");
  for (const value of [query.workspaceId, query.sessionId, query.provider, query.model]) if (value && value.length > 1_000) throw new Error("Usage filter is too large.");
}

function windowDuration(window: Exclude<UsageQuery["window"], "task">): number {
  return ({ "24h": 1, "7d": 7, "30d": 30, "90d": 90 } as const)[window] * 24 * 60 * 60 * 1_000;
}

function entryTimestamp(entry: Record<string, unknown>): string {
  if (typeof entry.timestamp === "string" && !Number.isNaN(Date.parse(entry.timestamp))) return new Date(entry.timestamp).toISOString();
  const message = isRecord(entry.message) ? entry.message : undefined;
  if (typeof message?.timestamp === "number" && Number.isFinite(message.timestamp)) return new Date(message.timestamp).toISOString();
  return new Date(0).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function optionalString(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim().slice(0, 1_000) : undefined; }
function finiteNonNegative(value: unknown): number { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0; }
function safeIso(value: unknown): string { return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : new Date(0).toISOString(); }
function fileKey(workspaceId: string, sessionId: string): string { return `${workspaceId}:${sessionId}`; }
