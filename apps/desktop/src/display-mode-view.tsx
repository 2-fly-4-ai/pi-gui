import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import type { RuntimeCommandRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
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
import type { DesktopAppState, DisplayModeThreadRecord, ExtensionCommandCompatibilityRecord, SessionRecord } from "./desktop-state";
import { TimelineItem } from "./timeline-item";
import { TerminalPanel } from "./terminal-panel";
import { ComposerSurface } from "./composer-surface";
import { VSCodePanel } from "./vscode-panel";
import { useSlashMenu } from "./hooks/use-slash-menu";
import { ArrowUpIcon, MaximizeIcon, MinimizeIcon, SidebarToggleIcon, StopSquareIcon, TerminalIcon } from "./icons";
import type { PiDesktopApi } from "./ipc";
import type { SettingsSection } from "./settings-view";
import { formatRelativeTime } from "./string-utils";

type DisplayModeFilter = "all" | "running" | "waiting" | "error";
type DrawerTab = "preview" | "logs" | "files";
type ColumnMode = number | "auto";

interface ChangedFile {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly staged: boolean;
}

export function DisplayModeView({
  api, drawerOpen, onToggleDrawer,
  vsCodeOpen, vsCodeWorkspaceId, vsCodeFolderPath, onToggleVsCode, onOpenVsCodeForWorkspace,
  runtimeByWorkspace, sessionCommandsBySession, commandCompatibilityByWorkspace,
  setSnapshot, openSettings, updateSnapshot,
}: {
  readonly api: PiDesktopApi;
  readonly drawerOpen: boolean;
  readonly onToggleDrawer: () => void;
  readonly vsCodeOpen: boolean;
  readonly vsCodeWorkspaceId: string | null;
  readonly vsCodeFolderPath: string | null;
  readonly onToggleVsCode: () => void;
  readonly onOpenVsCodeForWorkspace: (workspaceId: string, folderPath: string) => void;
  readonly runtimeByWorkspace: Readonly<Record<string, RuntimeSnapshot>>;
  readonly sessionCommandsBySession: Readonly<Record<string, readonly RuntimeCommandRecord[]>>;
  readonly commandCompatibilityByWorkspace: Readonly<Record<string, readonly ExtensionCommandCompatibilityRecord[]>>;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly openSettings: (workspaceId?: string, section?: SettingsSection) => void;
  readonly updateSnapshot: (
    api: PiDesktopApi,
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ) => Promise<DesktopAppState>;
}) {
  const [threads, setThreads] = useState<readonly DisplayModeThreadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DisplayModeFilter>("all");
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("");
  const [colCount, setColCount] = useState<ColumnMode>(() => lsGetColumnMode("dm:colCount", 3));
  const [compact, setCompact] = useState<boolean>(() => lsGetBool("dm:compact", false));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [localTerminalKeys, setLocalTerminalKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("preview");
  const [previewUrl, setPreviewUrl] = useState("http://localhost:5173");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [pinnedThreadKey, setPinnedThreadKey] = useState<string>("");
  const [tileOrder, setTileOrder] = useState<readonly string[]>([]);
  const [pinnedThreadFiles, setPinnedThreadFiles] = useState<readonly ChangedFile[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const [drawerWidth, setDrawerWidth] = useState<number>(() => lsGetNum("dm:drawerWidth", 320));
  const [vsCodeWidth, setVsCodeWidth] = useState<number>(() => getInitialVsCodeWidth());
  const lastFetchAt = useRef<number>(0);
  const pendingRefresh = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sectionRef = useRef<HTMLElement | null>(null);
  const drawerWidthRef = useRef(drawerWidth);
  const vsCodeWidthRef = useRef(vsCodeWidth);

  // Persist preferences
  useEffect(() => { lsSet("dm:colCount", colCount); }, [colCount]);
  useEffect(() => { lsSet("dm:compact", compact); }, [compact]);
  useEffect(() => { lsSet("dm:drawerWidth", drawerWidth); }, [drawerWidth]);
  useEffect(() => { lsSet("dm:vsCodeWidth", vsCodeWidth); }, [vsCodeWidth]);
  useEffect(() => {
    drawerWidthRef.current = drawerWidth;
    sectionRef.current?.style.setProperty("--display-mode-drawer-width", `${drawerWidth}px`);
  }, [drawerWidth]);
  useEffect(() => {
    vsCodeWidthRef.current = vsCodeWidth;
    sectionRef.current?.style.setProperty("--display-mode-vscode-width", `${vsCodeWidth}px`);
  }, [vsCodeWidth]);
  useEffect(() => {
    if (!vsCodeOpen) return;
    const section = sectionRef.current;
    if (!section) return;
    const maxWidth = getMaxVsCodeWidth(section.offsetWidth);
    if (vsCodeWidth > maxWidth) {
      setVsCodeWidth(maxWidth);
    }
  }, [vsCodeOpen, vsCodeWidth]);
  const startDrawerResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = drawerWidthRef.current;
    const section = sectionRef.current;
    if (!section) return;
    section.classList.add("display-mode--resizing");

    const onMove = (mv: PointerEvent) => {
      const delta = startX - mv.clientX;
      const sectionWidth = section.offsetWidth;
      const next = Math.max(240, Math.min(600, startWidth + delta));
      // Don't let drawer exceed 50% of total width
      const width = Math.min(next, Math.floor(sectionWidth * 0.5));
      drawerWidthRef.current = width;
      section.style.setProperty("--display-mode-drawer-width", `${width}px`);
    };
    const onUp = () => {
      section.classList.remove("display-mode--resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrawerWidth(drawerWidthRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startVsCodeResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = vsCodeWidthRef.current;
    const section = sectionRef.current;
    if (!section) return;
    section.classList.add("display-mode--resizing");

    const onMove = (mv: PointerEvent) => {
      const delta = startX - mv.clientX;
      const sectionWidth = section.offsetWidth;
      const next = Math.max(getMinVsCodeWidth(sectionWidth), Math.min(getMaxVsCodeWidth(sectionWidth), startWidth + delta));
      vsCodeWidthRef.current = next;
      section.style.setProperty("--display-mode-vscode-width", `${next}px`);
    };
    const onUp = () => {
      section.classList.remove("display-mode--resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setVsCodeWidth(vsCodeWidthRef.current);
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

  const focusRecord = expandedId
    ? (orderedThreads.find((r) => threadKey(r.workspace.id, r.session.id) === expandedId) ?? null)
    : null;
  const focusKey = focusRecord ? threadKey(focusRecord.workspace.id, focusRecord.session.id) : null;
  const restRecords = focusRecord
    ? orderedThreads.filter((r) => threadKey(r.workspace.id, r.session.id) !== expandedId)
    : orderedThreads;

  // Auto-select first workspace when VS Code panel opens without one already chosen
  useEffect(() => {
    if (vsCodeOpen && !vsCodeWorkspaceId && !loading && orderedThreads.length > 0) {
      const first = orderedThreads[0];
      if (first) onOpenVsCodeForWorkspace(first.workspace.id, first.workspace.path);
    }
  }, [vsCodeOpen, vsCodeWorkspaceId, loading, orderedThreads, onOpenVsCodeForWorkspace]);

  // Collapse when expanded thread is filtered out
  useEffect(() => {
    if (expandedId && !focusRecord) setExpandedId(null);
  }, [expandedId, focusRecord]);

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
    setLocalTerminalKeys((c) => {
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
      style={{ gridTemplateColumns: [
        "minmax(0, 1fr)",
        vsCodeOpen ? "5px var(--display-mode-vscode-width)" : "0 0",
        drawerOpen ? "5px var(--display-mode-drawer-width)" : "0 0",
      ].join(" "), "--display-mode-drawer-width": `${drawerWidth}px`, "--display-mode-vscode-width": `${vsCodeWidth}px` } as CSSProperties}
      data-testid="display-mode-surface"
    >
      <div className={`display-mode__main${expandedId ? " display-mode__main--split" : ""}`}>
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
            <div className="display-mode__col-picker" aria-label="Grid columns">
              <button
                className={`display-mode__col-btn display-mode__col-btn--auto${colCount === "auto" ? " display-mode__col-btn--active" : ""}`}
                type="button"
                aria-label="Automatic columns"
                onClick={() => setColCount("auto")}
              >
                Auto
              </button>
              {([1, 2, 3, 4, 5, 6, 7, 8] as const).map((n) => (
                <button
                  key={n}
                  className={`display-mode__col-btn${colCount === n ? " display-mode__col-btn--active" : ""}`}
                  type="button"
                  aria-label={`${n} columns`}
                  onClick={() => setColCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <button
              className={`display-mode__compact-toggle${compact ? " display-mode__compact-toggle--active" : ""}`}
              type="button"
              onClick={() => setCompact((c) => !c)}
            >
              {compact ? "Detailed" : "Compact"}
            </button>
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
        ) : expandedId && focusRecord && focusKey ? (
          /* ── Split-panel mode ── */
          <div className="display-mode__split">
            <div className="display-mode__split-focus">
              <DisplayModeTile
                api={api}
                id={focusKey}
                key={focusKey}
                record={focusRecord}
                terminalOpen={localTerminalKeys.has(focusKey)}
                renderTerminalInline={true}
                runtime={runtimeByWorkspace[focusRecord.workspace.id]}
                sessionCommands={sessionCommandsBySession[focusKey] ?? []}
                commandCompatibility={commandCompatibilityByWorkspace[focusRecord.workspace.id] ?? []}
                setSnapshot={setSnapshot}
                openSettings={openSettings}
                updateSnapshot={updateSnapshot}
                isPinned={focusKey === pinnedThreadKey}
                isExpanded={true}
                compact={false}
                onFilesUpdate={focusKey === pinnedThreadKey ? setPinnedThreadFiles : undefined}
                onOpenThread={() => void api.selectSession({ workspaceId: focusRecord.workspace.id, sessionId: focusRecord.session.id })}
                onOpenVSCode={() => onOpenVsCodeForWorkspace(focusRecord.workspace.id, focusRecord.workspace.path)}
                onPinPreview={() => setPinnedThreadKey(focusKey)}
                onToggleTerminal={() => toggleTerminal(focusKey)}
                onToggleExpand={() => setExpandedId(null)}
              />
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <SortableContext items={tileOrder.filter((k) => k !== expandedId)} strategy={rectSortingStrategy}>
                <div className="display-mode__split-rest" style={{ gridTemplateColumns: gridTemplateColumnsForMode(colCount) }}>
                  {restRecords.map((record) => {
                    const key = threadKey(record.workspace.id, record.session.id);
                    return (
                      <DisplayModeTile
                        api={api}
                        id={key}
                        key={key}
                        record={record}
                        terminalOpen={localTerminalKeys.has(key)}
                        renderTerminalInline={true}
                        runtime={runtimeByWorkspace[record.workspace.id]}
                        sessionCommands={sessionCommandsBySession[key] ?? []}
                        commandCompatibility={commandCompatibilityByWorkspace[record.workspace.id] ?? []}
                        setSnapshot={setSnapshot}
                        openSettings={openSettings}
                        updateSnapshot={updateSnapshot}
                        isPinned={key === pinnedThreadKey}
                        isExpanded={false}
                        compact={compact}
                        onFilesUpdate={key === pinnedThreadKey ? setPinnedThreadFiles : undefined}
                        onOpenThread={() => void api.selectSession({ workspaceId: record.workspace.id, sessionId: record.session.id })}
                        onOpenVSCode={() => onOpenVsCodeForWorkspace(record.workspace.id, record.workspace.path)}
                        onPinPreview={() => setPinnedThreadKey(key)}
                        onToggleTerminal={() => toggleTerminal(key)}
                        onToggleExpand={() => setExpandedId(key)}
                      />
                    );
                  })}
                </div>
              </SortableContext>
              <DragOverlay>
                {draggingId ? <div className="display-mode-tile display-mode-tile--drag-overlay" /> : null}
              </DragOverlay>
            </DndContext>
          </div>
        ) : (
          /* ── Normal DnD grid mode ── */
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <SortableContext items={[...tileOrder]} strategy={rectSortingStrategy}>
              <div className="display-mode__grid" style={{ gridTemplateColumns: gridTemplateColumnsForMode(colCount) }}>
                {orderedThreads.map((record) => {
                  const key = threadKey(record.workspace.id, record.session.id);
                  return (
                    <DisplayModeTile
                      api={api}
                      id={key}
                      key={key}
                      record={record}
                      terminalOpen={localTerminalKeys.has(key)}
                      renderTerminalInline={true}
                      runtime={runtimeByWorkspace[record.workspace.id]}
                      sessionCommands={sessionCommandsBySession[key] ?? []}
                      commandCompatibility={commandCompatibilityByWorkspace[record.workspace.id] ?? []}
                      setSnapshot={setSnapshot}
                      openSettings={openSettings}
                      updateSnapshot={updateSnapshot}
                      isPinned={key === pinnedThreadKey}
                      isExpanded={false}
                      compact={compact}
                      onFilesUpdate={key === pinnedThreadKey ? setPinnedThreadFiles : undefined}
                      onOpenThread={() => void api.selectSession({ workspaceId: record.workspace.id, sessionId: record.session.id })}
                      onOpenVSCode={() => onOpenVsCodeForWorkspace(record.workspace.id, record.workspace.path)}
                      onPinPreview={() => setPinnedThreadKey(key)}
                      onToggleTerminal={() => toggleTerminal(key)}
                      onToggleExpand={() => setExpandedId((c) => c === key ? null : key)}
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

      {/* Always in DOM so grid column count stays constant */}
      <div
        className="display-mode-drawer__resize"
        onPointerDown={drawerOpen ? startDrawerResize : undefined}
        role="separator"
        aria-label="Resize drawer"
        title="Drag to resize"
        style={{ pointerEvents: drawerOpen ? undefined : "none" }}
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

      {/* VS Code panel — resize handle always in DOM to keep grid column count constant */}
      <div
        className="display-mode-drawer__resize display-mode-vscode__resize"
        onPointerDown={vsCodeOpen ? startVsCodeResize : undefined}
        role="separator"
        aria-label="Resize VS Code panel"
        title="Drag to resize VS Code panel"
        style={{ pointerEvents: vsCodeOpen ? undefined : "none" }}
      />
      <aside className={`display-mode-vscode${vsCodeOpen ? "" : " display-mode-vscode--hidden"}`}>
        {vsCodeOpen && vsCodeWorkspaceId && vsCodeFolderPath ? (
          <VSCodePanel
            api={api}
            workspaceId={vsCodeWorkspaceId}
            folderPath={vsCodeFolderPath}
            className="display-mode-vscode__panel"
            testId="display-mode-vscode-panel"
          />
        ) : (
          <div className="display-mode-vscode__loading">Open a workspace to start VS Code.</div>
        )}
      </aside>
    </section>
  );
}

/* ── Tile ─────────────────────────────────────────────────────────── */

function DisplayModeTile({
  api, id, record, terminalOpen, renderTerminalInline, isPinned, isExpanded, compact,
  runtime, sessionCommands, commandCompatibility, setSnapshot, openSettings, updateSnapshot,
  onFilesUpdate, onOpenThread, onOpenVSCode, onPinPreview, onToggleTerminal, onToggleExpand,
}: {
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
  readonly updateSnapshot: (
    api: PiDesktopApi,
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ) => Promise<DesktopAppState>;
  readonly isPinned: boolean;
  readonly isExpanded: boolean;
  readonly compact: boolean;
  readonly onFilesUpdate: ((files: readonly ChangedFile[]) => void) | undefined;
  readonly onOpenThread: () => void;
  readonly onOpenVSCode: () => void;
  readonly onPinPreview: () => void;
  readonly onToggleTerminal: () => void;
  readonly onToggleExpand: () => void;
}) {
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
      record.session.status === "running" ? { deliverAs: "followUp" } : undefined,
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
    updateSnapshot,
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
    submitText(draft);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMenu.handleSlashKeyDown(e)) return;
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
      className={`display-mode-tile display-mode-tile--${tone}${isDragging ? " display-mode-tile--dragging" : ""}${isExpanded ? " display-mode-tile--expanded" : ""}${compact ? " display-mode-tile--compact" : ""}${terminalOpen ? " display-mode-tile--terminal-open" : ""}`}
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
            onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
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
          <button className={`button${isPinned ? " display-mode-tile__action-active" : ""}`} type="button" onClick={onPinPreview}><MaximizeIcon /> Pin</button>
        </div>
      )}

      {/* Transcript */}
      {!compact && (
        <div className="display-mode-tile__transcript" ref={transcriptRef}>
          {recentMessages.length > 0 ? (
            recentMessages.map((item) => (
              <TimelineItem
                item={item}
                key={item.id}
                expandedToolCallIds={expandedToolCallIds}
                onToggleToolCall={toggleToolCall}
              />
            ))
          ) : (
            <div className="display-mode-tile__empty-state">No messages yet</div>
          )}
        </div>
      )}

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

      {/* Reply — uses real .composer CSS so it looks identical to thread view */}
      {!compact && <div className="composer display-mode-tile__reply">
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
          )}
        />
      </div>}
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

function getInitialVsCodeWidth(): number {
  const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
  const target = Math.floor(viewportWidth / 3);
  const saved = lsGetNum("dm:vsCodeWidth", target);
  return saved > Math.floor(viewportWidth * 0.55)
    ? target
    : Math.max(getMinVsCodeWidth(viewportWidth), Math.min(getMaxVsCodeWidth(viewportWidth), saved));
}

function getMinVsCodeWidth(containerWidth: number): number {
  return Math.min(360, Math.max(280, Math.floor(containerWidth * 0.3)));
}

function getMaxVsCodeWidth(containerWidth: number): number {
  return Math.max(getMinVsCodeWidth(containerWidth), Math.floor(containerWidth * 0.7));
}

function gridTemplateColumnsForMode(mode: ColumnMode): string {
  return mode === "auto"
    ? "repeat(auto-fit, minmax(min(380px, 100%), 1fr))"
    : `repeat(${mode}, minmax(0, 1fr))`;
}

function lsGetNum(key: string, fallback: number): number {
  try { const v = localStorage.getItem(key); return v !== null ? Number(v) : fallback; } catch { return fallback; }
}

function lsGetColumnMode(key: string, fallback: ColumnMode): ColumnMode {
  try {
    const value = localStorage.getItem(key);
    if (value === "auto") return "auto";
    if (value === null) return fallback;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 1 && numeric <= 8 ? numeric : fallback;
  } catch {
    return fallback;
  }
}

function lsGetBool(key: string, fallback: boolean): boolean {
  try { const v = localStorage.getItem(key); return v !== null ? v === "true" : fallback; } catch { return fallback; }
}

function lsSet(key: string, value: number | boolean | string): void {
  try { localStorage.setItem(key, String(value)); } catch { /* ignore */ }
}
