import type { SessionDriverEvent } from "@pi-gui/session-driver";
import { randomUUID } from "node:crypto";
import { isAbsolute, relative } from "node:path";
import {
  TASK_EVIDENCE_SCHEMA_VERSION,
  type TaskEvidenceRecord,
} from "../src/product-experience/task-evidence";
import type { CheckpointWorkspaceIdentity } from "../src/product-experience/checkpoint-contract";
import type { CheckpointStore } from "./checkpoint-store";
import type { TaskEvidenceLedger } from "./task-evidence-ledger";

interface PendingToolCheckpoint {
  readonly checkpointId: string;
  readonly path: string;
}

export class CheckpointSessionObserver {
  private readonly pendingTools = new Map<string, PendingToolCheckpoint>();
  private readonly capturedPathsByRun = new Map<string, Set<string>>();

  constructor(
    private readonly checkpoints: CheckpointStore,
    private readonly evidence: TaskEvidenceLedger,
    private readonly resolveWorkspace: (
      workspaceId: string,
    ) => CheckpointWorkspaceIdentity | undefined | Promise<CheckpointWorkspaceIdentity | undefined>,
    private readonly createId: () => string = randomUUID,
  ) {}

  async observe(event: SessionDriverEvent): Promise<void> {
    if (event.type === "toolStarted") {
      await this.observeToolStarted(event);
      return;
    }
    if (event.type === "toolFinished") {
      await this.observeToolFinished(event);
      return;
    }
    if (
      event.type === "runCompleted"
      || event.type === "runFailed"
      || event.type === "sessionClosed"
    ) {
      this.capturedPathsByRun.delete(runKey(event));
    }
  }

  private async observeToolStarted(
    event: Extract<SessionDriverEvent, { type: "toolStarted" }>,
  ): Promise<void> {
    if (!isMutatingTool(event.toolName)) return;
    const path = extractPath(event.input);
    if (!path) {
      await this.appendStatus(event, {
        status: "unknown",
        summary: "Checkpoint unavailable: mutating tool did not expose a path",
      });
      return;
    }
    const workspace = await this.resolveWorkspace(event.sessionRef.workspaceId);
    if (!workspace) {
      await this.appendStatus(event, {
        status: "failed",
        summary: "Checkpoint failed: workspace identity is unavailable",
      });
      return;
    }
    const checkpointPath = normalizeToolPath(path, workspace.checkoutPath);
    if (!checkpointPath) {
      await this.appendStatus(event, {
        status: "failed",
        summary: "Checkpoint refused a path outside the active checkout",
      });
      return;
    }
    const run = runKey(event);
    const capturedPaths = this.capturedPathsByRun.get(run) ?? new Set<string>();
    this.capturedPathsByRun.set(run, capturedPaths);
    if (capturedPaths.has(checkpointPath)) return;
    try {
      const checkpoint = await this.checkpoints.create({
        workspace,
        sessionId: event.sessionRef.sessionId,
        ...(event.runId ? { runId: event.runId } : {}),
        reason: "before-run-mutation",
        paths: [{ path: checkpointPath, ownership: "pi" }],
      });
      capturedPaths.add(checkpointPath);
      this.pendingTools.set(toolKey(event), {
        checkpointId: checkpoint.id,
        path: checkpointPath,
      });
      await this.appendStatus(event, {
        status: "passed",
        summary: `Checkpoint created before editing ${checkpointPath}`,
        checkpointId: checkpoint.id,
        path: checkpointPath,
      });
    } catch (error) {
      await this.appendStatus(event, {
        status: "failed",
        summary: `Checkpoint failed before editing ${checkpointPath}: ${safeMessage(error)}`,
        path: checkpointPath,
      });
    }
  }

  private async observeToolFinished(
    event: Extract<SessionDriverEvent, { type: "toolFinished" }>,
  ): Promise<void> {
    const pending = this.pendingTools.get(toolKey(event));
    if (!pending) return;
    this.pendingTools.delete(toolKey(event));
    try {
      await this.checkpoints.finalizeExpectedAfter(pending.checkpointId, pending.path);
      await this.appendStatus(event, {
        status: event.success ? "passed" : "unknown",
        summary: event.success
          ? `Checkpoint finalized for ${pending.path}`
          : `Checkpoint preserved after a failed edit of ${pending.path}`,
        checkpointId: pending.checkpointId,
        path: pending.path,
      });
    } catch (error) {
      await this.appendStatus(event, {
        status: "failed",
        summary: `Checkpoint finalization failed for ${pending.path}: ${safeMessage(error)}`,
        checkpointId: pending.checkpointId,
        path: pending.path,
      });
    }
  }

  private async appendStatus(
    event: SessionDriverEvent,
    input: {
      readonly status: TaskEvidenceRecord["status"];
      readonly summary: string;
      readonly checkpointId?: string;
      readonly path?: string;
    },
  ): Promise<void> {
    await this.evidence.append({
      schemaVersion: TASK_EVIDENCE_SCHEMA_VERSION,
      id: this.createId(),
      workspaceId: event.sessionRef.workspaceId,
      sessionId: event.sessionRef.sessionId,
      ...(event.runId ? { runId: event.runId } : {}),
      timestamp: event.timestamp,
      kind: "checkpoint",
      source: "desktop",
      authority: "desktop-observed",
      status: input.status,
      summary: input.summary,
      correlation: {
        ...("callId" in event && typeof event.callId === "string"
          ? { toolCallId: event.callId }
          : {}),
        ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
      },
      ...(input.path ? {
        fileChange: {
          path: input.path,
          operation: "unknown",
          ownership: "pi",
        },
      } : {}),
    });
  }
}

function isMutatingTool(toolName: string): boolean {
  return /^(?:write|write_file|edit|apply_patch|patch)$/i.test(toolName.trim());
}

function extractPath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ["file_path", "filePath", "path"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeToolPath(path: string, checkoutPath: string): string | undefined {
  if (!isAbsolute(path)) return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  const relativePath = relative(checkoutPath, path);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) return undefined;
  return relativePath.replaceAll("\\", "/");
}

function toolKey(
  event: Pick<SessionDriverEvent, "sessionRef"> & { readonly callId: string },
): string {
  return `${event.sessionRef.workspaceId}:${event.sessionRef.sessionId}:${event.callId}`;
}

function runKey(event: SessionDriverEvent): string {
  return `${event.sessionRef.workspaceId}:${event.sessionRef.sessionId}:${event.runId ?? "unknown-run"}`;
}

function safeMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/(?:\/Users|\/private|\/var|\/tmp|\/Volumes)[^\s"',)]+/g, "[path]");
}
