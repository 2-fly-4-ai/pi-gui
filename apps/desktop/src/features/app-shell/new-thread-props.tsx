import type * as React from "react";
import type { RefObject } from "react";
import type { ToolAccessSelection } from "@pi-gui/session-driver";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type {
  ComposerAttachment,
  DiagnosticReportingPreferences,
  NewThreadEnvironment,
  WorkspaceRecord,
} from "../../desktop-state";
import type { MentionMenuState } from "../../hooks/use-mention-menu";
import type { SlashMenuState } from "../../hooks/use-slash-menu";
import type { ModelOnboardingState, ModelOnboardingSettingsSection } from "../../model-onboarding";
import type { NewThreadSurfaceProps } from "../new-thread/new-thread-surface";

interface CreateNewThreadSurfacePropsOptions {
  readonly createCheckoutSelector: (workspace: WorkspaceRecord | undefined, mode: "app" | "new-thread") => React.ReactNode;
  readonly fastModeAvailable: boolean;
  readonly fastModeSelection: "auto" | "on" | "off";
  readonly handleNewThreadAddAttachments: (files: File[]) => void;
  readonly handleNewThreadComposerDrop: React.DragEventHandler<HTMLDivElement>;
  readonly handleNewThreadComposerKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
  readonly handleNewThreadComposerPaste: React.ClipboardEventHandler<HTMLDivElement>;
  readonly handleNewThreadRemoveAttachment: (attachmentId: string) => void;
  readonly handleSelectNewThreadWorkspace: (workspaceId: string) => void;
  readonly handleSetActiveSkillProfile: (workspaceId: string | undefined, profileId: string) => void;
  readonly handleSetFastMode: (mode: "auto" | "on" | "off") => void;
  readonly handleToggleShowThinking: () => void;
  readonly newThreadAttachments: readonly ComposerAttachment[];
  readonly newThreadComposerError: string | undefined;
  readonly newThreadComposerRef: RefObject<HTMLTextAreaElement | null>;
  readonly newThreadEnvironment: NewThreadEnvironment;
  readonly newThreadMentionMenu: MentionMenuState;
  readonly newThreadModelOnboarding: ModelOnboardingState;
  readonly diagnosticReporting: DiagnosticReportingPreferences;
  readonly newThreadPrompt: string;
  readonly newThreadRootWorkspaceId: string;
  readonly newThreadRuntime: RuntimeSnapshot | undefined;
  readonly newThreadSlashMenu: SlashMenuState;
  readonly newThreadWorkspace: WorkspaceRecord | undefined;
  readonly openSettings: (workspaceId?: string, section?: ModelOnboardingSettingsSection) => void;
  readonly openSkillProfiles: (workspaceId?: string) => void;
  readonly handleSetDiagnosticReportingPreferences: (preferences: Partial<DiagnosticReportingPreferences>) => void;
  readonly resolvedNewThreadModelId: string | undefined;
  readonly resolvedNewThreadProvider: string | undefined;
  readonly resolvedNewThreadThinkingLevel: string | undefined;
  readonly resolvedNewThreadToolAccess: ToolAccessSelection;
  readonly rootWorkspaceOptions: readonly WorkspaceRecord[];
  readonly setNewThreadEnvironment: (environment: NewThreadEnvironment) => void;
  readonly setNewThreadModelId: (modelId: string) => void;
  readonly setNewThreadPrompt: (prompt: string) => void;
  readonly setNewThreadProvider: (provider: string) => void;
  readonly setNewThreadThinkingLevel: (level: string) => void;
  readonly setNewThreadToolAccess: (selection: ToolAccessSelection) => void;
  readonly showThinking: boolean;
  readonly startThread: () => void;
}

