import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DisplayModeThreadRecord, SessionRecord } from "./desktop-state";
import { ComposerSurface } from "./composer-surface";
import { TimelineItem } from "./timeline-item";
import { TerminalPanel } from "./terminal-panel";
import { ArrowUpIcon, MaximizeIcon, StopSquareIcon, TerminalIcon } from "./icons";
import type { PiDesktopApi } from "./ipc";
import { formatRelativeTime } from "./string-utils";

type DisplayModeFilter = "all" | "running" | "waiting" | "error";
type DrawerTab = "preview" | "logs" | "files";

interface ChangedFile {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly staged: boolean;
}

interface DisplayModeViewProps {
  readonly api: PiDesktopApi;
}

export function DisplayModeView({ api }: DisplayModeViewProps) {
  const [threads, setThreads] = useState<readonly DisplayModeThreadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DisplayModeFilter>("all");
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [terminalKeys, setTerminalKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("preview");
  const [previewUrl, setPreviewUrl] = useState("http://localhost:5173");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [pinnedThreadKey, setPinnedThreadKey] = useState<string>("");
  const [tileOrder, setTileOrder] = useState<readonly string[]>([]);
  const [pinnedThreadFiles, setPinnedThreadFiles] = useState<readonly ChangedFile[]>([]);

  const lastFetchAt = useRef<number>(0);
  const pendingRefresh = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const applyRecords = useCallback((records: readonly DisplayModeThreadRecord[]) => {
    setThreads(records);
    setExpandedKeys((current) => {
      if (current.size > 0) return current;
      const runningKeys = records
        .filter((r) => r.session.status === "running")
        .slice(0, 2)
        .map((r) => threadKey(r.workspace.id, r.session.id));
      if (runningKeys.length > 0) return new Set(runningKeys);
      return new Set(records[0] ? [threadKey(records[0].workspace.id, records[0].session.id)] : []);
    });
    setPinnedThreadKey((current) =>
      current || (records[0] ? threadKey(records[0].workspace.id, records[0].session.id) : ""),
    );
  }, []);

  useEffect(() => {
    let active = true;

    const doFetch = () => {
      lastFetchAt.current = Date.now();
      void api.getDisplayModeThreads().then((records) => {
        if (active) applyRecords(records);
      });
    };

    const scheduleRefresh = () => {
      if (!active) return;
      clearTimeout(pendingRefresh.current);
      const elapsed = Date.now() - lastFetchAt.current;
      const delay = Math.max(0, 1000 - elapsed);
      pendingRefresh.current = setTimeout(() => {
        if (active) doFetch();
      }, delay);
    };

    setLoading(true);
    void api.getDisplayModeThreads().then((records) => {
      if (!active) return;
      lastFetchAt.current = Date.now();
      applyRecords(records);
      setLoading(false);
    }).catch(() => {
      if (active) setLoading(false);
    });

    const unsub = api.onStateChanged(scheduleRefresh);

    return () => {
      active = false;
      clearTimeout(pendingRefresh.current);
      unsub();
    };
  }, [api, applyRecords]);

  const visibleThreads = useMemo(
    () => threads.filter((record) => matchesFilter(record.session, filter)),
    [filter, threads],
  );

  // Stable key string — only changes when the actual set of visible threads changes
  const visibleKeysStr = useMemo(
    () => visibleThreads.map((r) => threadKey(r.workspace.id, r.session.id)).join(","),
    [visibleThreads],
  );

  // Reconcile tile order when visible threads change: keep existing order, append new ones at end
  useEffect(() => {
    const keys = visibleKeysStr ? visibleKeysStr.split(",") : [];
    setTileOrder((current) => {
      const keySet = new Set(keys);
      const kept = current.filter((k) => keySet.has(k));
      const added = keys.filter((k) => !current.includes(k));
      return [...kept, ...added];
    });
  }, [visibleKeysStr]);

  const orderedVisibleThreads = useMemo(() => {
    if (tileOrder.length === 0) return visibleThreads;
    const orderMap = new Map(tileOrder.map((k, i) => [k, i]));
    return [...visibleThreads].sort((a, b) => {
      const ia = orderMap.get(threadKey(a.workspace.id, a.session.id)) ?? Infinity;
      const ib = orderMap.get(threadKey(b.workspace.id, b.session.id)) ?? Infinity;
      return ia - ib;
    });
  }, [visibleThreads, tileOrder]);

  const runningCount = threads.filter((r) => r.session.status === "running").length;
  const errorCount = threads.filter((r) => r.session.status === "failed").length;
  const pinnedThread = threads.find((r) => threadKey(r.workspace.id, r.session.id) === pinnedThreadKey);

  // Scan all transcripts for localhost URLs to offer as quick-pick in Preview drawer
  const detectedUrls = useMemo(() => {
    const seen = new Set<string>();
    for (const record of threads) {
      for (const msg of record.transcript) {
        if (msg.kind !== "message") continue;
        const matches = (msg as { text: string }).text.match(/https?:\/\/localhost:\d+/g);
        if (matches) { for (const u of matches) seen.add(u); }
      }
    }
    return [...seen];
  }, [threads]);

  const toggleExpanded = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  };

  const toggleTerminal = (key: string) => {
    setTerminalKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  };

  const pauseAll = () => {
    for (const record of threads) {
      if (record.session.status !== "running") continue;
      void api.cancelSessionRun({ workspaceId: record.workspace.id, sessionId: record.session.id });
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setTileOrder((current) => {
      const oldIdx = current.indexOf(active.id as string);
      const newIdx = current.indexOf(over.id as string);
      if (oldIdx === -1 || newIdx === -1) return current;
      return arrayMove([...current], oldIdx, newIdx);
    });
  };

  return (
    <section className="display-mode" data-testid="display-mode-surface">
      <div className="display-mode__main">
        <header className="display-mode__header">
          <div>
            <div className="display-mode__eyebrow">Display Mode</div>
            <h1>Command center</h1>
            <p>Watch running threads, reply inline, open terminals, and keep a preview pinned.</p>
          </div>
          <div className="display-mode__controls">
            <div className="display-mode__filters" aria-label="Display mode filters">
              {(["all", "running", "waiting", "error"] as const).map((f) => (
                <button
                  className={`display-mode__filter ${filter === f ? "display-mode__filter--active" : ""}`}
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                >
                  {filterLabel(f)}
                </button>
              ))}
            </div>
            <button className="button display-mode__pause-btn" type="button" disabled={runningCount === 0} onClick={pauseAll}>
              Pause all
            </button>
          </div>
        </header>

        <div className="display-mode__summary" aria-label="Display mode summary">
          <span><strong>{runningCount}</strong> running</span>
          <span><strong>{errorCount}</strong> errors</span>
          <span><strong>{threads.length}</strong> visible threads</span>
        </div>

        {loading ? (
          <div className="display-mode__empty">Loading active threads…</div>
        ) : orderedVisibleThreads.length === 0 ? (
          <div className="display-mode__empty">No threads match this filter.</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={[...tileOrder]} strategy={rectSortingStrategy}>
              <div className="display-mode__grid">
                {orderedVisibleThreads.map((record) => {
                  const key = threadKey(record.workspace.id, record.session.id);
                  return (
                    <SortableTile key={key} id={key}>
                      {(dragHandleProps) => (
                        <DisplayModeTile
                          api={api}
                          dragHandleProps={dragHandleProps}
                          expanded={expandedKeys.has(key)}
                          record={record}
                          terminalOpen={terminalKeys.has(key)}
                          onFilesUpdate={key === pinnedThreadKey ? setPinnedThreadFiles : undefined}
                          onOpenThread={() => {
                            void api.selectSession({ workspaceId: record.workspace.id, sessionId: record.session.id });
                          }}
                          onOpenVSCode={() => {
                            void api.openWorkspaceInVSCode(record.workspace.id);
                          }}
                          onPinPreview={() => setPinnedThreadKey(key)}
                          onToggleExpanded={() => toggleExpanded(key)}
                          onToggleTerminal={() => toggleTerminal(key)}
                        />
                      )}
                    </SortableTile>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <aside className="display-mode-drawer">
        <div className="display-mode-drawer__tabs" role="tablist" aria-label="Display drawer">
          {(["preview", "logs", "files"] as const).map((tab) => (
            <button
              className={`display-mode-drawer__tab ${drawerTab === tab ? "display-mode-drawer__tab--active" : ""}`}
              key={tab}
              type="button"
              role="tab"
              aria-selected={drawerTab === tab}
              onClick={() => setDrawerTab(tab)}
            >
              {drawerTabLabel(tab)}
            </button>
          ))}
        </div>

        {drawerTab === "preview" && (
          <div className="display-mode-drawer__body">
            <div className="display-mode-drawer__meta">
              Pinned to: {pinnedThread ? `${pinnedThread.workspace.name} / ${pinnedThread.session.title}` : "No thread"}
            </div>
            <label className="display-mode-drawer__field">
              <span>Preview URL</span>
              <input value={previewUrl} onChange={(e) => setPreviewUrl(e.target.value)} />
            </label>
            {detectedUrls.length > 0 && (
              <div className="display-mode-drawer__detected">
                <div className="display-mode-drawer__detected-label">Detected</div>
                <div className="display-mode-drawer__detected-urls">
                  {detectedUrls.map((url) => (
                    <button
                      key={url}
                      className={`display-mode-drawer__detected-url ${previewUrl === url ? "is-active" : ""}`}
                      type="button"
                      onClick={() => setPreviewUrl(url)}
                    >
                      {url.replace("http://", "").replace("https://", "")}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="display-mode-drawer__device-toggle">
              <button className={previewDevice === "desktop" ? "is-active" : ""} type="button" onClick={() => setPreviewDevice("desktop")}>Desktop</button>
              <button className={previewDevice === "mobile" ? "is-active" : ""} type="button" onClick={() => setPreviewDevice("mobile")}>Mobile</button>
            </div>
            <div className={`display-mode-preview display-mode-preview--${previewDevice}`}>
              {isHttpUrl(previewUrl) ? (
                <iframe title="Pinned preview" src={previewUrl} />
              ) : (
                <div className="display-mode-preview__empty">Enter an http:// or https:// URL above.</div>
              )}
            </div>
            <button className="button" type="button" disabled={!isHttpUrl(previewUrl)} onClick={() => void api.openExternal(previewUrl)}>
              Open browser
            </button>
          </div>
        )}

        {drawerTab === "logs" && (
          <div className="display-mode-drawer__body">
            {threads.length === 0 ? (
              <div className="display-mode-drawer__placeholder">No threads yet.</div>
            ) : (
              <div className="display-mode-logs">
                {[...threads]
                  .sort((a, b) => Date.parse(b.session.updatedAt) - Date.parse(a.session.updatedAt))
                  .map((record) => {
                    const tone = statusTone(record.session);
                    return (
                      <div className="display-mode-log-entry" key={threadKey(record.workspace.id, record.session.id)}>
                        <span className={`display-mode-tile__status display-mode-tile__status--${tone}`} aria-hidden="true" />
                        <div className="display-mode-log-entry__body">
                          <div className="display-mode-log-entry__title">
                            {record.workspace.name}
                            <span className="display-mode-log-entry__sep"> / </span>
                            {record.session.title}
                          </div>
                          {record.session.preview ? (
                            <div className="display-mode-log-entry__preview">{record.session.preview}</div>
                          ) : null}
                          <div className="display-mode-log-entry__time">{formatRelativeTime(record.session.updatedAt)}</div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {drawerTab === "files" && (
          <div className="display-mode-drawer__body">
            <div className="display-mode-drawer__meta">
              {pinnedThread ? `${pinnedThread.workspace.name} / ${pinnedThread.session.title}` : "No thread pinned"}
            </div>
            {pinnedThreadFiles.length === 0 ? (
              <div className="display-mode-drawer__placeholder">No changed files for pinned thread.</div>
            ) : (
              <div className="display-mode-drawer__files">
                {pinnedThreadFiles.map((file) => (
                  <div className="display-mode-drawer__file" key={file.path}>
                    <span className={`display-mode-drawer__file-status display-mode-drawer__file-status--${file.status}`}>
                      {fileStatusBadge(file.status)}
                    </span>
                    <span className="display-mode-drawer__file-path">{file.path}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>
    </section>
  );
}

/* ── Sortable wrapper ──────────────────────────────────────────────── */

interface DragHandleProps {
  readonly attributes: DraggableAttributes;
  readonly listeners: DraggableSyntheticListeners;
}

function SortableTile({
  id,
  children,
}: {
  readonly id: string;
  readonly children: (dragHandleProps: DragHandleProps) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : undefined,
        position: "relative",
      }}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

/* ── Tile ──────────────────────────────────────────────────────────── */

function DisplayModeTile({
  api,
  dragHandleProps,
  record,
  expanded,
  terminalOpen,
  onFilesUpdate,
  onOpenThread,
  onOpenVSCode,
  onPinPreview,
  onToggleExpanded,
  onToggleTerminal,
}: {
  readonly api: PiDesktopApi;
  readonly dragHandleProps: DragHandleProps;
  readonly record: DisplayModeThreadRecord;
  readonly expanded: boolean;
  readonly terminalOpen: boolean;
  readonly onFilesUpdate: ((files: readonly ChangedFile[]) => void) | undefined;
  readonly onOpenThread: () => void;
  readonly onOpenVSCode: () => void;
  readonly onPinPreview: () => void;
  readonly onToggleExpanded: () => void;
  readonly onToggleTerminal: () => void;
}) {
  const [replyDraft, setReplyDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [changedFiles, setChangedFiles] = useState<readonly ChangedFile[]>([]);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const key = threadKey(record.workspace.id, record.session.id);
  const status = statusTone(record.session);
  const recentTranscript = record.transcript.slice(-6);
  const hasReplyInput = replyDraft.trim().length > 0;

  useEffect(() => {
    let active = true;
    void api.getChangedFiles(record.workspace.id).then((files) => {
      if (!active) return;
      const sliced = files.slice(0, 8);
      setChangedFiles(sliced);
      onFilesUpdate?.(sliced);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [api, record.workspace.id, record.session.updatedAt, onFilesUpdate]);

  const submitReply = () => {
    const text = replyDraft.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setReplyDraft("");
    void api.submitComposerToSession(
      { workspaceId: record.workspace.id, sessionId: record.session.id },
      text,
      record.session.status === "running" ? { deliverAs: "followUp" } : undefined,
    ).finally(() => setSubmitting(false));
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submitReply();
  };

  // Tile-level keyboard shortcuts: only fire when focus is on the tile itself (not a child input)
  const handleTileKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const tag = (event.target as HTMLElement).tagName;
    if (tag === "TEXTAREA" || tag === "INPUT" || tag === "BUTTON") return;
    if (event.key === "t" || event.key === "T") { event.preventDefault(); onToggleTerminal(); }
    else if (event.key === "v" || event.key === "V") { event.preventDefault(); onOpenVSCode(); }
    else if (event.key === "o" || event.key === "O") { event.preventDefault(); onOpenThread(); }
    else if (event.key === "e" || event.key === "E") { event.preventDefault(); onToggleExpanded(); }
  };

  return (
    <article
      className={`display-mode-tile display-mode-tile--${status} ${expanded ? "display-mode-tile--expanded" : "display-mode-tile--compact"}`}
      data-testid="display-mode-thread-tile"
      tabIndex={0}
      onKeyDown={handleTileKeyDown}
    >
      <header className="display-mode-tile__header">
        <div className="display-mode-tile__identity">
          <div
            className="display-mode-tile__drag-handle"
            {...dragHandleProps.attributes}
            {...dragHandleProps.listeners}
            aria-label="Drag to reorder"
            title="Drag to reorder"
          >
            ⠿
          </div>
          <span className={`display-mode-tile__status display-mode-tile__status--${status}`} aria-hidden="true" />
          <div>
            <div className="display-mode-tile__workspace">{record.workspace.name}</div>
            <h2>{record.session.title}</h2>
          </div>
        </div>
        <button className="display-mode-tile__expand" type="button" onClick={onToggleExpanded}>
          {expanded ? "Compact" : "Expand"}
        </button>
      </header>

      <div className="display-mode-tile__meta">
        <span>{statusLabel(record.session)}</span>
        <span>{record.session.status === "running" && record.session.runningSince ? formatRelativeTime(record.session.runningSince) : formatRelativeTime(record.session.updatedAt)}</span>
        <span>{changedFiles.length} changed files</span>
      </div>

      {expanded ? (
        <>
          <section className="display-mode-tile__section">
            <div className="display-mode-tile__section-title">Chat</div>
            <div className="display-mode-tile__timeline">
              {recentTranscript.length > 0 ? recentTranscript.map((item) => (
                <TimelineItem item={item} key={item.id} />
              )) : <div className="display-mode-tile__empty">No transcript yet.</div>}
            </div>
          </section>

          <section className="display-mode-tile__section">
            <div className="display-mode-tile__section-title">Diff</div>
            {changedFiles.length > 0 ? (
              <div className="display-mode-tile__files">
                {changedFiles.slice(0, 4).map((file) => (
                  <div className="display-mode-tile__file" key={file.path}>
                    <span>{file.path}</span>
                    <span className={`display-mode-tile__file-badge display-mode-tile__file-badge--${file.status}`}>
                      {fileStatusBadge(file.status)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="display-mode-tile__empty">No changed files detected.</div>
            )}
          </section>

          {terminalOpen ? (
            <TerminalPanel
              workspace={record.workspace}
              sessionId={record.session.id}
              height={260}
              isTakeover={false}
              onHeightChange={() => undefined}
              onToggleTakeover={() => undefined}
              onHide={onToggleTerminal}
            />
          ) : null}

          <ComposerSurface
            attachments={[]}
            composerDraft={replyDraft}
            composerRef={composerRef}
            editingQueuedMessageId={undefined}
            footer={(
              <div className="display-mode-tile__composer-footer">
                <span>{record.session.status === "running" ? "Enter to queue · Shift+Enter newline" : "Enter to send · Shift+Enter newline"}</span>
                <button
                  aria-label={record.session.status === "running" && !hasReplyInput ? "Stop run" : "Send reply"}
                  className="button button--primary button--cta-icon"
                  type="button"
                  disabled={submitting || !hasReplyInput}
                  onClick={submitReply}
                >
                  {record.session.status === "running" && !hasReplyInput ? <StopSquareIcon /> : <ArrowUpIcon />}
                </button>
              </div>
            )}
            onCancelQueuedEdit={() => undefined}
            onClearSlashCommand={() => undefined}
            onComposerDrop={(event) => event.preventDefault()}
            onComposerKeyDown={handleComposerKeyDown}
            onComposerPaste={() => undefined}
            onEditQueuedMessage={() => undefined}
            onRemoveAttachment={() => undefined}
            onRemoveQueuedMessage={() => undefined}
            onSelectMention={() => undefined}
            onSelectSlashCommand={() => undefined}
            onSelectSlashOption={() => undefined}
            onSteerQueuedMessage={() => undefined}
            queuedMessages={[]}
            selectedMentionIndex={0}
            setComposerDraft={setReplyDraft}
            showMentionMenu={false}
            mentionOptions={[]}
            selectedSlashCommand={undefined}
            selectedSlashOption={undefined}
            showSlashMenu={false}
            showSlashOptionMenu={false}
            slashOptions={[]}
            slashSections={[]}
            textareaLabel={`Reply to ${record.session.title}`}
            textareaPlaceholder="Reply to this thread…"
            textareaTestId={`display-mode-reply-${key}`}
          />
        </>
      ) : (
        <div className="display-mode-tile__compact-summary">
          <span>{record.session.preview || "No preview yet"}</span>
          <span>{changedFiles.length > 0 ? `${changedFiles.length} files changed` : "No changes"}</span>
        </div>
      )}

      <footer className="display-mode-tile__actions">
        <button className="button button--primary display-mode-tile__action-open" type="button" onClick={onOpenThread}>Open thread</button>
        <button className="button" type="button" onClick={onToggleTerminal}><TerminalIcon /> Terminal</button>
        <button className="button" type="button" onClick={onOpenVSCode}>VS Code</button>
        <button className="button" type="button" onClick={onPinPreview}><MaximizeIcon /> Pin preview</button>
      </footer>

      <div className="display-mode-tile__shortcuts-hint">
        <kbd>O</kbd> open · <kbd>T</kbd> terminal · <kbd>V</kbd> VS Code · <kbd>E</kbd> expand
      </div>
    </article>
  );
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function threadKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

function matchesFilter(session: SessionRecord, filter: DisplayModeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "running") return session.status === "running";
  if (filter === "error") return session.status === "failed";
  return false;
}

function drawerTabLabel(tab: DrawerTab): string {
  if (tab === "preview") return "Preview";
  if (tab === "logs") return "Logs";
  return "Files";
}

function filterLabel(filter: DisplayModeFilter): string {
  if (filter === "all") return "All";
  if (filter === "running") return "Running";
  if (filter === "waiting") return "Waiting";
  return "Error";
}

function statusTone(session: SessionRecord): "running" | "waiting" | "error" | "idle" {
  if (session.status === "running") return "running";
  if (session.status === "failed") return "error";
  if (session.hasUnseenUpdate) return "waiting";
  return "idle";
}

function statusLabel(session: SessionRecord): string {
  const tone = statusTone(session);
  if (tone === "running") return "Running";
  if (tone === "waiting") return "Waiting for input";
  if (tone === "error") return "Error";
  return "Idle";
}

function fileStatusBadge(status: ChangedFile["status"]): string {
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  if (status === "untracked") return "U";
  return "M";
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
