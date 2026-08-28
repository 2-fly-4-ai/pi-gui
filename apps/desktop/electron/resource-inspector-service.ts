import { app, type BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { getHeapStatistics } from "node:v8";
import type {
  DiagnosticBundle,
  ResourceHealth,
  ResourceHistoryPoint,
  ResourceInspectorSnapshot,
  ResourceOwnerSummary,
  ResourceProcessRecord,
  ResourceProviderWait,
  ResourceRuntimeRoot,
  ResourceWarning,
} from "../src/resource-inspector-types";
import {
  RESOURCE_HISTORY_MAX_BYTES,
  RESOURCE_HISTORY_MAX_POINTS,
  RESOURCE_PROCESS_MAX_ROWS,
} from "../src/resource-inspector-types";
import { logIgnoredError } from "./diagnostics";

const execFileAsync = promisify(execFile);
const BACKGROUND_INTERVAL_MS = 15_000;
const VISIBLE_INTERVAL_MS = 1_000;
const FRESH_SAMPLE_MS = 800;
const MAX_VISIBLE_PROCESSES = 500;

export interface ProcessSample {
  readonly pid: number;
  readonly parentPid: number;
  readonly processGroupId: number;
  readonly cpuPercent: number;
  readonly residentBytes: number;
  readonly startedAt: string;
}

export interface ResourceInspectorServiceOptions {
  readonly getWindow: () => BrowserWindow | null;
  readonly getRuntimeRoots: () => Promise<readonly ResourceRuntimeRoot[]> | readonly ResourceRuntimeRoot[];
  readonly getProviderWaits?: () => Promise<readonly ResourceProviderWait[]> | readonly ResourceProviderWait[];
  readonly getDiagnostics: () => Record<string, number>;
  readonly getAppSummary: () => Promise<ResourceInspectorAppSummary> | ResourceInspectorAppSummary;
  readonly getRecentFailureTitles?: () => Promise<readonly string[]> | readonly string[];
}

export interface ResourceInspectorAppSummary {
    readonly activeView: string;
    readonly workspaceCount: number;
    readonly sessionCount: number;
    readonly connectedProviderCount: number;
    readonly availableModelCount: number;
    readonly terminalCount: number;
    readonly vscodeServerCount: number;
    readonly selectedWorkspaceId?: string;
    readonly selectedSessionId?: string;
}

export class ResourceInspectorService {
  private history: ResourceHistoryPoint[] = [];
  private current: ResourceInspectorSnapshot | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sampleInFlight: Promise<ResourceInspectorSnapshot> | undefined;
  private visible = false;
  private stopped = false;
  private processRowsRetained = 0;
  private readonly warningStreaks = new Map<string, number>();

  constructor(private readonly options: ResourceInspectorServiceOptions) {}

  start(): void {
    if (this.stopped || this.timer || this.sampleInFlight) return;
    void this.sample().finally(() => this.schedule());
  }

  dispose(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.stopped) void this.sample().finally(() => this.schedule());
  }

  async getSnapshot(): Promise<ResourceInspectorSnapshot> {
    const age = this.current ? Date.now() - Date.parse(this.current.sampledAt) : Number.POSITIVE_INFINITY;
    return age <= FRESH_SAMPLE_MS ? this.current as ResourceInspectorSnapshot : this.sample();
  }

  async buildDiagnosticBundle(): Promise<DiagnosticBundle> {
    const resourceSnapshot = await this.getSnapshot();
    const appSummary = await this.options.getAppSummary();
    const diagnostics = this.options.getDiagnostics();
    const recentFailureTitles = (await this.options.getRecentFailureTitles?.()) ?? [];
    const counters = Object.entries(diagnostics)
      .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, 80);
    const markdown = [
      "# Diagnose Pi",
      "",
      `Generated: ${resourceSnapshot.sampledAt}`,
      `Platform: ${process.platform} ${process.arch}`,
      `Versions: Electron ${process.versions.electron ?? "unknown"}; Node ${process.versions.node}; Chrome ${process.versions.chrome ?? "unknown"}`,
      `View: ${appSummary.activeView}`,
      `Workspaces: ${appSummary.workspaceCount}; tasks: ${appSummary.sessionCount}`,
      `Connected providers: ${appSummary.connectedProviderCount}; available models: ${appSummary.availableModelCount}`,
      `Integrated terminals: ${appSummary.terminalCount}; VS Code servers: ${appSummary.vscodeServerCount}`,
      `Selected workspace: ${appSummary.selectedWorkspaceId ? "present" : "none"}; selected task: ${appSummary.selectedSessionId ? "present" : "none"}`,
      "",
      "## Resources",
      "",
      `Health: ${resourceSnapshot.health}`,
      `CPU: ${resourceSnapshot.cpuPercent.toFixed(1)}%`,
      `Resident memory: ${formatBytes(resourceSnapshot.residentBytes)}`,
      `Owned processes: ${resourceSnapshot.processCount}`,
      ...resourceSnapshot.warnings.map((warning) => `- ${warning.level}: ${warning.title} — ${warning.message}`),
      "",
      "## Recent failure summaries",
      "",
      ...(recentFailureTitles.length > 0 ? recentFailureTitles.slice(0, 10).map((title) => `- ${title.slice(0, 160)}`) : ["- No recent failure summaries found."]),
      "",
      "## Safe local locations",
      "",
      "- App logs: userData/logs",
      "- Crash reports: userData/crash-reports (only when enabled)",
      "",
      "## Bounded runtime counters",
      "",
      ...counters.map(([name, value]) => `- ${name}: ${value}`),
      "",
      "> Paths, commands, prompts, environment values, provider credentials, and transcript content are intentionally excluded.",
    ].join("\n");
    return {
      schemaVersion: 1,
      generatedAt: resourceSnapshot.sampledAt,
      summary: `Pi ${resourceSnapshot.health}; ${resourceSnapshot.processCount} owned processes; ${formatBytes(resourceSnapshot.residentBytes)} resident`,
      markdown,
      resourceSnapshot,
    };
  }

  private schedule(): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.sample().finally(() => this.schedule());
    }, this.visible ? VISIBLE_INTERVAL_MS : BACKGROUND_INTERVAL_MS);
    this.timer.unref?.();
  }

  private sample(): Promise<ResourceInspectorSnapshot> {
    if (this.sampleInFlight) return this.sampleInFlight;
    this.sampleInFlight = this.collect()
      .catch((error) => {
        logIgnoredError("resource-inspector.sample", error);
        if (this.current) return this.current;
        return emptySnapshot(this.visible);
      })
      .finally(() => {
        this.sampleInFlight = undefined;
      });
    return this.sampleInFlight;
  }

  private async collect(): Promise<ResourceInspectorSnapshot> {
    const sampledAt = new Date().toISOString();
    const roots = dedupeRoots([
      await this.options.getRuntimeRoots(),
      electronRoots(this.options.getWindow()),
    ].flat());
    const providerWaits = (await this.options.getProviderWaits?.()) ?? [];
    const processSamples = await readProcessTable();
    const heapRatios = await readHeapRatios(this.options.getWindow());
    const processByPid = new Map(processSamples.map((sample) => [sample.pid, sample]));
    const childrenByParent = new Map<number, number[]>();
    for (const sample of processSamples) {
      const children = childrenByParent.get(sample.parentPid) ?? [];
      children.push(sample.pid);
      childrenByParent.set(sample.parentPid, children);
    }

    const claimedPids = new Set<number>();
    const processes: ResourceProcessRecord[] = [];
    const owners: ResourceOwnerSummary[] = [];
    for (const root of roots) {
      const descendantPids = root.ownerKind === "electron" ? [] : collectDescendants(root.pid, childrenByParent);
      const ownedPids = [root.pid, ...descendantPids].filter((pid) => !claimedPids.has(pid));
      ownedPids.forEach((pid) => claimedPids.add(pid));
      const ownedSamples = ownedPids.map((pid) => processByPid.get(pid)).filter((value): value is ProcessSample => Boolean(value));
      const rootSample = processByPid.get(root.pid);
      if (!rootSample || !processIdentityMatches(root, rootSample)) continue;
      const cpuPercent = sum(ownedSamples.map((sample) => sample.cpuPercent));
      const residentBytes = sum(ownedSamples.map((sample) => sample.residentBytes));
      const processCount = ownedSamples.length;
      owners.push({
        ownerKind: root.ownerKind,
        confidence: root.confidence ?? (root.startedAt ? "verified" : "lower"),
        ownerId: root.ownerId,
        label: root.label,
        startedAt: rootSample.startedAt,
        ...(root.workspaceId ? { workspaceId: root.workspaceId } : {}),
        ...(root.sessionId ? { sessionId: root.sessionId } : {}),
        ...(root.runtimeJobId ? { runtimeJobId: root.runtimeJobId } : {}),
        cpuPercent,
        residentBytes,
        processCount,
        stoppable: root.stoppable === true,
      });
      for (const pid of ownedPids) {
        const sample = processByPid.get(pid);
        if (!sample) continue;
        processes.push({
          identity: { pid, startedAt: sample.startedAt },
          parentPid: sample.parentPid,
          processGroupId: sample.processGroupId,
          ownerKind: root.ownerKind,
          confidence: root.confidence ?? (root.startedAt ? "verified" : "lower"),
          ownerId: root.ownerId,
          label: pid === root.pid ? root.label : `${root.label} child`,
          ...(root.workspaceId ? { workspaceId: root.workspaceId } : {}),
          ...(root.sessionId ? { sessionId: root.sessionId } : {}),
          ...(root.runtimeJobId ? { runtimeJobId: root.runtimeJobId } : {}),
          cpuPercent: sample.cpuPercent,
          residentBytes: sample.residentBytes,
          descendantCount: childrenByParent.get(pid)?.length ?? 0,
          status: "running",
          stoppable: pid === root.pid && root.stoppable === true,
        });
      }
    }

    owners.sort((left, right) => right.residentBytes - left.residentBytes || right.cpuPercent - left.cpuPercent);
    processes.sort((left, right) => right.residentBytes - left.residentBytes || right.cpuPercent - left.cpuPercent);
    const residentBytes = sum(owners.map((owner) => owner.residentBytes));
    const cpuPercent = sum(owners.map((owner) => owner.cpuPercent));
    const systemMemoryBytes = os.totalmem();
    const health = classifyHealth(cpuPercent, residentBytes, systemMemoryBytes, heapRatios);
    const historyPoint: ResourceHistoryPoint = {
      timestamp: sampledAt,
      cpuPercent,
      residentBytes,
      processCount: processes.length,
      health,
    };
    this.history = retainResourceHistory([...this.history, historyPoint]);
    this.processRowsRetained = Math.min(RESOURCE_PROCESS_MAX_ROWS, this.processRowsRetained + processes.length);
    const historyBytes = Buffer.byteLength(JSON.stringify(this.history), "utf8");
    const snapshot: ResourceInspectorSnapshot = {
      sampledAt,
      health,
      cpuPercent,
      residentBytes,
      systemMemoryBytes,
      processCount: processes.length,
      mainHeapRatio: heapRatios.mainHeapRatio,
      rendererHeapRatio: heapRatios.rendererHeapRatio,
      owners,
      processes: processes.slice(0, MAX_VISIBLE_PROCESSES),
      history: this.history,
      warnings: this.buildWarningsWithHysteresis({
        cpuPercent,
        residentBytes,
        systemMemoryBytes,
        processCount: processes.length,
        mainHeapRatio: heapRatios.mainHeapRatio,
        rendererHeapRatio: heapRatios.rendererHeapRatio,
        owners,
        providerWaits,
      }),
      sampling: {
        intervalMs: this.visible ? VISIBLE_INTERVAL_MS : BACKGROUND_INTERVAL_MS,
        visible: this.visible,
        processRowsRetained: this.processRowsRetained,
        historyBytes,
      },
    };
    this.current = snapshot;
    return snapshot;
  }

  private buildWarningsWithHysteresis(input: {
    readonly cpuPercent: number;
    readonly residentBytes: number;
    readonly systemMemoryBytes: number;
    readonly processCount: number;
    readonly mainHeapRatio: number;
    readonly rendererHeapRatio: number;
    readonly owners: readonly ResourceOwnerSummary[];
    readonly providerWaits: readonly ResourceProviderWait[];
  }): ResourceWarning[] {
    const candidates = resourceWarningCandidates(input, this.history);
    return updateWarningStreaks(candidates, this.warningStreaks);
  }
}

