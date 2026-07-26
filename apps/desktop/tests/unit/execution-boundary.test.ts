import { describe, expect, it } from "vitest";
import {
  EXECUTION_BOUNDARY_SCHEMA_VERSION,
  normalizeExecutionBoundaryInput,
  validateExecutionBoundaryPrompt,
  type ExecutionBoundary,
} from "../../src/product-experience/execution-boundary";

function boundary(overrides: Partial<ExecutionBoundary> = {}): ExecutionBoundary {
  return {
    schemaVersion: EXECUTION_BOUNDARY_SCHEMA_VERSION,
    workspaceId: "workspace",
    sessionId: "session",
    enabled: true,
    revision: 1,
    updatedAt: "2026-07-24T12:00:00.000Z",
    allowPaths: [],
    denyPaths: [],
    dependencyChanges: "allow",
    commandCategories: {},
    testOnly: false,
    toolAccess: { mode: "full", tools: [] },
    ...overrides,
  };
}

describe("execution boundaries", () => {
  it("normalizes invalid limits, duplicate patterns, modes, and tool selections", () => {
    expect(normalizeExecutionBoundaryInput({
      enabled: true,
      maxFiles: -1,
      maxElapsedMinutes: 1.5,
      allowPaths: [" src/** ", "src/**", ""],
      dependencyChanges: "approval",
      toolAccess: { mode: "custom", tools: ["read", "read", "bash"] },
    })).toEqual({
      enabled: true,
      allowPaths: ["src/**"],
      denyPaths: [],
      dependencyChanges: "approval",
      commandCategories: {},
      testOnly: false,
      toolAccess: { mode: "custom", tools: ["read", "bash"] },
    });
  });

  it("requires one-time approval for explicit file count and allow-list crossings", () => {
    const result = validateExecutionBoundaryPrompt(boundary({
      maxFiles: 1,
      allowPaths: ["src/**"],
    }), "Change @src/app.ts and @tests/app.test.ts");

    expect(result.requiresApproval).toBe(true);
    expect(result.denied).toBe(false);
    expect(result.violations.map((entry) => entry.id)).toEqual([
      "max-files",
      "allow:tests/app.test.ts",
    ]);
  });

  it("fails closed for explicit denied paths and test-only mutation requests", () => {
    const result = validateExecutionBoundaryPrompt(boundary({
      denyPaths: [".env", "secrets/**"],
      testOnly: true,
    }), "Edit @.env and implement the fix");

    expect(result.denied).toBe(true);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "deny:.env", mode: "deny" }),
      expect.objectContaining({ id: "test-only", mode: "deny" }),
    ]));
  });

  it("classifies dependency and command requests and labels elapsed time advisory", () => {
    const result = validateExecutionBoundaryPrompt(boundary({
      dependencyChanges: "approval",
      commandCategories: { network: "deny", "version-control": "approval" },
      maxElapsedMinutes: 10,
    }), "Install a package, curl the docs, then git commit");

    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "dependency-change", mode: "approval" }),
      expect.objectContaining({ id: "command:network", mode: "deny" }),
      expect.objectContaining({ id: "command:version-control", mode: "approval" }),
      expect.objectContaining({ id: "elapsed-advisory", mode: "advisory" }),
    ]));
  });

  it("does not block when a boundary is disabled", () => {
    expect(validateExecutionBoundaryPrompt(
      boundary({ enabled: false, denyPaths: ["**"] }),
      "Edit @src/app.ts",
    ).violations).toEqual([]);
  });
});
