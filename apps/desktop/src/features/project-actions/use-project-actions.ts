import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppView, SessionRecord, WorkspaceRecord } from "../../desktop-state";
import {
  clearLegacyProjectActions,
  loadLegacyProjectActions,
  type ProjectActionRecord,
  type ProjectActionsByWorkspace,
  type SaveProjectActionInput,
} from "../../project-actions";
import { buildCommandPreview, type CommandPreview } from "../../product-experience/command-preview";

type ActionDialogInput = Omit<SaveProjectActionInput, "workspaceId">;

interface UseProjectActionsOptions {
  readonly activeView: AppView | undefined;
  readonly api: NonNullable<typeof window.piApp> | undefined;
  readonly newThreadWorkspace: WorkspaceRecord | undefined;
  readonly onOpenPreviewUrl: (url: string) => void;
  readonly onOpenTerminalForSession: (sessionKey: string) => void;
  readonly selectedSession: SessionRecord | undefined;
  readonly selectedSessionKey: string;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
}

export function useProjectActions({ activeView, api, newThreadWorkspace, onOpenPreviewUrl, onOpenTerminalForSession, selectedSession, selectedSessionKey, selectedWorkspace }: UseProjectActionsOptions) {
  const [projectActionsByWorkspace, setProjectActionsByWorkspace] = useState<ProjectActionsByWorkspace>({});
  const [addActionDialogOpen, setAddActionDialogOpen] = useState(false);
  const [pendingCommandPreview, setPendingCommandPreview] = useState<{ readonly action: ProjectActionRecord; readonly preview: CommandPreview }>();
  const [actionError, setActionError] = useState<string>();

  const workspaceIds = useMemo(() => [...new Set([selectedWorkspace?.rootWorkspaceId || selectedWorkspace?.id, newThreadWorkspace?.rootWorkspaceId || newThreadWorkspace?.id].filter((value): value is string => Boolean(value)))], [newThreadWorkspace, selectedWorkspace]);
  useEffect(() => {
    if (!api) return;
    const legacy = loadLegacyProjectActions();
    if (!Object.keys(legacy).length) return;
    void api.migrateLegacyProjectActions(legacy).then(async () => {
      clearLegacyProjectActions();
      const values = await Promise.all(workspaceIds.map(async (workspaceId) => [workspaceId, await api.listProjectActions(workspaceId)] as const));
      setProjectActionsByWorkspace((current) => ({ ...current, ...Object.fromEntries(values) }));
    }).catch((error) => setActionError(message(error)));
  }, [api, workspaceIds]);
  useEffect(() => {
    let active = true;
    if (!api || !workspaceIds.length) return () => { active = false; };
    void Promise.all(workspaceIds.map(async (workspaceId) => [workspaceId, await api.listProjectActions(workspaceId)] as const)).then((values) => {
      if (!active) return;
      setProjectActionsByWorkspace((current) => ({ ...current, ...Object.fromEntries(values) }));
    }).catch((error) => { if (active) setActionError(message(error)); });
    return () => { active = false; };
  }, [api, workspaceIds]);

  const selectedProjectActions = selectedWorkspace ? projectActionsByWorkspace[selectedWorkspace.rootWorkspaceId || selectedWorkspace.id] ?? [] : [];
  const newThreadProjectActions = newThreadWorkspace ? projectActionsByWorkspace[newThreadWorkspace.rootWorkspaceId || newThreadWorkspace.id] ?? [] : [];
  const topbarProjectActions = activeView === "new-thread" ? newThreadProjectActions : selectedProjectActions;

  const refreshWorkspaceActions = useCallback(async (workspaceId: string) => {
    if (!api) return [];
    const actions = await api.listProjectActions(workspaceId);
    setProjectActionsByWorkspace((current) => ({ ...current, [workspaceId]: actions }));
    return actions;
  }, [api]);
  const replaceWorkspaceActions = useCallback((workspaceId: string, actions: readonly ProjectActionRecord[]) => {
    setProjectActionsByWorkspace((current) => ({ ...current, [workspaceId]: actions }));
  }, []);

  const saveProjectAction = useCallback(async (input: ActionDialogInput) => {
    const targetWorkspace = activeView === "new-thread" ? newThreadWorkspace : selectedWorkspace;
    const workspaceId = targetWorkspace?.rootWorkspaceId || targetWorkspace?.id;
    if (!api || !workspaceId) return;
    setActionError(undefined);
    try {
      const actions = await api.saveProjectAction({ workspaceId, ...input });
      setProjectActionsByWorkspace((current) => ({ ...current, [workspaceId]: actions }));
      setAddActionDialogOpen(false);
    } catch (error) { setActionError(message(error)); }
  }, [activeView, api, newThreadWorkspace, selectedWorkspace]);

  const executeProjectAction = useCallback((action: ProjectActionRecord) => {
    if (!api || !selectedWorkspace || !selectedSession || !action.trusted) return;
    onOpenTerminalForSession(selectedSessionKey);
    void api.ensureTerminalPanel(selectedWorkspace.id, selectedSession.id, { cols: 80, rows: 24 }).then((panel) => {
      const terminalId = panel.activeSessionId;
      if (!terminalId) return;
      return api.writeTerminal(terminalId, `${action.command.trim()}\n`).then(async () => {
        await api.recordProjectActionEvidence({ workspaceId: selectedWorkspace.id, sessionId: selectedSession.id, actionId: action.id, actionName: action.name, command: action.command });
        if (action.autoOpenPreview && action.previewUrl) onOpenPreviewUrl(action.previewUrl);
      });
    }).catch((error) => setActionError(message(error)));
  }, [api, onOpenPreviewUrl, onOpenTerminalForSession, selectedSession, selectedSessionKey, selectedWorkspace]);

  const runProjectAction = useCallback((action: ProjectActionRecord) => {
    if (!selectedWorkspace || !action.trusted) return;
    const preview = buildCommandPreview({ id: action.id, origin: "saved-project-action", command: action.command, cwd: selectedWorkspace.path });
    if (preview.requiresConfirmation) { setPendingCommandPreview({ action, preview }); return; }
    executeProjectAction(action);
  }, [executeProjectAction, selectedWorkspace]);

  const previewAgentCommand = useCallback((command: string) => {
    if (!selectedWorkspace || !command.trim()) return;
    const now = new Date().toISOString();
    const action: ProjectActionRecord = { id: `agent-command-${crypto.randomUUID()}`, workspaceId: selectedWorkspace.id, name: "Assistant shell snippet", command: command.trim(), runOnWorktreeCreation: false, icon: "terminal", autoOpenPreview: false, order: 0, primary: false, trusted: true, source: "saved", createdAt: now, updatedAt: now };
    setPendingCommandPreview({ action, preview: buildCommandPreview({ id: action.id, origin: "agent-proposed", command: action.command, cwd: selectedWorkspace.path, confirmationThreshold: "routine" }) });
  }, [selectedWorkspace]);

  const confirmCommandPreview = useCallback(() => {
    const pending = pendingCommandPreview;
    if (!pending || !api || !selectedWorkspace || !selectedSession) return;
    setPendingCommandPreview(undefined);
    void api.recordCommandPreviewDecision({ workspaceId: selectedWorkspace.id, sessionId: selectedSession.id, previewId: pending.preview.id, origin: pending.preview.origin, risk: pending.preview.risk, decision: "approved", command: pending.preview.command, cwd: pending.preview.cwd }).then(() => executeProjectAction(pending.action));
  }, [api, executeProjectAction, pendingCommandPreview, selectedSession, selectedWorkspace]);

  const denyCommandPreview = useCallback(() => {
    const pending = pendingCommandPreview;
    if (!pending || !api || !selectedWorkspace || !selectedSession) return;
    setPendingCommandPreview(undefined);
    void api.recordCommandPreviewDecision({ workspaceId: selectedWorkspace.id, sessionId: selectedSession.id, previewId: pending.preview.id, origin: pending.preview.origin, risk: pending.preview.risk, decision: "denied", command: pending.preview.command, cwd: pending.preview.cwd });
  }, [api, pendingCommandPreview, selectedSession, selectedWorkspace]);

  return {
    actionError,
    addActionDialogOpen,
    closeAddActionDialog: () => setAddActionDialogOpen(false),
    confirmCommandPreview,
    denyCommandPreview,
    openAddActionDialog: () => setAddActionDialogOpen(true),
    pendingCommandPreview: pendingCommandPreview?.preview,
    previewAgentCommand,
    projectActionsByWorkspace,
    replaceWorkspaceActions,
    refreshWorkspaceActions,
    runProjectAction,
    saveProjectAction,
    setProjectActionsByWorkspace,
    topbarProjectActions,
  };
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
