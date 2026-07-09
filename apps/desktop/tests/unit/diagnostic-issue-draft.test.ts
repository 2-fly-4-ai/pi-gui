import { describe, expect, it } from "vitest";
import { buildDiagnosticIssueDraft } from "../../src/diagnostic-issue-draft";
import type { ObservabilityEvent } from "../../src/observability-types";

function event(overrides: Partial<ObservabilityEvent> = {}): ObservabilityEvent {
  return {
    id: "event-1",
    timestamp: "2026-07-09T04:00:00.000Z",
    severity: "error",
    category: "renderer",
    event: "renderer-console-message",
    title: "Renderer console error",
    message: "Failed at /Users/brian/private-project/src/app.ts with token=sk-abcdefghijklmnopqrstuvwxyz",
    source: { kind: "desktop-log", path: "/Users/brian/private-project/logs/desktop.log", line: 12 },
    raw: {
      prompt: "do not include me",
      fileContent: "do not include me either",
    },
    ...overrides,
  };
}

describe("buildDiagnosticIssueDraft", () => {
  it("builds a GitHub issue URL with app versions and redacted event metadata", () => {
    const draft = buildDiagnosticIssueDraft({
      events: [event()],
      versions: {
        electron: "34.5.8",
        chrome: "132.0.0",
        node: "22.13.0",
      } as NodeJS.ProcessVersions,
      platform: "darwin",
    });

    expect(draft.url).toMatch(/^https:\/\/github\.com\/minghinmatthewlam\/pi-gui\/issues\/new\?/);
    expect(draft.body).toContain("Electron: 34.5.8");
    expect(draft.body).toContain("Platform: darwin");
    expect(draft.body).toContain("Renderer console error");
    expect(draft.body).toContain("[path]");
    expect(draft.body).toContain("token=[secret]");
    expect(draft.body).not.toContain("/Users/brian");
    expect(draft.body).not.toContain("do not include me");
    expect(draft.body).not.toContain("desktop.log");
  });

  it("limits the number of included events", () => {
    const draft = buildDiagnosticIssueDraft({
      events: Array.from({ length: 12 }, (_, index) => event({
        id: `event-${index}`,
        title: `Failure ${index}`,
      })),
      versions: {} as NodeJS.ProcessVersions,
      platform: "linux",
    });

    expect(draft.body).toContain("Events included: 8 of 12");
    expect(draft.body).toContain("Failure 7");
    expect(draft.body).not.toContain("Failure 8");
  });
});
