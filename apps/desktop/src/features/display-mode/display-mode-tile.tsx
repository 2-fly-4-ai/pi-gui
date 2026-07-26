import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type Dispatch,
  type DragEvent,
  type KeyboardEvent,
  type SetStateAction,
} from "react";
import type { RuntimeCommandRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  ComposerAttachment,
  DesktopAppState,
  DisplayModeThreadRecord,
  ExtensionCommandCompatibilityRecord,
} from "../../desktop-state";
import { applySessionConfigPatch } from "../../desktop-state";
import { TimelineItem } from "../../timeline-item";
import { TerminalPanel } from "../../terminal-panel";
import { ComposerSurface } from "../../composer-surface";
import {
  extractFilesFromDataTransfer,
  extractImageFilesFromClipboardData,
  readComposerAttachmentsFromFiles,
} from "../../composer-attachments";
import { ComposerControlBar } from "../../composer-control-bar";
import { ContextWindowIndicator } from "../../context-window-indicator";
import { FastModeSelector, type FastModeSelection } from "../../fast-mode-selector";
import { useSlashMenu } from "../../hooks/use-slash-menu";
import {
  ChevronRightIcon,
  EllipsisIcon,
  MaximizeIcon,
  MinimizeIcon,
  StopSquareIcon,
  TerminalIcon,
  VSCodeIcon,
} from "../../icons";
import type { PiDesktopApi } from "../../ipc";
import { ModelSelector } from "../../model-selector";
import { ReasoningSelector } from "../../reasoning-selector";
import { logIgnoredError } from "../../renderer-diagnostics";
import type { SettingsSection } from "../../settings-view";
import { SkillProfileSelector } from "../../skill-profile-selector";
import { formatExactLocalTime, formatRelativeTime } from "../../string-utils";
import { ThinkingTraceToggle } from "../../thinking-trace-toggle";
import { ToolAccessSelector } from "../../tool-access-selector";
import type { ChangedFile } from "./display-mode-types";
import { statusLabel, statusTone, summarizeDisplayModeSubagents } from "./display-mode-utils";

export interface DisplayModeTileProps {
  readonly api: PiDesktopApi;
  readonly id: string;
  readonly record: DisplayModeThreadRecord;
  readonly terminalOpen: boolean;
  readonly renderTerminalInline: boolean;
  readonly runtime: RuntimeSnapshot | undefined;
  readonly sessionCommands: readonly RuntimeCommandRecord[];
  readonly commandCompatibility: readonly ExtensionCommandCompatibilityRecord[];
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly openSettings: (workspaceId?: string, section?: SettingsSection) => void;
  readonly openSkillProfiles: (workspaceId?: string) => void;
  readonly isPinned: boolean;
  readonly isExpanded: boolean;
  readonly compact: boolean;
  readonly fastMode: FastModeSelection;
  readonly fastModeAvailable: boolean;
  readonly showThinking: boolean;
  readonly codexUsageStatus?: string;
  readonly onFilesUpdate: ((files: readonly ChangedFile[]) => void) | undefined;
  readonly onOpenThread: () => void;
  readonly onOpenVSCode: () => void;
  readonly onPinPreview: () => void;
  readonly onToggleTerminal: () => void;
  readonly onToggleExpand: () => void;
}

