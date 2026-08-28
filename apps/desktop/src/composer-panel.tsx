import { memo, type ClipboardEvent, type Dispatch, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject, type SetStateAction } from "react";
import type { RuntimeCommandRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ToolAccessSelection } from "@pi-gui/session-driver";
import type { ComposerAttachment, QueuedComposerMessage, SessionRecord } from "./desktop-state";
import type {
  ComposerSlashCommand,
  ComposerSlashCommandSection,
  ComposerSlashOption,
  ComposerSlashOptionEmptyState,
} from "./composer-commands";
import { ComposerSurface } from "./composer-surface";
import { ModelOnboardingNoticeBanner } from "./model-onboarding-notice";
import { selectorEmptyModelDescription, type ModelOnboardingState, type ModelOnboardingSettingsSection } from "./model-onboarding";
import { ModelSelector } from "./model-selector";
import { ComposerControlBar } from "./composer-control-bar";
import { ReasoningSelector } from "./reasoning-selector";
import { ToolAccessSelector } from "./tool-access-selector";
import { ContextWindowIndicator } from "./context-window-indicator";
import { FastModeSelector, type FastModeSelection } from "./fast-mode-selector";
import { ThinkingTraceToggle } from "./thinking-trace-toggle";
import type { PiDesktopApi } from "./ipc";
import { TaskEvidenceSurface } from "./features/evidence/task-evidence-surface";
import { TaskErrorRecovery } from "./features/evidence/task-error-recovery";
import { ContextInspector } from "./features/evidence/context-inspector";
import { ExecutionBoundaryControl } from "./features/evidence/execution-boundary-control";

interface ComposerPanelProps {
  readonly api: PiDesktopApi;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly onOpenLogs: () => void;
  readonly onOpenErrorSettings: () => void;
  readonly sessionStatus: SessionRecord["status"];
  readonly runtimeStatusText: string;
  readonly lastError?: string;
  readonly runtime?: RuntimeSnapshot;
  readonly activeSlashCommand?: ComposerSlashCommand;
  readonly activeSlashCommandMeta?: string;
  readonly composerDraft: string;
  readonly setComposerDraft: Dispatch<SetStateAction<string>>;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly attachments: readonly ComposerAttachment[];
  readonly queuedMessages: readonly QueuedComposerMessage[];
  readonly editingQueuedMessageId?: string;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly showThinking: boolean;
  readonly thinkingActive: boolean;
  readonly codexUsageStatus?: string;
  readonly slashSections: readonly ComposerSlashCommandSection[];
  readonly slashOptions: readonly ComposerSlashOption[];
  readonly sessionCommands: readonly RuntimeCommandRecord[];
  readonly fastMode: FastModeSelection;
  readonly fastModeAvailable: boolean;
  readonly selectedSlashCommand?: ComposerSlashCommand;
  readonly selectedSlashOption?: ComposerSlashOption;
  readonly showSlashMenu: boolean;
  readonly showSlashOptionMenu: boolean;
  readonly slashOptionEmptyState?: ComposerSlashOptionEmptyState;
  readonly onClearSlashCommand: () => void;
  readonly onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onComposerPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  readonly onComposerDrop: (event: DragEvent<HTMLDivElement>) => void;
  readonly onPickAttachments: () => void;
  readonly onRemoveAttachment: (attachmentId: string) => void;
  readonly onEditQueuedMessage: (messageId: string) => void;
  readonly onCancelQueuedEdit: () => void;
  readonly onRemoveQueuedMessage: (messageId: string) => void;
  readonly onSteerQueuedMessage: (messageId: string) => void;
  readonly onQueueQueuedMessage: (messageId: string) => void;
  readonly onMoveQueuedMessage: (messageId: string, direction: "up" | "down") => void;
  readonly onSendNextQueuedMessage: (messageId: string) => void;
  readonly onSelectSlashCommand: (command: ComposerSlashCommand) => void;
  readonly onSelectSlashOption: (option: ComposerSlashOption) => void;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly onToggleShowThinking: () => void;
  readonly onSetFastMode: (mode: FastModeSelection) => void;
  readonly skillProfileControl?: ReactNode;
  readonly modelOnboarding: ModelOnboardingState;
  readonly toolAccess: ToolAccessSelection;
  readonly onSetToolAccess: (selection: ToolAccessSelection) => void;
  readonly onOpenModelSettings: (section: ModelOnboardingSettingsSection) => void;
  readonly onSubmit: () => void;
  readonly onStashPrompt?: () => void;
  readonly showMentionMenu: boolean;
  readonly mentionOptions: readonly string[];
  readonly selectedMentionIndex: number;
  readonly onSelectMention: (filePath: string) => void;
  readonly checkoutSelector?: ReactNode;
  readonly onReviewChanges: (path: string) => void;
  readonly onCommit: () => void;
}

