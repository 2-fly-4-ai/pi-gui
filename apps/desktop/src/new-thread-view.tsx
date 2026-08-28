import { useEffect, useRef, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { ToolAccessSelection } from "@pi-gui/session-driver";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type {
  ComposerAttachment,
  DiagnosticReportingPreferences,
  NewThreadEnvironment,
  WorkspaceRecord,
} from "./desktop-state";
import { PiLogoMark } from "./icons";
import {
  MODEL_OPTIONS_EMPTY_TITLE,
  type ComposerSlashCommand,
  type ComposerSlashCommandSection,
  type ComposerSlashOption,
  type ComposerSlashOptionEmptyState,
} from "./composer-commands";
import { ComposerSurface } from "./composer-surface";
import { FirstRunOnboardingCard, ModelOnboardingNoticeBanner } from "./model-onboarding-notice";
import { selectorEmptyModelDescription, type ModelOnboardingState, type ModelOnboardingSettingsSection } from "./model-onboarding";
import { ModelSelector } from "./model-selector";
import { ComposerControlBar } from "./composer-control-bar";
import { ReasoningSelector } from "./reasoning-selector";
import { ToolAccessSelector } from "./tool-access-selector";
import { ContextWindowIndicator } from "./context-window-indicator";
import { FastModeSelector, type FastModeSelection } from "./fast-mode-selector";
import { ThinkingTraceToggle } from "./thinking-trace-toggle";
import { DiagnosticReportingOnboardingCard } from "./diagnostic-reporting-onboarding";

const REPO_STARTERS = [
  {
    label: "Inspect current changes",
    description: "Check the worktree first; summarize meaningful changes or say clearly when it is clean.",
    prompt: "Inspect the current repository changes. Summarize what changed, identify risks or unfinished work, and tell me the most useful next step. If the worktree is clean, say so and inspect recent project context instead.",
  },
  {
    label: "Find failing tests",
    description: "Discover the project’s test commands and diagnose real failures without assuming any exist.",
    prompt: "Find the appropriate test commands for this repository and run the narrowest useful checks. Diagnose any failures you find. If the tests pass, summarize what was verified and suggest the next highest-value check.",
  },
  {
    label: "Review the project",
    description: "Orient to the repository, its current state, and the highest-value improvement.",
    prompt: "Review this project as it exists now. Read its repository guidance, inspect the current state, and recommend the highest-value improvement with concrete evidence.",
  },
  {
    label: "Explain architecture",
    description: "Map the main components, boundaries, data flow, and extension points.",
    prompt: "Explain this repository’s architecture. Map the main components, runtime boundaries, data flow, and extension points, citing the most important files.",
  },
] as const;

export interface NewThreadViewProps {
  readonly workspaces: readonly WorkspaceRecord[];
  readonly selectedWorkspaceId: string;
  readonly runtime?: RuntimeSnapshot;
  readonly environment: NewThreadEnvironment;
  readonly prompt: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly lastError?: string;
  readonly submitting: boolean;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly showThinking: boolean;
  readonly modelOnboarding: ModelOnboardingState;
  readonly diagnosticReporting: DiagnosticReportingPreferences;
  readonly toolAccess: ToolAccessSelection;
  readonly fastMode: FastModeSelection;
  readonly fastModeAvailable: boolean;
  readonly skillProfileControl?: ReactNode;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly activeSlashCommand?: ComposerSlashCommand;
  readonly activeSlashCommandMeta?: string;
  readonly slashSections: readonly ComposerSlashCommandSection[];
  readonly slashOptions: readonly ComposerSlashOption[];
  readonly selectedSlashCommand?: ComposerSlashCommand;
  readonly selectedSlashOption?: ComposerSlashOption;
  readonly showSlashMenu: boolean;
  readonly showSlashOptionMenu: boolean;
  readonly slashOptionEmptyState?: ComposerSlashOptionEmptyState;
  readonly showMentionMenu: boolean;
  readonly mentionOptions: readonly string[];
  readonly selectedMentionIndex: number;
  readonly onChangePrompt: (prompt: string) => void;
  readonly onSelectEnvironment: (environment: NewThreadEnvironment) => void;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly onToggleShowThinking: () => void;
  readonly onSetToolAccess: (selection: ToolAccessSelection) => void;
  readonly onSetFastMode: (mode: FastModeSelection) => void;
  readonly onOpenModelSettings: (section: ModelOnboardingSettingsSection) => void;
  readonly onSetDiagnosticReportingPreferences: (preferences: Partial<DiagnosticReportingPreferences>) => void;
  readonly onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onComposerPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  readonly onComposerDrop: (event: DragEvent<HTMLDivElement>) => void;
  readonly onClearSlashCommand: () => void;
  readonly onSelectSlashCommand: (command: ComposerSlashCommand) => void;
  readonly onSelectSlashOption: (option: ComposerSlashOption) => void;
  readonly onSelectMention: (filePath: string) => void;
  readonly onAddAttachments: (files: File[]) => void;
  readonly onRemoveAttachment: (attachmentId: string) => void;
  readonly onStashPrompt: () => void;
  readonly onSubmit: () => void;
  readonly checkoutSelector?: ReactNode;
}

export function NewThreadView({
  workspaces,
  selectedWorkspaceId,
  runtime,
  environment,
  prompt,
  attachments,
  lastError,
  submitting,
  provider,
  modelId,
  thinkingLevel,
  showThinking,
  modelOnboarding,
  diagnosticReporting,
  toolAccess,
  fastMode,
  fastModeAvailable,
  skillProfileControl,
  composerRef,
  activeSlashCommand,
  activeSlashCommandMeta,
  slashSections,
  slashOptions,
  selectedSlashCommand,
  selectedSlashOption,
  showSlashMenu,
  showSlashOptionMenu,
  slashOptionEmptyState,
  showMentionMenu,
  mentionOptions,
  selectedMentionIndex,
  onChangePrompt,
  onSelectEnvironment,
  onSelectWorkspace,
  onSetModel,
  onSetThinking,
  onToggleShowThinking,
  onSetToolAccess,
  onSetFastMode,
  onOpenModelSettings,
  onSetDiagnosticReportingPreferences,
  onComposerKeyDown,
  onComposerPaste,
  onComposerDrop,
  onClearSlashCommand,
  onSelectSlashCommand,
  onSelectSlashOption,
  onSelectMention,
  onAddAttachments,
  onRemoveAttachment,
  onStashPrompt,
  onSubmit,
  checkoutSelector,
}: NewThreadViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workspace = workspaces.find((entry) => entry.id === selectedWorkspaceId);

  useEffect(() => {
    composerRef.current?.focus();
  }, [composerRef]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }

    composer.style.height = "0px";
    composer.style.height = `${Math.min(composer.scrollHeight, 260)}px`;
  }, [composerRef, prompt]);

  const applyStarter = (starterPrompt: string) => {
    onChangePrompt(starterPrompt);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  if (!workspace) {
    return (
      <section className="canvas canvas--empty">
        <div className="empty-panel">
          <div className="session-header__eyebrow">New thread</div>
          <h1>Open a folder to begin</h1>
          <p>Select a repository from the sidebar first, then start a local or worktree-backed thread.</p>
          <small>Press ⌘K to search commands from anywhere.</small>
        </div>
      </section>
    );
  }

  return (
    <section className="canvas canvas--new-thread">
      <div className="new-thread">
        <div className="new-thread__hero">
          <div className="new-thread__logo" data-testid="new-thread-logo">
            <PiLogoMark />
          </div>
          <div className="new-thread__eyebrow">New thread</div>
          <h1 className="new-thread__title">Let&apos;s build</h1>
          <label className="new-thread__workspace-picker">
            <span className="sr-only">Workspace</span>
            <select
              className="new-thread__workspace"
              value={workspace.id}
              onChange={(event) => onSelectWorkspace(event.target.value)}
            >
              {workspaces.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="new-thread__starters" aria-label={`Starter prompts for ${workspace.name}`}>
          {REPO_STARTERS.map((starter) => (
            <button
              className="new-thread__starter"
              key={starter.label}
              type="button"
              onClick={() => applyStarter(starter.prompt)}
            >
              <span className="new-thread__starter-title">{starter.label}</span>
              <span className="new-thread__starter-description">{starter.description}</span>
            </button>
          ))}
        </div>

        <div className="new-thread__onboarding">
          <DiagnosticReportingOnboardingCard
            preferences={diagnosticReporting}
            onSetPreferences={onSetDiagnosticReportingPreferences}
          />
        </div>

        <div className="new-thread__composer composer">
          <div className="conversation conversation--composer">
            {checkoutSelector ? (
              <div className="composer-status-strip" aria-label="Composer status">
                {checkoutSelector}
              </div>
            ) : null}
            <ComposerSurface
              lastError={lastError}
              activeSlashCommand={activeSlashCommand}
              activeSlashCommandMeta={activeSlashCommandMeta}
              topNotice={(
                <>
                  <FirstRunOnboardingCard
                    guide={modelOnboarding.firstRunGuide}
                    onOpenSettings={onOpenModelSettings}
                    onUsePrompt={onChangePrompt}
                  />
                  <ModelOnboardingNoticeBanner notice={modelOnboarding.notice} onOpenSettings={onOpenModelSettings} />
                </>
              )}
              queuedMessages={[]}
              composerDraft={prompt}
              setComposerDraft={onChangePrompt}
              composerRef={composerRef}
              attachments={attachments}
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
              onEditQueuedMessage={() => undefined}
              onCancelQueuedEdit={() => undefined}
              onRemoveQueuedMessage={() => undefined}
              onSteerQueuedMessage={() => undefined}
              onQueueQueuedMessage={() => undefined}
              onMoveQueuedMessage={() => undefined}
              onSendNextQueuedMessage={() => undefined}
              onRemoveAttachment={onRemoveAttachment}
              onSelectSlashCommand={onSelectSlashCommand}
              onSelectSlashOption={onSelectSlashOption}
              showMentionMenu={showMentionMenu}
              mentionOptions={mentionOptions}
              selectedMentionIndex={selectedMentionIndex}
              onSelectMention={onSelectMention}
              textareaLabel="New thread prompt"
              textareaTestId="new-thread-composer"
              textareaClassName="new-thread__textarea"
              textareaPlaceholder="Ask pi anything, use / for commands and skills"
              footer={(
                <NewThreadComposerFooter
                  runtime={runtime}
                  environment={environment}
                  provider={provider}
                  modelId={modelId}
                  thinkingLevel={thinkingLevel}
                  showThinking={showThinking}
                  modelOnboarding={modelOnboarding}
                  toolAccess={toolAccess}
                  fastMode={fastMode}
                  fastModeAvailable={fastModeAvailable}
                  skillProfileControl={skillProfileControl}
                  hasContent={Boolean(prompt.trim() || attachments.length > 0)}
                  submitting={submitting}
                  fileInputRef={fileInputRef}
                  onSelectEnvironment={onSelectEnvironment}
                  onSetModel={onSetModel}
                  onSetThinking={onSetThinking}
                  onToggleShowThinking={onToggleShowThinking}
                  onSetToolAccess={onSetToolAccess}
                  onSetFastMode={onSetFastMode}
                  onAddAttachments={onAddAttachments}
                  onStashPrompt={onStashPrompt}
                  onSubmit={onSubmit}
                />
              )}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

interface NewThreadComposerFooterProps {
  readonly runtime?: RuntimeSnapshot;
  readonly environment: NewThreadEnvironment;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly showThinking: boolean;
  readonly modelOnboarding: ModelOnboardingState;
  readonly toolAccess: ToolAccessSelection;
  readonly fastMode: FastModeSelection;
  readonly fastModeAvailable: boolean;
  readonly skillProfileControl?: ReactNode;
  readonly hasContent: boolean;
  readonly submitting: boolean;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly onSelectEnvironment: (environment: NewThreadEnvironment) => void;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly onToggleShowThinking: () => void;
  readonly onSetToolAccess: (selection: ToolAccessSelection) => void;
  readonly onSetFastMode: (mode: FastModeSelection) => void;
  readonly onAddAttachments: (files: File[]) => void;
  readonly onStashPrompt: () => void;
  readonly onSubmit: () => void;
}

function NewThreadComposerFooter({
  runtime,
  environment,
  provider,
  modelId,
  thinkingLevel,
  showThinking,
  modelOnboarding,
  toolAccess,
  fastMode,
  fastModeAvailable,
  skillProfileControl,
  hasContent,
  submitting,
  fileInputRef,
  onSelectEnvironment,
  onSetModel,
  onSetThinking,
  onToggleShowThinking,
  onSetToolAccess,
  onSetFastMode,
  onAddAttachments,
  onStashPrompt,
  onSubmit,
}: NewThreadComposerFooterProps) {
  return (
    <>
      <div className="composer__footer">
        <ComposerControlBar
          modelControl={(
            <ModelSelector
              runtime={runtime}
              provider={provider}
              modelId={modelId}
              thinkingLevel={undefined}
              dropdownPlacement="below"
              showEmptyModelControl
              variant="composer"
              unselectedModelLabel={modelOnboarding.unselectedModelLabel}
              emptyModelLabel={MODEL_OPTIONS_EMPTY_TITLE}
              emptyModelTitle={modelOnboarding.emptyModelTitle}
              emptyModelDescription={selectorEmptyModelDescription(modelOnboarding)}
              onSetModel={onSetModel}
              onSetThinking={onSetThinking}
            />
          )}
          reasoningControl={<ReasoningSelector thinkingLevel={thinkingLevel} onSetThinking={onSetThinking} />}
          fastModeControl={<FastModeSelector available={fastModeAvailable} value={fastMode} onSetFastMode={onSetFastMode} />}
          skillProfileControl={skillProfileControl}
          modeControl={(
            <div className="new-thread__environment-group">
              <button
                className={`new-thread__environment ${environment === "local" ? "new-thread__environment--active" : ""}`}
                type="button"
                onClick={() => onSelectEnvironment("local")}
              >
                <span>Local</span>
              </button>
              <button
                className={`new-thread__environment ${environment === "worktree" ? "new-thread__environment--active" : ""}`}
                type="button"
                onClick={() => onSelectEnvironment("worktree")}
              >
                <span>Worktree</span>
              </button>
            </div>
          )}
          supervisionControl={<ToolAccessSelector value={toolAccess} onChange={onSetToolAccess} />}
          contextControl={<ContextWindowIndicator compactionEnabled />}
          thinkingTraceControl={(
            <ThinkingTraceToggle
              showThinking={showThinking}
              onToggle={onToggleShowThinking}
            />
          )}
          sendLabel={submitting ? "Starting thread" : "Start thread"}
          sendDisabled={submitting || !hasContent || modelOnboarding.requiresModelSelection}
          stopMode={false}
          onAttach={() => fileInputRef.current?.click()}
          onStash={onStashPrompt}
          stashDisabled={!hasContent || submitting}
          onSubmit={onSubmit}
        />
        <input
          ref={fileInputRef}
          hidden
          type="file"
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length > 0) {
              onAddAttachments(files);
            }
            event.currentTarget.value = "";
          }}
        />
      </div>
    </>
  );
}