function electronRoots(window: BrowserWindow | null): ResourceRuntimeRoot[] {
  const selectedRendererPid = window && !window.isDestroyed() && !window.webContents.isDestroyed()
    ? window.webContents.getOSProcessId()
    : undefined;
  return app.getAppMetrics().map((metric) => ({
    ownerKind: "electron" as const,
    ownerId: `electron:${metric.pid}`,
    label: metric.pid === selectedRendererPid ? "Pi renderer" : `Electron ${metric.type}`,
    pid: metric.pid,
    confidence: "verified" as const,
  }));
}

async function readHeapRatios(window: BrowserWindow | null): Promise<{ readonly mainHeapRatio: number; readonly rendererHeapRatio: number }> {
  const heapLimit = getHeapStatistics().heap_size_limit;
  const mainHeapRatio = heapLimit > 0 ? process.memoryUsage().heapUsed / heapLimit : 0;
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return { mainHeapRatio, rendererHeapRatio: 0 };
  const rendererHeapRatio = await window.webContents.executeJavaScript(`
    (() => {
      const memory = performance.memory;
      return memory && memory.jsHeapSizeLimit > 0 ? memory.usedJSHeapSize / memory.jsHeapSizeLimit : 0;
    })()
  `).catch(() => 0) as number;
  return { mainHeapRatio, rendererHeapRatio: Number.isFinite(rendererHeapRatio) ? rendererHeapRatio : 0 };
}

