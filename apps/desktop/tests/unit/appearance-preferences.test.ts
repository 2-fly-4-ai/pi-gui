import { describe, expect, it } from "vitest";
import {
  normalizeAppearancePreferences,
} from "../../src/appearance-preferences";

describe("appearance preferences", () => {
  it("bounds persisted values and falls back safely", () => {
    expect(normalizeAppearancePreferences({
      density: "compact",
      transcriptFontSize: 99,
      monoFontSize: 1,
    })).toEqual({
      density: "compact",
      transcriptFontSize: 18,
      monoFontSize: 11,
      timelineCompression: "automatic",
      timelineMinimap: false,
      successMoments: true,
    });
  });

  it("uses comfortable defaults for unknown values", () => {
    expect(normalizeAppearancePreferences({ density: "other" as "compact" })).toEqual({
      density: "comfortable",
      transcriptFontSize: 15,
      monoFontSize: 13,
      timelineCompression: "automatic",
      timelineMinimap: false,
      successMoments: true,
    });
  });
});
