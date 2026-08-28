import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { SessionCatalogSnapshot, WorkspaceCatalogSnapshot, WorkspaceId } from "@pi-gui/catalogs";
import type {
  NavigateSessionTreeOptions,
  NavigateSessionTreeResult,
  SessionQueuedMessage,
  SessionTreeSnapshot,
} from "@pi-gui/session-driver/types";
import type {
  CreateSessionOptions,
  HostUiResponse,
  SessionDriver,
  SessionEventListener,
  SessionModelSelection,
  SessionRef,
  ToolAccessSelection,
  SessionSnapshot,
  SessionMessageInput,
  Unsubscribe,
  WorkspaceRef,
} from "@pi-gui/session-driver";
import {
  SessionSupervisor,
  type PiSdkDriverOptions,
  type SyncWorkspaceResult,
} from "./session-supervisor.js";
import { RuntimeSupervisor, type RuntimeSupervisorOptions } from "./runtime-supervisor.js";
import { createRuntimeDependencies } from "./runtime-deps.js";
import { createAgentSessionRuntimeWithNpmFallback } from "./npm-package-fallback.js";
import { generateThreadTitle, type GenerateThreadTitleOptions } from "./thread-title-generator.js";

export interface PiSdkDriverConfig extends PiSdkDriverOptions, RuntimeSupervisorOptions {}

export class PiSdkDriver implements SessionDriver {
  private readonly supervisor: SessionSupervisor;
  private readonly agentDir: string;
  private readonly getModelRuntime: () => Promise<ModelRuntime>;
  private readonly generateThreadTitleOverride:
    | ((workspace: WorkspaceRef, options: GenerateThreadTitleOptions) => Promise<string | null | undefined>)
    | undefined;
  readonly runtimeSupervisor: RuntimeSupervisor;

  constructor(options: PiSdkDriverConfig = {}) {
    const deps = createRuntimeDependencies(options);
    this.agentDir = deps.agentDir;
    this.getModelRuntime = deps.getModelRuntime;
    this.generateThreadTitleOverride = options.generateThreadTitleOverride;

    this.supervisor = new SessionSupervisor({
      ...options,
      getModelRuntime: deps.getModelRuntime,
      createAgentSessionRuntimeImpl: options.createAgentSessionRuntimeImpl
        ?? ((createOptions) => createAgentSessionRuntimeWithNpmFallback(
          createOptions,
          options.skillCatalogFilePath,
          options.appendSystemPromptProvider,
        )),
    });
    this.runtimeSupervisor = new RuntimeSupervisor({ ...options, runtimeDependencies: deps });
  }

  createSession(workspace: WorkspaceRef, options?: CreateSessionOptions): Promise<SessionSnapshot> {
    return this.supervisor.createSession(workspace, options);
  }

  openSession(sessionRef: SessionRef): Promise<SessionSnapshot> {
    return this.supervisor.openSession(sessionRef);
  }

  archiveSession(sessionRef: SessionRef): Promise<void> {
    return this.supervisor.archiveSession(sessionRef);
  }

  unarchiveSession(sessionRef: SessionRef): Promise<void> {
    return this.supervisor.unarchiveSession(sessionRef);
  }

  sendUserMessage(sessionRef: SessionRef, input: SessionMessageInput): Promise<void> {
    return this.supervisor.sendUserMessage(sessionRef, input);
  }

  replaceQueuedMessages(sessionRef: SessionRef, messages: readonly SessionQueuedMessage[]): Promise<void> {
    return this.supervisor.replaceQueuedMessages(sessionRef, messages);
  }

  cancelCurrentRun(sessionRef: SessionRef): Promise<void> {
    return this.supervisor.cancelCurrentRun(sessionRef);
  }

  stopRuntimeJob(sessionRef: SessionRef, jobId: string): Promise<void> {
    return this.supervisor.stopRuntimeJob(sessionRef, jobId);
  }

  refreshRuntimeJobs(sessionRef: SessionRef) {
    return this.supervisor.refreshRuntimeJobs(sessionRef);
  }