async function readProcessTable(): Promise<ProcessSample[]> {
  if (process.platform === "win32") return [];
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,pgid=,%cpu=,rss=,lstart="], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 5_000,
  });
  return stdout.split("\n").map(parseProcessLine).filter((value): value is ProcessSample => Boolean(value));
}

export function parseProcessLine(line: string): ProcessSample | undefined {
  const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+?)\s*$/);
  if (!match) return undefined;
  const [, pidText, parentText, groupText, cpuText, rssText, startedText] = match;
  if (!pidText || !parentText || !groupText || !cpuText || !rssText || !startedText) return undefined;
  const started = new Date(startedText);
  const pid = Number(pidText);
  const parentPid = Number(parentText);
  const processGroupId = Number(groupText);
  const cpuPercent = Number(cpuText);
  const rssKb = Number(rssText);
  if (![pid, parentPid, processGroupId, cpuPercent, rssKb].every(Number.isFinite) || Number.isNaN(started.getTime())) return undefined;
  return {
    pid,
    parentPid,
    processGroupId,
    cpuPercent,
    residentBytes: rssKb * 1024,
    startedAt: started.toISOString(),
  };
}

function collectDescendants(rootPid: number, childrenByParent: ReadonlyMap<number, readonly number[]>): number[] {
  const descendants: number[] = [];
  const seen = new Set([rootPid]);
  const queue = [...(childrenByParent.get(rootPid) ?? [])];
  while (queue.length > 0 && descendants.length < RESOURCE_PROCESS_MAX_ROWS) {
    const pid = queue.shift();
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    descendants.push(pid);
    queue.push(...(childrenByParent.get(pid) ?? []));
  }
  return descendants;
}

