import type { ToolAccessSelection } from "@pi-gui/session-driver";
import { extractFileMentions } from "./context-manifest";

export const EXECUTION_BOUNDARY_SCHEMA_VERSION = 1 as const;

export type BoundaryCommandCategory =
  | "read"
  | "test"
  | "build"
  | "package"
  | "network"
  | "version-control"
  | "other";

export type BoundaryRuleMode = "allow" | "approval" | "deny";

export interface ExecutionBoundary {
  readonly schemaVersion: typeof EXECUTION_BOUNDARY_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly enabled: boolean;
  readonly revision: number;
  readonly updatedAt: string;
  readonly maxFiles?: number;
  readonly allowPaths: readonly string[];
  readonly denyPaths: readonly string[];
  readonly dependencyChanges: BoundaryRuleMode;
  readonly commandCategories: Readonly<Partial<Record<BoundaryCommandCategory, BoundaryRuleMode>>>;
  readonly testOnly: boolean;
  readonly maxElapsedMinutes?: number;
  readonly toolAccess: ToolAccessSelection;
}

export interface ExecutionBoundaryInput {
  readonly enabled: boolean;
  readonly maxFiles?: number;
  readonly allowPaths?: readonly string[];
  readonly denyPaths?: readonly string[];
  readonly dependencyChanges?: BoundaryRuleMode;
  readonly commandCategories?: Readonly<Partial<Record<BoundaryCommandCategory, BoundaryRuleMode>>>;
  readonly testOnly?: boolean;
  readonly maxElapsedMinutes?: number;
  readonly toolAccess?: ToolAccessSelection;
}

export interface BoundaryViolation {
  readonly id: string;
  readonly label: string;
  readonly mode: "approval" | "deny" | "advisory";
  readonly field:
    | "maxFiles"
    | "allowPaths"
    | "denyPaths"
    | "dependencyChanges"
    | "commandCategories"
    | "testOnly"
    | "maxElapsedMinutes";
}

export interface ExecutionBoundaryPreflight {
  readonly boundary: ExecutionBoundary;
  readonly violations: readonly BoundaryViolation[];
  readonly requiresApproval: boolean;
  readonly denied: boolean;
}

export const DEFAULT_EXECUTION_BOUNDARY_INPUT: ExecutionBoundaryInput = {
  enabled: false,
  allowPaths: [],
  denyPaths: [],
  dependencyChanges: "approval",
  commandCategories: {},
  testOnly: false,
  toolAccess: { mode: "full", tools: [] },
};

export function normalizeExecutionBoundaryInput(
  input: ExecutionBoundaryInput,
): ExecutionBoundaryInput {
  return {
    enabled: Boolean(input.enabled),
    ...(positiveInteger(input.maxFiles) ? { maxFiles: positiveInteger(input.maxFiles) } : {}),
    allowPaths: normalizePatterns(input.allowPaths),
    denyPaths: normalizePatterns(input.denyPaths),
    dependencyChanges: normalizeRuleMode(input.dependencyChanges),
    commandCategories: normalizeCommandCategories(input.commandCategories),
    testOnly: Boolean(input.testOnly),
    ...(positiveInteger(input.maxElapsedMinutes)
      ? { maxElapsedMinutes: positiveInteger(input.maxElapsedMinutes) }
      : {}),
    toolAccess: normalizeToolAccess(input.toolAccess),
  };
}

export function validateExecutionBoundaryPrompt(
  boundary: ExecutionBoundary,
  prompt: string,
): ExecutionBoundaryPreflight {
  if (!boundary.enabled) {
    return { boundary, violations: [], requiresApproval: false, denied: false };
  }

  const violations: BoundaryViolation[] = [];
  const mentions = extractFileMentions(prompt);
  if (boundary.maxFiles && mentions.length > boundary.maxFiles) {
    violations.push({
      id: "max-files",
      label: `${mentions.length} explicit files exceed the ${boundary.maxFiles}-file limit`,
      mode: "approval",
      field: "maxFiles",
    });
  }
  for (const path of mentions) {
    if (boundary.denyPaths.some((pattern) => matchesPathPattern(path, pattern))) {
      violations.push({
        id: `deny:${path}`,
        label: `${path} matches a denied path`,
        mode: "deny",
        field: "denyPaths",
      });
    } else if (
      boundary.allowPaths.length > 0
      && !boundary.allowPaths.some((pattern) => matchesPathPattern(path, pattern))
    ) {
      violations.push({
        id: `allow:${path}`,
        label: `${path} is outside the allowed paths`,
        mode: "approval",
        field: "allowPaths",
      });
    }
  }

  if (looksLikeDependencyChange(prompt) && boundary.dependencyChanges !== "allow") {
    violations.push({
      id: "dependency-change",
      label: "The request appears to modify dependencies",
      mode: boundary.dependencyChanges,
      field: "dependencyChanges",
    });
  }

  const categories = inferCommandCategories(prompt);
  for (const category of categories) {
    const mode = boundary.commandCategories[category] ?? "allow";
    if (mode === "allow") continue;
    violations.push({
      id: `command:${category}`,
      label: `${commandCategoryLabel(category)} commands are ${mode === "deny" ? "denied" : "approval-gated"}`,
      mode,
      field: "commandCategories",
    });
  }

  if (boundary.testOnly && looksLikeMutationRequest(prompt)) {
    violations.push({
      id: "test-only",
      label: "The request appears to change files while test-only mode is active",
      mode: "deny",
      field: "testOnly",
    });
  }
  if (boundary.maxElapsedMinutes) {
    violations.push({
      id: "elapsed-advisory",
      label: `The ${boundary.maxElapsedMinutes}-minute elapsed limit is advisory until the run starts`,
      mode: "advisory",
      field: "maxElapsedMinutes",
    });
  }

  return {
    boundary,
    violations,
    requiresApproval: violations.some((violation) => violation.mode === "approval"),
    denied: violations.some((violation) => violation.mode === "deny"),
  };
}

