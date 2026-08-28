import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type Dispatch,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
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
import type { SettingsSection } from "../../settings-view";
import { SkillProfileSelector } from "../../skill-profile-selector";
import { formatExactLocalTime, formatRelativeTime } from "../../string-utils";
import { ThinkingTraceToggle } from "../../thinking-trace-toggle";
import { ToolAccessSelector } from "../../tool-access-selector";
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
  readonly onOpenThread: () => void;
  readonly onOpenVSCode: () => void;
  readonly onPinPreview: () => void;
  readonly onToggleTerminal: () => void;
  readonly onToggleExpand: () => void;
  readonly onRequestProjection: (workspaceId: string, sessionId: string) => void;
  readonly onInteractionResidencyChange: (key: string, active: boolean) => void;
  readonly keyboardDragging: boolean;
  readonly onKeyboardDragKeyDown: (id: string, event: KeyboardEvent<HTMLElement>) => void;
}

function displayModeTilePropsEqual(previous: DisplayModeTileProps, next: DisplayModeTileProps): boolean {
  return previous.api === next.api &&
    previous.id === next.id &&
    previous.record.session === next.record.session &&
    previous.record.transcript === next.record.transcript &&
    previous.record.subagentActivity === next.record.subagentActivity &&
    previous.record.workspace.id === next.record.workspace.id &&
    previous.record.workspace.name === next.record.workspace.name &&
    previous.record.workspace.path === next.record.workspace.path &&
    previous.record.workspace.rootWorkspaceId === next.record.workspace.rootWorkspaceId &&
    previous.terminalOpen === next.terminalOpen &&
    previous.renderTerminalInline === next.renderTerminalInline &&
    previous.runtime === next.runtime &&
    previous.sessionCommands === next.sessionCommands &&
    previous.commandCompatibility === next.commandCompatibility &&
    previous.isPinned === next.isPinned &&
    previous.isExpanded === next.isExpanded &&
    previous.compact === next.compact &&
    previous.fastMode === next.fastMode &&
    previous.fastModeAvailable === next.fastModeAvailable &&
    previous.showThinking === next.showThinking &&
    previous.codexUsageStatus === next.codexUsageStatus &&
    previous.setSnapshot === next.setSnapshot &&
    previous.openSettings === next.openSettings &&
    previous.openSkillProfiles === next.openSkillProfiles &&
    previous.onRequestProjection === next.onRequestProjection &&
    previous.onInteractionResidencyChange === next.onInteractionResidencyChange &&
    previous.keyboardDragging === next.keyboardDragging &&
    previous.onKeyboardDragKeyDown === next.onKeyboardDragKeyDown;
}

function DisplayModeTileComponent(props: DisplayModeTileProps) {
  return props.compact
    ? <DisplayModeCardShell {...props} />
    : <DisplayModeDetailedCard {...props} />;
}

export const DisplayModeTile = memo(DisplayModeTileComponent, displayModeTilePropsEqual);

function DisplayModeCardExcerpt({
  recentMessages,
  fallbackPreview,
  transcriptRef,
  expandedToolCallIds,
  onToggleToolCall,
}: {
  readonly recentMessages: DisplayModeThreadRecord["transcript"];
  readonly fallbackPreview: string;
  readonly transcriptRef: RefObject<HTMLDivElement | null>;
  readonly expandedToolCallIds: ReadonlySet<string>;
  readonly onToggleToolCall: (callId: string) => void;
}) {
  if (recentMessages.length > 0) {
    return (
      <div className="display-mode-tile__transcript" ref={transcriptRef}>
        {recentMessages.map((item) => (
          <TimelineItem
            item={item}
            key={item.id}
            expandedToolCallIds={expandedToolCallIds}
            onToggleToolCall={onToggleToolCall}
          />
        ))}
      </div>
    );
  }
  if (fallbackPreview) {
    return (
      <div className="display-mode-tile__transcript display-mode-tile__transcript--preview" ref={transcriptRef}>
        <div className="display-mode-tile__preview-text">{fallbackPreview}</div>
      </div>
    );
  }
  return <div className="display-mode-tile__empty-state">Transcript not loaded yet</div>;
}

