import { describe, expect, it } from "vitest";
import { classifyMemoryPressure } from "../../electron/memory-pressure-guard";

describe("memory pressure classification", () => {
  it("uses the highest main or renderer heap ratio", () => {
    expect(classifyMemoryPressure({ mainHeapRatio: 0.2, rendererHeapRatio: 0.3 })).toBe("normal");
    expect(classifyMemoryPressure({ mainHeapRatio: 0.71, rendererHeapRatio: 0.3 })).toBe("warning");
    expect(classifyMemoryPressure({ mainHeapRatio: 0.2, rendererHeapRatio: 0.86 })).toBe("critical");
  });
});
