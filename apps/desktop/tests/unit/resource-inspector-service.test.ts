import { describe, expect, it } from "vitest";
import {
  parseProcessLine,
  processIdentityMatches,
  retainResourceHistory,
  resourceWarningCandidates,
  updateWarningStreaks,
} from "../../electron/resource-inspector-service";

describe("resource inspector process parsing", () => {
  it("creates a stable PID and process-start identity from a macOS ps row", () => {
    expect(parseProcessLine("  912  101  912  12.5  65536 Wed Aug 12 10:57:33 2026")).toEqual({
      pid: 912,
      parentPid: 101,
      processGroupId: 912,
      cpuPercent: 12.5,
      residentBytes: 64 * 1024 * 1024,
      startedAt: new Date("Wed Aug 12 10:57:33 2026").toISOString(),
    });
  });

  it("rejects incomplete and non-numeric process rows", () => {
    expect(parseProcessLine("not a process")).toBeUndefined();
    expect(parseProcessLine("12 1 12 nope 10 Wed Aug 12 10:57:33 2026")).toBeUndefined();
  });

  it("rejects PID reuse when the owned start identity no longer matches", () => {
    const sample = parseProcessLine("  912  101  912  12.5  65536 Wed Aug 12 10:57:33 2026");
    expect(sample).toBeDefined();
    expect(processIdentityMatches({
      ownerKind: "runtime",
      ownerId: "job-1",
      label: "Provider job",
      pid: 912,
      startedAt: new Date(Date.parse(sample!.startedAt) - 60_000).toISOString(),
    }, sample!)).toBe(false);
  });

  it("requires three consecutive samples before surfacing a resource warning", () => {
    const streaks = new Map<string, number>();
    const warning = { id: "cpu", level: "warning" as const, title: "CPU", message: "High" };
    expect(updateWarningStreaks([warning], streaks)).toEqual([]);
    expect(updateWarningStreaks([warning], streaks)).toEqual([]);
    expect(updateWarningStreaks([warning], streaks)).toEqual([warning]);
    expect(updateWarningStreaks([], streaks)).toEqual([]);
    expect(streaks.get("cpu")).toBe(0);
  });

  it("keeps detailed history inside the 900-sample contract", () => {
    const history = Array.from({ length: 1_200 }, (_, index) => ({
      timestamp: new Date(index * 1_000).toISOString(),
      cpuPercent: index,
      residentBytes: index * 1024,
      processCount: 2,
      health: "healthy" as const,
    }));
    const retained = retainResourceHistory(history);
    expect(retained).toHaveLength(900);
    expect(retained[0]?.timestamp).toBe(history[300]?.timestamp);
  });

  it("detects a sustained provider wait without exposing provider details", () => {
    const warnings = resourceWarningCandidates({
      cpuPercent: 0, residentBytes: 0, systemMemoryBytes: 1, processCount: 0,
      mainHeapRatio: 0, rendererHeapRatio: 0, owners: [],
      providerWaits: [{ id: "workspace:task", label: "Build task", startedAt: new Date(Date.now() - 11 * 60_000).toISOString(), workspaceId: "workspace", sessionId: "task" }],
    }, []);
    expect(warnings).toEqual([expect.objectContaining({ id: "provider-wait:workspace:task", level: "critical", title: "Provider response is delayed" })]);
  });

  it("detects every bounded resource-warning class from aggregate data", () => {
    const now = Date.now();
    const history = Array.from({ length: 10 }, (_, index) => ({
      timestamp: new Date(now - (10 - index) * 1_000).toISOString(),
      cpuPercent: 25,
      residentBytes: 128 * 1024 * 1024,
      processCount: 10,
      health: "healthy" as const,
    }));
    const warnings = resourceWarningCandidates({
      cpuPercent: 650,
      residentBytes: 768 * 1024 * 1024,
      systemMemoryBytes: 1024 * 1024 * 1024,
      processCount: 24,
      mainHeapRatio: 0.9,
      rendererHeapRatio: 0.2,
      owners: [{
        ownerKind: "runtime",
        ownerId: "runtime-safe-id",
        label: "Bounded runtime",
        confidence: "verified",
        startedAt: new Date(now - 6 * 60_000).toISOString(),
        cpuPercent: 0,
        residentBytes: 1,
        processCount: 1,
        stoppable: true,
      }],
      providerWaits: [],
    }, history);

    expect(new Set(warnings.map((warning) => warning.id))).toEqual(new Set([
      "owned-memory",
      "owned-cpu",
      "heap-pressure",
      "memory-growth",
      "process-multiplication",
      "stale-runtime:runtime-safe-id",
    ]));
    expect(warnings.every((warning) => !warning.message.includes("/Users/") && !warning.message.includes("--"))).toBe(true);
  });
});
