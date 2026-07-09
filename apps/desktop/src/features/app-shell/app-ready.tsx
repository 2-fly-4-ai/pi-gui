import { type Dispatch, type SetStateAction, useCallback, useMemo, useRef } from "react";
import {
  appendComposerAttachments,
  type DesktopAppState,
  getSelectedSession,
  getSelectedWorkspace,
  type SelectedTranscriptRecord,
  type WorkspaceSessionTarget,
} from "../../desktop-state";
import { CommandPalette } from "../../command-palette";
import { buildThreadGroups } from "../../thread-groups";
import { appendComposerContext } from "../../terminal-selection-context";
import { useSlashMenu } from "../../hooks/use-slash-menu";
import { useMentionMenu } from "../../hooks/use-mention-menu";
import { useThreadSearch } from "../../hooks/use-thread-search";
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
  const {
    resetReviewSurface,
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
    togglePlanPanel,
  } = usePlanPanel({
    activeView: snapshot?.activeView,
    hasSelectedThread: Boolean(selectedWorkspace && selectedSession),
    rawTranscript: rawActiveTranscript,
    composerRef,
    setComposerDraft: sessionComposer.setComposerDraft,
  });
  const fastModeState = snapshot?.fastMode ?? { available: false, enabled: false };
  const fastModeSelection = fastModeState.enabled ? "on" : "off";
  const {
    diffFileRequest,
    handleViewFileInDiff,
    showDiffPanel,
    toggleDiffPanel,
  } = useDiffPanel({
    preserveTimelineBottomForLayoutChangeRef: preserveTimelineBottomForDiffToggleRef,
  });
  const timelineViewport = useTimelineViewport({
    activeView: snapshot?.activeView,
    composerDraft: sessionComposer.composerDraft,
    composerRef,
    transcript: activeTranscript,
    hasSelectedSession: Boolean(selectedSession),
    selectedSessionKey,
    showDiffPanel,
  });
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
    openAddActionDialog,
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
  const selectedRootWorkspaceId = selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id;

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

  const wsMenu = useWorkspaceMenu({
    api,
    setSnapshot,
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
  });

  const refreshSkillsRuntime = useCallback(() => {
    if (!api || !skillsWorkspace) {
      return;
    }
    void api.refreshRuntime(skillsWorkspace.id);
  }, [api, skillsWorkspace]);

  const refreshExtensionsRuntime = useCallback(() => {
    if (!api || !extensionsWorkspace) {
      return;
    }
    void api.refreshRuntime(extensionsWorkspace.id);
  }, [api, extensionsWorkspace]);

  const fillComposerFromReview = (prompt: string) => {
    sessionComposer.setComposerDraft(prompt);
    void api.updateComposerDraft(prompt);
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
    <CommandPalette actions={commandPaletteActions} onClose={() => setCommandPaletteOpen(false)} />
  ) : null;

  const secondarySurface = (
    <AppSecondarySurface
      activeView={snapshot.activeView}
      agents={agents}
      commandPalette={commandPalette}
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
    <AppPrimaryContent
      activeExtensionDialog={activeExtensionDialog}
      activeTranscript={activeTranscript}
      api={api}
      askPiToImplementLatestPlan={askPiToImplementLatestPlan}
      closePlanPanel={closePlanPanel}
      closeTreeModal={closeTreeModal}
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
  );

  return (
    <AppMainShell
      activeWorktrees={activeWorktrees}
      addActionDialogOpen={addActionDialogOpen}
      api={api}
      closeAddActionDialog={closeAddActionDialog}
      commandPalette={commandPalette}
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