export const ComposerPanel = memo(function ComposerPanel({
  api,
  workspaceId,
  sessionId,
  onOpenLogs,
  onOpenErrorSettings,
  sessionStatus,
  runtimeStatusText,
  lastError,
  runtime,
  activeSlashCommand,
  activeSlashCommandMeta,
  composerDraft,
  setComposerDraft,
  composerRef,
  attachments,
  queuedMessages,
  editingQueuedMessageId,
  provider,
  modelId,
  thinkingLevel,
  showThinking,
  thinkingActive,
  codexUsageStatus,
  slashSections,
  slashOptions,
  fastMode,
  fastModeAvailable,
  selectedSlashCommand,
  selectedSlashOption,
  showSlashMenu,
  showSlashOptionMenu,
  slashOptionEmptyState,
  onClearSlashCommand,
  onComposerKeyDown,
  onComposerPaste,
  onComposerDrop,
  onPickAttachments,
  onRemoveAttachment,
  onEditQueuedMessage,
  onCancelQueuedEdit,
  onRemoveQueuedMessage,
  onSteerQueuedMessage,
  onQueueQueuedMessage,
  onMoveQueuedMessage,
  onSendNextQueuedMessage,
  onSelectSlashCommand,
  onSelectSlashOption,
  onSetModel,
  onSetThinking,
  onToggleShowThinking,
  onSetFastMode,
  skillProfileControl,
  modelOnboarding,
  toolAccess,
  onSetToolAccess,
  onOpenModelSettings,
  onSubmit,
  onStashPrompt,
  showMentionMenu,
  mentionOptions,
  selectedMentionIndex,
  onSelectMention,
  checkoutSelector,
  onReviewChanges,
  onCommit,
}: ComposerPanelProps) {
  const hasComposerInput = composerDraft.trim().length > 0 || attachments.length > 0;
  const primaryActionIsStop = sessionStatus === "running" && !hasComposerInput;
  const primaryActionLabel = sessionStatus === "running" && hasComposerInput ? "Steer current run" : primaryActionIsStop ? "Stop run" : "Send message";
  const showRuntimeStatus = !isIdleRuntimeStatusText(runtimeStatusText);

  return (
    <footer className="composer">
      <div className="conversation conversation--composer">
        <div className="composer-status-strip" aria-label="Composer status">
          {checkoutSelector}
          <ContextInspector
            api={api}
            workspaceId={workspaceId}
            sessionId={sessionId}
            provider={provider}
            model={modelId}
            composerDraft={composerDraft}
            setComposerDraft={setComposerDraft}
            attachments={attachments}
            onRemoveAttachment={onRemoveAttachment}
          />
          <ExecutionBoundaryControl
            api={api}
            workspaceId={workspaceId}
            sessionId={sessionId}
            toolAccess={toolAccess}
            onSetToolAccess={onSetToolAccess}
          />
          {showRuntimeStatus ? (
            <span className="composer-runtime-status" data-testid="composer-runtime-status">
              {runtimeStatusText}
            </span>
          ) : null}
        </div>
        <TaskEvidenceSurface
          api={api}
          workspaceId={workspaceId}
          sessionId={sessionId}
          sessionStatus={sessionStatus}
          onOpenLogs={onOpenLogs}
          onOpenSettings={onOpenErrorSettings}
          onRetry={setComposerDraft}
          onReviewChanges={onReviewChanges}
          onCommit={onCommit}
        />
        {lastError ? (
          <TaskErrorRecovery
            api={api}
            message={lastError}
            onOpenLogs={onOpenLogs}
            onOpenSettings={onOpenErrorSettings}
            onRetry={setComposerDraft}
          />
        ) : null}
        <ComposerSurface
          lastError={undefined}
          activeSlashCommand={activeSlashCommand}
          activeSlashCommandMeta={activeSlashCommandMeta}
          topNotice={(
            <ModelOnboardingNoticeBanner notice={modelOnboarding.notice} onOpenSettings={onOpenModelSettings} />
          )}
          composerDraft={composerDraft}
          setComposerDraft={setComposerDraft}
          composerRef={composerRef}
          attachments={attachments}
          queuedMessages={queuedMessages}
          editingQueuedMessageId={editingQueuedMessageId}
          slashSections={slashSections}
          slashOptions={slashOptions}
          selectedSlashCommand={selectedSlashCommand}
          selectedSlashOption={selectedSlashOption}
          showSlashMenu={showSlashMenu}
          showSlashOptionMenu={showSlashOptionMenu}
          slashOptionEmptyState={slashOptionEmptyState}
          onClearSlashCommand={onClearSlashCommand}
          onComposerKeyDown={onComposerKeyDown}
          onComposerPaste={onComposerPaste}
          onComposerDrop={onComposerDrop}
          onRemoveAttachment={onRemoveAttachment}
          onEditQueuedMessage={onEditQueuedMessage}
          onCancelQueuedEdit={onCancelQueuedEdit}
          onRemoveQueuedMessage={onRemoveQueuedMessage}
          onSteerQueuedMessage={onSteerQueuedMessage}
          onQueueQueuedMessage={onQueueQueuedMessage}
          onMoveQueuedMessage={onMoveQueuedMessage}
          onSendNextQueuedMessage={onSendNextQueuedMessage}
          onSelectSlashCommand={onSelectSlashCommand}
          onSelectSlashOption={onSelectSlashOption}
          showMentionMenu={showMentionMenu}
          mentionOptions={mentionOptions}
          selectedMentionIndex={selectedMentionIndex}
          onSelectMention={onSelectMention}
          textareaLabel="Composer"
          textareaTestId="composer"
          textareaPlaceholder="Ask pi to inspect the repo, run a fix, or continue the current thread..."
          footer={(
            <div className="composer__footer">
              <ComposerControlBar
                modelControl={(
                  <ModelSelector
                    runtime={runtime}
                    provider={provider}
                    modelId={modelId}
                    thinkingLevel={undefined}
                    variant="composer"
                    unselectedModelLabel={modelOnboarding.unselectedModelLabel}
                    emptyModelTitle={modelOnboarding.emptyModelTitle}
                    emptyModelDescription={selectorEmptyModelDescription(modelOnboarding)}
                    onSetModel={onSetModel}
                    onSetThinking={onSetThinking}
                  />
                )}
                reasoningControl={(
                  <ReasoningSelector
                    thinkingLevel={thinkingLevel}
                    onSetThinking={onSetThinking}
                  />
                )}
                fastModeControl={fastMode === "on" ? (
                  <FastModeSelector
                    available={fastModeAvailable}
                    value={fastMode}
                    onSetFastMode={onSetFastMode}
                  />
                ) : undefined}
                skillProfileControl={skillProfileControl}
                supervisionControl={(
                  <ToolAccessSelector
                    value={toolAccess}
                    onChange={onSetToolAccess}
                  />
                )}
                contextControl={(
                  <ContextWindowIndicator
                    codexUsageStatus={codexUsageStatus}
                    compactionEnabled
                  />
                )}
                thinkingTraceControl={(
                  <ThinkingTraceToggle
                    showThinking={showThinking}
                    active={thinkingActive}
                    onToggle={onToggleShowThinking}
                  />
                )}
                sendLabel={primaryActionLabel}
                sendDisabled={
                  !primaryActionIsStop &&
                  ((!composerDraft.trim() && attachments.length === 0) || modelOnboarding.requiresModelSelection)
                }
                stopMode={primaryActionIsStop}
                onAttach={onPickAttachments}
                onStash={onStashPrompt}
                stashDisabled={!hasComposerInput}
                onSubmit={onSubmit}
              />
            </div>
          )}
        />
      </div>
    </footer>
  );
});

function isIdleRuntimeStatusText(text: string): boolean {
  return text === "Idle" || text === "Agent idle · no tools running";
}
