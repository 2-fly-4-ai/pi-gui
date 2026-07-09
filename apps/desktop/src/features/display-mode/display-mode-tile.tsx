import { useCallback, useEffect, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import type { RuntimeCommandRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DesktopAppState, DisplayModeThreadRecord, ExtensionCommandCompatibilityRecord } from "../../desktop-state";
import { TimelineItem } from "../../timeline-item";
import { TerminalPanel } from "../../terminal-panel";
import { ComposerSurface } from "../../composer-surface";
import { useSlashMenu } from "../../hooks/use-slash-menu";
import { ArrowUpIcon, MaximizeIcon, MinimizeIcon, StopSquareIcon, TerminalIcon } from "../../icons";
import type { PiDesktopApi } from "../../ipc";
import { logIgnoredError } from "../../renderer-diagnostics";
import type { SettingsSection } from "../../settings-view";
import { formatRelativeTime } from "../../string-utils";
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
  readonly isPinned: boolean;
  readonly isExpanded: boolean;
  readonly compact: boolean;
  readonly onFilesUpdate: ((files: readonly ChangedFile[]) => void) | undefined;
  readonly onOpenThread: () => void;
  readonly onOpenVSCode: () => void;
  readonly onPinPreview: () => void;
  readonly onToggleTerminal: () => void;
  readonly onToggleExpand: () => void;
}

export function DisplayModeTile({
  api, id, record, terminalOpen, renderTerminalInline, isPinned, isExpanded, compact,
  runtime, sessionCommands, commandCompatibility, setSnapshot, openSettings,
  onFilesUpdate, onOpenThread, onOpenVSCode, onPinPreview, onToggleTerminal, onToggleExpand,
}: DisplayModeTileProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: isExpanded });
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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
    if (!text || submitting) return;
    setSubmitting(true);
    setDraft("");
    void api.submitComposerToSession(
      { workspaceId: record.workspace.id, sessionId: record.session.id },
      text,
      record.session.status === "running" ? { deliverAs: "steer" } : undefined,
    ).finally(() => setSubmitting(false));
  }, [api, record.session.id, record.session.status, record.workspace.id, submitting]);

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
          <span className="display-mode-tile__time">{formatRelativeTime(record.session.updatedAt)}</span>
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
        {subagentActivity ? (
          <div
            className={`display-mode-tile__subagents display-mode-tile__subagents--${subagentActivity.status}`}
            data-testid="display-mode-subagent-activity"
            title={subagentActivity.label}
          >
            <span className="display-mode-tile__subagents-dot" aria-hidden="true" />
            <span>{subagentActivity.label}</span>
          </div>
        ) : null}
      </header>

      {/* Actions row */}
      {!compact && (
        <div className="display-mode-tile__actions">
          <button className="button button--primary display-mode-tile__action-primary" type="button" onClick={onOpenThread}>Open thread</button>
          {record.session.status === "running" && (
            <button className="button display-mode-tile__action-stop" type="button" onClick={() => void api.cancelSessionRun({ workspaceId: record.workspace.id, sessionId: record.session.id })}>
              <StopSquareIcon /> Stop
            </button>
          )}
          <button className={`button${terminalOpen ? " display-mode-tile__action-active" : ""}`} type="button" onClick={onToggleTerminal}><TerminalIcon /> Terminal</button>
          <button className="button" type="button" onClick={onOpenVSCode}>VS Code</button>
          <button className={`button${isPinned ? " display-mode-tile__action-active" : ""}`} type="button" aria-pressed={isPinned} onClick={onPinPreview}><MaximizeIcon /> Pin</button>
        </div>
      )}

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

      {/* Reply — reuse the same composer surface/input structure as the thread view. */}
      {!compact && <div className="composer display-mode-tile__reply">
        <div className="conversation conversation--composer">
          <ComposerSurface
            activeSlashCommand={slashMenu.activeSlashFlow?.command}
            activeSlashCommandMeta={slashMenu.activeSlashFlow?.command?.description}
            attachments={[]}
            queuedMessages={[]}
            composerDraft={draft}
            composerRef={textareaRef}
            lastError={undefined}
            onCancelQueuedEdit={() => undefined}
            onClearSlashCommand={slashMenu.resetSlashUi}
            onComposerDrop={(event) => event.preventDefault()}
            onComposerKeyDown={handleKeyDown}
            onComposerPaste={() => undefined}
            onEditQueuedMessage={() => undefined}
            onRemoveAttachment={() => undefined}
            onRemoveQueuedMessage={() => undefined}
            onSelectMention={() => undefined}
            onSelectSlashCommand={(command) => slashMenu.applySlashCommandSelection(command, "click")}
            onSelectSlashOption={(option) => slashMenu.applySlashOptionSelection(option)}
            onSteerQueuedMessage={() => undefined}
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
                <div className="composer-control-bar display-mode-tile__reply-bar">
                  <div className="composer-control-bar__left">
                    <span className="display-mode-tile__reply-hint">Enter to send · Shift+Enter newline</span>
                  </div>
                  <div className="composer-control-bar__right">
                    <button
                      className="button button--primary button--cta-icon"
                      type="button"
                      disabled={submitting || !draft.trim()}
                      onClick={submit}
                      aria-label="Send reply"
                    >
                      <ArrowUpIcon />
                    </button>
                  </div>
                </div>
              </div>
            )}
          />
        </div>
      </div>}
    </article>
  );
}
