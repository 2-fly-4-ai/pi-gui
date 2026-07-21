import type { WorkspaceSessionTarget } from "./desktop-state";
import type { AgentDefinitionRecord } from "./agent-definitions";
import { canonicalRoleForAgentName } from "./agent-definitions";

export type SubagentWorkflowId = string;
export type SubagentWorkflowScope = "global" | "project";
export type SubagentWorkflowSource = "builtin" | SubagentWorkflowScope;

export interface SubagentWorkflowTemplate {
  readonly id: SubagentWorkflowId;
  readonly title: string;
  readonly description: string;
  readonly roles: readonly string[];
  readonly artifacts: readonly string[];
}

export interface SubagentWorkflowRecord extends SubagentWorkflowTemplate {
  readonly source: SubagentWorkflowSource;
  readonly scope?: SubagentWorkflowScope;
  readonly path?: string;
  readonly builtin: boolean;
  readonly overridden: boolean;
  readonly warnings: readonly string[];
}

export interface SubagentWorkflowSnapshot {
  readonly globalWorkflowsDir: string;
  readonly projectWorkflowsDir?: string;
  readonly workflows: readonly SubagentWorkflowRecord[];
}

export interface SaveSubagentWorkflowInput {
  readonly scope: SubagentWorkflowScope;
  readonly workflow: SubagentWorkflowTemplate;
}

export interface DeleteSubagentWorkflowInput {
  readonly scope: SubagentWorkflowScope;
  readonly id: SubagentWorkflowId;
}

export interface SubagentWorkflowMessageMetadata {
  readonly kind: "subagent-workflow";
  readonly workflowRunId?: string;
  readonly workflow: string;
  readonly roles: readonly string[];
  readonly artifacts: readonly string[];
}

export interface SubagentWorkflowRoleValidation {
  readonly missingRoles: readonly string[];
}

export type SubagentRunStatus = "submitted" | "running" | "completed" | "failed" | "cancelled";

export interface SubagentChildRunRecord {
  readonly id: string;
  readonly status: Exclude<SubagentRunStatus, "submitted">;
  readonly lifecycleRunId: string;
  readonly toolCallId?: string;
  readonly auditAgentId?: string;
  readonly role?: string;
  readonly agentName?: string;
  readonly description?: string;
  readonly startedAt?: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly toolUseCount?: number;
  readonly elapsedMs?: number;
  readonly summary?: string;
  readonly transcriptPath?: string;
  readonly artifactPaths?: readonly string[];
}

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
  readonly executionStartedAt?: string;
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
  readonly childRuns?: readonly SubagentChildRunRecord[];
  readonly error?: string;
}

export function isSubagentWorkflowMessageMetadata(metadata: unknown): metadata is SubagentWorkflowMessageMetadata {
  if (!metadata || typeof metadata !== "object") return false;
  const candidate = metadata as Partial<SubagentWorkflowMessageMetadata>;
  return candidate.kind === "subagent-workflow" &&
    typeof candidate.workflow === "string" &&
    Array.isArray(candidate.roles) &&
    candidate.roles.every((role) => typeof role === "string") &&
    Array.isArray(candidate.artifacts) &&
    candidate.artifacts.every((artifact) => typeof artifact === "string") &&
    (candidate.workflowRunId === undefined || typeof candidate.workflowRunId === "string");
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

export function dryRunSubagentWorkflow(role: string): SubagentWorkflowTemplate {
  const normalizedRole = role.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(normalizedRole)) throw new Error("Invalid dry-run agent role.");
  return {
    id: `dry-run:${normalizedRole}`,
    title: `Dry run · ${normalizedRole}`,
    description: "A bounded definition check launched from Settings.",
    roles: [normalizedRole],
    artifacts: [],
  };
}

export function roleFromDryRunWorkflowId(id: string): string | undefined {
  return id.startsWith("dry-run:") ? id.slice("dry-run:".length).trim() || undefined : undefined;
}

export function builtinSubagentWorkflowRecords(): readonly SubagentWorkflowRecord[] {
  return BUILTIN_SUBAGENT_WORKFLOWS.map((workflow) => ({
    ...workflow,
    source: "builtin",
    builtin: true,
    overridden: false,
    warnings: [],
  }));
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
    "Run this Nico-lite subagent workflow by invoking the available Agent(...) subagent tool exactly once for each listed role, in order.",
    "Keep child-agent prompts bounded. Return a concise summary and link or paste any artifacts you create.",
    ...(workflowRunId ? [`Begin every Agent prompt with exactly: workflow_run_id: ${workflowRunId}`] : []),
    "",
    `User instruction: ${instruction}`,
  ].join("\n");
}

export function buildSubagentWorkflowMessageMetadata(
  workflow: SubagentWorkflowTemplate,
  workflowRunId?: string,
): SubagentWorkflowMessageMetadata {
  return {
    kind: "subagent-workflow",
    ...(workflowRunId ? { workflowRunId } : {}),
    workflow: workflow.title,
    roles: [...workflow.roles],
    artifacts: [...workflow.artifacts],
  };
}

function addRoleAliases(roles: Set<string>, role: string): void {
  roles.add(role);
  roles.add(baseWorkflowRole(role));
}

export function baseWorkflowRole(role: string): string {
  return role.split("/", 1)[0] ?? role;
}