function DisplayModeCardTerminal({
  wrapperRef,
  workspace,
  sessionId,
  height,
  onHide,
}: {
  readonly wrapperRef: RefObject<HTMLDivElement | null>;
  readonly workspace: DisplayModeThreadRecord["workspace"];
  readonly sessionId: string;
  readonly height: number;
  readonly onHide: () => void;
}) {
  return (
    <div className="display-mode-tile__terminal" ref={wrapperRef}>
      <TerminalPanel
        workspace={workspace}
        sessionId={sessionId}
        height={height}
        isTakeover={false}
        onHeightChange={() => undefined}
        onToggleTakeover={() => undefined}
        onHide={onHide}
      />
    </div>
  );
}

function DisplayModeCardComposer({ children }: { readonly children: ReactNode }) {
  return (
    <div className="composer display-mode-tile__reply">
      <div className="conversation conversation--composer">{children}</div>
    </div>
  );
}

function DisplayModeCardShell({
  api,
  id,
  record,
  terminalOpen,
  isPinned,
  isExpanded,
  onOpenThread,
  onOpenVSCode,
  onPinPreview,
  onToggleTerminal,
  onToggleExpand,
  onInteractionResidencyChange,
  keyboardDragging,
  onKeyboardDragKeyDown,
}: DisplayModeTileProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: isExpanded,
  });
  const tone = statusTone(record.session);

  useEffect(() => {
    if (renaming) renameInputRef.current?.select();
  }, [renaming]);

  useEffect(() => {
    if (!actionsMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!actionsMenuRef.current?.contains(event.target as Node)) setActionsMenuOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setActionsMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [actionsMenuOpen]);

  useEffect(() => {
    onInteractionResidencyChange(id, renaming || actionsMenuOpen || terminalOpen);
    return () => onInteractionResidencyChange(id, false);
  }, [actionsMenuOpen, id, onInteractionResidencyChange, renaming, terminalOpen]);

  const submitRename = () => {
    const title = renameDraft.trim();
    if (title && title !== record.session.title) {
      void api.renameSession({ workspaceId: record.workspace.id, sessionId: record.session.id }, title);
    }
    setRenaming(false);
  };
  const runAction = (action: () => void) => {
    setActionsMenuOpen(false);
    action();
  };

  return (
    <article
      ref={setNodeRef}
      className={`display-mode-tile display-mode-tile--${tone}${isPinned ? " display-mode-tile--pinned" : ""}${isDragging ? " display-mode-tile--dragging" : ""} display-mode-tile--compact`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid="display-mode-thread-tile"
      data-thread-key={id}
    >
      <div className="display-mode-tile__accent" aria-hidden="true" />
      <header className="display-mode-tile__head">
        <div className="display-mode-tile__head-top">
          <div
            ref={setActivatorNodeRef}
            className="display-mode-tile__drag"
            {...listeners}
            {...attributes}
            aria-label="Drag to reorder"
            aria-pressed={keyboardDragging}
            title="Drag to reorder"
            onKeyDown={(event) => onKeyboardDragKeyDown(id, event)}
          >⠿</div>
          <button
            className="display-mode-tile__expand-btn"
            type="button"
            aria-label="Expand tile to half width"
            title="Expand to half"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand();
            }}
          >
            <MaximizeIcon />
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
                <button aria-pressed={terminalOpen} role="menuitem" type="button" onClick={() => runAction(onToggleTerminal)}>
                  <TerminalIcon />
                  <span>Terminal</span>
                </button>
                <button role="menuitem" type="button" onClick={() => runAction(onOpenVSCode)}>
                  <VSCodeIcon />
                  <span>VS Code</span>
                </button>
                <button aria-pressed={isPinned} role="menuitem" type="button" onClick={() => runAction(onPinPreview)}>
                  <MaximizeIcon />
                  <span>Pin preview</span>
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
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitRename();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setRenaming(false);
                }
              }}
              onBlur={submitRename}
            />
          ) : (
            <button
              className="display-mode-tile__title display-mode-tile__title--editable"
              type="button"
              title="Click to rename"
              onClick={() => {
                setRenameDraft(record.session.title);
                setRenaming(true);
              }}
            >
              {record.session.title}
            </button>
          )}
        </div>
      </header>
    </article>
  );
}

