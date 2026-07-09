import type { SessionDriverEvent } from "@pi-gui/session-driver";
import { access } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { DesktopAppStore } from "./app-store";
import { JsonFileStore } from "./json-file-store";
import {
  buildSubagentWorkflowMessageMetadata,
  buildSubagentWorkflowPrompt,
  type RunSubagentWorkflowInput,
  type SubagentRunRecord,
  type SubagentWorkflowTemplate,
} from "../src/subagent-workflows";

const LIVE_ARTIFACT_SCAN_INTERVAL_MS = 750;

export class SubagentRunStore {
  private readonly runStore: JsonFileStore<readonly SubagentRunRecord[]>;
  private readonly loadedWorkspaces = new Set<string>();
  private readonly runsByWorkspace = new Map<string, SubagentRunRecord[]>();
  private readonly artifactScanIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private readonly artifactScansInFlight = new Set<string>();

  constructor(
    userDataDir: string,
    private readonly onRunsChanged?: (workspaceId: string) => void,
  ) {
    this.runStore = new JsonFileStore<readonly SubagentRunRecord[]>(userDataDir, "subagent-runs");
  }

  dispose(): void {
    for (const interval of this.artifactScanIntervals.values()) {
      clearInterval(interval);
    }
    this.artifactScanIntervals.clear();
    this.artifactScansInFlight.clear();
  }

  async listRuns(workspaceId: string, workspacePath?: string): Promise<readonly SubagentRunRecord[]> {
    await this.loadWorkspace(workspaceId);
    if (workspacePath) {
      await this.applyWorkspacePath(workspaceId, workspacePath);
    }
    await this.refreshArtifactPathsForWorkspace(workspaceId);
    this.refreshLiveArtifactScan(workspaceId);
    return this.getRuns(workspaceId)
      .filter((run) => run.workspaceId === workspaceId)
      .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
  }

