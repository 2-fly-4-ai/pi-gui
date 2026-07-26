import { describe, expect, it } from "vitest";
import {
  CONTEXT_MANIFEST_SCHEMA_VERSION,
  buildContextManifest,
  providerVisibleContextEntries,
  removableContextEntries,
  resolveProjectMemory,
  sanitizeContextDisplayValue,
  type ContextManifest,
  type ProjectMemoryEntry,
} from "../../src/product-experience/context-manifest";

function memory(
  id: string,
  scope: ProjectMemoryEntry["scope"],
  overrides: Partial<ProjectMemoryEntry> = {},
): ProjectMemoryEntry {
  return {
    id,
    key: "style",
    text: id,
    scope,
    enabled: true,
    updatedAt: "2026-07-24T00:00:00.000Z",
    createdBy: "user",
    ...overrides,
  };
}

describe("resolveProjectMemory", () => {
  it("uses thread over workspace over global for the same key", () => {
    const resolved = resolveProjectMemory([
      memory("global", "global"),
      memory("workspace", "workspace", { workspaceId: "workspace-1" }),
      memory("thread", "thread", { workspaceId: "workspace-1", sessionId: "session-1" }),
      memory("other-workspace", "workspace", { workspaceId: "workspace-2" }),
    ], {
      workspaceId: "workspace-1",
      sessionId: "session-1",
    });

    expect(resolved.map((entry) => entry.id)).toEqual(["thread"]);
  });

  it("ignores disabled and out-of-scope entries while preserving separate keys", () => {
    const resolved = resolveProjectMemory([
      memory("disabled", "global", { enabled: false }),
      memory("style", "workspace", { workspaceId: "workspace-1" }),
      memory("tests", "workspace", {
        key: "tests",
        workspaceId: "workspace-1",
      }),
    ], {
      workspaceId: "workspace-1",
    });

    expect(resolved.map((entry) => entry.id)).toEqual(["style", "tests"]);
  });

  it("does not activate an unconfirmed assistant proposal", () => {
    const resolved = resolveProjectMemory([
      memory("proposal", "workspace", {
        workspaceId: "workspace-1",
        createdBy: "assistant-proposal",
      }),
      memory("confirmed", "workspace", {
        key: "tests",
        workspaceId: "workspace-1",
        createdBy: "assistant-proposal",
        confirmedAt: "2026-07-24T00:01:00.000Z",
      }),
    ], {
      workspaceId: "workspace-1",
    });

    expect(resolved.map((entry) => entry.id)).toEqual(["confirmed"]);
  });
});

describe("context disclosure", () => {
  const manifest: ContextManifest = {
    schemaVersion: CONTEXT_MANIFEST_SCHEMA_VERSION,
    workspaceId: "workspace-1",
    sessionId: "session-1",
    model: "gpt",
    provider: "provider",
    generatedAt: "2026-07-24T00:00:00.000Z",
    entries: [
      {
        id: "attachment",
        source: "attachment",
        scope: "message",
        label: "report.md",
        reason: "Attached to the next message",
        removable: true,
        providerVisible: true,
        persistent: false,
        contentAccess: "content",
        availability: "available",
      },
      {
        id: "runtime",
        source: "runtime",
        scope: "runtime",
        label: "Upstream system context",
        reason: "Managed by the runtime",
        removable: false,
        providerVisible: true,
        persistent: false,
        contentAccess: "opaque",
        availability: "available",
      },
      {
        id: "local",
        source: "project-memory",
        scope: "workspace",
        label: "Local note",
        reason: "Disabled for this submission",
        removable: true,
        providerVisible: false,
        persistent: true,
        contentAccess: "content",
        availability: "stale",
      },
    ],
  };

  it("separates removable and provider-visible entries honestly", () => {
    expect(removableContextEntries(manifest).map((entry) => entry.id)).toEqual([
      "attachment",
      "local",
    ]);
    expect(providerVisibleContextEntries(manifest).map((entry) => entry.id)).toEqual([
      "attachment",
      "runtime",
    ]);
  });

  it("redacts common secret shapes and shortens the home path", () => {
    expect(sanitizeContextDisplayValue(
      "OPENAI_API_KEY=sk-abcdefghijklmnop in /Users/example/project and Bearer abcdefghijklmnop",
      { homePath: "/Users/example" },
    )).toBe("OPENAI_API_KEY=[redacted] in ~/project and Bearer [redacted]");
  });

  it("builds an honest next-message manifest with removable and opaque entries", () => {
    const built = buildContextManifest({
      workspaceId: "workspace-1",
      sessionId: "session-1",
      model: "gpt-5",
      provider: "openai",
      checkout: "feature/context",
      generatedAt: "2026-07-24T00:00:00.000Z",
      attachments: [{ id: "a-1", label: "report.md", availability: "available" }],
      fileMentions: ["src/app.ts"],
      desktopInstructionsEnabled: true,
      activeSkillProfile: "Review",
      projectMemory: [memory("memory-1", "workspace", { workspaceId: "workspace-1" })],
    });

    expect(built).toMatchObject({
      model: "gpt-5",
      provider: "openai",
      checkout: "feature/context",
    });
    expect(built.entries.map((entry) => [entry.source, entry.removable, entry.contentAccess])).toEqual([
      ["attachment", true, "content"],
      ["file-mention", true, "metadata-only"],
      ["desktop-instruction", true, "content"],
      ["skill", true, "metadata-only"],
      ["project-memory", true, "content"],
      ["workspace-instruction", false, "opaque"],
      ["runtime", false, "opaque"],
    ]);
  });
});
