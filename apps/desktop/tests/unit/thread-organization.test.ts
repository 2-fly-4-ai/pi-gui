import { describe, expect, it } from "vitest";
import type { ThreadListEntry } from "../../src/thread-groups";
import {
  groupThreadsByDate,
  matchesThreadOrganizationFilters,
  matchesThreadOrganizationQuery,
  threadOrganizationStatuses,
} from "../../src/thread-organization";

function thread(overrides: Partial<ThreadListEntry["session"]> = {}): ThreadListEntry {
  return {
    workspaceId: "workspace",
    environment: { kind: "worktree", label: "Feature checkout", branchName: "feat/safe-search" },
    session: {
      id: "session",
      title: "Fix sidebar search",
      updatedAt: "2026-07-24T10:00:00.000Z",
      preview: "PRIVATE_TRANSCRIPT_SECRET",
      status: "idle",
      hasUnseenUpdate: false,
      ...overrides,
    },
  };
}

describe("thread organization", () => {
  it("searches only safe title and environment metadata", () => {
    const candidate = thread();
    expect(matchesThreadOrganizationQuery(candidate, "Pi GUI", "sidebar feature")).toBe(true);
    expect(matchesThreadOrganizationQuery(candidate, "Pi GUI", "PRIVATE_TRANSCRIPT_SECRET")).toBe(false);
  });

  it("derives filters without treating failures as completions", () => {
    expect(threadOrganizationStatuses(thread({ status: "failed" }))).toEqual(["failed"]);
    expect(threadOrganizationStatuses(thread({ preview: "Run aborted" }))).toEqual(["interrupted", "unverified"]);
    expect(matchesThreadOrganizationFilters(thread(), new Set(["completed"]))).toBe(true);
  });

  it("groups calendar dates in a stable display order", () => {
    const now = new Date(2026, 6, 24, 12);
    const localTime = (year: number, month: number, day: number) =>
      new Date(year, month - 1, day, 10).toISOString();
    const groups = groupThreadsByDate([
      thread({ id: "older", updatedAt: localTime(2026, 6, 1) }),
      thread({ id: "today", updatedAt: localTime(2026, 7, 24) }),
      thread({ id: "week", updatedAt: localTime(2026, 7, 20) }),
      thread({ id: "yesterday", updatedAt: localTime(2026, 7, 23) }),
    ], now);
    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday", "Previous 7 days", "Older"]);
  });
});
