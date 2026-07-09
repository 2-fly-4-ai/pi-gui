import { describe, expect, it } from "vitest";
import { normalizeRuntimeCommandName, skillCommandName, skillSlashCommand } from "../../src/runtime-command-utils";

describe("runtime command utilities", () => {
  it("normalizes user-entered slash command names", () => {
    expect(normalizeRuntimeCommandName("///review")).toBe("review");
    expect(normalizeRuntimeCommandName("  /skill:review  ")).toBe("skill:review");
  });

  it("formats skill command names and slash tokens", () => {
    expect(skillCommandName("/review")).toBe("skill:review");
    expect(skillSlashCommand("review")).toBe("/skill:review");
  });
});