  setSessionModel(sessionRef: SessionRef, selection: SessionModelSelection): Promise<void> {
    return this.supervisor.setSessionModel(sessionRef, selection);
  }

  setSessionThinkingLevel(sessionRef: SessionRef, thinkingLevel: string): Promise<void> {
    return this.supervisor.setSessionThinkingLevel(sessionRef, thinkingLevel);
  }

  setSessionToolAccess(sessionRef: SessionRef, toolAccess: ToolAccessSelection): Promise<void> {
    return this.supervisor.setSessionToolAccess(sessionRef, toolAccess);
  }

  renameSession(sessionRef: SessionRef, title: string): Promise<void> {
    return this.supervisor.renameSession(sessionRef, title);
  }

  compactSession(sessionRef: SessionRef, customInstructions?: string): Promise<void> {
    return this.supervisor.compactSession(sessionRef, customInstructions);
  }

  reloadSession(sessionRef: SessionRef): Promise<void> {
    return this.supervisor.reloadSession(sessionRef);
  }

  getSessionTree(sessionRef: SessionRef): Promise<SessionTreeSnapshot> {
    return this.supervisor.getSessionTree(sessionRef);
  }

  navigateSessionTree(
    sessionRef: SessionRef,
    targetId: string,
    options?: NavigateSessionTreeOptions,
  ): Promise<NavigateSessionTreeResult> {
    return this.supervisor.navigateSessionTree(sessionRef, targetId, options);
  }

  getSessionCommands(sessionRef: SessionRef) {
    return this.supervisor.getSessionCommands(sessionRef);
  }

  respondToHostUiRequest(sessionRef: SessionRef, response: HostUiResponse): Promise<void> {
    return this.supervisor.respondToHostUiRequest(sessionRef, response);
  }

  subscribe(sessionRef: SessionRef, listener: SessionEventListener): Unsubscribe {
    return this.supervisor.subscribe(sessionRef, listener);
  }

  suspendSessionRuntime(sessionRef: SessionRef): Promise<boolean> {
    return this.supervisor.suspendSessionRuntime(sessionRef);
  }

  closeSession(sessionRef: SessionRef): Promise<void> {
    return this.supervisor.closeSession(sessionRef);
  }

  listWorkspaces(): Promise<WorkspaceCatalogSnapshot> {
    return this.supervisor.listWorkspaces();
  }

  listSessions(workspaceId?: WorkspaceId): Promise<SessionCatalogSnapshot> {
    return this.supervisor.listSessions(workspaceId);
  }

  getRuntimeDiagnostics() {
    return this.supervisor.getRuntimeDiagnostics();
  }

  getResidentSessionRefs() {
    return this.supervisor.getResidentSessionRefs();
  }

  syncWorkspace(path: string, displayName?: string): Promise<SyncWorkspaceResult> {
    return this.supervisor.syncWorkspace(path, displayName);
  }

  renameWorkspace(workspaceId: WorkspaceId, displayName: string) {
    return this.supervisor.renameWorkspace(workspaceId, displayName);
  }

  removeWorkspace(workspaceId: WorkspaceId): Promise<void> {
    return this.supervisor.removeWorkspace(workspaceId);
  }

  getTranscript(sessionRef: SessionRef) {
    return this.supervisor.getTranscript(sessionRef);
  }

  async generateThreadTitle(workspace: WorkspaceRef, options: GenerateThreadTitleOptions): Promise<string | null> {
    const modelRuntime = await this.getModelRuntime();
    if (this.generateThreadTitleOverride) {
      const override = await this.generateThreadTitleOverride(workspace, options);
      if (override !== undefined) {
        return override;
      }
    }
    return generateThreadTitle(workspace, options, {
      agentDir: this.agentDir,
      modelRuntime,
    });
  }
}

export function createPiSdkDriver(options?: PiSdkDriverConfig): PiSdkDriver {
  return new PiSdkDriver(options);
}
