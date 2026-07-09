import { describe, expect, it } from "vitest";
import { formatSubagentFinalBlockSummary, parseSubagentFinalBlock } from "../../src/subagent-final-block";

describe("subagent final block parser", () => {
  it("parses the versioned final block", () => {
    const parsed = parseSubagentFinalBlock([
      "some transcript prelude",
      "<pi-subagent-result-v1>",
      "STATUS: APPROVED",
      "SUMMARY: Reviewed the change.",
      "ISSUES: none",
      "TESTS: pnpm typecheck passed",
      "ARTIFACTS: review.md",
      "</pi-subagent-result-v1>",
    ].join("\n"));

    expect(parsed).toMatchObject({
      version: 1,
      status: "APPROVED",
      summary: "Reviewed the change.",
      issues: "none",
      tests: "pnpm typecheck passed",
      artifacts: "review.md",
    });
    expect(parsed ? formatSubagentFinalBlockSummary(parsed) : "").toContain("STATUS: APPROVED");
  });

  it("parses escaped transcript text from JSONL output", () => {
    const parsed = parseSubagentFinalBlock(
      "{\"type\":\"message_end\",\"text\":\"<pi-subagent-result-v1>\\nSTATUS: DONE\\nSUMMARY: Finished\\n</pi-subagent-result-v1>\"}",
    );

    expect(parsed?.status).toBe("DONE");
    expect(parsed?.summary).toBe("Finished");
  });

  it("rejects loose legacy status text", () => {
    expect(parseSubagentFinalBlock("STATUS: APPROVED\nISSUES: none")).toBeUndefined();
  });

  it("rejects invalid statuses", () => {
    expect(parseSubagentFinalBlock("<pi-subagent-result-v1>\nSTATUS: OK\n</pi-subagent-result-v1>")).toBeUndefined();
  });
});
