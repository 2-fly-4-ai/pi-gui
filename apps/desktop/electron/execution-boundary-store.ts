import { createHash } from "node:crypto";
import {
  EXECUTION_BOUNDARY_SCHEMA_VERSION,
  normalizeExecutionBoundaryInput,
  type ExecutionBoundary,
  type ExecutionBoundaryInput,
} from "../src/product-experience/execution-boundary";
import { JsonFileStore } from "./json-file-store";

interface PersistedExecutionBoundaries {
  readonly schemaVersion: 1;
  readonly workspaceKey: string;
  readonly boundaries: readonly Omit<ExecutionBoundary, "workspaceId">[];
}

export class ExecutionBoundaryStore {
  private readonly files: JsonFileStore<unknown>;
  private readonly cache = new Map<string, ExecutionBoundary[]>();
  private readonly writes = new Map<string, Promise<void>>();

  constructor(userDataDir: string) {
    this.files = new JsonFileStore(userDataDir, "execution-boundaries");
  }

  async get(workspaceId: string, sessionId: string): Promise<ExecutionBoundary> {
    const boundaries = await this.load(workspaceId);
    return boundaries.find((candidate) => candidate.sessionId === sessionId)
      ?? createBoundary(workspaceId, sessionId, { enabled: false });
  }

  async set(
    workspaceId: string,
    sessionId: string,
    input: ExecutionBoundaryInput,
  ): Promise<ExecutionBoundary> {
    const boundaries = await this.load(workspaceId);
    const previous = boundaries.find((candidate) => candidate.sessionId === sessionId);
    const normalized = normalizeExecutionBoundaryInput(input);
    const next = createBoundary(workspaceId, sessionId, normalized, (previous?.revision ?? 0) + 1);
    this.cache.set(workspaceId, [
      ...boundaries.filter((candidate) => candidate.sessionId !== sessionId),
      next,
    ]);
    await this.enqueueWrite(workspaceId);
    return next;
  }

  async flush(): Promise<void> {
    await Promise.all(this.writes.values());
  }

  private async load(workspaceId: string): Promise<ExecutionBoundary[]> {
    const cached = this.cache.get(workspaceId);
    if (cached) return cached;
    const raw = await this.files.read(workspaceKey(workspaceId));
    const boundaries = normalizePersisted(raw, workspaceId);
    this.cache.set(workspaceId, boundaries);
    return boundaries;
  }

  private enqueueWrite(workspaceId: string): Promise<void> {
    const previous = this.writes.get(workspaceId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() =>
      this.files.write(workspaceKey(workspaceId), {
        schemaVersion: 1,
        workspaceKey: workspaceKey(workspaceId),
        boundaries: (this.cache.get(workspaceId) ?? []).map(({ workspaceId: _workspaceId, ...boundary }) => boundary),
      } satisfies PersistedExecutionBoundaries)
    ).finally(() => {
      if (this.writes.get(workspaceId) === next) this.writes.delete(workspaceId);
    });
    this.writes.set(workspaceId, next);
    return next;
  }
}

function createBoundary(
  workspaceId: string,
  sessionId: string,
  input: ExecutionBoundaryInput,
  revision = 0,
): ExecutionBoundary {
  const normalized = normalizeExecutionBoundaryInput(input);
  return {
    schemaVersion: EXECUTION_BOUNDARY_SCHEMA_VERSION,
    workspaceId,
    sessionId,
    enabled: normalized.enabled,
    revision,
    updatedAt: new Date().toISOString(),
    ...(normalized.maxFiles ? { maxFiles: normalized.maxFiles } : {}),
    allowPaths: normalized.allowPaths ?? [],
    denyPaths: normalized.denyPaths ?? [],
    dependencyChanges: normalized.dependencyChanges ?? "approval",
    commandCategories: normalized.commandCategories ?? {},
    testOnly: normalized.testOnly ?? false,
    ...(normalized.maxElapsedMinutes ? { maxElapsedMinutes: normalized.maxElapsedMinutes } : {}),
    toolAccess: normalized.toolAccess ?? { mode: "full", tools: [] },
  };
}

function normalizePersisted(raw: unknown, workspaceId: string): ExecutionBoundary[] {
  if (!raw || typeof raw !== "object") return [];
  const candidate = raw as Partial<PersistedExecutionBoundaries>;
  if (
    candidate.schemaVersion !== 1
    || candidate.workspaceKey !== workspaceKey(workspaceId)
    || !Array.isArray(candidate.boundaries)
  ) {
    return [];
  }
  return candidate.boundaries.flatMap((boundary) => {
    if (
      !boundary
      || typeof boundary !== "object"
      || typeof boundary.sessionId !== "string"
      || !Number.isSafeInteger(boundary.revision)
    ) return [];
    return [createBoundary(workspaceId, boundary.sessionId, boundary, boundary.revision)];
  });
}

function workspaceKey(workspaceId: string): string {
  return createHash("sha256").update(workspaceId).digest("hex");
}
