export type ObservabilitySeverity = "info" | "warning" | "error";

export type ObservabilityCategory =
  | "desktop"
  | "renderer"
  | "agent"
  | "tool"
  | "skill"
  | "subagent"
  | "workspace"
  | "slash-command";

export interface ObservabilityEventSource {
  readonly kind: "desktop-log" | "native-crash-report" | "subagents-audit" | "session-jsonl" | "transcript" | "ledger";
  readonly path?: string;
  readonly line?: number;
}

export interface ObservabilityEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly severity: ObservabilitySeverity;
  readonly category: ObservabilityCategory;
  readonly event: string;
  readonly title: string;
  readonly message?: string;
  readonly source: ObservabilityEventSource;
  readonly correlation?: {
    readonly desktopSessionId?: string;
    readonly workspaceId?: string;
    readonly sessionId?: string;
    readonly parentToolCallId?: string;
    readonly toolCallId?: string;
    readonly subagentId?: string;
    readonly runId?: string;
  };
  readonly workspace?: {
    readonly id?: string;
    readonly name?: string;
    readonly selectedPath?: string;
    readonly runtimeCwd?: string;
    readonly repoRoot?: string;
    readonly workspaceRoot?: string;
  };
  readonly agent?: {
    readonly kind?: "parent" | "subagent";
    readonly type?: string;
    readonly displayName?: string;
    readonly description?: string;
    readonly model?: string;
    readonly thinking?: string;
    readonly status?: string;
  };
  readonly tool?: {
    readonly name?: string;
    readonly argsExcerpt?: string;
    readonly isError?: boolean;
  };
  readonly skill?: {
    readonly name?: string;
    readonly path?: string;
    readonly trigger?: "auto" | "explicit" | "preload";
  };
  readonly durationMs?: number;
  readonly raw?: unknown;
}

export interface ObservabilityQuery {
  readonly workspaceId?: string;
  readonly workspacePath?: string;
  readonly sessionId?: string;
  readonly includeGlobal?: boolean;
  readonly severity?: readonly ObservabilitySeverity[];
  readonly category?: readonly ObservabilityCategory[];
  readonly query?: string;
  readonly since?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ObservabilityEventPage {
  readonly events: readonly ObservabilityEvent[];
  readonly nextCursor?: string;
  readonly scannedSources: readonly string[];
  readonly warnings: readonly string[];
}
