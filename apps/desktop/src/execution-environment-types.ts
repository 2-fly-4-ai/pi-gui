export const EXECUTION_PROTOCOL_VERSION = 1 as const;

export interface ExecutionEnvironmentCapabilities {
  readonly filesystem: "none" | "read-only" | "read-write";
  readonly process: "none" | "read-only" | "spawn";
  readonly terminal: boolean;
  readonly git: "none" | "status" | "read-write";
  readonly runtimeProvider: boolean;
  readonly editorOpen: boolean;
  readonly watch: boolean;
  readonly reconnect: boolean;
}

export interface ExecutionDirectoryEntry {
  readonly name: string;
  readonly kind: "file" | "directory" | "symlink" | "other";
}

export interface ExecutionGitStatusEntry {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly staged: boolean;
}

export type LoopbackRemoteStatus = "disabled" | "stopped" | "connecting" | "connected" | "disconnected" | "error";

export interface LoopbackRemoteSnapshot {
  readonly enabled: boolean;
  readonly status: LoopbackRemoteStatus;
  readonly protocolVersion: number;
  readonly generation: number;
  readonly pid?: number;
  readonly connectedAt?: string;
  readonly lastHeartbeatAt?: string;
  readonly root?: string;
  readonly capabilities?: ExecutionEnvironmentCapabilities;
  readonly lastError?: string;
}

export interface LoopbackRemoteProbe {
  readonly snapshot: LoopbackRemoteSnapshot;
  readonly health: { readonly ok: true; readonly uptimeMs: number };
  readonly root: string;
  readonly entries: readonly ExecutionDirectoryEntry[];
  readonly git: readonly ExecutionGitStatusEntry[];
}