export function createNewThreadSurfaceProps({
  createCheckoutSelector,
  fastModeAvailable,
  fastModeSelection,
  handleNewThreadAddAttachments,
  handleNewThreadComposerDrop,
  handleNewThreadComposerKeyDown,
  handleNewThreadComposerPaste,
  handleNewThreadRemoveAttachment,
  handleSelectNewThreadWorkspace,
  handleSetActiveSkillProfile,
  handleSetFastMode,
  handleToggleShowThinking,
  newThreadAttachments,
  newThreadComposerError,
  newThreadComposerRef,
  newThreadEnvironment,
  newThreadMentionMenu,
  newThreadModelOnboarding,
  diagnosticReporting,
  newThreadPrompt,
  newThreadRootWorkspaceId,
  newThreadRuntime,
  newThreadSlashMenu,
  newThreadWorkspace,
  openSettings,
  openSkillProfiles,
  handleSetDiagnosticReportingPreferences,
  resolvedNewThreadModelId,
  resolvedNewThreadProvider,
  resolvedNewThreadThinkingLevel,
  resolvedNewThreadToolAccess,
  rootWorkspaceOptions,
  setNewThreadEnvironment,
  setNewThreadModelId,
  setNewThreadPrompt,
  setNewThreadProvider,
  setNewThreadThinkingLevel,
  setNewThreadToolAccess,
  showThinking,
  startThread,
}: CreateNewThreadSurfacePropsOptions): NewThreadSurfaceProps {
  return {
    viewProps: {
      workspaces: rootWorkspaceOptions,
      selectedWorkspaceId: newThreadRootWorkspaceId || rootWorkspaceOptions[0]?.id || "",
      runtime: newThreadRuntime,
      environment: newThreadEnvironment,
      prompt: newThreadPrompt,
      attachments: newThreadAttachments,
      lastError: newThreadComposerError,
      provider: resolvedNewThreadProvider,
      modelId: resolvedNewThreadModelId,
      thinkingLevel: resolvedNewThreadThinkingLevel,
      showThinking,
      modelOnboarding: newThreadModelOnboarding,
      diagnosticReporting,
      toolAccess: resolvedNewThreadToolAccess,
      fastMode: fastModeSelection,
      fastModeAvailable,
      composerRef: newThreadComposerRef,
      activeSlashCommand: newThreadSlashMenu.activeSlashFlow?.command,
      activeSlashCommandMeta: newThreadSlashMenu.activeSlashFlow?.command?.description,
      slashSections: newThreadSlashMenu.slashSections,
      slashOptions: newThreadSlashMenu.slashOptions,
      selectedSlashCommand: newThreadSlashMenu.activeSlashOptionCommand ?? newThreadSlashMenu.selectedSlashCommand,
      selectedSlashOption: newThreadSlashMenu.selectedSlashOption,
      showSlashMenu: newThreadSlashMenu.showSlashMenu,
      showSlashOptionMenu: newThreadSlashMenu.showSlashOptionMenu,
      slashOptionEmptyState: newThreadSlashMenu.slashOptionEmptyState,
      showMentionMenu: newThreadMentionMenu.showMentionMenu,
      mentionOptions: newThreadMentionMenu.mentionOptions,
      selectedMentionIndex: newThreadMentionMenu.selectedIndex,
      onChangePrompt: setNewThreadPrompt,
      onSelectEnvironment: setNewThreadEnvironment,
      onSelectWorkspace: handleSelectNewThreadWorkspace,
      onSetModel: (provider, modelId) => { setNewThreadProvider(provider); setNewThreadModelId(modelId); },
      onSetThinking: setNewThreadThinkingLevel,
      onToggleShowThinking: handleToggleShowThinking,
      onSetToolAccess: setNewThreadToolAccess,
      onSetFastMode: handleSetFastMode,
      onOpenModelSettings: (section) => openSettings(newThreadWorkspace?.id, section),
      onSetDiagnosticReportingPreferences: handleSetDiagnosticReportingPreferences,
      onComposerKeyDown: handleNewThreadComposerKeyDown,
      onComposerPaste: handleNewThreadComposerPaste,
      onComposerDrop: handleNewThreadComposerDrop,
      onClearSlashCommand: newThreadSlashMenu.resetSlashUi,
      onSelectSlashCommand: (command) => {
        newThreadSlashMenu.applySlashCommandSelection(command, "click");
      },
      onSelectSlashOption: (option) => {
        newThreadSlashMenu.applySlashOptionSelection(option);
      },
      onSelectMention: newThreadMentionMenu.insertMention,
      onAddAttachments: handleNewThreadAddAttachments,
      onRemoveAttachment: handleNewThreadRemoveAttachment,
      onSubmit: startThread,
      checkoutSelector: createCheckoutSelector(newThreadWorkspace, "new-thread"),
    },
    onSelectSkillProfile: (profileId) => handleSetActiveSkillProfile(newThreadWorkspace?.id, profileId),
    onOpenSkillProfiles: () => openSkillProfiles(newThreadWorkspace?.id),
  };
}
