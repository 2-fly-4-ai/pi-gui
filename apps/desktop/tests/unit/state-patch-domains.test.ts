import { describe, expect, it } from "vitest";
import { createEmptyDesktopAppState, type DesktopAppState } from "../../src/desktop-state";
import {
  applyDesktopStatePatchEvent,
  buildDesktopStateDomainSnapshot,
  buildDesktopStatePatchEvents,
  desktopStatePatchDomains,
} from "../../src/state/state-patch-domains";

const baseState = (overrides: Partial<DesktopAppState> = {}): DesktopAppState => ({
  ...createEmptyDesktopAppState(),
  ...overrides,
});

describe("buildDesktopStateDomainSnapshot", () => {
  it("groups every state field into an explicit replacement domain", () => {
    const snapshot = buildDesktopStateDomainSnapshot(baseState({
      selectedWorkspaceId: "workspace-1",
      composerDraft: "hello",
      revision: 3,
    }));

    expect(Object.keys(snapshot)).toEqual([...desktopStatePatchDomains]);
    expect(snapshot.selection).toMatchObject({ selectedWorkspaceId: "workspace-1" });
    expect(snapshot.composer).toMatchObject({ composerDraft: "hello" });
    expect(snapshot.diagnostics).toMatchObject({ revision: 3 });
  });
});

describe("buildDesktopStatePatchEvents", () => {
  it("emits every domain for the boot snapshot", () => {
    const events = buildDesktopStatePatchEvents(null, baseState({ revision: 1 }));

    expect(events.map((event) => event.domain)).toEqual([...desktopStatePatchDomains]);
    expect(events.every((event) => event.revision === 1)).toBe(true);
  });

  it("emits composer and diagnostics when only the composer draft changes", () => {
    const previous = baseState({ composerDraft: "old", revision: 1 });
    const next = baseState({ composerDraft: "new", revision: 2 });

    expect(buildDesktopStatePatchEvents(previous, next).map((event) => event.domain)).toEqual([
      "composer",
      "diagnostics",
    ]);
  });

  it("emits selection and diagnostics when only selection changes", () => {
    const previous = baseState({ selectedSessionId: "s1", revision: 1 });
    const next = baseState({ selectedSessionId: "s2", revision: 2 });

    expect(buildDesktopStatePatchEvents(previous, next).map((event) => event.domain)).toEqual([
      "selection",
      "diagnostics",
    ]);
  });

  it("emits only diagnostics for revision and error changes", () => {
    const previous = baseState({ revision: 1 });
    const next = baseState({ revision: 2, lastError: "boom" });

    const events = buildDesktopStatePatchEvents(previous, next);

    expect(events.map((event) => event.domain)).toEqual(["diagnostics"]);
    expect(events[0]?.patch).toEqual({ revision: 2, lastError: "boom" });
  });
});

describe("applyDesktopStatePatchEvent", () => {
  it("materializes replacement domains onto the current snapshot", () => {
    const previous = baseState({
      selectedSessionId: "s1",
      composerDraft: "old",
      revision: 1,
    });
    const [selectionPatch] = buildDesktopStatePatchEvents(previous, baseState({
      selectedSessionId: "s2",
      composerDraft: "old",
      revision: 2,
    }));
    const [composerPatch] = buildDesktopStatePatchEvents(previous, baseState({
      selectedSessionId: "s1",
      composerDraft: "new",
      revision: 2,
    }));

    const withSelection = applyDesktopStatePatchEvent(previous, selectionPatch!);
    const withComposer = applyDesktopStatePatchEvent(withSelection, composerPatch!);

    expect(withComposer).toMatchObject({
      selectedSessionId: "s2",
      composerDraft: "new",
      revision: 1,
    });
  });

  it("applies diagnostics patches to advance the materialized revision", () => {
    const previous = baseState({ revision: 1 });
    const next = baseState({ revision: 2, lastError: "boom" });
    const [diagnosticsPatch] = buildDesktopStatePatchEvents(previous, next);

    expect(applyDesktopStatePatchEvent(previous, diagnosticsPatch!)).toMatchObject({
      revision: 2,
      lastError: "boom",
    });
  });

  it("ignores stale patches from older revisions", () => {
    const current = baseState({ composerDraft: "current", revision: 4 });
    const stale = {
      domain: "composer" as const,
      revision: 3,
      patch: {
        composerDraft: "stale",
        composerDraftSyncSource: "state",
        composerDraftSyncNonce: 0,
        composerAttachments: [],
        queuedComposerMessages: [],
      },
    };

    expect(applyDesktopStatePatchEvent(current, stale)).toBe(current);
  });
});
