import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyAdaptiveRecommendation,
  deriveAdaptiveRecommendation,
  dismissAdaptiveRecommendation,
  readAdaptiveUsage,
  recordAdaptiveAction,
  resetAdaptiveRecommendations,
} from "../../src/product-experience/adaptive-interface";

describe("adaptive interface recommendations", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
  });

  afterEach(() => Reflect.deleteProperty(globalThis, "localStorage"));

  it("uses only local coarse counts and requires three uses", () => {
    recordAdaptiveAction("workspace", "toggle-changes");
    recordAdaptiveAction("workspace", "toggle-changes");
    expect(deriveAdaptiveRecommendation(
      readAdaptiveUsage("workspace"),
      new Set(["toggle-changes"]),
      new Set(),
    )).toBeUndefined();
    recordAdaptiveAction("workspace", "toggle-changes");
    expect(deriveAdaptiveRecommendation(
      readAdaptiveUsage("workspace"),
      new Set(["toggle-changes"]),
      new Set(),
    )).toMatchObject({ actionId: "toggle-changes", count: 3 });
  });

  it("respects explicit dismiss, apply, pin, and reset", () => {
    for (let index = 0; index < 3; index += 1) recordAdaptiveAction("workspace", "settings");
    dismissAdaptiveRecommendation("workspace", "settings");
    expect(deriveAdaptiveRecommendation(readAdaptiveUsage("workspace"), new Set(["settings"]), new Set())).toBeUndefined();
    resetAdaptiveRecommendations("workspace");
    for (let index = 0; index < 3; index += 1) recordAdaptiveAction("workspace", "settings");
    applyAdaptiveRecommendation("workspace", "settings");
    expect(deriveAdaptiveRecommendation(readAdaptiveUsage("workspace"), new Set(["settings"]), new Set())).toBeUndefined();
    resetAdaptiveRecommendations("workspace");
    expect(readAdaptiveUsage("workspace").counts).toEqual({});
  });
});
