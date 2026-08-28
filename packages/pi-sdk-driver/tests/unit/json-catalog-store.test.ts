import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonCatalogStore } from "../../src/json-catalog-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("JSON session catalog", () => {
  it("persists per-task tool access across supervisor and app restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-gui-session-catalog-"));
    temporaryDirectories.push(directory);
    const catalogFilePath = join(directory, "catalog.json");
    const sessionRef = { workspaceId: "workspace", sessionId: "session" };
    const store = new JsonCatalogStore({ catalogFilePath });
    await store.sessions.upsertSession({
      sessionRef,
      workspaceId: sessionRef.workspaceId,
      title: "Persistent task",
      updatedAt: "2026-08-23T00:00:00.000Z",
      status: "idle",
      config: {
        provider: "openai-codex",
        modelId: "gpt-5.6-sol",
        toolAccess: { mode: "custom", tools: ["read", "grep"] },
      },
    });

    const reopened = new JsonCatalogStore({ catalogFilePath });
    expect(await reopened.sessions.getSession(sessionRef)).toMatchObject({
      config: {
        provider: "openai-codex",
        modelId: "gpt-5.6-sol",
        toolAccess: { mode: "custom", tools: ["read", "grep"] },
      },
    });
  });
});
