import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  appendComposerAttachments,
  type DesktopAppState,
  getSelectedSession,
  getSelectedWorkspace,
  type SelectedTranscriptRecord,
  type WorkspaceSessionTarget,
} from "../../desktop-state";
import { CommandPalette } from "../../command-palette";
import type { CommandPaletteAction } from "../../command-palette-model";
import { buildThreadGroups } from "../../thread-groups";
import { appendComposerContext } from "../../terminal-selection-context";
import { useSlashMenu } from "../../hooks/use-slash-menu";
import { useMentionMenu } from "../../hooks/use-mention-menu";
import { useThreadSearch } from "../../hooks/use-thread-search";
import { readOpenFileHistory, recordOpenedFile } from "../../open-file-history";
import { useWorkspaceMenu } from "../../hooks/use-workspace-menu";
import { AppMainShell } from "./app-main-shell";
import { AppPrimaryContent } from "./app-primary-content";
import { AppSecondarySurface } from "./app-secondary-surface";
import { isSecondarySurfaceActive } from "./secondary-surface-props";
import { useAppTranscriptState } from "./use-app-transcript-state";
import { useAppViewNavigation } from "./use-app-view-navigation";
import { usePanelLayout } from "../panels/use-panel-layout";
import { useGitActions } from "../git/use-git-actions";
import { useCommandPalette } from "../command-palette/use-command-palette";
import { useAgents } from "../agents/use-agents";
import { useCheckoutSelector } from "../checkout/use-checkout-selector";
import { useComposerFileInput } from "../composer/use-composer-file-input";
import { createNewThreadComposerKeyHandler, createSessionComposerKeyHandler } from "../composer/use-composer-key-routing";
import { useSessionComposer } from "../composer/use-session-composer";
import { useDiffPanel } from "../diff/use-diff-panel";
import { useExtensionSessionUi } from "../extensions/use-extension-session-ui";
import { useNewThreadState } from "../new-thread/use-new-thread-state";
import { useRuntimeSelections } from "../models/use-runtime-selections";
import { useOpenUrlRouting } from "../navigation/use-open-url-routing";
import { useSettingsActions } from "../settings/use-settings-actions";
import { useSettingsRouting } from "../settings/use-settings-routing";
import { useReviewSurface } from "../review/use-review-surface";
import { usePlanPanel } from "../plans/use-plan-panel";
import { useProjectActions } from "../project-actions/use-project-actions";
import { usePrimarySidebarToggle } from "../sidebar/use-primary-sidebar-toggle";
import { useSessionActions } from "../session/use-session-actions";
import { useRunningLabel } from "../session/use-running-label";
import { useSessionTreeModal } from "../session-tree/use-session-tree-modal";
import { useSkillUsageTracking } from "../skills/use-skill-usage-tracking";
import { useVisibleTerminal } from "../terminal/use-visible-terminal";
import { useTimelineViewport } from "../timeline/use-timeline-viewport";
import { useWorkspaceDerivations } from "../workspaces/use-workspace-derivations";
import { CommandPreviewDialog } from "../evidence/command-preview-dialog";
import { WorkspaceProductivityHub } from "../../workspace-productivity-hub";
import {
  indexWorkspaceArtifacts,
  normalizeShortcut,
  readWorkspaceShortcuts,
  type WorkspaceArtifactReference,
} from "../../product-experience/workspace-productivity";
import { SETTINGS_SEARCH_ENTRIES } from "../../product-experience/settings-search";
import type { AgentDefinitionRecord } from "../../agent-definitions";

interface AppReadyProps {
  readonly api: NonNullable<typeof window.piApp>;
  readonly snapshot: DesktopAppState;
  readonly selectedTranscript: SelectedTranscriptRecord | null;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
}

