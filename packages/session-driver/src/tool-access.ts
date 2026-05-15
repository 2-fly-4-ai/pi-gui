export type BuiltInToolId = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls";
export type ToolAccessMode = "full" | "read-only" | "no-tools" | "custom";

export interface ToolAccessSelection {
  readonly mode: ToolAccessMode;
  readonly tools: readonly BuiltInToolId[];
}

export const BUILT_IN_TOOLS: readonly BuiltInToolId[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];
export const READ_ONLY_TOOLS: readonly BuiltInToolId[] = ["read", "grep", "find", "ls"];
export const DEFAULT_TOOL_ACCESS: ToolAccessSelection = {
  mode: "full",
  tools: BUILT_IN_TOOLS,
};
