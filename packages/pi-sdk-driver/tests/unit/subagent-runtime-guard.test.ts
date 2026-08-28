import { describe, expect, it } from "vitest";
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_DESKTOP_SUBAGENT_MAX_TURNS,
  guardSubagentToolCall,
} from "../../src/subagent-runtime-guard.js";

function toolCall(toolName: string, input: Record<string, unknown>): ToolCallEvent {
  return { type: "tool_call", toolCallId: "call-1", toolName, input } as ToolCallEvent;
}

describe("subagent runtime guard", () => {
  it("adds a finite turn boundary only when the caller omitted one", () => {
    const missing = toolCall("Agent", { prompt: "work" });
    const explicit = toolCall("Agent", { prompt: "work", max_turns: 12 });
    const explicitUnlimited = toolCall("Agent", { prompt: "work", max_turns: 0 });

    guardSubagentToolCall(missing);
    guardSubagentToolCall(explicit);
    guardSubagentToolCall(explicitUnlimited);

    expect(missing.input.max_turns).toBe(DEFAULT_DESKTOP_SUBAGENT_MAX_TURNS);
    expect(explicit.input.max_turns).toBe(12);
    expect(explicitUnlimited.input.max_turns).toBe(0);
  });

  it("converts blocking result joins to non-blocking status checks", () => {
    const result = toolCall("vendor.get_subagent_result", { agent_id: "agent-1", wait: true });

    guardSubagentToolCall(result);

    expect(result.input.wait).toBe(false);
  });

  it("does not mutate unrelated tools", () => {
    const unrelated = toolCall("bash", { wait: true });

    guardSubagentToolCall(unrelated);

    expect(unrelated.input).toEqual({ wait: true });
  });
});