export function AppReady({
  api,
  snapshot,
  selectedTranscript,
  setSnapshot,
}: AppReadyProps) {
  const {
    recordSubmittedSkillUsage,
    skillUsageByPath,
  } = useSkillUsageTracking();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const newThreadComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const onLeaveDisplayModeSurfaceRef = useRef<() => void>(() => undefined);
  const preserveTimelineBottomForDiffToggleRef = useRef<(delayFrames?: number) => void>(() => undefined);
  const [workspaceHubOpen, setWorkspaceHubOpen] = useState(false);
  const [paletteAgents, setPaletteAgents] = useState<readonly AgentDefinitionRecord[]>([]);
  const [paletteArtifacts, setPaletteArtifacts] = useState<readonly WorkspaceArtifactReference[]>([]);
  const [workspaceShortcutRevision, setWorkspaceShortcutRevision] = useState(0);

  const selectedWorkspace = snapshot ? (getSelectedWorkspace(snapshot) ?? snapshot.workspaces[0]) : undefined;
  const selectedSession = snapshot ? (getSelectedSession(snapshot) ?? selectedWorkspace?.sessions[0]) : undefined;
  const gitActions = useGitActions({
    api,
    selectedWorkspace,
  });
  const {
    activeWorktrees,
    linkedWorktreeByWorkspaceId,
    rootWorkspace,
    rootWorkspaceOptions,
    visibleWorkspaces,
  } = useWorkspaceDerivations({ snapshot, selectedWorkspace });
  const selectedWorktree = selectedWorkspace ? linkedWorktreeByWorkspaceId.get(selectedWorkspace.id) : undefined;
  const selectedWorkspaceId = selectedWorkspace?.id;
  const selectedSessionId = selectedSession?.id;
  useEffect(() => {
    let active = true;
    if (!selectedWorkspaceId) {
      setPaletteAgents([]);
      setPaletteArtifacts([]);
      return () => {
        active = false;
      };
    }
    void Promise.all([
      api.listAgentDefinitions(selectedWorkspaceId),
      api.listWorkspaceFiles(selectedWorkspaceId),
      api.listTaskEvidence({ workspaceId: selectedWorkspaceId, limit: 2_000 }),
      api.listSubagentRuns(selectedWorkspaceId),
    ]).then(([agentSnapshot, workspacePaths, evidencePage, subagentRuns]) => {
      if (!active) return;
      setPaletteAgents(agentSnapshot.agents);
      setPaletteArtifacts(indexWorkspaceArtifacts({
        workspacePaths,
        evidence: evidencePage.records,
        subagentRuns,
      }));
    }).catch((error) => {
      if (!active) return;
      setPaletteAgents([]);
      setPaletteArtifacts([]);
      console.warn("Failed to build workspace palette index", error);
    });
    return () => {
      active = false;
    };
  }, [api, selectedWorkspaceId]);
  useEffect(() => {
    const refresh = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail === selectedWorkspaceId) {
        setWorkspaceShortcutRevision((current) => current + 1);
      }
    };
    window.addEventListener("pi-gui:workspace-shortcuts-changed", refresh);
    return () => window.removeEventListener("pi-gui:workspace-shortcuts-changed", refresh);
  }, [selectedWorkspaceId]);
  const {
    resetReviewSurface,
    refreshReviewSurface,
    reviewLoading,
    reviewSnapshot,
  } = useReviewSurface({
    api,
    activeView: snapshot?.activeView,
    reviewRequest: snapshot?.reviewRequest,
    selectedWorkspaceId,
    selectedSessionId,
  });
  const onLeaveReviewSurface = resetReviewSurface;
  const onLeaveDisplayModeSurface = useCallback(() => {
    onLeaveDisplayModeSurfaceRef.current();
  }, []);
  const {
    extensionsWorkspace,
    openExtensions,
    openSettings,
    openSkills,
    setExtensionsWorkspaceId,
    setSettingsSection,
    setSettingsWorkspaceId,
    setSkillsWorkspaceId,
    settingsSection,
    settingsReturnView,
    settingsWorkspace,
    skillsWorkspace,
  } = useSettingsRouting({
    api,
    activeView: snapshot?.activeView,
    rootWorkspaceOptions,
    onLeaveReviewSurface,
    onLeaveDisplayModeSurface,
    setSnapshot,
  });
  const settingsActions = useSettingsActions({
    activeView: snapshot?.activeView,
    api,
    extensionsWorkspace,
    openSkills,
    setSnapshot,
    settingsSection,
    settingsWorkspace,
    skillsWorkspace,
  });
  const newThreadState = useNewThreadState({
    rootWorkspace,
    rootWorkspaceOptions,
    snapshot,
    visibleWorkspaces,
  });
  const agents = useAgents({
    api,
    activeView: snapshot?.activeView,
    settingsSection,
    settingsWorkspaceId: settingsWorkspace?.id,
  });

  const newThreadWorkspace =
    rootWorkspaceOptions.find((entry) => entry.id === newThreadState.newThreadRootWorkspaceId) ?? rootWorkspaceOptions[0];
  const runtimeSelections = useRuntimeSelections({
    snapshot,
    selectedWorkspace,
    selectedSession,
    settingsWorkspace,
    skillsWorkspace,
    extensionsWorkspace,
    newThreadWorkspace,
    newThreadProvider: newThreadState.newThreadProvider,
    newThreadModelId: newThreadState.newThreadModelId,
    newThreadThinkingLevel: newThreadState.newThreadThinkingLevel,
    newThreadToolAccess: newThreadState.newThreadToolAccess,
  });
  const runningLabel = useRunningLabel(selectedSession?.status === "running" ? selectedSession.runningSince : undefined);
  const selectedSessionKey = selectedWorkspace && selectedSession ? `${selectedWorkspace.id}:${selectedSession.id}` : "";
  const showThinking = snapshot?.showThinking ?? false;
  const openTreeModalRef = useRef<() => void>(() => undefined);
  const sessionComposer = useSessionComposer({
    api,
    composerRef,
    modelSelectionRequired: runtimeSelections.selectedSessionModelOnboarding.requiresModelSelection,
    selectedRuntime: runtimeSelections.selectedRuntime,
    selectedSession,
    selectedSessionKey,
    selectedWorkspace,
    showThinking,
    snapshot,
    setSnapshot,
    onOpenTreeModal: () => openTreeModalRef.current(),
    onRecordSubmittedSkillUsage: recordSubmittedSkillUsage,
  });
  const {
    handleClipboardImageShortcut,
    handleComposerDrop,
    handleComposerPaste,
    handleNewThreadComposerDrop,
    handleNewThreadComposerPaste,
    handlePastedClipboardImage,
  } = useComposerFileInput({
    api,
    composerRef,
    newThreadComposerRef,
    setSnapshot,
    addAttachmentsToSessionComposer: sessionComposer.addAttachmentsToSessionComposer,
    addNewThreadClipboardImage: newThreadState.addNewThreadClipboardImage,
    handleNewThreadAddAttachments: newThreadState.handleNewThreadAddAttachments,
  });
  const panelLayout = usePanelLayout({
    activeView: snapshot?.activeView,
    sidebarCollapsed: snapshot?.sidebarCollapsed ?? false,
    workspaceCount: snapshot?.workspaces.length ?? 0,
    selectedSessionKey,
    selectedWorkspaceId: selectedWorkspace?.id ?? "",
    mainRef,
  });
  const {
    displayModeInitialPinnedThreadKey,
    onLeaveDisplayModeSurface: handleLeaveDisplayModeSurface,
    openNewThreadSurface,
    setActiveView,
  } = useAppViewNavigation({
    api,
    activeView: snapshot?.activeView,
    openVsCodeForWorkspace: panelLayout.openVsCodeForWorkspace,
    resetNewThreadSurface: newThreadState.resetNewThreadSurface,
    resetReviewSurface,
    selectedSession,
    selectedWorkspace,
    setNewThreadRootWorkspaceId: newThreadState.setNewThreadRootWorkspaceId,
    setPendingNewThreadWorkspaceId: newThreadState.setPendingNewThreadWorkspaceId,
    setSnapshot,
    vsCodeOpen: panelLayout.vsCodeOpen,
    workspaces: snapshot?.workspaces ?? [],
  });
  onLeaveDisplayModeSurfaceRef.current = handleLeaveDisplayModeSurface;
  const visibleTerminal = useVisibleTerminal({
    activeTerminalSessionKey: panelLayout.activeTerminalSessionKey,
    openTerminalSessionKeys: panelLayout.openTerminalSessionKeys,
    selectedSessionKey,
    snapshot,
    takeoverTerminalSessionKeys: panelLayout.takeoverTerminalSessionKeys,
  });
  const {
    activeTranscript,
    isTranscriptLoading,
    rawActiveTranscript,
    selectedExtensionUi,
    selectedSessionCommands,
    selectedWorkspaceCommandCompatibility,
    thinkingActive,
  } = useAppTranscriptState({
    selectedSession,
    selectedSessionId,
    selectedSessionKey,
    selectedTranscript,
    selectedWorkspace,
    selectedWorkspaceId,
    showThinking,
    snapshot,
  });
  const {
    askPiToImplementLatestPlan,
    closePlanPanel,
    latestPlan,
    planPanelOpen,
    planSurfaceAvailable,
    resetPlanPanel,
    togglePlanPanel,
  } = usePlanPanel({
    activeView: snapshot?.activeView,
    hasSelectedThread: Boolean(selectedWorkspace && selectedSession),
    rawTranscript: rawActiveTranscript,
    composerRef,
    setComposerDraft: sessionComposer.setComposerDraft,
    workspaceId: selectedWorkspace?.id ?? "",
  });
  const fastModeState = snapshot?.fastMode ?? { available: false, enabled: false };
  const fastModeSelection = fastModeState.enabled ? "on" : "off";
  const {
    diffFileRequest,
    handleViewFileInDiff: openFileInDiff,
    resetDiffPanel,
    showDiffPanel,
    toggleDiffPanel,
  } = useDiffPanel({
    preserveTimelineBottomForLayoutChangeRef: preserveTimelineBottomForDiffToggleRef,
    workspaceId: selectedWorkspace?.id ?? "",
  });
  const handleViewFileInDiff = useCallback((path: string) => {
    if (selectedWorkspace) {
      recordOpenedFile({
        workspaceId: selectedWorkspace.id,
        path,
        source: "changes",
      });
    }
    openFileInDiff(path);
  }, [openFileInDiff, selectedWorkspace]);
  const timelineViewport = useTimelineViewport({
    activeView: snapshot?.activeView,
    composerDraft: sessionComposer.composerDraft,
    composerRef,
    transcript: activeTranscript,
    hasSelectedSession: Boolean(selectedSession),
    selectedSessionKey,
    showDiffPanel,
  });
  const resetAllWorkspaceLayout = useCallback(() => {
    panelLayout.resetWorkspaceLayout();
    resetDiffPanel();
    resetPlanPanel();
  }, [panelLayout, resetDiffPanel, resetPlanPanel]);
  preserveTimelineBottomForDiffToggleRef.current = timelineViewport.preserveTimelineBottomForLayoutChange;
  const threadSearch = useThreadSearch(timelineViewport.timelinePaneRef);
  const toggleSelectedWorkspaceVsCodePanel = useCallback(() => {
    panelLayout.toggleSelectedWorkspaceVsCode(selectedWorkspace);
  }, [panelLayout, selectedWorkspace]);

  const openUrl = useOpenUrlRouting({
    api,
    activeView: snapshot?.activeView,
    mainRef,
    openSideBrowserUrl: panelLayout.openSideBrowserUrl,
  });

  const displayedSessionTitle = selectedExtensionUi?.title ?? selectedSession?.title ?? "";
  const threadGroups = useMemo(
    () => (snapshot ? buildThreadGroups(snapshot) : []),
    [snapshot],
  );
  const focusComposer = () => {
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  };
  const {
    activeExtensionDialog,
    handleRespondToExtensionDialog,
    handleToggleExtensionDock,
    isSelectedExtensionDockExpanded,
    selectedExtensionDock,
  } = useExtensionSessionUi({
    api,
    focusComposer,
    selectedExtensionUi,
    selectedSession,
    selectedSessionKey,
    selectedWorkspace,
    sessionExtensionUiBySession: snapshot?.sessionExtensionUiBySession,
  });
  const {
    handleArchiveSession,
    handleOpenSubagentRunTarget,
    handleSelectSession,
    handleUnarchiveSession,
  } = useSessionActions({
    api,
    focusComposer,
    setSnapshot,
    updateVsCodeTarget: panelLayout.updateVsCodeTarget,
    vsCodeOpen: panelLayout.vsCodeOpen,
    workspaces: snapshot?.workspaces ?? [],
  });
  const handleOpenSubagentRunArtifact = useCallback((input: { readonly target: WorkspaceSessionTarget; readonly path: string }) => {
    handleOpenSubagentRunTarget(input.target);
    handleViewFileInDiff(input.path);
  }, [handleOpenSubagentRunTarget, handleViewFileInDiff]);
  const {
    branchFromMessage,
    closeTreeModal,
    navigateTreeSelection,
    openTreeModal,
    treeModalState,
  } = useSessionTreeModal({
    activeView: snapshot?.activeView,
    api,
    focusComposer,
    selectedSession,
    selectedSessionKey,
    selectedWorkspace,
    setComposerDraft: sessionComposer.setComposerDraft,
    setSnapshot,
  });
  openTreeModalRef.current = openTreeModal;
  const {
    addActionDialogOpen,
    closeAddActionDialog,
    confirmCommandPreview,
    denyCommandPreview,
    openAddActionDialog,
    pendingCommandPreview,
    previewAgentCommand,
    runProjectAction,
    saveProjectAction,
    topbarProjectActions,
  } = useProjectActions({
    activeView: snapshot?.activeView,
    api,
    newThreadWorkspace,
    onOpenTerminalForSession: panelLayout.openTerminalForSession,
    selectedSession,
    selectedSessionKey,
    selectedWorkspace,
  });
  const selectedRootWorkspaceId = selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id;
  const wsMenu = useWorkspaceMenu({
    api,
    setSnapshot,
  });
  const workspaceShortcuts = useMemo(
    () => {
      void workspaceShortcutRevision;
      return selectedWorkspace ? readWorkspaceShortcuts(selectedWorkspace.id) : [];
    },
    [selectedWorkspace, workspaceShortcutRevision],
  );
  const indexedPaletteActions = useMemo<readonly CommandPaletteAction[]>(() => {
    const actions: CommandPaletteAction[] = [];
    for (const workspace of snapshot.workspaces) {
      actions.push({
        id: `workspace:${workspace.id}`,
        title: workspace.name,
        subtitle: workspace.branchName ? `Workspace · ${workspace.branchName}` : "Workspace",
        category: "Workspaces",
        keywords: ["workspace", "folder", workspace.path, workspace.branchName ?? ""],
        run: () => wsMenu.selectWorkspace(workspace.id),
      });
      for (const session of workspace.sessions) {
        actions.push({
          id: `thread:${workspace.id}:${session.id}`,
          title: session.title,
          subtitle: `${workspace.name} · ${session.status}`,
          category: "Threads",
          keywords: ["thread", "session", "history", workspace.name, workspace.branchName ?? "", session.status],
          run: () => handleSelectSession({ workspaceId: workspace.id, sessionId: session.id }),
        });
      }
    }
    for (const section of ["appearance", "general", "providers", "models", "agents", "notifications"] as const) {
      actions.push({
        id: `settings:${section}`,
        title: `${section === "agents" ? "Subagents" : section[0]?.toUpperCase()}${section === "agents" ? "" : section.slice(1)} settings`,
        subtitle: "Open the exact Settings section",
        category: "Settings",
        keywords: ["settings", "preferences", section],
        run: () => openSettings(selectedRootWorkspaceId, section),
      });
    }
    for (const entry of SETTINGS_SEARCH_ENTRIES) {
      actions.push({
        id: `settings-search:${entry.id}`,
        title: entry.label,
        subtitle: entry.description,
        category: "Settings",
        keywords: ["settings", entry.section, entry.rowText, ...entry.synonyms],
        run: () => openSettings(selectedRootWorkspaceId, entry.section),
      });
    }
    for (const model of runtimeSelections.selectedRuntime?.models ?? []) {
      actions.push({
        id: `model:${model.providerId}:${model.modelId}`,
        title: model.label,
        subtitle: `${model.providerName} · model`,
        category: "Models",
        keywords: ["model", model.providerId, model.modelId, model.providerName],
        run: () => openSettings(selectedRootWorkspaceId, "models"),
      });
    }
    for (const skill of runtimeSelections.selectedRuntime?.skills ?? []) {
      actions.push({
        id: `skill:${skill.filePath}`,
        title: skill.name,
        subtitle: "Skill",
        category: "Skills",
        keywords: ["skill", skill.name, skill.description ?? ""],
        run: () => openSkills(selectedRootWorkspaceId),
      });
    }
    for (const agent of paletteAgents) {
      actions.push({
        id: `agent:${agent.name}`,
        title: agent.config.displayName || agent.name,
        subtitle: `${agent.source} agent · ${agent.config.enabled ? "enabled" : "disabled"}`,
        category: "Agents",
        keywords: ["agent", "subagent", agent.name, agent.config.role ?? "", agent.config.description],
        run: () => openSettings(selectedRootWorkspaceId, "agents"),
      });
    }
    for (const action of topbarProjectActions) {
      actions.push({
        id: `project-action:${action.id}`,
        title: action.name,
        subtitle: action.command,
        category: "Project actions",
        shortcut: action.keybinding,
        significant: true,
        keywords: ["project action", "command", action.name],
        run: () => runProjectAction(action),
      });
    }
    for (const assignment of workspaceShortcuts) {
      if (!assignment.enabled) continue;
      actions.push({
        id: `workspace-shortcut:${assignment.id}`,
        title: assignment.label,
        subtitle: "Workspace shortcut",
        category: "Workspace shortcuts",
        shortcut: assignment.keys,
        significant: assignment.significant,
        keywords: ["shortcut", "workspace", assignment.commandId],
        run: () => {
          if (assignment.commandId === "toggle-changes") toggleDiffPanel();
          else if (assignment.commandId === "open-settings") openSettings(selectedRootWorkspaceId);
          else if (assignment.commandId === "open-workspace-hub") setWorkspaceHubOpen(true);
          else if (assignment.commandId.startsWith("project-action:")) {
            const action = topbarProjectActions.find((candidate) => (
              candidate.id === assignment.commandId.slice("project-action:".length)
            ));
            if (action) runProjectAction(action);
          }
        },
      });
    }
    for (const entry of selectedWorkspace ? readOpenFileHistory(selectedWorkspace.id).slice(0, 20) : []) {
      actions.push({
        id: `recent-file:${entry.path}`,
        title: entry.path,
        subtitle: `Recent file · ${entry.source}`,
        category: "Recent files",
        keywords: ["file", "recent", "open", entry.path],
        run: () => handleViewFileInDiff(entry.path),
      });
    }
    for (const artifact of paletteArtifacts.slice(0, 200)) {
      actions.push({
        id: `artifact:${artifact.id}`,
        title: artifact.path,
        subtitle: `${artifact.type} · ${artifact.state}`,
        category: "Artifacts",
        disabled: artifact.state !== "available",
        keywords: [
          "artifact",
          artifact.type,
          artifact.state,
          artifact.source,
          artifact.runId ?? "",
          artifact.sessionId ?? "",
        ],
        run: () => handleViewFileInDiff(artifact.path),
      });
    }
    for (const file of reviewSnapshot?.files ?? []) {
      actions.push({
        id: `review-group:${file.path}`,
        title: `Review ${file.path}`,
        subtitle: `${file.status} change`,
        category: "Review groups",
        keywords: ["review", "change", file.path, file.status],
        run: () => setActiveView("review"),
      });
    }
    actions.push({
      id: "workspace-hub",
      title: "Workspace hub",
      subtitle: "Artifacts, worktree lifecycle, handoff, and shortcuts",
      category: "Workspace",
      keywords: ["artifact", "handoff", "worktree", "shortcuts", "workspace hub"],
      disabled: !selectedWorkspace,
      run: () => setWorkspaceHubOpen(true),
    });
    return actions;
  }, [
    handleSelectSession,
    handleViewFileInDiff,
    openSettings,
    openSkills,
    paletteAgents,
    paletteArtifacts,
    reviewSnapshot,
    runProjectAction,
    runtimeSelections.selectedRuntime?.models,
    runtimeSelections.selectedRuntime?.skills,
    selectedRootWorkspaceId,
    selectedWorkspace,
    setActiveView,
    snapshot.workspaces,
    topbarProjectActions,
    toggleDiffPanel,
    workspaceShortcuts,
    wsMenu,
  ]);
  useEffect(() => {
    const matchesShortcut = (event: globalThis.KeyboardEvent, keys: string) => {
      const pressed = [
        event.metaKey ? "cmd" : "",
        event.ctrlKey ? "ctrl" : "",
        event.altKey ? "alt" : "",
        event.shiftKey ? "shift" : "",
        event.key.length === 1 ? event.key.toLowerCase() : "",
      ].filter(Boolean).join("+");
      return normalizeShortcut(pressed) === normalizeShortcut(keys);
    };
    const handleWorkspaceShortcut = (event: globalThis.KeyboardEvent) => {
      if (!selectedWorkspace || event.repeat || event.defaultPrevented) return;
      const assignment = readWorkspaceShortcuts(selectedWorkspace.id)
        .find((candidate) => candidate.enabled && matchesShortcut(event, candidate.keys));
      if (!assignment) return;
      event.preventDefault();
      if (assignment.commandId === "toggle-changes") toggleDiffPanel();
      else if (assignment.commandId === "open-settings") openSettings(selectedRootWorkspaceId);
      else if (assignment.commandId === "open-workspace-hub") setWorkspaceHubOpen(true);
      else if (assignment.commandId.startsWith("project-action:")) {
        const actionId = assignment.commandId.slice("project-action:".length);
        const action = topbarProjectActions.find((candidate) => candidate.id === actionId);
        if (action) runProjectAction(action);
      }
    };
    window.addEventListener("keydown", handleWorkspaceShortcut);
    return () => window.removeEventListener("keydown", handleWorkspaceShortcut);
  }, [
    openSettings,
    runProjectAction,
    selectedRootWorkspaceId,
    selectedWorkspace,
    toggleDiffPanel,
    topbarProjectActions,
  ]);
  useEffect(() => {
    const previewSnippet = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
      previewAgentCommand(event.detail);
    };
    const openLogs = () => panelLayout.setLogsPanelOpen(true);
    window.addEventListener("pi-gui:preview-shell-snippet", previewSnippet);
    window.addEventListener("pi-gui:open-logs", openLogs);
    return () => {
      window.removeEventListener("pi-gui:preview-shell-snippet", previewSnippet);
      window.removeEventListener("pi-gui:open-logs", openLogs);
    };
  }, [panelLayout, previewAgentCommand]);

  const addTerminalSelectionToComposer = useCallback((context: string) => {
    sessionComposer.setComposerDraft((current) => appendComposerContext(current, context));
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  }, [sessionComposer]);
  const focusNewThreadComposer = () => {
    window.requestAnimationFrame(() => {
      newThreadComposerRef.current?.focus();
    });
  };
  const slashMenu = useSlashMenu({
    composerDraft: sessionComposer.composerDraft,
    setComposerDraft: sessionComposer.setComposerDraft,
    selectedRuntime: runtimeSelections.selectedRuntime,
    selectedModelRuntime: runtimeSelections.selectedModelRuntime,
    sessionCommands: selectedSessionCommands,
    commandCompatibility: selectedWorkspaceCommandCompatibility,
    selectedSessionKey,
    selectedSession,
    selectedWorkspace,
    isRunning: selectedSession?.status === "running",
    api,
    setSnapshot,
    focusComposer,
    openSettings,
    allowTreeCommand: true,
    onRunTreeCommand: openTreeModal,
  });

  const mentionMenu = useMentionMenu({
    composerDraft: sessionComposer.composerDraft,
    setComposerDraft: sessionComposer.setComposerDraft,
    composerRef,
    workspaceId: selectedWorkspace?.id,
    api,
  });

  const newThreadSlashMenu = useSlashMenu({
    composerDraft: newThreadState.newThreadPrompt,
    setComposerDraft: newThreadState.updateNewThreadPrompt,
    selectedRuntime: runtimeSelections.newThreadRuntime,
    selectedModelRuntime: runtimeSelections.newThreadRuntime,
    sessionCommands: [],
    commandCompatibility: [],
    selectedSessionKey: `new-thread:${newThreadWorkspace?.id ?? ""}`,
    selectedSession: undefined,
    selectedWorkspace: newThreadWorkspace,
    isRunning: false,
    api,
    setSnapshot,
    focusComposer: focusNewThreadComposer,
    openSettings,
    allowTreeCommand: false,
    immediateCommandMode: "prefill",
    onSelectModelOption: (provider, modelId) => {
      newThreadState.setNewThreadProvider(provider);
      newThreadState.setNewThreadModelId(modelId);
    },
    onSelectThinkingOption: newThreadState.setNewThreadThinkingLevel,
    onSelectLoginProvider: (providerId) => {
      if (!api || !newThreadWorkspace) {
        return;
      }
      void api.loginProvider(newThreadWorkspace.id, providerId).then(() => api.getState()).then(setSnapshot);
    },
    onSelectLogoutProvider: (providerId) => {
      if (!api || !newThreadWorkspace) {
        return;
      }
      void api.logoutProvider(newThreadWorkspace.id, providerId).then(() => api.getState()).then(setSnapshot);
    },
  });

  const newThreadMentionMenu = useMentionMenu({
    composerDraft: newThreadState.newThreadPrompt,
    setComposerDraft: newThreadState.setNewThreadPrompt,
    composerRef: newThreadComposerRef,
    workspaceId: newThreadWorkspace?.id,
    api,
  });

  const createCheckoutSelector = useCheckoutSelector({
    snapshot,
    linkedWorktreeByWorkspaceId,
    onSelectWorkspace: wsMenu.selectWorkspace,
    onSelectLocalNewThreadCheckout: newThreadState.selectLocalNewThreadCheckout,
    onSelectWorktreeNewThreadCheckout: newThreadState.selectWorktreeNewThreadCheckout,
  });

  const {
    handleTogglePrimarySidebar,
    primarySidebarToggleVisible,
  } = usePrimarySidebarToggle({
    api,
    activeView: snapshot?.activeView,
    sidebarCollapsed: snapshot?.sidebarCollapsed ?? false,
    setSnapshot,
  });

  const {
    commandPaletteActions,
    commandPaletteOpen,
    setCommandPaletteOpen,
    sidebarToggleShortcutLabel,
  } = useCommandPalette({
    api,
    selectedRootWorkspaceId,
    hasSelectedSession: Boolean(selectedSession),
    hasSelectedWorkspace: Boolean(selectedWorkspace),
    threadSearch,
    handlePastedClipboardImage,
    handleTogglePrimarySidebar,
    openExtensions,
    openNewThreadSurface,
    openSettings,
    openSkills,
    resetNewThreadSurface: newThreadState.resetNewThreadSurface,
    setPendingNewThreadWorkspaceId: newThreadState.setPendingNewThreadWorkspaceId,
    toggleDiffPanel,
    toggleTerminal: panelLayout.toggleTerminal,
    resetWorkspaceLayout: resetAllWorkspaceLayout,
    additionalActions: indexedPaletteActions,
  });

  const refreshSkillsRuntime = useCallback(async () => {
    if (!api || !skillsWorkspace) {
      return "Select a workspace before refreshing skill discovery.";
    }
    await api.refreshRuntime(skillsWorkspace.id);
    return (await api.getState()).lastError;
  }, [api, skillsWorkspace]);

  const refreshExtensionsRuntime = useCallback(async () => {
    if (!api || !extensionsWorkspace) {
      return "Select a workspace before refreshing extension discovery.";
    }
    await api.refreshRuntime(extensionsWorkspace.id);
    return (await api.getState()).lastError;
  }, [api, extensionsWorkspace]);

  const fillComposerFromReview = (prompt: string) => {
    sessionComposer.setComposerDraft(prompt);
    if (selectedWorkspace && selectedSession) {
      void api.updateComposerDraft({ workspaceId: selectedWorkspace.id, sessionId: selectedSession.id }, prompt);
    }
  };

  const handleTrySkill = (command: string) => {
    setSnapshot((current) => current ? { ...current, activeView: "threads", lastError: undefined } : current);
    void api.setActiveView("threads");
    slashMenu.fillComposerFromSlash(command);
  };

  const handleStartThread = () => {
    newThreadState.handleStartThread({
      api,
      modelSelectionRequired: runtimeSelections.newThreadModelOnboarding.requiresModelSelection,
      provider: runtimeSelections.resolvedNewThreadProvider,
      modelId: runtimeSelections.resolvedNewThreadModelId,
      thinkingLevel: runtimeSelections.resolvedNewThreadThinkingLevel,
      toolAccess: runtimeSelections.resolvedNewThreadToolAccess,
      runtime: runtimeSelections.newThreadRuntime,
      setSnapshot,
      onExpandWorkspace: wsMenu.expandWorkspace,
      onFocusComposer: focusComposer,
      onRecordSubmittedSkillUsage: recordSubmittedSkillUsage,
    });
  };

  const handleComposerKeyDown = createSessionComposerKeyHandler({
    attachments: sessionComposer.composerAttachments,
    draft: sessionComposer.composerDraft,
    handleClipboardImageShortcut,
    mentionMenu,
    modelSelectionRequired: runtimeSelections.selectedSessionModelOnboarding.requiresModelSelection,
    onAddClipboardImage: (clipboardImage) => {
      setSnapshot((current) => current ? appendComposerAttachments(current, [clipboardImage]) : current);
      void api.addComposerAttachments([clipboardImage]);
    },
    sessionStatus: selectedSession?.status,
    slashMenu,
    submitDraft: sessionComposer.submitComposerDraft,
  });

  const handleNewThreadComposerKeyDown = createNewThreadComposerKeyHandler({
    attachments: newThreadState.newThreadAttachments,
    draft: newThreadState.newThreadPrompt,
    handleClipboardImageShortcut,
    mentionMenu: newThreadMentionMenu,
    modelSelectionRequired: runtimeSelections.newThreadModelOnboarding.requiresModelSelection,
    onAddClipboardImage: newThreadState.addNewThreadClipboardImage,
    onStartThread: handleStartThread,
    slashMenu: newThreadSlashMenu,
  });

  const commandPalette = commandPaletteOpen ? (
    <CommandPalette
      actions={commandPaletteActions}
      storageScope={selectedWorkspace?.id}
      onClose={() => setCommandPaletteOpen(false)}
    />
  ) : null;
  const attachWorkspaceArtifact = useCallback(async (relativePath: string) => {
    if (!selectedWorkspace) return;
    const normalized = relativePath.replace(/^\.\/+/, "");
    const snapshot = await api.snapshotWorkspaceArtifact(selectedWorkspace.id, normalized);
    const version = {
      sizeBytes: snapshot.sizeBytes,
      modifiedAt: snapshot.modifiedAt,
    };
    const attachment = {
      id: crypto.randomUUID(),
      kind: "file" as const,
      name: normalized.split("/").at(-1) ?? normalized,
      mimeType: "application/octet-stream",
      fsPath: snapshot.fsPath,
      sizeBytes: snapshot.sizeBytes,
      source: "workspace-reference" as const,
      status: "ready" as const,
      artifactReference: {
        workspaceId: selectedWorkspace.id,
        relativePath: normalized,
        observedAt: new Date().toISOString(),
        version,
        sensitivity: /(?:secret|private|\.env|\.log$)/i.test(normalized) ? "private" as const : "normal" as const,
        includeInHandoff: false,
      },
    };
    setSnapshot((current) => current ? appendComposerAttachments(current, [attachment]) : current);
    void api.addComposerAttachments([attachment]);
    setWorkspaceHubOpen(false);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }, [api, selectedWorkspace, setSnapshot]);
  const workspaceHub = workspaceHubOpen && selectedWorkspace ? (
    <WorkspaceProductivityHub
      projectActions={topbarProjectActions}
      session={selectedSession}
      workspace={selectedWorkspace}
      worktree={selectedWorktree}
      onAttachFile={attachWorkspaceArtifact}
      onOpenBranches={() => {
        setWorkspaceHubOpen(false);
        openTreeModal();
      }}
      onClose={() => setWorkspaceHubOpen(false)}
      onOpenChanges={() => {
        if (!showDiffPanel) toggleDiffPanel();
        setWorkspaceHubOpen(false);
      }}
      onOpenFile={(path) => {
        handleViewFileInDiff(path);
        setWorkspaceHubOpen(false);
      }}
    />
  ) : null;

  const secondarySurface = (
    <AppSecondarySurface
      activeView={snapshot.activeView}
      agents={agents}
      commandPalette={<>{commandPalette}{workspaceHub}</>}
      extensionsWorkspace={extensionsWorkspace}
      onOpenSubagentRunArtifact={handleOpenSubagentRunArtifact}
      onOpenSubagentRunTarget={handleOpenSubagentRunTarget}
      onRefreshExtensionsRuntime={refreshExtensionsRuntime}
      onRefreshSkillsRuntime={refreshSkillsRuntime}
      onSelectExtensionsWorkspace={setExtensionsWorkspaceId}
      onSelectSettingsSection={setSettingsSection}
      onSelectSettingsWorkspace={setSettingsWorkspaceId}
      onSelectSkillsWorkspace={setSkillsWorkspaceId}
      onSetActiveView={setActiveView}
      onSubmitReviewPrompt={(prompt) => {
        fillComposerFromReview(prompt);
        setActiveView("threads");
      }}
      onTrySkill={(skill) =>
        handleTrySkill(
          skill.filePath
            ? `${skill.slashCommand} `
            : "Create a new skill for this workspace and explain which files you will add.",
        )
      }
      reviewLoading={reviewLoading}
      reviewSnapshot={reviewSnapshot}
      refreshReviewSurface={refreshReviewSurface}
      rootWorkspaceOptions={rootWorkspaceOptions}
      runtimeSelections={runtimeSelections}
      selectedSession={selectedSession}
      selectedWorkspace={selectedWorkspace}
      settingsActions={settingsActions}
      settingsSection={settingsSection}
      settingsReturnView={settingsReturnView}
      settingsWorkspace={settingsWorkspace}
      skillsUsageByPath={skillUsageByPath}
      skillsWorkspace={skillsWorkspace}
      snapshot={snapshot}
    />
  );
  if (isSecondarySurfaceActive(snapshot.activeView)) {
    return secondarySurface;
  }

  const primaryContent = (
    <>
      <AppPrimaryContent
      activeExtensionDialog={activeExtensionDialog}
      activeTranscript={activeTranscript}
      api={api}
      askPiToImplementLatestPlan={askPiToImplementLatestPlan}
      closePlanPanel={closePlanPanel}
      closeTreeModal={closeTreeModal}
      branchFromMessage={branchFromMessage}
      composerRef={composerRef}
      createCheckoutSelector={createCheckoutSelector}
      displayModeInitialPinnedThreadKey={displayModeInitialPinnedThreadKey}
      fastModeAvailable={fastModeState.available}
      fastModeSelection={fastModeSelection}
      gitActions={gitActions}
      handleComposerDrop={handleComposerDrop}
      handleComposerKeyDown={handleComposerKeyDown}
      handleComposerPaste={handleComposerPaste}
      handleNewThreadAddAttachments={newThreadState.handleNewThreadAddAttachments}
      handleNewThreadComposerDrop={handleNewThreadComposerDrop}
      handleNewThreadComposerKeyDown={handleNewThreadComposerKeyDown}
      handleNewThreadComposerPaste={handleNewThreadComposerPaste}
      handleNewThreadRemoveAttachment={newThreadState.handleNewThreadRemoveAttachment}
      handleRespondToExtensionDialog={handleRespondToExtensionDialog}
      handleSelectSession={handleSelectSession}
      handleViewFileInDiff={handleViewFileInDiff}
      isTranscriptLoading={isTranscriptLoading}
      latestPlan={latestPlan}
      mentionMenu={mentionMenu}
      navigateTreeSelection={navigateTreeSelection}
      newThreadComposerRef={newThreadComposerRef}
      newThreadMentionMenu={newThreadMentionMenu}
      newThreadSlashMenu={newThreadSlashMenu}
      newThreadState={newThreadState}
      newThreadWorkspace={newThreadWorkspace}
      onOpenNewThread={openNewThreadSurface}
      openSettings={openSettings}
      openSkillProfiles={settingsActions.openSkillProfiles}
      openUrl={openUrl}
      panelLayout={panelLayout}
      planPanelOpen={planPanelOpen}
      planSurfaceAvailable={planSurfaceAvailable}
      rootWorkspaceOptions={rootWorkspaceOptions}
      runtimeSelections={runtimeSelections}
      selectedSession={selectedSession}
      selectedSessionCommands={selectedSessionCommands}
      selectedSessionKey={selectedSessionKey}
      selectedWorkspace={selectedWorkspace}
      sessionComposer={sessionComposer}
      settingsActions={settingsActions}
      showThinking={showThinking}
      slashMenu={slashMenu}
      snapshot={snapshot}
      setSnapshot={setSnapshot}
      startThread={handleStartThread}
      thinkingActive={thinkingActive}
      threadSearch={threadSearch}
      timelineViewport={timelineViewport}
      treeModalState={treeModalState}
      />
      {pendingCommandPreview ? (
        <CommandPreviewDialog
          preview={pendingCommandPreview}
          onCancel={denyCommandPreview}
          onConfirm={confirmCommandPreview}
        />
      ) : null}
    </>
  );

  return (
    <AppMainShell
      activeWorktrees={activeWorktrees}
      addActionDialogOpen={addActionDialogOpen}
      api={api}
      closeAddActionDialog={closeAddActionDialog}
      commandPalette={<>{commandPalette}{workspaceHub}</>}
      diffFileRequest={diffFileRequest}
      displayedSessionTitle={displayedSessionTitle}
      gitActions={gitActions}
      handleArchiveSession={handleArchiveSession}
      handleSelectSession={handleSelectSession}
      handleToggleExtensionDock={handleToggleExtensionDock}
      handleTogglePrimarySidebar={handleTogglePrimarySidebar}
      handleUnarchiveSession={handleUnarchiveSession}
      isSelectedExtensionDockExpanded={isSelectedExtensionDockExpanded}
      linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
      mainRef={mainRef}
      onAddAction={openAddActionDialog}
      onAddTerminalSelectionToComposer={addTerminalSelectionToComposer}
      onFocusComposer={focusComposer}
      onOpenExtensions={openExtensions}
      onOpenNewThreadSurface={openNewThreadSurface}
      onOpenSettings={openSettings}
      onOpenSkills={openSkills}
      onOpenUrl={openUrl}
      onRunProjectAction={runProjectAction}
      onSaveProjectAction={saveProjectAction}
      onSetActiveView={setActiveView}
      panelLayout={panelLayout}
      planPanelOpen={planPanelOpen}
      planSurfaceAvailable={planSurfaceAvailable}
      primaryContent={primaryContent}
      primarySidebarToggleVisible={primarySidebarToggleVisible}
      rootWorkspace={rootWorkspace}
      runningLabel={runningLabel}
      selectedExtensionDock={selectedExtensionDock}
      selectedSession={selectedSession}
      selectedSessionKey={selectedSessionKey}
      selectedWorkspace={selectedWorkspace}
      selectedWorktree={selectedWorktree}
      setSnapshot={setSnapshot}
      showDiffPanel={showDiffPanel}
      sidebarToggleShortcutLabel={sidebarToggleShortcutLabel}
      snapshot={snapshot}
      threadGroups={threadGroups}
      toggleDiffPanel={toggleDiffPanel}
      togglePlanPanel={togglePlanPanel}
      toggleSelectedWorkspaceVsCodePanel={toggleSelectedWorkspaceVsCodePanel}
      topbarProjectActions={topbarProjectActions}
      visibleTerminal={visibleTerminal}
      visibleWorkspaces={visibleWorkspaces}
      wsMenu={wsMenu}
    />
  );
}
