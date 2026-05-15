import {
  BUILT_IN_TOOLS,
  DEFAULT_TOOL_ACCESS,
  READ_ONLY_TOOLS,
  type BuiltInToolId,
  type ToolAccessMode,
  type ToolAccessSelection,
} from "@pi-gui/session-driver";

export { BUILT_IN_TOOLS, DEFAULT_TOOL_ACCESS, READ_ONLY_TOOLS };
export type { BuiltInToolId, ToolAccessMode, ToolAccessSelection };

export const TOOL_ACCESS_MODE_LABELS: Readonly<Record<ToolAccessMode, string>> = {
  full: "Full",
  "read-only": "Read-only",
  "no-tools": "No tools",
  custom: "Custom",
};

export const BUILT_IN_TOOL_LABELS: Readonly<Record<BuiltInToolId, string>> = {
  read: "read",
  bash: "bash",
  edit: "edit",
  write: "write",
  grep: "grep",
  find: "find",
  ls: "ls",
};

export function getToolAccessLabel(selection: ToolAccessSelection): string {
  return TOOL_ACCESS_MODE_LABELS[selection.mode];
}

export function normalizeToolAccess(selection: ToolAccessSelection | undefined): ToolAccessSelection {
  if (!selection) {
    return DEFAULT_TOOL_ACCESS;
  }

  if (selection.mode === "full") {
    return DEFAULT_TOOL_ACCESS;
  }
  if (selection.mode === "read-only") {
    return { mode: "read-only", tools: READ_ONLY_TOOLS };
  }
  if (selection.mode === "no-tools") {
    return { mode: "no-tools", tools: [] };
  }

  const tools = BUILT_IN_TOOLS.filter((tool) => selection.tools.includes(tool));
  return { mode: "custom", tools };
}

export function resolveToolsForRuntime(selection: ToolAccessSelection): readonly BuiltInToolId[] | undefined {
  const normalized = normalizeToolAccess(selection);
  if (normalized.mode === "full") {
    return undefined;
  }
  return normalized.tools;
}
