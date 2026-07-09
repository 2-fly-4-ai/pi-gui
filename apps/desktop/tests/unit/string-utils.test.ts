import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime, titleCase } from "../../src/string-utils";

describe("titleCase", () => {
  it("formats dash and underscore separated values", () => {
    expect(titleCase("phase-4_state-sync")).toBe("Phase 4 State Sync");
  });

  it("drops empty separators", () => {
    expect(titleCase("--model__settings-")).toBe("Model Settings");
  });
});

describe("formatRelativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty and invalid values without guessing", () => {
    expect(formatRelativeTime("")).toBe("");
    expect(formatRelativeTime("not-a-date")).toBe("not-a-date");
  });

  it("formats recent timestamps into compact relative labels", () => {
    vi.setSystemTime(new Date("2026-07-08T12:00:00.000Z"));

    expect(formatRelativeTime("2026-07-08T11:59:45.000Z")).toBe("now");
    expect(formatRelativeTime("2026-07-08T11:42:00.000Z")).toBe("18m");
    expect(formatRelativeTime("2026-07-08T09:00:00.000Z")).toBe("3h");
    expect(formatRelativeTime("2026-07-05T12:00:00.000Z")).toBe("3d");
  });
});