  async runWorkflow(
    store: DesktopAppStore,
    input: RunSubagentWorkflowInput,
    workflow: SubagentWorkflowTemplate,
  ): Promise<readonly SubagentRunRecord[]> {
    await this.loadWorkspace(input.target.workspaceId);
    const queuedAtSubmission = store.sessionFromState(input.target)?.status === "running";
    const workspacePath = store.getWorkspacePath(input.target.workspaceId);
    const workflowRunId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const baseRun = {
      id: workflowRunId,
      workflowRunId,
      workflowId: workflow.id,
      title: workflow.title,
      workspaceId: input.target.workspaceId,
      ...(workspacePath ? { workspacePath } : {}),
      target: input.target,
      roles: workflow.roles,
      artifacts: workflow.artifacts,
      submittedAt: new Date().toISOString(),
      ...(queuedAtSubmission ? { queuedAtSubmission } : {}),
    } satisfies Omit<SubagentRunRecord, "status" | "error">;

    const submittedRun = { ...baseRun, status: "submitted" } satisfies SubagentRunRecord;
    const workspaceRuns = this.getRuns(input.target.workspaceId);
    workspaceRuns.unshift(submittedRun);
    await this.persistWorkspace(input.target.workspaceId);
    this.refreshLiveArtifactScan(input.target.workspaceId);
    void store
      .submitComposerToSession(input.target, buildSubagentWorkflowPrompt(workflow, input.userInstruction, workflowRunId), {
        deliverAs: "followUp",
        messageMetadata: buildSubagentWorkflowMessageMetadata(workflow, workflowRunId),
      })
      .then((state) => {
        if (state.lastError) {
          void this.replaceRun(input.target.workspaceId, submittedRun.id, {
            ...submittedRun,
            status: "failed",
            error: state.lastError,
          });
        }
      })
      .catch((error: unknown) => {
        void this.replaceRun(input.target.workspaceId, submittedRun.id, {
          ...submittedRun,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return this.listRuns(input.target.workspaceId);
  }

  async cancelRun(store: DesktopAppStore, workspaceId: string, runId: string): Promise<readonly SubagentRunRecord[]> {
    await this.loadWorkspace(workspaceId);
    const runs = this.getRuns(workspaceId);
    const run = runs.find((entry) => entry.id === runId);
    if (!run || run.workspaceId !== workspaceId) {
      throw new Error("Subagent workflow run was not found.");
    }
    if (isTerminalSubagentRun(run)) {
      return this.listRuns(workspaceId, store.getWorkspacePath(workspaceId));
    }

    await store.cancelSessionRun(run.target);
    const timestamp = new Date().toISOString();
    await this.replaceRun(workspaceId, run.id, await attachExistingArtifactPaths({
      ...run,
      status: "cancelled",
      updatedAt: timestamp,
      completedAt: timestamp,
      error: "Cancelled by user.",
    }));
    this.refreshLiveArtifactScan(workspaceId);
    this.onRunsChanged?.(workspaceId);
    return this.listRuns(workspaceId, store.getWorkspacePath(workspaceId));
  }

  async applySessionEvent(event: SessionDriverEvent): Promise<string | undefined> {
    if (event.type === "runCompleted" || event.type === "runFailed") {
      return this.applyParentRunFinished(event);
    }

    if (event.type !== "subagentRunUpdated") {
      return undefined;
    }

    const workspaceId = event.parentSession.workspaceId;
    await this.loadWorkspace(workspaceId);
    const runs = this.getRuns(workspaceId);
    const exactIndex = runs.findIndex((run) => matchesLifecycleRun(run, event));
    const index = exactIndex >= 0 ? exactIndex : runs.findIndex((run) => matchesPendingRun(run, event));
    if (index === -1) {
      return undefined;
    }

    const current = runs[index];
    if (!current) {
      return undefined;
    }

    runs[index] = await attachExistingArtifactPaths(applyLifecycleEventToRun(current, event));
    await this.persistWorkspace(workspaceId);
    this.refreshLiveArtifactScan(workspaceId);
    return workspaceId;
  }

  private async applyParentRunFinished(event: Extract<SessionDriverEvent, { type: "runCompleted" | "runFailed" }>): Promise<string | undefined> {
    const workspaceId = event.sessionRef.workspaceId;
    await this.loadWorkspace(workspaceId);
    const runs = this.getRuns(workspaceId);
    let changed = false;
    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index];
      if (!run || !isSubmittedDirectWorkflowRun(run, event.sessionRef)) {
        continue;
      }
      runs[index] = failRunWithoutObservedAgent(run, event);
      changed = true;
    }
    if (!changed) {
      return undefined;
    }
    await this.persistWorkspace(workspaceId);
    this.refreshLiveArtifactScan(workspaceId);
    return workspaceId;
  }

  private async loadWorkspace(workspaceId: string): Promise<void> {
    if (this.loadedWorkspaces.has(workspaceId)) {
      return;
    }
    this.loadedWorkspaces.add(workspaceId);
    this.runsByWorkspace.set(workspaceId, normalizeRuns(await this.runStore.read(workspaceId), workspaceId));
  }

  private getRuns(workspaceId: string): SubagentRunRecord[] {
    const existing = this.runsByWorkspace.get(workspaceId);
    if (existing) {
      return existing;
    }
    const next: SubagentRunRecord[] = [];
    this.runsByWorkspace.set(workspaceId, next);
    return next;
  }

  private async persistWorkspace(workspaceId: string): Promise<void> {
    await this.runStore.write(workspaceId, this.getRuns(workspaceId));
  }

  private async replaceRun(workspaceId: string, runId: string, nextRun: SubagentRunRecord): Promise<void> {
    const runs = this.getRuns(workspaceId);
    const index = runs.findIndex((run) => run.id === runId);
    if (index === -1) {
      return;
    }
    runs[index] = nextRun;
    await this.persistWorkspace(workspaceId);
  }

  private async applyWorkspacePath(workspaceId: string, workspacePath: string): Promise<void> {
    const runs = this.getRuns(workspaceId);
    let changed = false;
    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index];
      if (!run || run.workspacePath) {
        continue;
      }
      runs[index] = { ...run, workspacePath };
      changed = true;
    }
    if (changed) {
      await this.persistWorkspace(workspaceId);
    }
  }

