import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaskEvidenceLedger } from "../../electron/task-evidence-ledger";
import {
  TASK_EVIDENCE_SCHEMA_VERSION,
  type TaskEvidenceRecord,
} from "../../src/product-experience/task-evidence";

const tempDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempUserData(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "pi-gui-evidence-"));
  tempDirectories.push(path);
  return path;
}

function evidence(
  id: string,
  overrides: Partial<TaskEvidenceRecord> = {},
): TaskEvidenceRecord {
  return {
    schemaVersion: TASK_EVIDENCE_SCHEMA_VERSION,
    id,
    workspaceId: "workspace-1",
    sessionId: "session-1",
    runId: "run-1",
    timestamp: `2026-07-24T12:00:${id.padStart(2, "0")}.000Z`,
    kind: "activity",
    source: "runtime",
    authority: "runtime-observed",
    status: "running",
    summary: `Evidence ${id}`,
    ...overrides,
  };
}

describe("TaskEvidenceLedger", () => {
  it("persists across relaunch and queries by correlation without duplicate ids", async () => {
    const userDataDir = await tempUserData();
    const first = new TaskEvidenceLedger(userDataDir, {
      now: () => new Date("2026-07-24T12:01:00.000Z"),
    });
    await first.appendMany([
      evidence("01", { kind: "command" }),
      evidence("02", { kind: "test", correlation: { commandId: "command-1" } }),
      evidence("02", { kind: "test", correlation: { commandId: "command-1" } }),
    ]);
    await first.flush();

    const relaunched = new TaskEvidenceLedger(userDataDir, {
      now: () => new Date("2026-07-24T12:01:00.000Z"),
    });
    const page = await relaunched.query({
      workspaceId: "workspace-1",
      sessionId: "session-1",
      runId: "run-1",
      kinds: ["test"],
    });

    expect(page.records.map((record) => record.id)).toEqual(["02"]);
    expect(page.records[0]?.correlation?.commandId).toBe("command-1");
    expect(page.hasMore).toBe(false);
  });

  it("bounds growth by count and age", async () => {
    const userDataDir = await tempUserData();
    const ledger = new TaskEvidenceLedger(userDataDir, {
      maxRecords: 3,
      maxAgeMs: 60_000,
      now: () => new Date("2026-07-24T12:01:00.000Z"),
    });
    await ledger.appendMany([
      evidence("00", { timestamp: "2026-07-24T11:00:00.000Z" }),
      evidence("01"),
      evidence("02"),
      evidence("03"),
      evidence("04"),
    ]);

    const page = await ledger.query({ workspaceId: "workspace-1", limit: 10 });
    expect(page.records.map((record) => record.id)).toEqual(["04", "03", "02"]);
  });

  it("returns compact groups without losing raw drill-down ids", async () => {
    const userDataDir = await tempUserData();
    const ledger = new TaskEvidenceLedger(userDataDir, {
      now: () => new Date("2026-07-24T12:01:00.000Z"),
    });
    await ledger.appendMany([
      evidence("01", { timestamp: "2026-07-24T12:00:01.000Z" }),
      evidence("02", { timestamp: "2026-07-24T12:00:02.000Z" }),
    ]);

    const page = await ledger.query({ workspaceId: "workspace-1", compact: true });
    expect(page.records.map((record) => record.id)).toEqual(["02", "01"]);
    expect(page.groups).toEqual([
      expect.objectContaining({
        count: 2,
        evidenceIds: ["01", "02"],
      }),
    ]);
  });

  it("redacts secrets and converts known paths to safe display paths", async () => {
    const userDataDir = await tempUserData();
    const ledger = new TaskEvidenceLedger(userDataDir, {
      now: () => new Date("2026-07-24T12:01:00.000Z"),
      homePath: "/Users/example",
      workspacePath: () => "/Users/example/project",
    });
    await ledger.append(evidence("01", {
      kind: "verification",
      summary: "Ran with API_KEY=super-secret-value for person@example.com",
      fileChange: {
        path: "/Users/example/project/src/main.ts",
        operation: "modify",
        ownership: "pi",
      },
      verification: {
        scope: "unit",
        command: "API_KEY=super-secret-value pnpm test /private/tmp/output.log",
        cwd: "/Users/example/project",
        relatedPaths: ["/Users/example/project/src/main.ts", "/Volumes/private/report.txt"],
      },
    }));

    const record = (await ledger.query({ workspaceId: "workspace-1" })).records[0];
    expect(record?.summary).toBe("Ran with API_KEY=[redacted] for [email]");
    expect(record?.fileChange?.path).toBe("src/main.ts");
    expect(record?.verification).toMatchObject({
      command: "API_KEY=[redacted] pnpm test [path]",
      cwd: ".",
      relatedPaths: ["src/main.ts", "[path]/report.txt"],
    });
  });

  it("recovers from malformed and newer-schema persisted values", async () => {
    const userDataDir = await tempUserData();
    const storeDir = join(userDataDir, "task-evidence");
    await mkdir(storeDir, { recursive: true });
    const storePath = join(storeDir, `${encodeURIComponent("workspace-1")}.json`);

    await writeFile(storePath, "{malformed", "utf8");
    const malformed = new TaskEvidenceLedger(userDataDir, {
      now: () => new Date("2026-07-24T12:01:00.000Z"),
    });
    expect((await malformed.query({ workspaceId: "workspace-1" })).records).toEqual([]);

    await writeFile(storePath, JSON.stringify({
      schemaVersion: 99,
      workspaceId: "workspace-1",
      records: [evidence("01")],
    }), "utf8");
    const newer = new TaskEvidenceLedger(userDataDir, {
      now: () => new Date("2026-07-24T12:01:00.000Z"),
    });
    expect((await newer.query({ workspaceId: "workspace-1" })).records).toEqual([]);

    await newer.append(evidence("02"));
    const persisted = JSON.parse(await readFile(storePath, "utf8")) as { schemaVersion: number };
    expect(persisted.schemaVersion).toBe(1);
  });
});
