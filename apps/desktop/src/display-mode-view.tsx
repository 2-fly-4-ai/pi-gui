import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
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
import { TimelineItem } from "./timeline-item";
import { TerminalPanel } from "./terminal-panel";
import { ArrowUpIcon, MaximizeIcon, TerminalIcon } from "./icons";
import type { PiDesktopApi } from "./ipc";
import { formatRelativeTime } from "./string-utils";

type DisplayModeFilter = "all" | "running" | "waiting" | "error";
type DrawerTab = "preview" | "logs" | "files";

interface ChangedFile {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly staged: boolean;
}

export function DisplayModeView({ api }: { readonly api: PiDesktopApi }) {
  const [threads, setThreads] = useState<readonly DisplayModeThreadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DisplayModeFilter>("all");
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("");
  const [terminalKeys, setTerminalKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("preview");
  const [previewUrl, setPreviewUrl] = useState("http://localhost:5173");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [pinnedThreadKey, setPinnedThreadKey] = useState<string>("");
  const [tileOrder, setTileOrder] = useState<readonly string[]>([]);
  const [pinnedThreadFiles, setPinnedThreadFiles] = useState<readonly ChangedFile[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const [drawerWidth, setDrawerWidth] = useState(320);
  const lastFetchAt = useRef<number>(0);
  const pendingRefresh = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sectionRef = useRef<HTMLElement | null>(null);

  const startDrawerResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = drawerWidth;
    const section = sectionRef.current;

    const onMove = (mv: PointerEvent) => {
      const delta = startX - mv.clientX;
      const sectionWidth = section?.offsetWidth ?? 1200;
      const next = Math.max(240, Math.min(600, startWidth + delta));
      // Don't let drawer exceed 50% of total width
      setDrawerWidth(Math.min(next, Math.floor(sectionWidth * 0.5)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const applyRecords = useCallback((records: readonly DisplayModeThreadRecord[]) => {
    setThreads(records);
    setPinnedThreadKey((c) => c || (records[0] ? threadKey(records[0].workspace.id, records[0].session.id) : ""));
  }, []);

  useEffect(() => {
    let active = true;

    const doFetch = () => {
      lastFetchAt.current = Date.now();
      void api.getDisplayModeThreads().then((r) => { if (active) applyRecords(r); });
    };

    const scheduleRefresh = () => {
      if (!active) return;
      clearTimeout(pendingRefresh.current);
      const delay = Math.max(0, 1000 - (Date.now() - lastFetchAt.current));
      pendingRefresh.current = setTimeout(() => { if (active) doFetch(); }, delay);
    };

    setLoading(true);
    void api.getDisplayModeThreads().then((r) => {
      if (!active) return;
      lastFetchAt.current = Date.now();
      applyRecords(r);
      setLoading(false);
    }).catch(() => { if (active) setLoading(false); });

    const unsub = api.onStateChanged(scheduleRefresh);
    return () => { active = false; clearTimeout(pendingRefresh.current); unsub(); };
  }, [api, applyRecords]);

  const uniqueWorkspaces = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of threads) seen.set(r.workspace.id, r.workspace.name);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [threads]);

  const visibleThreads = useMemo(
    () => threads.filter((r) =>
      matchesFilter(r.session, filter) &&
      (workspaceFilter === "" || r.workspace.id === workspaceFilter),
    ),
    [filter, workspaceFilter, threads],
  );

  const visibleKeysStr = useMemo(
    () => visibleThreads.map((r) => threadKey(r.workspace.id, r.session.id)).join(","),
    [visibleThreads],
  );

  useEffect(() => {
    const keys = visibleKeysStr ? visibleKeysStr.split(",") : [];
    setTileOrder((c) => {
      const s = new Set(keys);
      return [...c.filter((k) => s.has(k)), ...keys.filter((k) => !c.includes(k))];
    });
  }, [visibleKeysStr]);

  const orderedThreads = useMemo(() => {
    if (tileOrder.length === 0) return visibleThreads;
    const m = new Map(tileOrder.map((k, i) => [k, i]));
    return [...visibleThreads].sort((a, b) => {
      const ia = m.get(threadKey(a.workspace.id, a.session.id)) ?? Infinity;
      const ib = m.get(threadKey(b.workspace.id, b.session.id)) ?? Infinity;
      return ia - ib;
    });
  }, [visibleThreads, tileOrder]);

  const runningCount = threads.filter((r) => r.session.status === "running").length;
  const errorCount = threads.filter((r) => r.session.status === "failed").length;
  const pinnedThread = threads.find((r) => threadKey(r.workspace.id, r.session.id) === pinnedThreadKey);

  const detectedUrls = useMemo(() => {
    const seen = new Set<string>();
    for (const r of threads) {
      for (const msg of r.transcript) {
        if (msg.kind !== "message") continue;
        const matches = (msg as { text: string }).text.match(/https?:\/\/localhost:\d+/g);
        if (matches) for (const u of matches) seen.add(u);
      }
    }
    return [...seen];
  }, [threads]);

  const toggleTerminal = (key: string) => {
    setTerminalKeys((c) => {
      const n = new Set(c);
      if (n.has(key)) { n.delete(key); } else { n.add(key); }
      return n;
    });
  };

  const pauseAll = () => {
    for (const r of threads) {
      if (r.session.status === "running") {
        void api.cancelSessionRun({ workspaceId: r.workspace.id, sessionId: r.session.id });
      }
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setTileOrder((c) => {
      const oi = c.indexOf(active.id as string);
      const ni = c.indexOf(over.id as string);
      if (oi === -1 || ni === -1) return c;
      return arrayMove([...c], oi, ni);
    });
  };

  return (
    <section
      ref={sectionRef}
      className="display-mode"
      style={{ gridTemplateColumns: `minmax(0, 1fr) 5px ${drawerWidth}px` }}
      data-testid="display-mode-surface"
    >
      <div className="display-mode__main">
        <header className="display-mode__header">
          <div>
            <div className="display-mode__eyebrow">Display Mode</div>
            <h1>Command center</h1>
          </div>
          <div className="display-mode__controls">
            <div className="display-mode__filters" aria-label="Display mode filters">
              {(["all", "running", "waiting", "error"] as const).map((f) => (
                <button
                  className={`display-mode__filter${filter === f ? " display-mode__filter--active" : ""}`}
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                >
                  {filterLabel(f)}
                </button>
              ))}
            </div>
            {uniqueWorkspaces.length > 1 && (
              <select
                className="display-mode__project-select"
                value={workspaceFilter}
                onChange={(e) => setWorkspaceFilter(e.target.value)}
                aria-label="Filter by project"
              >
                <option value="">All projects</option>
                {uniqueWorkspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>{ws.name}</option>
                ))}
              </select>
            )}
            <div className="display-mode__summary">
              <span><strong>{runningCount}</strong> running</span>
              <span><strong>{errorCount}</strong> errors</span>
              <span><strong>{threads.length}</strong> threads</span>
            </div>
            <button className="button display-mode__pause-btn" type="button" disabled={runningCount === 0} onClick={pauseAll}>
              Pause all
            </button>
          </div>
        </header>

        {loading ? (
          <div className="display-mode__empty">Loading threads…</div>
        ) : orderedThreads.length === 0 ? (
          <div className="display-mode__empty">No threads match this filter.</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <SortableContext items={[...tileOrder]} strategy={rectSortingStrategy}>
              <div className="display-mode__grid">
                {orderedThreads.map((record) => {
                  const key = threadKey(record.workspace.id, record.session.id);
                  return (
                    <DisplayModeTile
                      api={api}
                      id={key}
                      key={key}
                      record={record}
                      terminalOpen={terminalKeys.has(key)}
                      isPinned={key === pinnedThreadKey}
                      onFilesUpdate={key === pinnedThreadKey ? setPinnedThreadFiles : undefined}
                      onOpenThread={() => void api.selectSession({ workspaceId: record.workspace.id, sessionId: record.session.id })}
                      onOpenVSCode={() => void api.openWorkspaceInVSCode(record.workspace.id)}
                      onPinPreview={() => setPinnedThreadKey(key)}
                      onToggleTerminal={() => toggleTerminal(key)}
                    />
                  );
                })}
              </div>
            </SortableContext>
            <DragOverlay>
              {draggingId ? (
                <div className="display-mode-tile display-mode-tile--drag-overlay" />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <div
        className="display-mode-drawer__resize"
        onPointerDown={startDrawerResize}
        role="separator"
        aria-label="Resize drawer"
        title="Drag to resize"
      />
      <aside className="display-mode-drawer">
        <div className="display-mode-drawer__tabs" role="tablist">
          {(["preview", "logs", "files"] as const).map((tab) => (
            <button
              className={`display-mode-drawer__tab${drawerTab === tab ? " display-mode-drawer__tab--active" : ""}`}
              key={tab}
              type="button"
              role="tab"
              aria-selected={drawerTab === tab}
              onClick={() => setDrawerTab(tab)}
            >
              {tab === "preview" ? "Preview" : tab === "logs" ? "Logs" : "Files"}
            </button>
          ))}
        </div>

        {drawerTab === "preview" && (
          <div className="display-mode-drawer__body">
            <div className="display-mode-drawer__meta">
              Pinned: {pinnedThread ? `${pinnedThread.workspace.name} / ${pinnedThread.session.title}` : "None"}
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
                      className={`display-mode-drawer__detected-url${previewUrl === url ? " is-active" : ""}`}
                      type="button"
                      onClick={() => setPreviewUrl(url)}
                    >
                      {url.replace(/https?:\/\//, "")}
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
                <iframe title="Preview" src={previewUrl} />
              ) : (
                <div className="display-mode-preview__empty">Enter a URL above.</div>
              )}
            </div>
            <button className="button" type="button" disabled={!isHttpUrl(previewUrl)} onClick={() => void api.openExternal(previewUrl)}>
              Open in browser
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
                  .map((r) => {
                    const tone = statusTone(r.session);
                    return (
                      <div className="display-mode-log-entry" key={threadKey(r.workspace.id, r.session.id)}>
                        <span className={`display-mode-tile__status-dot display-mode-tile__status-dot--${tone}`} aria-hidden="true" />
                        <div className="display-mode-log-entry__body">
                          <div className="display-mode-log-entry__title">{r.workspace.name} <span>/</span> {r.session.title}</div>
                          {r.session.preview ? <div className="display-mode-log-entry__preview">{r.session.preview}</div> : null}
                          <div className="display-mode-log-entry__time">{formatRelativeTime(r.session.updatedAt)}</div>
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
              <div className="display-mode-drawer__placeholder">No changed files.</div>
            ) : (
              <div className="display-mode-drawer__files">
                {pinnedThreadFiles.map((f) => (
                  <div className="display-mode-drawer__file" key={f.path}>
                    <span className={`display-mode-drawer__file-badge display-mode-drawer__file-badge--${f.status}`}>{fileBadge(f.status)}</span>
                    <span className="display-mode-drawer__file-path">{f.path}</span>
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

/* ── Tile ─────────────────────────────────────────────────────────── */

function DisplayModeTile({
  api, id, record, terminalOpen, isPinned,
  onFilesUpdate, onOpenThread, onOpenVSCode, onPinPreview, onToggleTerminal,
}: {
  readonly api: PiDesktopApi;
  readonly id: string;
  readonly record: DisplayModeThreadRecord;
  readonly terminalOpen: boolean;
  readonly isPinned: boolean;
  readonly onFilesUpdate: ((files: readonly ChangedFile[]) => void) | undefined;
  readonly onOpenThread: () => void;
  readonly onOpenVSCode: () => void;
  readonly onPinPreview: () => void;
  readonly onToggleTerminal: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const tone = statusTone(record.session);
  const recentMessages = record.transcript.slice(-8);

  useEffect(() => { if (renaming) renameInputRef.current?.select(); }, [renaming]);

  const startRename = () => { setRenameDraft(record.session.title); setRenaming(true); };
  const submitRename = () => {
    const t = renameDraft.trim();
    if (t && t !== record.session.title) {
      void api.renameSession({ workspaceId: record.workspace.id, sessionId: record.session.id }, t);
    }
    setRenaming(false);
  };

  useEffect(() => {
    let active = true;
    void api.getChangedFiles(record.workspace.id).then((files) => {
      if (!active) return;
      const sliced = files.slice(0, 8);
      onFilesUpdate?.(sliced);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [api, record.workspace.id, record.session.updatedAt, onFilesUpdate]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "0";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [draft]);

  const submit = () => {
    const text = draft.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setDraft("");
    void api.submitComposerToSession(
      { workspaceId: record.workspace.id, sessionId: record.session.id },
      text,
      record.session.status === "running" ? { deliverAs: "followUp" } : undefined,
    ).finally(() => setSubmitting(false));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const handleTileKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "TEXTAREA" || tag === "INPUT" || tag === "BUTTON") return;
    if (e.key === "t" || e.key === "T") { e.preventDefault(); onToggleTerminal(); }
    else if (e.key === "v" || e.key === "V") { e.preventDefault(); onOpenVSCode(); }
    else if (e.key === "o" || e.key === "O") { e.preventDefault(); onOpenThread(); }
  };

  return (
    <article
      ref={setNodeRef}
      className={`display-mode-tile display-mode-tile--${tone}${isDragging ? " display-mode-tile--dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid="display-mode-thread-tile"
      onKeyDown={handleTileKeyDown}
      {...attributes}
    >
      {/* Header */}
      <header className="display-mode-tile__head">
        <div className="display-mode-tile__head-top">
          <div
            className="display-mode-tile__drag"
            {...listeners}
            aria-label="Drag to reorder"
            title="Drag to reorder"
          >⠿</div>
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
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); submitRename(); }
                if (e.key === "Escape") { e.preventDefault(); setRenaming(false); }
              }}
              onBlur={submitRename}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <button
              className="display-mode-tile__title display-mode-tile__title--editable"
              type="button"
              title="Click to rename"
              onClick={(e) => { e.stopPropagation(); startRename(); }}
            >
              {record.session.title}
            </button>
          )}
        </div>
      </header>

      {/* Actions row */}
      <div className="display-mode-tile__actions">
        <button className="button button--primary display-mode-tile__action-primary" type="button" onClick={onOpenThread}>Open thread</button>
        <button className={`button${terminalOpen ? " display-mode-tile__action-active" : ""}`} type="button" onClick={onToggleTerminal}><TerminalIcon /> Terminal</button>
        <button className="button" type="button" onClick={onOpenVSCode}>VS Code</button>
        <button className={`button${isPinned ? " display-mode-tile__action-active" : ""}`} type="button" onClick={onPinPreview}><MaximizeIcon /> Pin</button>
      </div>

      {/* Transcript */}
      <div className="display-mode-tile__transcript">
        {recentMessages.length > 0 ? (
          recentMessages.map((item) => <TimelineItem item={item} key={item.id} />)
        ) : (
          <div className="display-mode-tile__empty-state">No messages yet</div>
        )}
      </div>

      {/* Terminal (when open) */}
      {terminalOpen && (
        <div className="display-mode-tile__terminal">
          <TerminalPanel
            workspace={record.workspace}
            sessionId={record.session.id}
            height={200}
            isTakeover={false}
            onHeightChange={() => undefined}
            onToggleTakeover={() => undefined}
            onHide={onToggleTerminal}
          />
        </div>
      )}

      {/* Reply — uses real .composer CSS so it looks identical to thread view */}
      <div className="composer display-mode-tile__reply">
        <div className="composer__surface">
          <div className="composer__editor">
            <textarea
              ref={textareaRef}
              placeholder={`Reply to ${record.session.title}…`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />
          </div>
          <div className="display-mode-tile__reply-bar">
            <span className="display-mode-tile__reply-hint">Enter to send · Shift+Enter newline</span>
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
    </article>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function threadKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

function matchesFilter(session: SessionRecord, filter: DisplayModeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "running") return session.status === "running";
  if (filter === "error") return session.status === "failed";
  return false;
}

function filterLabel(filter: DisplayModeFilter): string {
  if (filter === "running") return "Running";
  if (filter === "waiting") return "Waiting";
  if (filter === "error") return "Error";
  return "All";
}

function statusTone(session: SessionRecord): "running" | "waiting" | "error" | "idle" {
  if (session.status === "running") return "running";
  if (session.status === "failed") return "error";
  if (session.hasUnseenUpdate) return "waiting";
  return "idle";
}

function statusLabel(session: SessionRecord): string {
  const t = statusTone(session);
  if (t === "running") return "Running";
  if (t === "waiting") return "Needs reply";
  if (t === "error") return "Error";
  return "Idle";
}

function fileBadge(status: ChangedFile["status"]): string {
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  if (status === "untracked") return "U";
  return "M";
}

function isHttpUrl(value: string): boolean {
  try {
    const p = new URL(value);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch { return false; }
}