  private async refreshArtifactPathsForWorkspace(workspaceId: string): Promise<void> {
    const runs = this.getRuns(workspaceId);
    let changed = false;
    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index];
      if (!run) {
        continue;
      }
      const nextRun = await attachExistingArtifactPaths(run);
      if (nextRun !== run) {
        runs[index] = nextRun;
        changed = true;
      }
    }
    if (changed) {
      await this.persistWorkspace(workspaceId);
    }
  }

  private refreshLiveArtifactScan(workspaceId: string): void {
    if (!this.hasMissingActiveArtifacts(workspaceId)) {
      this.stopLiveArtifactScan(workspaceId);
      return;
    }
    if (this.artifactScanIntervals.has(workspaceId)) {
      return;
    }
    const scan = () => {
      void this.scanLiveArtifacts(workspaceId).catch(() => undefined);
    };
    this.artifactScanIntervals.set(workspaceId, setInterval(scan, LIVE_ARTIFACT_SCAN_INTERVAL_MS));
    scan();
  }

  private stopLiveArtifactScan(workspaceId: string): void {
    const interval = this.artifactScanIntervals.get(workspaceId);
    if (!interval) {
      return;
    }
    clearInterval(interval);
    this.artifactScanIntervals.delete(workspaceId);
    this.artifactScansInFlight.delete(workspaceId);
  }

  private async scanLiveArtifacts(workspaceId: string): Promise<void> {
    if (this.artifactScansInFlight.has(workspaceId)) {
      return;
    }
    this.artifactScansInFlight.add(workspaceId);
    try {
      const runs = this.getRuns(workspaceId);
      let changed = false;
      for (let index = 0; index < runs.length; index += 1) {
        const run = runs[index];
        if (!run || !isActiveArtifactRun(run)) {
          continue;
        }
        const nextRun = await attachExistingArtifactPaths(run);
        if (nextRun !== run) {
          runs[index] = nextRun;
          changed = true;
        }
      }
      if (changed) {
        await this.persistWorkspace(workspaceId);
        this.onRunsChanged?.(workspaceId);
      }
      if (!this.hasMissingActiveArtifacts(workspaceId)) {
        this.stopLiveArtifactScan(workspaceId);
      }
    } finally {
      this.artifactScansInFlight.delete(workspaceId);
    }
  }

  private hasMissingActiveArtifacts(workspaceId: string): boolean {
    return this.getRuns(workspaceId).some((run) => isActiveArtifactRun(run) && runHasMissingDeclaredArtifact(run));
  }
}

function normalizeRuns(value: readonly SubagentRunRecord[] | undefined, workspaceId: string): SubagentRunRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((run): run is SubagentRunRecord => (
    typeof run?.id === "string" &&
    typeof run.workflowId === "string" &&
    typeof run.title === "string" &&
    run.workspaceId === workspaceId &&
    typeof run.target?.workspaceId === "string" &&
    typeof run.target?.sessionId === "string" &&
    isSubagentRunStatus(run.status) &&
    Array.isArray(run.roles) &&
    Array.isArray(run.artifacts) &&
    typeof run.submittedAt === "string"
  ));
}

function isSubagentRunStatus(value: unknown): value is SubagentRunRecord["status"] {
  return value === "submitted" || value === "running" || value === "completed" || value === "failed" || value === "cancelled";
}

function isTerminalSubagentRun(run: SubagentRunRecord): boolean {
  return run.status === "completed" || run.status === "failed" || run.status === "cancelled";
}

function matchesLifecycleRun(run: SubagentRunRecord, event: Extract<SessionDriverEvent, { type: "subagentRunUpdated" }>): boolean {
  return run.workspaceId === event.parentSession.workspaceId &&
    run.target.sessionId === event.parentSession.sessionId &&
    (run.lifecycleRunId === event.subagentRunId || run.toolCallId === event.toolCallId);
}

function matchesPendingRun(run: SubagentRunRecord, event: Extract<SessionDriverEvent, { type: "subagentRunUpdated" }>): boolean {
  if (run.workspaceId !== event.parentSession.workspaceId || run.target.sessionId !== event.parentSession.sessionId) {
    return false;
  }
  if (run.status !== "submitted" && run.status !== "running") {
    return false;
  }
  const role = event.role?.trim();
  return !role || run.roles.some((runRole) => baseRole(runRole) === baseRole(role));
}

