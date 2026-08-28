import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { UsageIndexService, buildUsageDashboard, parseUsageLine, scanUsageFile } from "../../electron/usage-index-service";
import type { UsageRecord } from "../../src/usage-types";

describe("usage index", () => {
  it("extracts provider/model, reasoning, cache, and provider-reported cost", () => {
    const parsed = parseUsageLine(JSON.stringify({
      type: "message",
      id: "assistant-1",
      timestamp: "2026-08-28T02:00:00+12:00",
      message: {
        role: "assistant",
        provider: "anthropic",
        model: "claude-sonnet",
        api: "anthropic-messages",
        usage: { input: 100, output: 40, reasoning: 12, cacheRead: 80, cacheWrite: 5, totalTokens: 225, cost: { total: 0.0123 } },
      },
    }), "workspace", "session");
    expect(parsed.record).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet",
      inputTokens: 100,
      outputTokens: 40,
      reasoningTokens: 12,
      cacheReadTokens: 80,
      totalTokens: 225,
      costUsd: 0.0123,
      costKind: "provider-reported",
    });
    expect(parsed.record?.createdAt).toBe("2026-08-27T14:00:00.000Z");
  });

  it("keeps subscription and unknown-price usage distinct while carrying model changes into compactions", () => {
    const modelChange = parseUsageLine(JSON.stringify({ type: "model_change", id: "m", provider: "openai-codex", modelId: "gpt-5.6-sol" }), "w", "s");
    const compaction = parseUsageLine(JSON.stringify({ type: "compaction", id: "c", timestamp: new Date().toISOString(), usage: { input: 20, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 30 } }), "w", "s", modelChange.provider, modelChange.model);
    expect(compaction.record).toMatchObject({ provider: "openai-codex", model: "gpt-5.6-sol", costKind: "subscription", sourceKind: "compaction" });

    const unknown = parseUsageLine(JSON.stringify({ type: "message", id: "u", timestamp: new Date().toISOString(), message: { role: "assistant", provider: "new-provider", model: "new-model", usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5 } } }), "w", "s");
    expect(unknown.record).toMatchObject({ totalTokens: 5, costKind: "unpriced" });
  });

  it("skips corrupt, legacy missing-usage, and non-assistant lines", () => {
    expect(parseUsageLine("not json", "w", "s").record).toBeUndefined();
    expect(parseUsageLine(JSON.stringify({ type: "message", id: "a", message: { role: "assistant" } }), "w", "s").record).toBeUndefined();
    expect(parseUsageLine(JSON.stringify({ type: "message", id: "u", message: { role: "user" } }), "w", "s").record).toBeUndefined();
  });

  it("scans append-only files from the last complete newline", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-usage-scan-"));
    const file = join(root, "session.jsonl");
    const first = usageLine("one", 10);
    await writeFile(file, `${first}\n`, "utf8");
    const initial = await scanUsageFile(file, 0, { workspaceId: "w", sessionId: "s" });
    expect(initial.records).toHaveLength(1);
    expect(initial.partial).toBe(false);
    await appendFile(file, `${usageLine("two", 20)}\n`, "utf8");
    const appended = await scanUsageFile(file, initial.offset, { workspaceId: "w", sessionId: "s", provider: initial.provider, model: initial.model });
    expect(appended.records.map((record) => record.messageId)).toEqual(["two"]);
  });

  it("deduplicates unchanged persisted files and prunes records older than 90 days", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-usage-index-"));
    const file = join(root, "session.jsonl");
    const oldTimestamp = new Date(Date.now() - 91 * 24 * 60 * 60 * 1_000).toISOString();
    await writeFile(file, `${usageLine("old", 100, oldTimestamp)}\n${usageLine("new", 50)}\n`, "utf8");
    const catalog = { sessions: [{ sessionRef: { workspaceId: "w", sessionId: "s" }, workspaceId: "w", title: "Task", updatedAt: new Date().toISOString(), sessionFilePath: file, status: "idle" as const }] };
    const firstService = new UsageIndexService(root, async () => catalog);
    const first = await firstService.getDashboard({ window: "90d" });
    expect(first.recordCount).toBe(1);
    expect(first.totals.totalTokens).toBe(50);
    expect(first.scannedFileCount).toBe(1);
    expect(first.indexBytes).toBeLessThanOrEqual(first.indexByteLimit);

    const reloaded = new UsageIndexService(root, async () => catalog);
    const second = await reloaded.getDashboard({ window: "90d" });
    expect(second.recordCount).toBe(1);
    expect(second.unchangedFileCount).toBe(1);
    expect(second.scannedFileCount).toBe(0);
  });

  it("aggregates provider/model/task buckets exactly once", () => {
    const records: UsageRecord[] = [record("1", "openai", "gpt", 10), record("2", "openai", "gpt", 20), record("3", "anthropic", "sonnet", 30)];
    const dashboard = buildUsageDashboard(records, { window: "7d" }, new Date().toISOString());
    expect(dashboard.totals.totalTokens).toBe(60);
    expect(dashboard.providers.map((bucket) => [bucket.key, bucket.totalTokens])).toEqual([["anthropic", 30], ["openai", 30]]);
    expect(dashboard.models).toHaveLength(2);
    expect(dashboard.tasks).toHaveLength(1);
  });

  it("includes internal usage in totals without presenting it as another assistant turn", () => {
    const assistant = { ...record("assistant", "openai", "gpt", 10), turnId: "user-1" };
    const secondProviderCall = { ...record("assistant-2", "openai", "gpt", 5), turnId: "user-1" };
    const compaction = { ...record("compaction", "openai", "gpt", 20), turnId: "user-1", sourceKind: "compaction" as const };
    const branchSummary = { ...record("summary", "openai", "gpt", 30), turnId: "user-1", sourceKind: "branch-summary" as const };
    const dashboard = buildUsageDashboard([assistant, secondProviderCall, compaction, branchSummary], { window: "7d" }, new Date().toISOString());
    expect(dashboard.recordCount).toBe(4);
    expect(dashboard.totals.totalTokens).toBe(65);
    expect(dashboard.totals.turns).toBe(1);
    expect(dashboard.providers[0]?.turns).toBe(1);
    expect(dashboard.models[0]?.turns).toBe(1);
  });

  it("aggregates a 90-day, 20k-record index inside the interactive budget", () => {
    const records = Array.from({ length: 20_000 }, (_, index) => ({
      ...record(String(index), `provider-${index % 4}`, `model-${index % 12}`, 100 + index % 900),
      workspaceId: `workspace-${index % 20}`,
      sessionId: `session-${index % 500}`,
      createdAt: new Date(Date.now() - (index % 90) * 24 * 60 * 60 * 1_000).toISOString(),
    }));
    const started = performance.now();
    const dashboard = buildUsageDashboard(records, { window: "90d" }, new Date().toISOString());
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(dashboard.recordCount).toBe(20_000);
    expect(dashboard.providers).toHaveLength(4);
    expect(dashboard.models).toHaveLength(12);
  });
});

function usageLine(id: string, totalTokens: number, timestamp = new Date().toISOString()): string {
  return JSON.stringify({ type: "message", id, timestamp, message: { role: "assistant", provider: "openai", model: "gpt", usage: { input: totalTokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens, cost: { total: 0.001 } } } });
}

function record(id: string, provider: string, model: string, totalTokens: number): UsageRecord {
  return { id, workspaceId: "w", sessionId: "s", messageId: id, createdAt: new Date().toISOString(), provider, model, inputTokens: totalTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens, costUsd: 0.001, costKind: "provider-reported", sourceKind: "assistant" };
}
