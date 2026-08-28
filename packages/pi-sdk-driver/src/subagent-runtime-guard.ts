import type { InlineExtension, ToolCallEvent } from "@earendil-works/pi-coding-agent";

export const DEFAULT_DESKTOP_SUBAGENT_MAX_TURNS = 40;

function toolLeafName(toolName: string): string {
  return toolName.split(/[.:/]/).at(-1)?.toLowerCase() ?? toolName.toLowerCase();
}

/**
 * Desktop-owned defense in depth around third-party subagent extensions.
 *
 * The extension still owns execution and completion delivery. Pi GUI only
 * prevents a model-generated unbounded join from blocking its parent session,
 * and supplies a finite turn boundary when the caller omitted one.
 */
export function guardSubagentToolCall(event: ToolCallEvent): void {
  const name = toolLeafName(event.toolName);
  const input = event.input as Record<string, unknown>;
  if (name === "agent" && input.max_turns === undefined) {
    input.max_turns = DEFAULT_DESKTOP_SUBAGENT_MAX_TURNS;
    return;
  }

  if (name === "get_subagent_result" && input.wait === true) {
    input.wait = false;
  }
}

export const subagentRuntimeGuardExtension: InlineExtension = {
  name: "pi-gui-subagent-runtime-guard",
  hidden: true,
  factory(pi) {
    pi.on("tool_call", (event) => {
      guardSubagentToolCall(event);
    });
  },
};