function applyLifecycleEventToRun(
  run: SubagentRunRecord,
  event: Extract<SessionDriverEvent, { type: "subagentRunUpdated" }>,
): SubagentRunRecord {
  const status = statusForLifecycleEvent(event.status);
  return {
    ...run,
    status,
    updatedAt: event.timestamp,
    lifecycleRunId: event.subagentRunId,
    ...(event.toolCallId !== undefined ? { toolCallId: event.toolCallId } : {}),
    ...(event.status === "started" && run.startedAt === undefined ? { startedAt: event.timestamp } : {}),
    ...(status === "completed" || status === "failed" || status === "cancelled" ? { completedAt: event.timestamp } : {}),
    ...(event.toolUseCount !== undefined ? { toolUseCount: event.toolUseCount } : {}),
    ...(event.elapsedMs !== undefined ? { elapsedMs: event.elapsedMs } : {}),
    ...(event.summary !== undefined ? { summary: event.summary } : {}),
    ...(event.transcriptPath !== undefined ? { transcriptPath: event.transcriptPath } : {}),
    ...(event.artifacts !== undefined ? { artifactPaths: event.artifacts } : {}),
    ...(status === "failed" && event.summary ? { error: event.summary } : {}),
  };
}

async function attachExistingArtifactPaths(run: SubagentRunRecord): Promise<SubagentRunRecord> {
  if (!run.workspacePath || run.artifacts.length === 0) {
    return run;
  }

  const detected: string[] = [];
  for (const artifact of run.artifacts) {
    const resolved = resolveDeclaredArtifactPath(run.workspacePath, artifact);
    if (!resolved) {
      continue;
    }
    try {
      await access(resolved.absolutePath);
      detected.push(resolved.displayPath);
    } catch {
      // Best effort: artifact discovery should never affect lifecycle updates.
    }
  }

  if (detected.length === 0) {
    return run;
  }
  const artifactPaths = uniqueStrings([...(run.artifactPaths ?? []), ...detected]);
  return artifactPaths.length === (run.artifactPaths?.length ?? 0)
    ? run
    : { ...run, artifactPaths };
}

function resolveDeclaredArtifactPath(
  workspacePath: string,
  artifactPath: string,
): { readonly absolutePath: string; readonly displayPath: string } | undefined {
  const displayPath = artifactPath.trim();
  if (!displayPath || isAbsolute(displayPath)) {
    return undefined;
  }
  const workspaceRoot = resolve(workspacePath);
  const absolutePath = resolve(workspaceRoot, displayPath);
  const relativePath = relative(workspaceRoot, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return undefined;
  }
  return { absolutePath, displayPath };
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function isActiveArtifactRun(run: SubagentRunRecord): boolean {
  return (run.status === "submitted" || run.status === "running") && Boolean(run.workspacePath) && run.artifacts.length > 0;
}

function runHasMissingDeclaredArtifact(run: SubagentRunRecord): boolean {
  const existing = new Set(run.artifactPaths ?? []);
  return run.artifacts.some((artifact) => {
    if (!run.workspacePath) {
      return false;
    }
    const resolved = resolveDeclaredArtifactPath(run.workspacePath, artifact);
    return resolved !== undefined && !existing.has(resolved.displayPath);
  });
}

function isSubmittedDirectWorkflowRun(run: SubagentRunRecord, sessionRef: SessionDriverEvent["sessionRef"]): boolean {
  return run.workspaceId === sessionRef.workspaceId &&
    run.target.sessionId === sessionRef.sessionId &&
    run.status === "submitted" &&
    !run.queuedAtSubmission;
}

function failRunWithoutObservedAgent(
  run: SubagentRunRecord,
  event: Extract<SessionDriverEvent, { type: "runCompleted" | "runFailed" }>,
): SubagentRunRecord {
  const error = event.type === "runFailed"
    ? `Workflow turn failed before invoking the Agent tool: ${event.error.message}`
    : "Workflow finished without invoking the Agent tool.";
  return {
    ...run,
    status: "failed",
    updatedAt: event.timestamp,
    completedAt: event.timestamp,
    error,
  };
}

function statusForLifecycleEvent(status: Extract<SessionDriverEvent, { type: "subagentRunUpdated" }>["status"]): SubagentRunRecord["status"] {
  if (status === "started" || status === "progress") return "running";
  return status;
}

function baseRole(role: string): string {
  return role.split("/", 1)[0]?.trim() || role.trim();
}
