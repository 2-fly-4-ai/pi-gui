import type * as React from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { NavigateSessionTreeOptions } from "@pi-gui/session-driver/types";
import type {
  DesktopAppState,
  SessionRecord,
  WorkspaceRecord,
  WorkspaceSessionTarget,
} from "../../desktop-state";
import type { MentionMenuState } from "../../hooks/use-mention-menu";
import type { SlashMenuState } from "../../hooks/use-slash-menu";
import type { SettingsSection } from "../../settings-utils";
import type { useCheckoutSelector } from "../checkout/use-checkout-selector";
import type { useGitActions } from "../git/use-git-actions";
import type { useNewThreadState } from "../new-thread/use-new-thread-state";
import type { usePanelLayout } from "../panels/use-panel-layout";
import type { useRuntimeSelections } from "../models/use-runtime-selections";
import type { useSessionComposer } from "../composer/use-session-composer";
import type { useSettingsActions } from "../settings/use-settings-actions";
import type { useTimelineViewport } from "../timeline/use-timeline-viewport";
import { createDisplayModeProps } from "./display-mode-props";
import { createNewThreadSurfaceProps } from "./new-thread-props";
import { PrimaryContentSurface } from "./primary-content-surface";
import { createThreadSurfaceProps } from "./thread-props";
import type { DetectedPlan } from "../../plan-panel-model";
import type { TranscriptMessage } from "../../timeline-types";
import type { ThreadSurfaceProps } from "../thread/thread-surface";

interface AppPrimaryContentProps {
  readonly activeExtensionDialog: ThreadSurfaceProps["extensionDialog"];
  readonly activeTranscript: readonly TranscriptMessage[];
  readonly api: NonNullable<typeof window.piApp>;
  readonly askPiToImplementLatestPlan: NonNullable<ThreadSurfaceProps["planPanel"]>["onImplement"];
  readonly closePlanPanel: () => void;
  readonly closeTreeModal: () => void;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly createCheckoutSelector: ReturnType<typeof useCheckoutSelector>;
  readonly displayModeInitialPinnedThreadKey: string;
  readonly fastModeAvailable: boolean;
  readonly fastModeSelection: "auto" | "on" | "off";
  readonly gitActions: ReturnType<typeof useGitActions>;
  readonly handleComposerDrop: React.DragEventHandler<HTMLDivElement>;
  readonly handleComposerKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
  readonly handleComposerPaste: React.ClipboardEventHandler<HTMLDivElement>;
  readonly handleNewThreadAddAttachments: (files: File[]) => void;
  readonly handleNewThreadComposerDrop: React.DragEventHandler<HTMLDivElement>;
  readonly handleNewThreadComposerKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
  readonly handleNewThreadComposerPaste: React.ClipboardEventHandler<HTMLDivElement>;
  readonly handleNewThreadRemoveAttachment: (attachmentId: string) => void;
  readonly handleRespondToExtensionDialog: ThreadSurfaceProps["onRespondToExtensionDialog"];
  readonly handleSelectSession: (target: WorkspaceSessionTarget) => void;
  readonly handleViewFileInDiff: ThreadSurfaceProps["timelineProps"]["onViewFileInDiff"];
  readonly isTranscriptLoading: boolean;
  readonly latestPlan: DetectedPlan | null;
  readonly mentionMenu: MentionMenuState;
  readonly navigateTreeSelection: (targetId: string, options?: NavigateSessionTreeOptions) => void;
  readonly newThreadComposerRef: RefObject<HTMLTextAreaElement | null>;
  readonly newThreadMentionMenu: MentionMenuState;
  readonly newThreadSlashMenu: SlashMenuState;
  readonly newThreadState: ReturnType<typeof useNewThreadState>;
  readonly newThreadWorkspace: WorkspaceRecord | undefined;
  readonly onOpenNewThread: (workspaceId?: string) => void;
  readonly openSettings: (workspaceId?: string, section?: SettingsSection) => void;
  readonly openSkillProfiles: ReturnType<typeof useSettingsActions>["openSkillProfiles"];
  readonly openUrl: ThreadSurfaceProps["timelineProps"]["onOpenUrl"];
  readonly panelLayout: ReturnType<typeof usePanelLayout>;
  readonly planPanelOpen: boolean;
  readonly planSurfaceAvailable: boolean;
  readonly rootWorkspaceOptions: readonly WorkspaceRecord[];
  readonly runtimeSelections: ReturnType<typeof useRuntimeSelections>;
  readonly selectedSession: SessionRecord | undefined;
  readonly selectedSessionCommands: ThreadSurfaceProps["composerProps"]["sessionCommands"];
  readonly selectedSessionKey: string;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly sessionComposer: ReturnType<typeof useSessionComposer>;
  readonly settingsActions: ReturnType<typeof useSettingsActions>;
  readonly showThinking: boolean;
  readonly slashMenu: SlashMenuState;
  readonly snapshot: DesktopAppState;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly startThread: () => void;
  readonly thinkingActive: boolean;
  readonly threadSearch: ThreadSurfaceProps["timelineProps"]["threadSearch"];
  readonly timelineViewport: ReturnType<typeof useTimelineViewport>;
  readonly treeModalState: ThreadSurfaceProps["treeModal"] extends infer TreeModal
    ? Omit<NonNullable<TreeModal>, "onClose" | "onNavigate"> & { readonly open: boolean }
    : never;
}