function dedupeRoots(roots: readonly ResourceRuntimeRoot[]): ResourceRuntimeRoot[] {
  const byPid = new Map<number, ResourceRuntimeRoot>();
  for (const root of roots) {
    if (!Number.isSafeInteger(root.pid) || root.pid <= 1) continue;
    const existing = byPid.get(root.pid);
    if (!existing || (root.ownerKind !== "electron" && existing.ownerKind === "electron")) byPid.set(root.pid, root);
  }
  return [...byPid.values()];
}

function classifyHealth(
  cpuPercent: number,
  residentBytes: number,
  totalMemoryBytes: number,
  heapRatios: { readonly mainHeapRatio: number; readonly rendererHeapRatio: number },
): ResourceHealth {
  const memoryRatio = totalMemoryBytes > 0 ? residentBytes / totalMemoryBytes : 0;
  const heapRatio = Math.max(heapRatios.mainHeapRatio, heapRatios.rendererHeapRatio);
  if (memoryRatio >= 0.5 || cpuPercent >= 600 || heapRatio >= 0.85) return "critical";
  if (memoryRatio >= 0.3 || cpuPercent >= 300 || heapRatio >= 0.7) return "warning";
  return "healthy";
}

export function resourceWarningCandidates(input: {
  readonly cpuPercent: number;
  readonly residentBytes: number;
  readonly systemMemoryBytes: number;
  readonly processCount: number;
  readonly mainHeapRatio: number;
  readonly rendererHeapRatio: number;
  readonly owners: readonly ResourceOwnerSummary[];
  readonly providerWaits: readonly ResourceProviderWait[];
}, history: readonly ResourceHistoryPoint[]): ResourceWarning[] {
  const warnings: ResourceWarning[] = [];
  const memoryRatio = input.systemMemoryBytes > 0 ? input.residentBytes / input.systemMemoryBytes : 0;
  if (memoryRatio >= 0.3) warnings.push({
    id: "owned-memory",
    level: memoryRatio >= 0.5 ? "critical" : "warning",
    title: "High Pi memory use",
    message: `${Math.round(memoryRatio * 100)}% of system memory is resident across Pi-owned processes.`,
  });
  if (input.cpuPercent >= 300) warnings.push({
    id: "owned-cpu",
    level: input.cpuPercent >= 600 ? "critical" : "warning",
    title: "High sustained work",
    message: `Pi-owned processes are using ${input.cpuPercent.toFixed(0)}% CPU across cores.`,
  });
  const maxHeapRatio = Math.max(input.mainHeapRatio, input.rendererHeapRatio);
  if (maxHeapRatio >= 0.7) warnings.push({
    id: "heap-pressure",
    level: maxHeapRatio >= 0.85 ? "critical" : "warning",
    title: "JavaScript heap pressure",
    message: `The busiest Pi heap is at ${Math.round(maxHeapRatio * 100)}% of its runtime limit.`,
  });
  const comparison = history.at(Math.max(0, history.length - 6));
  if (comparison && input.residentBytes - comparison.residentBytes >= 256 * 1024 * 1024) warnings.push({
    id: "memory-growth",
    level: "warning",
    title: "Memory is growing",
    message: `Resident memory grew ${formatBytes(input.residentBytes - comparison.residentBytes)} across recent samples.`,
  });
  const recent = history.slice(-10);
  const averageProcessCount = recent.length > 0 ? sum(recent.map((point) => point.processCount)) / recent.length : input.processCount;
  if (input.processCount >= 20 && input.processCount >= averageProcessCount * 1.8) warnings.push({
    id: "process-multiplication",
    level: "warning",
    title: "Owned process count increased",
    message: `${input.processCount} Pi-owned processes are active, well above the recent average.`,
  });
  const staleOwner = input.owners.find((owner) => (
    owner.ownerKind === "runtime"
    && owner.cpuPercent < 0.1
    && owner.processCount > 0
    && Date.now() - Date.parse(owner.startedAt) >= 5 * 60_000
  ));
  if (staleOwner) warnings.push({
    id: `stale-runtime:${staleOwner.ownerId}`,
    level: "warning",
    title: "Runtime job may be stale",
    message: `${staleOwner.label} is still owned but has shown no measurable CPU activity.`,
  });
  for (const wait of input.providerWaits.slice(0, 20)) {
    const elapsedMs = Date.now() - Date.parse(wait.startedAt);
    if (!Number.isFinite(elapsedMs) || elapsedMs < 2 * 60_000) continue;
    warnings.push({
      id: `provider-wait:${wait.id}`,
      level: elapsedMs >= 10 * 60_000 ? "critical" : "warning",
      title: "Provider response is delayed",
      message: `${wait.label} has been waiting for a provider for ${Math.max(2, Math.floor(elapsedMs / 60_000))} minutes.`,
    });
  }
  return warnings;
}

