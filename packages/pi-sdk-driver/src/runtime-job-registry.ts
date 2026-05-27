import type {
  RuntimeJobSnapshot,
  RuntimeJobStatus,
  RuntimeProcessSnapshot,
  RuntimeSummarySnapshot,
  RunId,
  SessionRef,
  SessionStatus,
} from "@pi-gui/session-driver";

export interface RuntimeJobRegistryState {
  readonly jobs: Map<string, RuntimeJobSnapshot>;
}

export interface CreateToolRuntimeJobInput {
  readonly sessionRef: SessionRef;
  readonly runId?: RunId;
  readonly toolCallId: string;
  readonly title?: string;
  readonly command?: string;
  readonly cwd?: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly logPaths?: readonly string[];
  readonly artifactPaths?: readonly string[];
  readonly message?: string;
}

export interface CreateBackgroundRuntimeJobInput {
  readonly sessionRef: SessionRef;
  readonly runId?: RunId;
  readonly process: RuntimeProcessSnapshot;
  readonly title?: string;
  readonly logPaths?: readonly string[];
  readonly artifactPaths?: readonly string[];
  readonly message?: string;
}

export interface MarkRuntimeJobFinishedInput {
  readonly status?: RuntimeJobStatus;
  readonly updatedAt: string;
  readonly endedAt?: string;
  readonly exitCode?: number | null;
  readonly signal?: string;
  readonly message?: string;
}

export function createRuntimeJobRegistryState(): RuntimeJobRegistryState {
  return { jobs: new Map() };
}

export function upsertRuntimeJob(state: RuntimeJobRegistryState, job: RuntimeJobSnapshot): RuntimeJobSnapshot {
  const next = cloneJob(mergeJob(state.jobs.get(job.id), job));
  state.jobs.set(next.id, next);
  return cloneJob(next);
}

export function buildRuntimeSummary(state: RuntimeJobRegistryState, agentStatus: SessionStatus): RuntimeSummarySnapshot {
  const jobs = [...state.jobs.values()]
    .map((job) => cloneJob(job))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  let activeToolCount = 0;
  let backgroundJobCount = 0;
  let unknownJobCount = 0;

  for (const job of jobs) {
    if (job.kind === "tool" && job.status === "running") {
      activeToolCount += 1;
    }
    const hasUnknownConfidence = job.confidence === "unknown" || job.confidence === "claimed";
    if (job.status === "unknown" || hasUnknownConfidence) {
      unknownJobCount += 1;
      continue;
    }
    if (job.status === "background" || (job.kind === "background" && job.status === "running")) {
      backgroundJobCount += 1;
    }
  }

  return {
    agentStatus,
    activeToolCount,
    backgroundJobCount,
    unknownJobCount,
    jobs,
  };
}