function DisplayModeDetailedCard({
  api, id, record, terminalOpen, renderTerminalInline, isPinned, isExpanded, compact,
  fastMode, fastModeAvailable, showThinking, codexUsageStatus,
  runtime, sessionCommands, commandCompatibility, setSnapshot, openSettings, openSkillProfiles,
  onOpenThread, onOpenVSCode, onPinPreview, onToggleTerminal, onToggleExpand, onRequestProjection,
  onInteractionResidencyChange, keyboardDragging, onKeyboardDragKeyDown,
}: DisplayModeTileProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: isExpanded,
  });
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<readonly ComposerAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [composerHydrated, setComposerHydrated] = useState(false);
  const composerTouchedRef = useRef(false);
  const draftTouchedRef = useRef(false);
  const attachmentsTouchedRef = useRef(false);
  const latestDraftRef = useRef(draft);
  const latestAttachmentsRef = useRef(attachments);
  latestDraftRef.current = draft;
  latestAttachmentsRef.current = attachments;
  const setComposerDraft: Dispatch<SetStateAction<string>> = useCallback((value) => {
    composerTouchedRef.current = true;
    draftTouchedRef.current = true;
    setDraft(value);
  }, []);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const projectionRequestedRef = useRef(false);
  const terminalWrapperRef = useRef<HTMLDivElement | null>(null);
  const [terminalHeight, setTerminalHeight] = useState(200);
  const [expandedToolCallIds, setExpandedToolCallIds] = useState<Set<string>>(() => new Set());
  const tone = statusTone(record.session);
  const recentMessages = record.transcript.slice(-8);
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
    setSubmitError(undefined);
    void api.submitComposerToSession(
      { workspaceId: record.workspace.id, sessionId: record.session.id },
      text,
      {
        attachments,
        ...(record.session.status === "running" ? { deliverAs: "steer" as const } : {}),
      },
    ).then((result) => {
      if (!result.accepted) {
        setSubmitError(result.error ?? "The message could not be sent.");
        return;
      }
      setDraft("");
      setAttachments([]);
    }).catch((error: unknown) => {
      setSubmitError(error instanceof Error ? error.message : String(error));
    }).finally(() => setSubmitting(false));
  }, [api, attachments, record.session.id, record.session.status, record.workspace.id, submitting]);

  useEffect(() => {
    let active = true;
    setComposerHydrated(false);
    void api.getSessionComposerState({
      workspaceId: record.workspace.id,
      sessionId: record.session.id,
    }).then((state) => {
      if (!active) return;
      if (!composerTouchedRef.current) {
        setDraft(state.draft);
        setAttachments(state.attachments);
      }
      setComposerHydrated(true);
    });
    return () => {
      active = false;
    };
  }, [api, record.session.id, record.workspace.id]);

  useEffect(() => {
    if (!composerHydrated || !draftTouchedRef.current) return;
    const timer = window.setTimeout(() => {
      void api.updateComposerDraft(
        { workspaceId: record.workspace.id, sessionId: record.session.id },
        draft,
      );
    }, 150);
    return () => window.clearTimeout(timer);
  }, [api, composerHydrated, draft, record.session.id, record.workspace.id]);

  useEffect(() => {
    if (!composerHydrated || !attachmentsTouchedRef.current) return;
    void api.setSessionComposerAttachments(
      { workspaceId: record.workspace.id, sessionId: record.session.id },
      attachments,
    );
  }, [api, attachments, composerHydrated, record.session.id, record.workspace.id]);

  useEffect(() => {
    if (!composerHydrated) return;
    const target = { workspaceId: record.workspace.id, sessionId: record.session.id };
    return () => {
      if (draftTouchedRef.current) {
        void api.updateComposerDraft(target, latestDraftRef.current);
      }
      if (attachmentsTouchedRef.current) {
        void api.setSessionComposerAttachments(target, latestAttachmentsRef.current);
      }
    };
  }, [api, composerHydrated, record.session.id, record.workspace.id]);

  const slashMenu = useSlashMenu({
    composerDraft: draft,
    setComposerDraft,
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
      if (h > 0) setTerminalHeight((current) => current === h ? current : h);
    });
    ro.observe(el);
    const h = el.clientHeight;
    if (h > 0) setTerminalHeight((current) => current === h ? current : h);
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
    composerTouchedRef.current = true;
    attachmentsTouchedRef.current = true;
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

  const setArticleNode = useCallback((node: HTMLElement | null) => {
    articleRef.current = node;
    setNodeRef(node);
  }, [setNodeRef]);

  useEffect(() => {
    projectionRequestedRef.current = false;
    if (compact) return;
    const node = articleRef.current;
    if (!node) return;
    if (isExpanded) {
      projectionRequestedRef.current = true;
      onRequestProjection(record.workspace.id, record.session.id);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || projectionRequestedRef.current) return;
      projectionRequestedRef.current = true;
      onRequestProjection(record.workspace.id, record.session.id);
    }, { rootMargin: "1000px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [compact, id, isExpanded, onRequestProjection, record.session.id, record.workspace.id]);

  useEffect(() => {
    const resident =
      terminalOpen ||
      isExpanded ||
      renaming ||
      actionsMenuOpen ||
      (composerHydrated && (draft.trim().length > 0 || attachments.length > 0));
    onInteractionResidencyChange(id, resident);
    return () => onInteractionResidencyChange(id, false);
  }, [
    actionsMenuOpen,
    attachments.length,
    composerHydrated,
    draft,
    id,
    isExpanded,
    onInteractionResidencyChange,
    renaming,
    terminalOpen,
  ]);

  return (
    <article
      ref={setArticleNode}
      className={`display-mode-tile display-mode-tile--${tone}${isPinned ? " display-mode-tile--pinned" : ""}${isDragging ? " display-mode-tile--dragging" : ""}${isExpanded ? " display-mode-tile--expanded" : ""}${compact ? " display-mode-tile--compact" : ""}${terminalOpen ? " display-mode-tile--terminal-open" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      data-testid="display-mode-thread-tile"
      data-thread-key={id}
      onKeyDown={handleTileKeyDown}
    >
      <div className="display-mode-tile__accent" aria-hidden="true" />
      {/* Header */}
      <header className="display-mode-tile__head">
        <div className="display-mode-tile__head-top">
          <div
            ref={setActivatorNodeRef}
            className="display-mode-tile__drag"
            {...(isExpanded ? {} : listeners)}
            {...attributes}
            aria-label="Drag to reorder"
            aria-pressed={keyboardDragging}
            title="Drag to reorder"
            onKeyDown={(event) => onKeyboardDragKeyDown(id, event)}
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

      <DisplayModeCardExcerpt
        recentMessages={recentMessages}
        fallbackPreview={transcriptFallbackPreview}
        transcriptRef={transcriptRef}
        expandedToolCallIds={expandedToolCallIds}
        onToggleToolCall={toggleToolCall}
      />

      {/* Terminal (when open) */}
      {terminalOpen && renderTerminalInline ? (
        <DisplayModeCardTerminal
          wrapperRef={terminalWrapperRef}
          workspace={record.workspace}
          sessionId={record.session.id}
          height={terminalHeight}
          onHide={onToggleTerminal}
        />
      ) : null}

      {subagentActivity ? (
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
      <DisplayModeCardComposer>
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
            lastError={submitError}
            onCancelQueuedEdit={() => undefined}
            onClearSlashCommand={slashMenu.resetSlashUi}
            onComposerDrop={handleComposerDrop}
            onComposerKeyDown={handleKeyDown}
            onComposerPaste={handleComposerPaste}
            onEditQueuedMessage={() => undefined}
            onRemoveAttachment={(attachmentId) => {
              composerTouchedRef.current = true;
              attachmentsTouchedRef.current = true;
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
            setComposerDraft={setComposerDraft}
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
      </DisplayModeCardComposer>
    </article>
  );
}
