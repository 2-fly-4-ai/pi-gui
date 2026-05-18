import type { DesktopAppStore } from "./app-store";
import {
  buildSubagentWorkflowPrompt,
  workflowById,
  type RunSubagentWorkflowInput,
  type SubagentRunRecord,
} from "../src/subagent-workflows";

export class SubagentRunStore {
  private readonly runs: SubagentRunRecord[] = [];

  listRuns(workspaceId: string): readonly SubagentRunRecord[] {
    return this.runs
      .filter((run) => run.workspaceId === workspaceId)
      .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
  }

  async runWorkflow(store: DesktopAppStore, input: RunSubagentWorkflowInput): Promise<readonly SubagentRunRecord[]> {
    const workflow = workflowById(input.workflowId);
    const baseRun = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      workflowId: workflow.id,
      title: workflow.title,
      workspaceId: input.target.workspaceId,
      target: input.target,
      roles: workflow.roles,
      artifacts: workflow.artifacts,
      submittedAt: new Date().toISOString(),
    } satisfies Omit<SubagentRunRecord, "status" | "error">;

    try {
      const state = await store.submitComposerToSession(input.target, buildSubagentWorkflowPrompt(workflow, input.userInstruction), {
        deliverAs: "followUp",
      });
      if (state.lastError) {
        throw new Error(state.lastError);
      }
      this.runs.unshift({ ...baseRun, status: "submitted" });
    } catch (error) {
      this.runs.unshift({
        ...baseRun,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return this.listRuns(input.target.workspaceId);
  }
}
