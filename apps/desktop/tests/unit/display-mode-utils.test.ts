import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../../src/desktop-state";
import {
  filterLabel,
  matchesFilter,
  statusLabel,
} from "../../src/features/display-mode/display-mode-utils";

const session = (patch: Partial<SessionRecord>): SessionRecord => ({
  id: "session",
  title: "Thread",
  status: "idle",
  createdAt: "2026-07-25T00:00:00.000Z",
  updatedAt: "2026-07-25T00:00:00.000Z",
  ...patch,
});

describe("Display Mode status vocabulary", () => {
  it("matches waiting updates and calls terminal errors failed", () => {
    expect(matchesFilter(session({ hasUnseenUpdate: true }), "waiting")).toBe(true);
    expect(matchesFilter(session({ status: "running", hasUnseenUpdate: true }), "waiting")).toBe(false);
    expect(filterLabel("error")).toBe("Failed");
    expect(statusLabel(session({ status: "failed" }))).toBe("Failed");
  });
});
