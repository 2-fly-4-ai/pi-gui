export type UsageWindow = "task" | "24h" | "7d" | "30d" | "90d";
export type UsageCostKind = "provider-reported" | "subscription" | "estimated" | "unpriced";

export interface UsageRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly messageId: string;
  /** Stable user-message entry that owns one or more provider calls in an assistant turn. */
  readonly turnId?: string;
  readonly createdAt: string;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens?: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalTokens: number;
  readonly costUsd?: number;
  readonly costKind: UsageCostKind;
  readonly sourceKind: "assistant" | "compaction" | "branch-summary";
}

export interface UsageBucket {
  readonly key: string;
  readonly label: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly pricedRecords: number;
  readonly unpricedRecords: number;
  readonly turns: number;
}

export interface UsageQuery {
  readonly window: UsageWindow;
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly provider?: string;
  readonly model?: string;
}

export interface UsageDashboardSnapshot {
  readonly query: UsageQuery;
  readonly totals: UsageBucket;
  readonly trend: readonly UsageBucket[];
  readonly providers: readonly UsageBucket[];
  readonly models: readonly UsageBucket[];
  readonly workspaces: readonly UsageBucket[];
  readonly tasks: readonly UsageBucket[];
  readonly costKinds: Readonly<Record<UsageCostKind, number>>;
  readonly indexedAt: string;
  readonly recordCount: number;
  readonly sourceFileCount: number;
  readonly scannedFileCount: number;
  readonly unchangedFileCount: number;
  readonly prunedRecordCount: number;
  readonly indexBytes: number;
  readonly indexByteLimit: number;
  readonly retentionDays: number;
  readonly partial: boolean;
  readonly notes: readonly string[];
}