export function createToolRuntimeJob(input: CreateToolRuntimeJobInput): RuntimeJobSnapshot {
  return cloneJob({
    id: `tool:${input.toolCallId}`,
    sessionRef: { ...input.sessionRef },
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    toolCallId: input.toolCallId,
    kind: "tool",
    status: "running",
    confidence: "tracked",
    title: input.title?.trim() || (input.command ? "Bash" : "Tool"),
    ...(input.command ? { command: input.command } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
    ...(input.logPaths && input.logPaths.length > 0 ? { logPaths: uniqueStrings(input.logPaths) } : {}),
    ...(input.artifactPaths && input.artifactPaths.length > 0 ? { artifactPaths: uniqueStrings(input.artifactPaths) } : {}),
    ...(input.message ? { message: input.message } : {}),
  } satisfies RuntimeJobSnapshot);
}

export function createBackgroundRuntimeJob(input: CreateBackgroundRuntimeJobInput): RuntimeJobSnapshot {
  const process = cloneProcess(input.process);
  return cloneJob({
    id: `process:${input.process.pid}`,
    sessionRef: { ...input.sessionRef },
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    kind: "background",
    status: input.process.status === "running" ? "background" : input.process.status,
    confidence: input.process.confidence,
    title: input.title?.trim() || input.process.command?.trim() || `Process ${input.process.pid}`,
    ...(input.process.command ? { command: input.process.command } : {}),
    ...(input.process.cwd ? { cwd: input.process.cwd } : {}),
    startedAt: input.process.startedAt ?? input.process.updatedAt,
    updatedAt: input.process.updatedAt,
    ...(input.process.exitedAt !== undefined ? { endedAt: input.process.exitedAt } : {}),
    ...(input.process.exitCode !== undefined ? { exitCode: input.process.exitCode } : {}),
    ...(input.process.signal !== undefined ? { signal: input.process.signal } : {}),
    ...(input.logPaths && input.logPaths.length > 0 ? { logPaths: uniqueStrings(input.logPaths) } : {}),
    ...(input.artifactPaths && input.artifactPaths.length > 0 ? { artifactPaths: uniqueStrings(input.artifactPaths) } : {}),
    process,
    ...(input.message ? { message: input.message } : {}),
  } as RuntimeJobSnapshot);
}

export function markRuntimeJobFinished(
  state: RuntimeJobRegistryState,
  id: string,
  input: MarkRuntimeJobFinishedInput,
): RuntimeJobSnapshot | undefined {
  const existing = state.jobs.get(id);
  if (!existing) {
    return undefined;
  }

  const next = cloneJob(
    mergeJob(existing, {
      id: existing.id,
      sessionRef: existing.sessionRef,
      kind: existing.kind,
      confidence: existing.confidence,
      title: existing.title,
      startedAt: existing.startedAt,
      status: input.status ?? existing.status,
      updatedAt: input.updatedAt,
      ...(input.endedAt !== undefined ? { endedAt: input.endedAt } : {}),
      ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
      ...(input.message !== undefined ? { message: input.message } : {}),
    } as RuntimeJobSnapshot),
  );
  state.jobs.set(id, next);
  return cloneJob(next);
}

function mergeJob(existing: RuntimeJobSnapshot | undefined, incoming: RuntimeJobSnapshot): RuntimeJobSnapshot {
  const mergedChildren = uniqueProcesses([...(existing?.children ?? []), ...(incoming.children ?? [])]);
  const mergedLogPaths = uniqueStrings([...(existing?.logPaths ?? []), ...(incoming.logPaths ?? [])]);
  const mergedArtifactPaths = uniqueStrings([...(existing?.artifactPaths ?? []), ...(incoming.artifactPaths ?? [])]);
  const merged: RuntimeJobSnapshot = {
    ...(existing ?? {}),
    ...incoming,
    sessionRef: { ...incoming.sessionRef },
    ...(incoming.runId === undefined && existing?.runId !== undefined ? { runId: existing.runId } : {}),
    ...(incoming.toolCallId === undefined && existing?.toolCallId !== undefined ? { toolCallId: existing.toolCallId } : {}),
    ...(mergedChildren.length > 0 ? { children: mergedChildren } : {}),
    ...(mergedLogPaths.length > 0 ? { logPaths: mergedLogPaths } : {}),
    ...(mergedArtifactPaths.length > 0 ? { artifactPaths: mergedArtifactPaths } : {}),
  } as RuntimeJobSnapshot;

  const process = incoming.process ?? existing?.process;
  if (process) {
    (merged as { process: RuntimeProcessSnapshot }).process = cloneProcess(process)!;
  }

  return merged;
}

function cloneJob(job: RuntimeJobSnapshot): RuntimeJobSnapshot {
  const cloned = {
    id: job.id,
    sessionRef: { ...job.sessionRef },
    ...(job.runId !== undefined ? { runId: job.runId } : {}),
    ...(job.toolCallId !== undefined ? { toolCallId: job.toolCallId } : {}),
    kind: job.kind,
    status: job.status,
    confidence: job.confidence,
    title: job.title,
    ...(job.command !== undefined ? { command: job.command } : {}),
    ...(job.cwd !== undefined ? { cwd: job.cwd } : {}),
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    ...(job.endedAt !== undefined ? { endedAt: job.endedAt } : {}),
    ...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}),
    ...(job.signal !== undefined ? { signal: job.signal } : {}),
    ...(job.logPaths !== undefined ? { logPaths: uniqueStrings(job.logPaths) } : {}),
    ...(job.artifactPaths !== undefined ? { artifactPaths: uniqueStrings(job.artifactPaths) } : {}),
    ...(job.message !== undefined ? { message: job.message } : {}),
  } as RuntimeJobSnapshot & { children?: readonly RuntimeProcessSnapshot[]; process?: RuntimeProcessSnapshot };

  if (job.process !== undefined) {
    cloned.process = cloneProcess(job.process)!;
  }
  if (job.children !== undefined) {
    cloned.children = uniqueProcesses(job.children);
  }

  return cloned;
}

function cloneProcess(process: RuntimeProcessSnapshot | undefined): RuntimeProcessSnapshot | undefined {
  if (!process) return undefined;
  return {
    pid: process.pid,
    ...(process.parentPid !== undefined ? { parentPid: process.parentPid } : {}),
    ...(process.processGroupId !== undefined ? { processGroupId: process.processGroupId } : {}),
    ...(process.command !== undefined ? { command: process.command } : {}),
    ...(process.cwd !== undefined ? { cwd: process.cwd } : {}),
    status: process.status,
    confidence: process.confidence,
    ...(process.startedAt !== undefined ? { startedAt: process.startedAt } : {}),
    updatedAt: process.updatedAt,
    ...(process.exitedAt !== undefined ? { exitedAt: process.exitedAt } : {}),
    ...(process.exitCode !== undefined ? { exitCode: process.exitCode } : {}),
    ...(process.signal !== undefined ? { signal: process.signal } : {}),
  };
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function uniqueProcesses(values: readonly RuntimeProcessSnapshot[]): readonly RuntimeProcessSnapshot[] {
  const seen = new Set<number>();
  const result: RuntimeProcessSnapshot[] = [];
  for (const process of values) {
    if (seen.has(process.pid)) continue;
    seen.add(process.pid);
    const cloned = cloneProcess(process);
    if (cloned) result.push(cloned);
  }
  return result;
}
