import { describe, expect, it } from "vitest";
import type { AgentDefinitionRecord } from "../../src/agent-definitions";
import type { SubagentWorkflowTemplate } from "../../src/subagent-workflows";
import { buildSubagentWorkflowPrompt, validateSubagentWorkflowRoles } from "../../src/subagent-workflows";

function agent(name: string, options: { readonly role?: string; readonly enabled?: boolean } = {}): AgentDefinitionRecord {
  return {
    name,
    source: "builtin",
    builtin: true,
    overridden: false,
    config: {
      name,
      description: name,
      modelMode: "inherit",
      thinkingMode: "inherit",
      extensions: true,
      skills: true,
      promptMode: "replace",
      ...(options.role ? { role: options.role } : {}),
      enabled: options.enabled ?? true,
      systemPrompt: "",
    },
    warnings: [],
  };
}

function workflow(roles: readonly string[]): SubagentWorkflowTemplate {
  return {
    id: "parallel-review",
    title: "Test workflow",
    description: "Test workflow",
    roles,
    artifacts: [],
  };
}

describe("validateSubagentWorkflowRoles", () => {
  it("accepts exact agent names and configured canonical roles", () => {
    expect(validateSubagentWorkflowRoles(workflow(["scout", "planner"]), [
      agent("Explore"),
      agent("custom-planner", { role: "planner" }),
    ])).toEqual({ missingRoles: [] });
  });

  it("accepts slash-qualified workflow roles when the base role exists", () => {
    expect(validateSubagentWorkflowRoles(workflow(["reviewer/correctness", "reviewer/tests"]), [
      agent("reviewer"),
    ])).toEqual({ missingRoles: [] });
  });

  it("reports roles whose base role is missing or disabled", () => {
    expect(validateSubagentWorkflowRoles(workflow(["scout", "planner", "reviewer/tests"]), [
      agent("scout", { enabled: false }),
      agent("planner"),
    ])).toEqual({ missingRoles: ["scout", "reviewer/tests"] });
  });
});

describe("buildSubagentWorkflowPrompt", () => {
  it("includes a stable workflow run correlation id when provided", () => {
    const prompt = buildSubagentWorkflowPrompt(workflow(["scout", "planner"]), "Map the repo.", "workflow-run-123");

    expect(prompt.split("\n").slice(0, 5)).toEqual([
      "SUBAGENT_WORKFLOW_RUN",
      "workflow_run_id: workflow-run-123",
      "workflow: Test workflow",
      "roles: scout -> planner",
      "artifacts: ",
    ]);
    expect(prompt).toContain("User instruction: Map the repo.");
  });
});