export function DisplayModeTile({
  api, id, record, terminalOpen, renderTerminalInline, isPinned, isExpanded, compact,
  fastMode, fastModeAvailable, showThinking, codexUsageStatus,
  runtime, sessionCommands, commandCompatibility, setSnapshot, openSettings, openSkillProfiles,
  onFilesUpdate, onOpenThread, onOpenVSCode, onPinPreview, onToggleTerminal, onToggleExpand,
}: DisplayModeTileProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: isExpanded });
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<readonly ComposerAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const terminalWrapperRef = useRef<HTMLDivElement | null>(null);
  const [terminalHeight, setTerminalHeight] = useState(200);
  const [expandedToolCallIds, setExpandedToolCallIds] = useState<Set<string>>(() => new Set());
  const tone = statusTone(record.session);
  const recentMessages = record.transcript.slice(-8);
  const hasRecentMessages = recentMessages.length > 0;
  const sessionPreview = record.session.preview.trim();
  const transcriptFallbackPreview = sessionPreview && sessionPreview !== record.session.title.trim() ? sessionPreview : "";
  const subagentActivity = record.subagentActivity ?? summarizeDisplayModeSubagents(record.transcript);
  const focusComposer = () => {
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };
  const submitText = useCallback((textInput: string) => {
    const text = textInput.trim();
    if ((!text && attachments.length === 0) || submitting) return;
    setSubmitting(true);
    setDraft("");
    setAttachments([]);
    void api.submitComposerToSession(
      { workspaceId: record.workspace.id, sessionId: record.session.id },
      text,
      {
        attachments,
        ...(record.session.status === "running" ? { deliverAs: "steer" as const } : {}),
      },
    ).finally(() => setSubmitting(false));
  }, [api, attachments, record.session.id, record.session.status, record.workspace.id, submitting]);

  const slashMenu = useSlashMenu({
    composerDraft: draft,
    setComposerDraft: setDraft,
    selectedRuntime: runtime,
    selectedModelRuntime: runtime,
    sessionCommands,
    commandCompatibility,
    selectedSessionKey: id,
    selectedSession: record.session,
    selectedWorkspace: record.workspace,
    isRunning: record.session.status === "running",
    api,
    setSnapshot,
    focusComposer,
    openSettings,
    allowTreeCommand: false,
    immediateCommandMode: "submit",
    onSubmitImmediateCommand: submitText,
  });

  useEffect(() => {
    const availableToolCallIds = new Set(
      record.transcript.filter((item) => item.kind === "tool").map((item) => item.callId),
    );
    setExpandedToolCallIds((current) => {
      if (current.size === 0) return current;
      const next = new Set<string>();
      for (const callId of current) {
        if (availableToolCallIds.has(callId)) {
          next.add(callId);
        }
      }
      return next.size === current.size ? current : next;
    });
  }, [record.transcript]);

  const toggleToolCall = useCallback((callId: string) => {
    setExpandedToolCallIds((current) => {
      const next = new Set(current);
      if (next.has(callId)) {
        next.delete(callId);
      } else {
        next.add(callId);
      }
      return next;
    });
  }, []);

  // Measure terminal wrapper height so TerminalPanel fills it exactly
  useEffect(() => {
    if (!terminalOpen) { setTerminalHeight(200); return; }
    const el = terminalWrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      if (h > 0) setTerminalHeight(h);
    });
    ro.observe(el);
    const h = el.clientHeight;
    if (h > 0) setTerminalHeight(h);
    return () => ro.disconnect();
  }, [terminalOpen]);

  // Auto-scroll transcript to bottom while running
  useEffect(() => {
    if (record.session.status === "running" && transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [record.transcript.length, record.session.status]);

  useEffect(() => { if (renaming) renameInputRef.current?.select(); }, [renaming]);

  useEffect(() => {
    if (!actionsMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!actionsMenuRef.current?.contains(event.target as Node)) {
        setActionsMenuOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setActionsMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [actionsMenuOpen]);

  const startRename = () => { setRenameDraft(record.session.title); setRenaming(true); };
  const submitRename = () => {
    const title = renameDraft.trim();
    if (title && title !== record.session.title) {
      void api.renameSession({ workspaceId: record.workspace.id, sessionId: record.session.id }, title);
    }
    setRenaming(false);
  };

  useEffect(() => {
    let active = true;
    void api.getChangedFiles(record.workspace.id).then((files) => {
      if (!active) return;
      const sliced = files.slice(0, 8);
      onFilesUpdate?.(sliced);
    }).catch((error) => logIgnoredError("display-mode.changed-files", error));
    return () => { active = false; };
  }, [api, record.workspace.id, record.session.updatedAt, onFilesUpdate]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [draft]);

  const submit = () => {
    submitText(draft);
  };

  const addAttachments = useCallback((files: readonly File[]) => {
    if (files.length === 0) return;
    void readComposerAttachmentsFromFiles(files).then((nextAttachments) => {
      if (nextAttachments.length > 0) {
        setAttachments((current) => [...current, ...nextAttachments]);
      }
    });
  }, []);

  const handleComposerPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = extractImageFilesFromClipboardData(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    addAttachments(files);
  };

  const handleComposerDrop = (event: DragEvent<HTMLDivElement>) => {
    const files = extractFilesFromDataTransfer(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    addAttachments(files);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMenu.handleSlashKeyDown(event)) return;
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
  };

  const handleTileKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const tag = (event.target as HTMLElement).tagName;
    if (tag === "TEXTAREA" || tag === "INPUT" || tag === "BUTTON") return;
    if (event.key === "t" || event.key === "T") { event.preventDefault(); onToggleTerminal(); }
    else if (event.key === "v" || event.key === "V") { event.preventDefault(); onOpenVSCode(); }
    else if (event.key === "o" || event.key === "O") { event.preventDefault(); onOpenThread(); }
  };
  const runAction = (action: () => void) => {
    setActionsMenuOpen(false);
    action();
  };
  const setSessionModel = (provider: string, modelId: string) => {
    setSnapshot((current) => current
      ? applySessionConfigPatch(current, record.workspace.id, record.session.id, { provider, modelId })
      : current);
    void api.setSessionModel(record.workspace.id, record.session.id, provider, modelId);
  };
  const setSessionThinking = (level: string) => {
    const thinkingLevel = level as NonNullable<RuntimeSnapshot["settings"]["defaultThinkingLevel"]>;
    setSnapshot((current) => current
      ? applySessionConfigPatch(current, record.workspace.id, record.session.id, { thinkingLevel })
      : current);
    void api.setSessionThinkingLevel(record.workspace.id, record.session.id, thinkingLevel);
  };
  const setSessionToolAccess = (toolAccess: NonNullable<DisplayModeThreadRecord["session"]["config"]>["toolAccess"]) => {
    if (!toolAccess) return;
    setSnapshot((current) => current
      ? applySessionConfigPatch(current, record.workspace.id, record.session.id, { toolAccess })
      : current);
    void api.setSessionToolAccess(record.workspace.id, record.session.id, toolAccess);
  };
  const toggleShowThinking = () => {
    const nextShowThinking = !showThinking;
    setSnapshot((current) => current ? { ...current, showThinking: nextShowThinking } : current);
    void api.setShowThinking(nextShowThinking);
  };
  const setFastMode = (mode: FastModeSelection) => {
    const enabled = mode === "on";
    setSnapshot((current) => current
      ? { ...current, fastMode: { ...current.fastMode, enabled }, lastError: undefined }
      : current);
    void api.setFastMode(enabled);
  };
  const provider = record.session.config?.provider ?? runtime?.settings.defaultProvider;
  const modelId = record.session.config?.modelId ?? runtime?.settings.defaultModelId;
  const thinkingLevel = record.session.config?.thinkingLevel ?? runtime?.settings.defaultThinkingLevel;

  return (
    <article
      ref={setNodeRef}
      className={`display-mode-tile display-mode-tile--${tone}${isPinned ? " display-mode-tile--pinned" : ""}${isDragging ? " display-mode-tile--dragging" : ""}${isExpanded ? " display-mode-tile--expanded" : ""}${compact ? " display-mode-tile--compact" : ""}${terminalOpen ? " display-mode-tile--terminal-open" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      data-testid="display-mode-thread-tile"
      onKeyDown={handleTileKeyDown}
      {...attributes}
    >
      <div className="display-mode-tile__accent" aria-hidden="true" />
      {/* Header */}
      <header className="display-mode-tile__head">
        <div className="display-mode-tile__head-top">
          <div
            className="display-mode-tile__drag"
            {...(isExpanded ? {} : listeners)}
            aria-label="Drag to reorder"
            title="Drag to reorder"
            style={isExpanded ? { opacity: 0.3, pointerEvents: "none" } : undefined}
          >⠿</div>
          <button
            className={`display-mode-tile__expand-btn${isExpanded ? " display-mode-tile__expand-btn--active" : ""}`}
            type="button"
            aria-label={isExpanded ? "Collapse tile" : "Expand tile to half width"}
            title={isExpanded ? "Collapse" : "Expand to half"}
            onClick={(event) => { event.stopPropagation(); onToggleExpand(); }}
          >
            {isExpanded ? <MinimizeIcon /> : <MaximizeIcon />}
          </button>
          <span className="display-mode-tile__workspace">{record.workspace.name}</span>
          <span className={`display-mode-tile__status-pill display-mode-tile__status-pill--${tone}`}>
            <span className="display-mode-tile__status-dot" aria-hidden="true" />
            {statusLabel(record.session)}
          </span>
          <time
            aria-label={`Updated ${formatExactLocalTime(record.session.updatedAt)}`}
            className="display-mode-tile__time"
            dateTime={record.session.updatedAt}
            tabIndex={0}
            title={formatExactLocalTime(record.session.updatedAt)}
          >
            {formatRelativeTime(record.session.updatedAt)}
          </time>
          <div className="display-mode-tile__action-menu" ref={actionsMenuRef}>
            <button
              aria-expanded={actionsMenuOpen}
              aria-haspopup="menu"
              aria-label="Thread actions"
              className={`display-mode-tile__action-menu-trigger${actionsMenuOpen ? " display-mode-tile__action-menu-trigger--open" : ""}`}
              data-testid="display-mode-thread-actions"
              title="Thread actions"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setActionsMenuOpen((open) => !open);
              }}
            >
              <EllipsisIcon />
            </button>
            {actionsMenuOpen ? (
              <div aria-label="Thread actions" className="display-mode-tile__action-menu-popover" role="menu">
                <button role="menuitem" type="button" onClick={() => runAction(onOpenThread)}>
                  <ChevronRightIcon />
                  <span>Open thread</span>
                </button>
                {record.session.status === "running" ? (
                  <button
                    className="display-mode-tile__action-menu-danger"
                    role="menuitem"
                    type="button"
                    onClick={() => runAction(() => {
                      void api.cancelSessionRun({
                        workspaceId: record.workspace.id,
                        sessionId: record.session.id,
                      });
                    })}
                  >
                    <StopSquareIcon />
                    <span>Stop</span>
                  </button>
                ) : null}
                <div className="display-mode-tile__action-menu-separator" role="separator" />
                <button
                  aria-pressed={terminalOpen}
                  role="menuitem"
                  type="button"
                  onClick={() => runAction(onToggleTerminal)}
                >
                  <TerminalIcon />
                  <span>Terminal</span>
                  {terminalOpen ? <span aria-hidden="true" className="display-mode-tile__action-menu-state">Open</span> : null}
                </button>
                <button role="menuitem" type="button" onClick={() => runAction(onOpenVSCode)}>
                  <VSCodeIcon />
                  <span>VS Code</span>
                </button>
                <button
                  aria-pressed={isPinned}
                  role="menuitem"
                  type="button"
                  onClick={() => runAction(onPinPreview)}
                >
                  <MaximizeIcon />
                  <span>Pin preview</span>
                  {isPinned ? <span aria-hidden="true" className="display-mode-tile__action-menu-state">Pinned</span> : null}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="display-mode-tile__head-title">
          {renaming ? (
            <input
              ref={renameInputRef}
              className="display-mode-tile__rename-input"
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); submitRename(); }
                if (event.key === "Escape") { event.preventDefault(); setRenaming(false); }
              }}
              onBlur={submitRename}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <button
              className="display-mode-tile__title display-mode-tile__title--editable"
              type="button"
              title="Click to rename"
              onClick={(event) => { event.stopPropagation(); startRename(); }}
            >
              {record.session.title}
            </button>
          )}
        </div>
      </header>

      {/* Transcript */}
      {!compact && hasRecentMessages ? (
        <div className="display-mode-tile__transcript" ref={transcriptRef}>
          {recentMessages.map((item) => (
            <TimelineItem
              item={item}
              key={item.id}
              expandedToolCallIds={expandedToolCallIds}
              onToggleToolCall={toggleToolCall}
            />
          ))}
        </div>
      ) : !compact && transcriptFallbackPreview ? (
        <div className="display-mode-tile__transcript display-mode-tile__transcript--preview" ref={transcriptRef}>
          <div className="display-mode-tile__preview-text">{transcriptFallbackPreview}</div>
        </div>
      ) : !compact ? (
        <div className="display-mode-tile__empty-state">Transcript not loaded yet</div>
      ) : null}

      {/* Terminal (when open) */}
      {!compact && terminalOpen && renderTerminalInline && (
        <div className="display-mode-tile__terminal" ref={terminalWrapperRef}>
          <TerminalPanel
            workspace={record.workspace}
            sessionId={record.session.id}
            height={terminalHeight}
            isTakeover={false}
            onHeightChange={() => undefined}
            onToggleTakeover={() => undefined}
            onHide={onToggleTerminal}
          />
        </div>
      )}

      {subagentActivity && !compact ? (
        <div
          aria-live="polite"
          className={`display-mode-tile__activity-rail display-mode-tile__activity-rail--${subagentActivity.status}`}
          data-testid="display-mode-subagent-activity"
          title={subagentActivity.label}
        >
          <span className="display-mode-tile__activity-rail-marker" aria-hidden="true" />
          <span>{subagentActivity.label}</span>
        </div>
      ) : null}

      {/* Reply — reuse the same composer surface/input structure as the thread view. */}
      {!compact && <div className="composer display-mode-tile__reply">
        <div className="conversation conversation--composer">
          <input
            ref={fileInputRef}
            className="sr-only"
            multiple
            tabIndex={-1}
            type="file"
            onChange={(event) => {
              addAttachments(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <ComposerSurface
            activeSlashCommand={slashMenu.activeSlashFlow?.command}
            activeSlashCommandMeta={slashMenu.activeSlashFlow?.command?.description}
            attachments={attachments}
            queuedMessages={[]}
            composerDraft={draft}
            composerRef={textareaRef}
            lastError={undefined}
            onCancelQueuedEdit={() => undefined}
            onClearSlashCommand={slashMenu.resetSlashUi}
            onComposerDrop={handleComposerDrop}
            onComposerKeyDown={handleKeyDown}
            onComposerPaste={handleComposerPaste}
            onEditQueuedMessage={() => undefined}
            onRemoveAttachment={(attachmentId) => {
              setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
            }}
            onRemoveQueuedMessage={() => undefined}
            onSelectMention={() => undefined}
            onSelectSlashCommand={(command) => slashMenu.applySlashCommandSelection(command, "click")}
            onSelectSlashOption={(option) => slashMenu.applySlashOptionSelection(option)}
            onSteerQueuedMessage={() => undefined}
            onQueueQueuedMessage={() => undefined}
            onMoveQueuedMessage={() => undefined}
            onSendNextQueuedMessage={() => undefined}
            selectedMentionIndex={0}
            selectedSlashCommand={slashMenu.activeSlashOptionCommand ?? slashMenu.selectedSlashCommand}
            selectedSlashOption={slashMenu.selectedSlashOption}
            setComposerDraft={setDraft}
            showMentionMenu={false}
            mentionOptions={[]}
            showSlashMenu={slashMenu.showSlashMenu}
            showSlashOptionMenu={slashMenu.showSlashOptionMenu}
            slashOptionEmptyState={slashMenu.slashOptionEmptyState}
            slashOptions={slashMenu.slashOptions}
            slashSections={slashMenu.slashSections}
            textareaLabel={`Reply to ${record.session.title}`}
            textareaPlaceholder={`Reply to ${record.session.title}…`}
            textareaTestId={`display-mode-reply-${id}`}
            compactSlashDescriptions
            footer={(
              <div className="composer__footer">
                <ComposerControlBar
                  modelControl={(
                    <ModelSelector
                      runtime={runtime}
                      provider={provider}
                      modelId={modelId}
                      thinkingLevel={undefined}
                      showEmptyModelControl
                      variant="composer"
                      onSetModel={setSessionModel}
                      onSetThinking={setSessionThinking}
                    />
                  )}
                  reasoningControl={(
                    <ReasoningSelector
                      thinkingLevel={thinkingLevel}
                      onSetThinking={setSessionThinking}
                    />
                  )}
                  fastModeControl={fastMode === "on" ? (
                    <FastModeSelector
                      available={fastModeAvailable}
                      value={fastMode}
                      onSetFastMode={setFastMode}
                    />
                  ) : undefined}
                  skillProfileControl={runtime ? (
                    <SkillProfileSelector
                      profiles={runtime.skillProfiles}
                      activeProfileId={runtime.activeSkillProfileId}
                      onSelectProfile={(profileId) => {
                        void api.setActiveSkillProfile(record.workspace.id, profileId);
                      }}
                      onOpenSkillProfiles={() => {
                        openSkillProfiles(record.workspace.rootWorkspaceId ?? record.workspace.id);
                      }}
                    />
                  ) : undefined}
                  supervisionControl={(
                    <ToolAccessSelector
                      value={record.session.config?.toolAccess}
                      onChange={setSessionToolAccess}
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
                      onToggle={toggleShowThinking}
                    />
                  )}
                  sendLabel={record.session.status === "running" ? "Steer thread" : "Send reply"}
                  sendDisabled={submitting || (!draft.trim() && attachments.length === 0)}
                  stopMode={false}
                  onAttach={() => fileInputRef.current?.click()}
                  onSubmit={submit}
                />
              </div>
            )}
          />
        </div>
      </div>}
    </article>
  );
}
