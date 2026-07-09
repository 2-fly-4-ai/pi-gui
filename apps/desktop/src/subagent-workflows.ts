import type { WorkspaceSessionTarget } from "./desktop-state";
import type { AgentDefinitionRecord } from "./agent-definitions";
import { canonicalRoleForAgentName } from "./agent-definitions";

export type SubagentWorkflowId =
  | "scout-then-plan"
  | "implement-with-worker"
  | "review-current-diff"
  | "parallel-review"
  | "oracle-second-opinion"
  | "review-loop";

export interface SubagentWorkflowTemplate {
  readonly id: SubagentWorkflowId;
  readonly title: string;
  readonly description: string;
  readonly roles: readonly string[];
  readonly artifacts: readonly string[];
}

export interface SubagentWorkflowRoleValidation {
  readonly missingRoles: readonly string[];
}

export type SubagentRunStatus = "submitted" | "running" | "completed" | "failed" | "cancelled";

export interface SubagentRunRecord {
  readonly id: string;
  readonly workflowRunId?: string;
  readonly workflowId: SubagentWorkflowId;
  readonly title: string;
  readonly workspaceId: string;
  readonly workspacePath?: string;
  readonly target: WorkspaceSessionTarget;
  readonly status: SubagentRunStatus;
  readonly roles: readonly string[];
  readonly artifacts: readonly string[];
  readonly submittedAt: string;
  readonly queuedAtSubmission?: boolean;
  readonly updatedAt?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly lifecycleRunId?: string;
  readonly toolCallId?: string;
  readonly toolUseCount?: number;
  readonly elapsedMs?: number;
  readonly summary?: string;
  readonly transcriptPath?: string;
  readonly artifactPaths?: readonly string[];
  readonly error?: string;
}

export interface RunSubagentWorkflowInput {
  readonly workflowId: SubagentWorkflowId;
  readonly target: WorkspaceSessionTarget;
  readonly userInstruction?: string;
}

export const BUILTIN_SUBAGENT_WORKFLOWS: readonly SubagentWorkflowTemplate[] = [
  {
    id: "scout-then-plan",
    title: "Scout then plan",
    description: "Ask scout to map the repo, then planner to produce an implementation plan.",
    roles: ["scout", "planner"],
    artifacts: ["context.md", "plan.md"],
  },
  {
    id: "implement-with-worker",
    title: "Implement with worker",
    description: "Delegate a bounded implementation task to worker.",
    roles: ["worker"],
    artifacts: ["progress.md"],
  },
  {
    id: "review-current-diff",
    title: "Review current diff",
    description: "Review the current working tree for correctness, tests, and maintainability.",
    roles: ["reviewer"],
    artifacts: ["review.md"],
  },
  {
    id: "parallel-review",
    title: "Parallel review",
    description: "Run correctness, tests, and simplicity review perspectives in parallel.",
    roles: ["reviewer/correctness", "reviewer/tests", "reviewer/simplicity"],
    artifacts: ["review-correctness.md", "review-tests.md", "review-simplicity.md"],
  },
  {
    id: "oracle-second-opinion",
    title: "Oracle second opinion",
    description: "Challenge assumptions and compare alternatives before committing to an approach.",
    roles: ["oracle"],
    artifacts: ["oracle.md"],
  },
  {
    id: "review-loop",
    title: "Review loop",
    description: "Review, apply accepted fixes with worker, then review once more.",
    roles: ["reviewer", "worker", "reviewer"],
    artifacts: ["review.md", "progress.md", "final-review.md"],
  },
];

export function workflowById(id: SubagentWorkflowId): SubagentWorkflowTemplate {
  const workflow = BUILTIN_SUBAGENT_WORKFLOWS.find((entry) => entry.id === id);
  if (!workflow) {
    throw new Error(`Unknown subagent workflow: ${id}`);
  }
  return workflow;
}

export function validateSubagentWorkflowRoles(
  workflow: SubagentWorkflowTemplate,
  agents: readonly AgentDefinitionRecord[],
): SubagentWorkflowRoleValidation {
  const availableRoles = new Set<string>();
  for (const agent of agents) {
    if (!agent.config.enabled) continue;
    addRoleAliases(availableRoles, agent.name);
    addRoleAliases(availableRoles, canonicalRoleForAgentName(agent.name, agent.config.role));
  }

  return {
    missingRoles: workflow.roles.filter((role) => !availableRoles.has(role) && !availableRoles.has(baseWorkflowRole(role))),
  };
}

export function buildSubagentWorkflowPrompt(
  workflow: SubagentWorkflowTemplate,
  userInstruction?: string,
  workflowRunId?: string,
): string {
  const instruction = userInstruction?.trim() || "Use the current thread context and repository state.";
  return [
    "SUBAGENT_WORKFLOW_RUN",
    ...(workflowRunId ? [`workflow_run_id: ${workflowRunId}`] : []),
    `workflow: ${workflow.title}`,
    `roles: ${workflow.roles.join(" -> ")}`,
    `artifacts: ${workflow.artifacts.join(", ")}`,
    "",
    "Run this Nico-lite subagent workflow using the available Agent(...) subagent tool when appropriate.",
    "Keep child-agent prompts bounded. Return a concise summary and link or paste any artifacts you create.",
    "",
    `User instruction: ${instruction}`,
  ].join("\n");
}

function addRoleAliases(roles: Set<string>, role: string): void {
  roles.add(role);
  roles.add(baseWorkflowRole(role));
}

export function baseWorkflowRole(role: string): string {
  return role.split("/", 1)[0] ?? role;
}