export function countActiveBoundaryRules(boundary: ExecutionBoundary): number {
  if (!boundary.enabled) return 0;
  return [
    boundary.maxFiles !== undefined,
    boundary.allowPaths.length > 0,
    boundary.denyPaths.length > 0,
    boundary.dependencyChanges !== "allow",
    Object.values(boundary.commandCategories).some((mode) => mode !== "allow"),
    boundary.testOnly,
    boundary.maxElapsedMinutes !== undefined,
    boundary.toolAccess.mode !== "full",
  ].filter(Boolean).length;
}

export function commandCategoryLabel(category: BoundaryCommandCategory): string {
  return category === "version-control"
    ? "Version control"
    : `${category.slice(0, 1).toUpperCase()}${category.slice(1)}`;
}

function positiveInteger(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function normalizePatterns(patterns: readonly string[] | undefined): readonly string[] {
  return [...new Set((patterns ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 100);
}

function normalizeRuleMode(value: BoundaryRuleMode | undefined): BoundaryRuleMode {
  return value === "allow" || value === "deny" ? value : "approval";
}

function normalizeCommandCategories(
  value: ExecutionBoundaryInput["commandCategories"],
): ExecutionBoundary["commandCategories"] {
  const normalized: Partial<Record<BoundaryCommandCategory, BoundaryRuleMode>> = {};
  for (const category of [
    "read", "test", "build", "package", "network", "version-control", "other",
  ] as const) {
    if (value?.[category]) normalized[category] = normalizeRuleMode(value[category]);
  }
  return normalized;
}

function normalizeToolAccess(value: ToolAccessSelection | undefined): ToolAccessSelection {
  if (!value || value.mode === "full") return { mode: "full", tools: [] };
  if (value.mode === "read-only") return { mode: "read-only", tools: [...value.tools] };
  if (value.mode === "no-tools") return { mode: "no-tools", tools: [] };
  return { mode: "custom", tools: [...new Set(value.tools)].slice(0, 100) };
}

function matchesPathPattern(path: string, pattern: string): boolean {
  const normalizedPath = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  const normalizedPattern = pattern.replaceAll("\\", "/").replace(/^\.\/+/, "");
  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const expression = escaped.replaceAll("**", "\u0000").replaceAll("*", "[^/]*").replaceAll("\u0000", ".*");
  return new RegExp(`^${expression}$`).test(normalizedPath);
}

function looksLikeDependencyChange(prompt: string): boolean {
  return /\b(install|add|remove|upgrade|update)\b[\s\S]{0,40}\b(dependenc(?:y|ies)|package|npm|pnpm|yarn|pip|cargo|gem)\b/i.test(prompt)
    || /\b(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|requirements\.txt|Cargo\.toml)\b/i.test(prompt);
}

function looksLikeMutationRequest(prompt: string): boolean {
  return /\b(edit|change|fix|implement|create|write|delete|remove|rename|refactor|install|upgrade|update)\b/i.test(prompt);
}

function inferCommandCategories(prompt: string): readonly BoundaryCommandCategory[] {
  const matches = new Set<BoundaryCommandCategory>();
  if (/\b(test|vitest|jest|playwright|pytest|cargo test)\b/i.test(prompt)) matches.add("test");
  if (/\b(build|compile|tsc|vite build|cargo build)\b/i.test(prompt)) matches.add("build");
  if (/\b(install|uninstall|package|pnpm|npm|yarn|pip|cargo add)\b/i.test(prompt)) matches.add("package");
  if (/\b(curl|wget|fetch|download|network|http[s]?:\/\/)\b/i.test(prompt)) matches.add("network");
  if (/\b(git|commit|push|pull request|merge|rebase|checkout)\b/i.test(prompt)) matches.add("version-control");
  if (/\b(read|inspect|search|find|list|cat|rg)\b/i.test(prompt)) matches.add("read");
  return [...matches];
}
