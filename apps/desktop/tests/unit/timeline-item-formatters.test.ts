import { describe, expect, it } from "vitest";
import { capToolContentText, formatToolContent } from "../../src/timeline-item-formatters";

describe("timeline item formatters", () => {
  it("caps oversized tool output with a visible truncation note", () => {
    const formatted = formatToolContent(undefined, "x".repeat(12_050));

    expect(formatted.length).toBeLessThan(12_250);
    expect(formatted).toContain("[Output truncated for chat: showing first 12,000 of 12,050 characters.]");
  });

  it("caps formatted object output after serialization", () => {
    const formatted = formatToolContent(undefined, { payload: "y".repeat(12_050) });

    expect(formatted).toContain("\"payload\"");
    expect(formatted).toContain("[Output truncated for chat:");
  });

  it("leaves small tool output unchanged", () => {
    expect(capToolContentText("short output")).toBe("short output");
  });
});