export function AppPrimaryContent({
  activeExtensionDialog,
  activeTranscript,
  api,
  askPiToImplementLatestPlan,
  closePlanPanel,
  closeTreeModal,
  composerRef,
  createCheckoutSelector,
  displayModeInitialPinnedThreadKey,
  fastModeAvailable,
  fastModeSelection,
  gitActions,
  handleComposerDrop,
  handleComposerKeyDown,
  handleComposerPaste,
  handleNewThreadAddAttachments,
  handleNewThreadComposerDrop,
  handleNewThreadComposerKeyDown,
  handleNewThreadComposerPaste,
  handleNewThreadRemoveAttachment,
  handleRespondToExtensionDialog,
  handleSelectSession,
  handleViewFileInDiff,
  isTranscriptLoading,
  latestPlan,
  mentionMenu,
  navigateTreeSelection,
  newThreadComposerRef,
  newThreadMentionMenu,
  newThreadSlashMenu,
  newThreadState,
  newThreadWorkspace,
  onOpenNewThread,
  openSettings,
  openSkillProfiles,
  openUrl,
  panelLayout,
  planPanelOpen,
  planSurfaceAvailable,
  rootWorkspaceOptions,
  runtimeSelections,
  selectedSession,
  selectedSessionCommands,
  selectedSessionKey,
  selectedWorkspace,
  sessionComposer,
  settingsActions,
  showThinking,
  slashMenu,
  snapshot,
  setSnapshot,
  startThread,
  thinkingActive,
  threadSearch,
  timelineViewport,
  treeModalState,
}: AppPrimaryContentProps) {
  return (
    <PrimaryContentSurface
      activeView={snapshot.activeView}
      displayModeProps={createDisplayModeProps({
        api,
        commandCompatibilityByWorkspace: snapshot.extensionCommandCompatibilityByWorkspace,
        displayModeInitialPinnedThreadKey,
        dmDrawerOpen: panelLayout.dmDrawerOpen,
        handleSelectSession,
        openSettings,
        openVsCodeForWorkspace: panelLayout.openVsCodeForWorkspace,
        runtimeByWorkspace: snapshot.runtimeByWorkspace,
        sessionCommandsBySession: snapshot.sessionCommandsBySession,
        setSharedVsCodeWidth: panelLayout.setSharedVsCodeWidth,
        setSnapshot,
        setVsCodeSlotElement: panelLayout.setVsCodeSlotElement,
        threadVsCodeWidth: panelLayout.threadVsCodeWidth,
        toggleDmDrawer: panelLayout.toggleDmDrawer,
        toggleVsCode: panelLayout.toggleVsCode,
        vsCodeFolderPath: panelLayout.vsCodeFolderPath,
        vsCodeOpen: panelLayout.vsCodeOpen,
        vsCodeWorkspaceId: panelLayout.vsCodeWorkspaceId,
      })}
      newThreadProps={createNewThreadSurfaceProps({
        createCheckoutSelector,
        fastModeAvailable,
        fastModeSelection,
        handleNewThreadAddAttachments,
        handleNewThreadComposerDrop,
        handleNewThreadComposerKeyDown,
        handleNewThreadComposerPaste,
        handleNewThreadRemoveAttachment,
        handleSelectNewThreadWorkspace: newThreadState.handleSelectNewThreadWorkspace,
        handleSetActiveSkillProfile: settingsActions.handleSetActiveSkillProfile,
        handleSetFastMode: sessionComposer.handleSetFastMode,
        handleToggleShowThinking: sessionComposer.handleToggleShowThinking,
        newThreadAttachments: newThreadState.newThreadAttachments,
        newThreadComposerError: newThreadState.newThreadComposerError,
        newThreadComposerRef,
        newThreadEnvironment: newThreadState.newThreadEnvironment,
        newThreadMentionMenu,
        newThreadModelOnboarding: runtimeSelections.newThreadModelOnboarding,
        diagnosticReporting: snapshot.diagnosticReporting,
        newThreadPrompt: newThreadState.newThreadPrompt,
        newThreadRootWorkspaceId: newThreadState.newThreadRootWorkspaceId,
        newThreadRuntime: runtimeSelections.newThreadRuntime,
        newThreadSlashMenu,
        newThreadWorkspace,
        openSettings,
        openSkillProfiles,
        handleSetDiagnosticReportingPreferences: settingsActions.handleSetDiagnosticReportingPreferences,
        resolvedNewThreadModelId: runtimeSelections.resolvedNewThreadModelId,
        resolvedNewThreadProvider: runtimeSelections.resolvedNewThreadProvider,
        resolvedNewThreadThinkingLevel: runtimeSelections.resolvedNewThreadThinkingLevel,
        resolvedNewThreadToolAccess: runtimeSelections.resolvedNewThreadToolAccess,
        rootWorkspaceOptions,
        setNewThreadEnvironment: newThreadState.setNewThreadEnvironment,
        setNewThreadModelId: newThreadState.setNewThreadModelId,
        setNewThreadPrompt: newThreadState.setNewThreadPrompt,
        setNewThreadProvider: newThreadState.setNewThreadProvider,
        setNewThreadThinkingLevel: newThreadState.setNewThreadThinkingLevel,
        setNewThreadToolAccess: newThreadState.setNewThreadToolAccess,
        showThinking,
        startThread,
      })}
      selectedWorkspace={selectedWorkspace}
      threadProps={selectedWorkspace && selectedSession ? createThreadSurfaceProps({
        activeExtensionDialog,
        activeTranscript,
        askPiToImplementLatestPlan,
        closeGitDialog: gitActions.closeGitDialog,
        closePlanPanel,
        closeTreeModal,
        composerAttachments: sessionComposer.composerAttachments,
        composerDraft: sessionComposer.composerDraft,
        composerRef,
        createCheckoutSelector,
        editingQueuedMessageId: sessionComposer.editingQueuedMessageId,
        fastModeAvailable,
        fastModeSelection,
        gitActionError: gitActions.gitActionError,
        gitActionPending: gitActions.gitActionPending,
        gitBranchName: gitActions.gitBranchName,
        gitChangedFiles: gitActions.gitChangedFiles,
        gitDialog: gitActions.gitDialog,
        handleCancelQueuedEdit: sessionComposer.handleCancelQueuedEdit,
        handleCommitChanges: gitActions.handleCommitChanges,
        handleComposerDrop,
        handleComposerKeyDown,
        handleComposerPaste,
        handleCreatePullRequest: gitActions.handleCreatePullRequest,
        handleEditQueuedMessage: sessionComposer.handleEditQueuedMessage,
        handlePickAttachments: sessionComposer.handlePickAttachments,
        handlePushBranch: gitActions.handlePushBranch,
        handleRemoveAttachment: sessionComposer.handleRemoveAttachment,
        handleRemoveQueuedMessage: sessionComposer.handleRemoveQueuedMessage,
        handleRespondToExtensionDialog,
        handleSetActiveSkillProfile: settingsActions.handleSetActiveSkillProfile,
        handleSetFastMode: sessionComposer.handleSetFastMode,
        handleSetSessionModel: sessionComposer.handleSetSessionModel,
        handleSetSessionThinking: sessionComposer.handleSetSessionThinking,
        handleSetSessionToolAccess: sessionComposer.handleSetSessionToolAccess,
        handleSteerQueuedMessage: sessionComposer.handleSteerQueuedMessage,
        handleToggleShowThinking: sessionComposer.handleToggleShowThinking,
        handleViewFileInDiff,
        isTranscriptLoading,
        lastError: snapshot.lastError,
        latestPlan,
        mentionMenu,
        navigateTreeSelection,
        openSettings,
        openSkillProfiles,
        openUrl,
        planPanelOpen,
        planSurfaceAvailable,
        queuedComposerMessages: sessionComposer.queuedComposerMessages,
        resolvedSessionModelId: runtimeSelections.resolvedSessionModelId,
        resolvedSessionProvider: runtimeSelections.resolvedSessionProvider,
        resolvedSessionThinkingLevel: runtimeSelections.resolvedSessionThinkingLevel,
        resolvedSessionToolAccess: runtimeSelections.resolvedSessionToolAccess,
        selectedModelRuntime: runtimeSelections.selectedModelRuntime,
        selectedRuntime: runtimeSelections.selectedRuntime,
        selectedSession,
        selectedSessionCommands,
        selectedSessionKey,
        selectedSessionModelOnboarding: runtimeSelections.selectedSessionModelOnboarding,
        selectedWorkspace,
        setComposerDraft: sessionComposer.setComposerDraft,
        showThinking,
        slashMenu,
        submitComposerDraft: sessionComposer.submitComposerDraft,
        thinkingActive,
        threadSearch,
        timelineViewport,
        treeModalState,
      }) : undefined}
      onOpenNewThread={onOpenNewThread}
    />
  );
}
