import type * as React from "react";
import type { RefObject } from "react";
import type { RuntimeCommandRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { NavigateSessionTreeOptions } from "@pi-gui/session-driver/types";
import type {
  ComposerAttachment,
  QueuedComposerMessage,
  SessionRecord,
  WorkspaceRecord,
} from "../../desktop-state";
import type { MentionMenuState } from "../../hooks/use-mention-menu";
import type { SlashMenuState } from "../../hooks/use-slash-menu";
import type { ModelOnboardingState, ModelOnboardingSettingsSection } from "../../model-onboarding";
import { runtimeStatusLabel } from "../../runtime-status";
import type { DetectedPlan } from "../../plan-panel-model";
import type { TranscriptMessage } from "../../timeline-types";
import { SkillProfileSelector } from "../../skill-profile-selector";
import type { ThreadSurfaceProps } from "../thread/thread-surface";

interface TimelineViewportProps {
  readonly timelinePaneRef: ThreadSurfaceProps["timelineProps"]["timelinePaneRef"];
  readonly setTimelinePaneElement: ThreadSurfaceProps["timelineProps"]["timelinePaneElementRef"];
  readonly shouldDisableTimelineVirtualization: ThreadSurfaceProps["timelineProps"]["disableVirtualization"];
  readonly finalizeTimelineVirtualizationDisable: ThreadSurfaceProps["timelineProps"]["onDisableVirtualizationReady"];
  readonly handleTimelineScroll: ThreadSurfaceProps["timelineProps"]["onTimelineScroll"];
  readonly showJumpToLatest: ThreadSurfaceProps["timelineProps"]["showJumpToLatest"];
  readonly jumpToLatest: ThreadSurfaceProps["timelineProps"]["onJumpToLatest"];
  readonly handleTimelineContentHeightChange: ThreadSurfaceProps["timelineProps"]["onContentHeightChange"];
}

interface CreateThreadSurfacePropsOptions {
  readonly activeExtensionDialog: ThreadSurfaceProps["extensionDialog"];
  readonly activeTranscript: readonly TranscriptMessage[];
  readonly closeGitDialog: () => void;
  readonly closePlanPanel: () => void;
  readonly closeTreeModal: () => void;
  readonly composerAttachments: readonly ComposerAttachment[];
  readonly composerDraft: string;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly createCheckoutSelector: (workspace: WorkspaceRecord) => React.ReactNode;
  readonly editingQueuedMessageId: string | undefined;
  readonly fastModeAvailable: boolean;
  readonly fastModeSelection: "auto" | "on" | "off";
  readonly gitActionError: string | undefined;
  readonly gitActionPending: boolean;
  readonly gitBranchName: string | undefined;
  readonly gitChangedFiles: ThreadSurfaceProps["gitDialogs"]["commitProps"]["files"];
  readonly gitDialog: ThreadSurfaceProps["gitDialogs"]["kind"] | null;
  readonly handleCancelQueuedEdit: ThreadSurfaceProps["composerProps"]["onCancelQueuedEdit"];
  readonly handleCommitChanges: ThreadSurfaceProps["gitDialogs"]["onCommit"];
  readonly handleComposerDrop: ThreadSurfaceProps["composerProps"]["onComposerDrop"];
  readonly handleComposerKeyDown: ThreadSurfaceProps["composerProps"]["onComposerKeyDown"];
  readonly handleComposerPaste: ThreadSurfaceProps["composerProps"]["onComposerPaste"];
  readonly handleCreatePullRequest: ThreadSurfaceProps["gitDialogs"]["onCreatePr"];
  readonly handleEditQueuedMessage: ThreadSurfaceProps["composerProps"]["onEditQueuedMessage"];
  readonly handlePickAttachments: ThreadSurfaceProps["composerProps"]["onPickAttachments"];
  readonly handlePushBranch: ThreadSurfaceProps["gitDialogs"]["onPush"];
  readonly handleRemoveAttachment: ThreadSurfaceProps["composerProps"]["onRemoveAttachment"];
  readonly handleRemoveQueuedMessage: ThreadSurfaceProps["composerProps"]["onRemoveQueuedMessage"];
  readonly handleRespondToExtensionDialog: ThreadSurfaceProps["onRespondToExtensionDialog"];
  readonly handleSetActiveSkillProfile: (workspaceId: string | undefined, profileId: string) => void;
  readonly handleSetFastMode: ThreadSurfaceProps["composerProps"]["onSetFastMode"];
  readonly handleSetSessionModel: ThreadSurfaceProps["composerProps"]["onSetModel"];
  readonly handleSetSessionThinking: ThreadSurfaceProps["composerProps"]["onSetThinking"];
  readonly handleSetSessionToolAccess: ThreadSurfaceProps["composerProps"]["onSetToolAccess"];
  readonly handleSteerQueuedMessage: ThreadSurfaceProps["composerProps"]["onSteerQueuedMessage"];
  readonly handleToggleShowThinking: ThreadSurfaceProps["composerProps"]["onToggleShowThinking"];
  readonly handleViewFileInDiff: ThreadSurfaceProps["timelineProps"]["onViewFileInDiff"];
  readonly isTranscriptLoading: boolean;
  readonly lastError: string | undefined;
  readonly latestPlan: DetectedPlan | null;
  readonly mentionMenu: MentionMenuState;
  readonly navigateTreeSelection: (targetId: string, options?: NavigateSessionTreeOptions) => void;
  readonly openSettings: (workspaceId?: string, section?: ModelOnboardingSettingsSection) => void;
  readonly openSkillProfiles: (workspaceId?: string) => void;
  readonly openUrl: ThreadSurfaceProps["timelineProps"]["onOpenUrl"];
  readonly planPanelOpen: boolean;
  readonly planSurfaceAvailable: boolean;
  readonly queuedComposerMessages: readonly QueuedComposerMessage[];
  readonly resolvedSessionModelId: string | undefined;
  readonly resolvedSessionProvider: string | undefined;
  readonly resolvedSessionThinkingLevel: string | undefined;
  readonly resolvedSessionToolAccess: ThreadSurfaceProps["composerProps"]["toolAccess"];
  readonly selectedModelRuntime: RuntimeSnapshot | undefined;
  readonly selectedRuntime: RuntimeSnapshot | undefined;
  readonly selectedSession: SessionRecord;
  readonly selectedSessionCommands: readonly RuntimeCommandRecord[];
  readonly selectedSessionKey: string;
  readonly selectedSessionModelOnboarding: ModelOnboardingState;
  readonly selectedWorkspace: WorkspaceRecord;
  readonly setComposerDraft: ThreadSurfaceProps["composerProps"]["setComposerDraft"];
  readonly showThinking: boolean;
  readonly slashMenu: SlashMenuState;
  readonly submitComposerDraft: ThreadSurfaceProps["composerProps"]["onSubmit"];
  readonly thinkingActive: boolean;
  readonly threadSearch: ThreadSurfaceProps["timelineProps"]["threadSearch"];
  readonly timelineViewport: TimelineViewportProps;
  readonly treeModalState: Omit<NonNullable<ThreadSurfaceProps["treeModal"]>, "onClose" | "onNavigate"> & { readonly open: boolean };
  readonly askPiToImplementLatestPlan: NonNullable<ThreadSurfaceProps["planPanel"]>["onImplement"];
}

export function createThreadSurfaceProps({
  activeExtensionDialog,
  activeTranscript,
  askPiToImplementLatestPlan,
  closeGitDialog,
  closePlanPanel,
  closeTreeModal,
  composerAttachments,
  composerDraft,
  composerRef,
  createCheckoutSelector,
  editingQueuedMessageId,
  fastModeAvailable,
  fastModeSelection,
  gitActionError,
  gitActionPending,
  gitBranchName,
  gitChangedFiles,
  gitDialog,
  handleCancelQueuedEdit,
  handleCommitChanges,
  handleComposerDrop,
  handleComposerKeyDown,
  handleComposerPaste,
  handleCreatePullRequest,
  handleEditQueuedMessage,
  handlePickAttachments,
  handlePushBranch,
  handleRemoveAttachment,
  handleRemoveQueuedMessage,
  handleRespondToExtensionDialog,
  handleSetActiveSkillProfile,
  handleSetFastMode,
  handleSetSessionModel,
  handleSetSessionThinking,
  handleSetSessionToolAccess,
  handleSteerQueuedMessage,
  handleToggleShowThinking,
  handleViewFileInDiff,
  isTranscriptLoading,
  lastError,
  latestPlan,
  mentionMenu,
  navigateTreeSelection,
  openSettings,
  openSkillProfiles,
  openUrl,
  planPanelOpen,
  planSurfaceAvailable,
  queuedComposerMessages,
  resolvedSessionModelId,
  resolvedSessionProvider,
  resolvedSessionThinkingLevel,
  resolvedSessionToolAccess,
  selectedModelRuntime,
  selectedRuntime,
  selectedSession,
  selectedSessionCommands,
  selectedSessionKey,
  selectedSessionModelOnboarding,
  selectedWorkspace,
  setComposerDraft,
  showThinking,
  slashMenu,
  submitComposerDraft,
  thinkingActive,
  threadSearch,
  timelineViewport,
  treeModalState,
}: CreateThreadSurfacePropsOptions): ThreadSurfaceProps {
  return {
    timelineProps: {
      timelineSessionKey: selectedSessionKey,
      transcript: activeTranscript,
      isTranscriptLoading,
      timelinePaneRef: timelineViewport.timelinePaneRef,
      timelinePaneElementRef: timelineViewport.setTimelinePaneElement,
      disableVirtualization: timelineViewport.shouldDisableTimelineVirtualization,
      onDisableVirtualizationReady: timelineViewport.finalizeTimelineVirtualizationDisable,
      onTimelineScroll: timelineViewport.handleTimelineScroll,
      threadSearch,
      showJumpToLatest: timelineViewport.showJumpToLatest,
      onJumpToLatest: timelineViewport.jumpToLatest,
      onContentHeightChange: timelineViewport.handleTimelineContentHeightChange,
      onViewFileInDiff: handleViewFileInDiff,
      onOpenUrl: openUrl,
    },
    composerKey: selectedSessionKey,
    composerProps: {
      activeSlashCommand: slashMenu.activeSlashFlow?.command,
      activeSlashCommandMeta: slashMenu.activeSlashFlow?.command?.description,
      attachments: composerAttachments,
      queuedMessages: queuedComposerMessages,
      editingQueuedMessageId,
      composerDraft,
      composerRef,
      runtime: selectedModelRuntime,
      provider: resolvedSessionProvider,
      modelId: resolvedSessionModelId,
      thinkingLevel: resolvedSessionThinkingLevel,
      showThinking,
      thinkingActive,
      toolAccess: resolvedSessionToolAccess,
      sessionCommands: selectedSessionCommands,
      onSetToolAccess: handleSetSessionToolAccess,
      onClearSlashCommand: slashMenu.resetSlashUi,
      onComposerKeyDown: handleComposerKeyDown,
      onComposerPaste: handleComposerPaste,
      onComposerDrop: handleComposerDrop,
      onPickAttachments: handlePickAttachments,
      onRemoveAttachment: handleRemoveAttachment,
      onEditQueuedMessage: handleEditQueuedMessage,
      onCancelQueuedEdit: handleCancelQueuedEdit,
      onRemoveQueuedMessage: handleRemoveQueuedMessage,
      onSteerQueuedMessage: handleSteerQueuedMessage,
      onSelectSlashCommand: (command) => {
        slashMenu.applySlashCommandSelection(command, "click");
      },
      onSelectSlashOption: (option) => {
        slashMenu.applySlashOptionSelection(option);
      },
      onSetModel: handleSetSessionModel,
      onSetThinking: handleSetSessionThinking,
      onToggleShowThinking: handleToggleShowThinking,
      fastMode: fastModeSelection,
      fastModeAvailable,
      onSetFastMode: handleSetFastMode,
      skillProfileControl: selectedRuntime ? (
        <SkillProfileSelector
          profiles={selectedRuntime.skillProfiles}
          activeProfileId={selectedRuntime.activeSkillProfileId}
          onSelectProfile={(profileId) => handleSetActiveSkillProfile(selectedWorkspace.id, profileId)}
          onOpenSkillProfiles={() => openSkillProfiles(selectedWorkspace.rootWorkspaceId ?? selectedWorkspace.id)}
        />
      ) : undefined,
      modelOnboarding: selectedSessionModelOnboarding,
      onOpenModelSettings: (section) =>
        openSettings(selectedWorkspace.rootWorkspaceId ?? selectedWorkspace.id, section),
      onSubmit: submitComposerDraft,
      sessionStatus: selectedSession.status,
      runtimeStatusText: runtimeStatusLabel(selectedSession),
      lastError,
      selectedSlashCommand: slashMenu.activeSlashOptionCommand ?? slashMenu.selectedSlashCommand,
      selectedSlashOption: slashMenu.selectedSlashOption,
      slashOptionEmptyState: slashMenu.slashOptionEmptyState,
      setComposerDraft,
      showSlashOptionMenu: slashMenu.showSlashOptionMenu,
      showSlashMenu: slashMenu.showSlashMenu,
      slashOptions: slashMenu.slashOptions,
      slashSections: slashMenu.slashSections,
      showMentionMenu: mentionMenu.showMentionMenu,
      mentionOptions: mentionMenu.mentionOptions,
      selectedMentionIndex: mentionMenu.selectedIndex,
      onSelectMention: mentionMenu.insertMention,
      checkoutSelector: createCheckoutSelector(selectedWorkspace),
    },
    extensionDialog: activeExtensionDialog,
    onRespondToExtensionDialog: handleRespondToExtensionDialog,
    gitDialogs: {
      kind: gitDialog ?? undefined,
      commitProps: {
        branchName: gitBranchName,
        error: gitActionError,
        files: gitChangedFiles,
        workspaceName: selectedWorkspace.name,
        pending: gitActionPending,
      },
      pushProps: {
        branchName: gitBranchName ?? selectedWorkspace.branchName,
        error: gitActionError,
        pending: gitActionPending,
      },
      prProps: {
        branchName: gitBranchName ?? selectedWorkspace.branchName,
        error: gitActionError,
        pending: gitActionPending,
      },
      setUpstreamError: gitActionError,
      onClose: closeGitDialog,
      onCommit: handleCommitChanges,
      onPush: handlePushBranch,
      onCreatePr: handleCreatePullRequest,
    },
    treeModal: treeModalState.open ? {
      error: treeModalState.error,
      loading: treeModalState.loading,
      submitting: treeModalState.submitting,
      tree: treeModalState.tree,
      onClose: closeTreeModal,
      onNavigate: navigateTreeSelection,
    } : undefined,
    planPanel: planPanelOpen && planSurfaceAvailable && latestPlan ? {
      plan: latestPlan,
      onClose: closePlanPanel,
      onImplement: askPiToImplementLatestPlan,
    } : undefined,
  };
}
