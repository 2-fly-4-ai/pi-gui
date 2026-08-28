export const RESOURCE_HISTORY_MAX_POINTS = 900;
export const RESOURCE_PROCESS_MAX_ROWS = 20_000;
export const RESOURCE_HISTORY_MAX_BYTES = 16 * 1024 * 1024;

export type ResourceOwnerKind = "electron" | "runtime" | "terminal" | "vscode";
export type ResourceAttributionConfidence = "verified" | "lower";
export type ResourceHealth = "healthy" | "warning" | "critical";

export interface ResourceProcessIdentity {
  readonly pid: number;
  readonly startedAt: string;
}

export interface ResourceProcessRecord {
  readonly identity: ResourceProcessIdentity;
  readonly parentPid?: number;
  readonly processGroupId?: number;
  readonly ownerKind: ResourceOwnerKind;
  readonly confidence: ResourceAttributionConfidence;
  readonly ownerId: string;
  readonly label: string;
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly runtimeJobId?: string;
  readonly cpuPercent: number;
  readonly residentBytes: number;
  readonly descendantCount: number;
  readonly status: "running" | "exited" | "unknown";
  readonly stoppable: boolean;
}

export interface ResourceOwnerSummary {
  readonly ownerKind: ResourceOwnerKind;
  readonly confidence: ResourceAttributionConfidence;
  readonly ownerId: string;
  readonly label: string;
  readonly startedAt: string;
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly runtimeJobId?: string;
  readonly cpuPercent: number;
  readonly residentBytes: number;
  readonly processCount: number;
  readonly stoppable: boolean;
}

export interface ResourceHistoryPoint {
  readonly timestamp: string;
  readonly cpuPercent: number;
  readonly residentBytes: number;
  readonly processCount: number;
  readonly health: ResourceHealth;
}

export interface ResourceWarning {
  readonly id: string;
  readonly level: Exclude<ResourceHealth, "healthy">;
  readonly title: string;
  readonly message: string;
}

export interface ResourceInspectorSnapshot {
  readonly sampledAt: string;
  readonly health: ResourceHealth;
  readonly cpuPercent: number;
  readonly residentBytes: number;
  readonly systemMemoryBytes: number;
  readonly processCount: number;
  readonly mainHeapRatio: number;
  readonly rendererHeapRatio: number;
  readonly owners: readonly ResourceOwnerSummary[];
  readonly processes: readonly ResourceProcessRecord[];
  readonly history: readonly ResourceHistoryPoint[];
  readonly warnings: readonly ResourceWarning[];
  readonly sampling: {
    readonly intervalMs: number;
    readonly visible: boolean;
    readonly processRowsRetained: number;
    readonly historyBytes: number;
  };
}

export interface DiagnosticBundle {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly summary: string;
  readonly markdown: string;
  readonly resourceSnapshot: ResourceInspectorSnapshot;
}

export interface ResourceRuntimeRoot {
  readonly ownerKind: ResourceOwnerKind;
  readonly ownerId: string;
  readonly label: string;
  readonly pid: number;
  readonly startedAt?: string;
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly runtimeJobId?: string;
  readonly stoppable?: boolean;
  readonly confidence?: ResourceAttributionConfidence;
}

export interface ResourceProviderWait {
  readonly id: string;
  readonly label: string;
  readonly startedAt: string;
  readonly workspaceId: string;
  readonly sessionId: string;
}