export function processIdentityMatches(root: ResourceRuntimeRoot, sample: ProcessSample): boolean {
  if (!root.startedAt) return true;
  const expected = Date.parse(root.startedAt);
  const observed = Date.parse(sample.startedAt);
  return Number.isFinite(expected) && Number.isFinite(observed) && Math.abs(expected - observed) <= 2_000;
}

export function retainResourceHistory(history: ResourceHistoryPoint[]): ResourceHistoryPoint[] {
  const latestTimestamp = Date.parse(history.at(-1)?.timestamp ?? "");
  const cutoff = Number.isFinite(latestTimestamp) ? latestTimestamp - 15 * 60_000 : Number.NEGATIVE_INFINITY;
  let retained = history.filter((point) => Date.parse(point.timestamp) >= cutoff).slice(-RESOURCE_HISTORY_MAX_POINTS);
  while (retained.length > 1 && Buffer.byteLength(JSON.stringify(retained), "utf8") > RESOURCE_HISTORY_MAX_BYTES) {
    retained = retained.slice(Math.ceil(retained.length / 4));
  }
  return retained;
}

export function updateWarningStreaks(
  candidates: readonly ResourceWarning[],
  streaks: Map<string, number>,
  minimumSamples = 3,
): ResourceWarning[] {
  const activeIds = new Set(candidates.map((warning) => warning.id));
  for (const id of streaks.keys()) {
    if (!activeIds.has(id)) streaks.set(id, 0);
  }
  return candidates.filter((warning) => {
    const streak = (streaks.get(warning.id) ?? 0) + 1;
    streaks.set(warning.id, streak);
    return streak >= minimumSamples;
  });
}

function emptySnapshot(visible: boolean): ResourceInspectorSnapshot {
  return {
    sampledAt: new Date().toISOString(),
    health: "healthy",
    cpuPercent: 0,
    residentBytes: 0,
    systemMemoryBytes: os.totalmem(),
    processCount: 0,
    mainHeapRatio: 0,
    rendererHeapRatio: 0,
    owners: [],
    processes: [],
    history: [],
    warnings: [],
    sampling: { intervalMs: visible ? VISIBLE_INTERVAL_MS : BACKGROUND_INTERVAL_MS, visible, processRowsRetained: 0, historyBytes: 2 },
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}
