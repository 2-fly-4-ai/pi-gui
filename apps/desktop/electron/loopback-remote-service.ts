import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { ExecutionDirectoryEntry, ExecutionEnvironmentCapabilities, ExecutionGitStatusEntry, LoopbackRemoteProbe, LoopbackRemoteSnapshot } from "../src/execution-environment-types";
import { EXECUTION_PROTOCOL_VERSION } from "../src/execution-environment-types";
import { encodeRemoteFrame, MAX_REMOTE_PENDING_REQUESTS, RemoteFrameDecoder, validateRemoteResponse, type RemoteRequest } from "./remote-execution-protocol";

const REQUEST_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 2_000;
const HEARTBEAT_FAILURE_LIMIT = 3;

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export class LoopbackRemoteService {
  private child?: ChildProcessWithoutNullStreams;
  private credential?: string;
  private pending = new Map<string, PendingRequest>();
  private heartbeat?: NodeJS.Timeout;
  private heartbeatFailures = 0;
  private generation = 0;
  private state: LoopbackRemoteSnapshot;

  constructor(
    private readonly enabled = process.env.PI_APP_EXPERIMENTAL_REMOTE_EXECUTION === "1",
    private readonly helperPath = join(__dirname, "remote-execution-helper.js"),
  ) {
    this.state = { enabled, status: enabled ? "stopped" : "disabled", protocolVersion: EXECUTION_PROTOCOL_VERSION, generation: 0 };
  }

  snapshot(): LoopbackRemoteSnapshot { return this.state; }

  async launch(workspaceRoot: string): Promise<LoopbackRemoteSnapshot> {
    if (!this.enabled) throw new Error("Loopback remote execution is disabled. Set PI_APP_EXPERIMENTAL_REMOTE_EXECUTION=1 for this development-only spike.");
    await this.shutdown();
    this.generation += 1;
    const generation = this.generation;
    this.credential = randomBytes(32).toString("base64url");
    this.state = { enabled: true, status: "connecting", protocolVersion: EXECUTION_PROTOCOL_VERSION, generation };
    const child = spawn(process.execPath, [this.helperPath], {
      cwd: process.cwd(),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PI_LOOPBACK_CREDENTIAL: this.credential, PI_LOOPBACK_ROOT: resolve(workspaceRoot) },
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    this.child = child;
    const decoder = new RemoteFrameDecoder();
    child.stdout.on("data", (chunk: Buffer) => {
      try { for (const value of decoder.push(chunk)) this.receive(value, generation); }
      catch (error) { this.fail(error); }
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2_000); });
    child.once("error", (error) => this.fail(error));
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.stopHeartbeat();
      const expected = this.state.status === "stopped";
      this.rejectPending(new Error("Loopback helper disconnected."));
      if (!expected) this.state = { ...this.state, status: "disconnected", pid: undefined, lastError: redact(`${stderr || `Helper exited (${code ?? signal ?? "unknown"}).`}`) };
    });
    try {
      const hello = await this.request<{ protocolVersion: number; capabilities: ExecutionEnvironmentCapabilities }>("hello");
      if (hello.protocolVersion !== EXECUTION_PROTOCOL_VERSION) throw new Error(`Protocol mismatch: helper ${hello.protocolVersion}, app ${EXECUTION_PROTOCOL_VERSION}.`);
      const root = await this.request<{ root: string }>("root");
      const connectedAt = new Date().toISOString();
      this.state = { enabled: true, status: "connected", protocolVersion: hello.protocolVersion, generation, pid: child.pid, connectedAt, lastHeartbeatAt: connectedAt, root: redactPath(root.root), capabilities: hello.capabilities };
      this.startHeartbeat();
      return this.state;
    } catch (error) {
      await this.forceStop();
      this.state = { enabled: true, status: "error", protocolVersion: EXECUTION_PROTOCOL_VERSION, generation, lastError: redact(message(error)) };
      throw error;
    }
  }

  async probe(relativePath = "."): Promise<LoopbackRemoteProbe> {
    this.requireConnected();
    const [health, root, directory, git] = await Promise.all([
      this.request<{ ok: true; uptimeMs: number }>("health"),
      this.request<{ root: string }>("root"),
      this.request<{ entries: readonly ExecutionDirectoryEntry[] }>("listDirectory", { path: relativePath }),
      this.request<{ entries: readonly ExecutionGitStatusEntry[] }>("gitStatus"),
    ]);
    return { snapshot: this.state, health, root: redactPath(root.root), entries: directory.entries.slice(0, 200), git: git.entries.slice(0, 2_000) };
  }

  async shutdown(): Promise<LoopbackRemoteSnapshot> {
    if (!this.child) {
      if (this.enabled && this.state.status !== "disabled") this.state = { enabled: true, status: "stopped", protocolVersion: EXECUTION_PROTOCOL_VERSION, generation: this.generation };
      return this.state;
    }
    const child = this.child;
    this.state = { ...this.state, status: "stopped", pid: undefined };
    this.stopHeartbeat();
    try { await this.request("shutdown", undefined, 1_000); } catch { /* hard stop below */ }
    if (this.child === child) await this.forceStop();
    this.credential = undefined;
    this.rejectPending(new Error("Loopback helper shut down."));
    this.state = { enabled: true, status: "stopped", protocolVersion: EXECUTION_PROTOCOL_VERSION, generation: this.generation };
    return this.state;
  }

  dispose(): void { void this.forceStop(); this.credential = undefined; this.stopHeartbeat(); this.rejectPending(new Error("Loopback service disposed.")); }

  async request<T = unknown>(method: RemoteRequest["method"], params?: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS, signal?: AbortSignal): Promise<T> {
    const child = this.child;
    const credential = this.credential;
    if (!child || !credential || !child.stdin.writable) throw new Error("Loopback helper is not connected.");
    if (this.pending.size >= MAX_REMOTE_PENDING_REQUESTS) throw new Error("Loopback pending request limit reached.");
    signal?.throwIfAborted();
    const id = randomUUID();
    const request: RemoteRequest = { version: EXECUTION_PROTOCOL_VERSION, id, credential, method, params };
    return new Promise<T>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.sendCancel(id);
        rejectRequest(new Error(`Loopback ${method} request timed out.`));
      }, Math.max(50, Math.min(timeoutMs, 30_000)));
      const abort = () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        this.sendCancel(id);
        rejectRequest(new Error("Loopback request cancelled."));
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, {
        timer,
        resolve: (value) => { signal?.removeEventListener("abort", abort); resolveRequest(value as T); },
        reject: (error) => { signal?.removeEventListener("abort", abort); rejectRequest(error); },
      });
      child.stdin.write(encodeRemoteFrame(request), (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error);
      });
    });
  }

  simulateChildCrashForTest(): void { this.child?.kill("SIGKILL"); }

  private receive(value: unknown, generation: number): void {
    if (generation !== this.generation) return;
    const response = validateRemoteResponse(value);
    const pending = this.pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new Error(response.error?.message || "Loopback operation failed."));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.state.status !== "connected") return;
      void this.request("health", undefined, 1_000).then(() => {
        this.heartbeatFailures = 0;
        this.state = { ...this.state, lastHeartbeatAt: new Date().toISOString() };
      }).catch((error) => {
        this.heartbeatFailures += 1;
        if (this.heartbeatFailures < HEARTBEAT_FAILURE_LIMIT) return;
        this.state = { ...this.state, status: "disconnected", lastError: redact(message(error)) };
        void this.forceStop();
      });
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();
  }

  private stopHeartbeat(): void { if (this.heartbeat) clearInterval(this.heartbeat); this.heartbeat = undefined; this.heartbeatFailures = 0; }
  private requireConnected(): void { if (this.state.status !== "connected") throw new Error("Loopback helper is not connected."); }
  private sendCancel(targetId: string): void {
    if (!this.child || !this.credential || !this.child.stdin.writable) return;
    try { this.child.stdin.write(encodeRemoteFrame({ version: EXECUTION_PROTOCOL_VERSION, id: randomUUID(), credential: this.credential, method: "cancel", params: { targetId } })); } catch { /* disconnect owns cleanup */ }
  }
  private fail(error: unknown): void { this.state = { ...this.state, status: "error", lastError: redact(message(error)), pid: undefined }; void this.forceStop(); }
  private rejectPending(error: Error): void { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); }
  private async forceStop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    child.stdin.destroy();
    if (!child.killed) child.kill("SIGTERM");
    await new Promise<void>((resolveDone) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolveDone(); return; }
      const timer = setTimeout(() => { if (!child.killed || child.exitCode === null) child.kill("SIGKILL"); resolveDone(); }, 1_000);
      child.once("exit", () => { clearTimeout(timer); resolveDone(); });
    });
  }
}

function redactPath(path: string): string { const home = homedir(); return path === home ? "~" : path.startsWith(`${home}/`) ? `~/${relative(home, path)}` : path; }
function redact(value: string): string { return value.replaceAll(/[A-Za-z0-9_-]{32,}/g, "<redacted>").slice(0, 1_000); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
