import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
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
} from "@dnd-kit/sortable";
import type { DesktopAppState, DisplayModeThreadRecord, ExtensionCommandCompatibilityRecord } from "./desktop-state";
import { DisplayModeTile } from "./features/display-mode/display-mode-tile";
import type { ChangedFile, ColumnMode, DisplayModeFilter, DrawerTab } from "./features/display-mode/display-mode-types";
import {
  fileBadge,
  filterLabel,
  gridTemplateColumnsForMode,
  isHttpUrl,
  lsGetBool,
  lsGetColumnMode,
  lsGetNum,
  lsSet,
  matchesFilter,
  statusTone,
  threadKey,
} from "./features/display-mode/display-mode-utils";
import type { PiDesktopApi } from "./ipc";
import type { SettingsSection } from "./settings-view";
import { formatRelativeTime } from "./string-utils";
import {
  clampVsCodeSidePanelWidth,
  getMaxVsCodeSidePanelWidth,
} from "./vscode-panel-width";

export interface DisplayModeViewProps {
  readonly api: PiDesktopApi;
  readonly drawerOpen: boolean;
  readonly onToggleDrawer: () => void;
  readonly vsCodeOpen: boolean;
  readonly vsCodeWorkspaceId: string | null;
  readonly vsCodeFolderPath: string | null;
  readonly vsCodeWidth: number;
  readonly onVsCodeWidthChange: (width: number) => void;
  readonly onToggleVsCode: () => void;
  readonly onOpenVsCodeForWorkspace: (workspaceId: string, folderPath: string) => void;
  readonly initialPinnedThreadKey: string;
  readonly vscodeSlotRef: (node: HTMLElement | null) => void;
  readonly runtimeByWorkspace: Readonly<Record<string, RuntimeSnapshot>>;
  readonly sessionCommandsBySession: Readonly<Record<string, readonly RuntimeCommandRecord[]>>;
  readonly commandCompatibilityByWorkspace: Readonly<Record<string, readonly ExtensionCommandCompatibilityRecord[]>>;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly openSettings: (workspaceId?: string, section?: SettingsSection) => void;
  readonly onOpenThread: (target: { readonly workspaceId: string; readonly sessionId: string }) => void;
}

export function DisplayModeView({
  api, drawerOpen,
  vsCodeOpen, vsCodeWorkspaceId, vsCodeWidth, onVsCodeWidthChange, onOpenVsCodeForWorkspace,
  initialPinnedThreadKey, vscodeSlotRef,
  runtimeByWorkspace, sessionCommandsBySession, commandCompatibilityByWorkspace,
  setSnapshot, openSettings, onOpenThread,
}: DisplayModeViewProps) {
  const [threads, setThreads] = useState<readonly DisplayModeThreadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DisplayModeFilter>("all");
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("");
  const [colCount, setColCount] = useState<ColumnMode>(() => lsGetColumnMode("dm:colCount", 3));
  const [compact, setCompact] = useState<boolean>(() => lsGetBool("dm:compact", false));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [localTerminalKeys, setLocalTerminalKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("preview");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [pinnedThreadKey, setPinnedThreadKey] = useState<string>("");
  const [tileOrder, setTileOrder] = useState<readonly string[]>([]);
  const [pinnedThreadFiles, setPinnedThreadFiles] = useState<readonly ChangedFile[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const [drawerWidth, setDrawerWidth] = useState<number>(() => lsGetNum("dm:drawerWidth", 320));
  const lastFetchAt = useRef<number>(0);
  const pendingRefresh = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sectionRef = useRef<HTMLElement | null>(null);
  const drawerWidthRef = useRef(drawerWidth);
  const vsCodeWidthRef = useRef(vsCodeWidth);
  const appliedInitialPinnedThreadKeyRef = useRef("");

  // Persist preferences
  useEffect(() => { lsSet("dm:colCount", colCount); }, [colCount]);
  useEffect(() => { lsSet("dm:compact", compact); }, [compact]);
  useEffect(() => { lsSet("dm:drawerWidth", drawerWidth); }, [drawerWidth]);
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
    const maxWidth = getMaxVsCodeSidePanelWidth(section.offsetWidth);
    if (vsCodeWidth > maxWidth) {
      onVsCodeWidthChange(maxWidth);
    }
  }, [onVsCodeWidthChange, vsCodeOpen, vsCodeWidth]);
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
      const next = clampVsCodeSidePanelWidth(startWidth + delta, sectionWidth);
      vsCodeWidthRef.current = next;
      section.style.setProperty("--display-mode-vscode-width", `${next}px`);
      onVsCodeWidthChange(next);
    };
    const onUp = () => {
      section.classList.remove("display-mode--resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onVsCodeWidthChange(vsCodeWidthRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const applyRecords = useCallback((records: readonly DisplayModeThreadRecord[]) => {
    setThreads(records);
    setPinnedThreadKey((c) => c || initialPinnedThreadKey || (records[0] ? threadKey(records[0].workspace.id, records[0].session.id) : ""));
  }, [initialPinnedThreadKey]);

  useEffect(() => {
    if (!initialPinnedThreadKey || appliedInitialPinnedThreadKeyRef.current === initialPinnedThreadKey) {
      return;
    }
    const initialThreadExists = threads.some((record) => threadKey(record.workspace.id, record.session.id) === initialPinnedThreadKey);
    if (!initialThreadExists) {
      return;
    }
    appliedInitialPinnedThreadKeyRef.current = initialPinnedThreadKey;
    setPinnedThreadKey(initialPinnedThreadKey);
    setPinnedThreadFiles([]);
  }, [initialPinnedThreadKey, threads]);

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

    const unsub = api.onStatePatchChanged(scheduleRefresh);
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
  const pinThread = useCallback((record: DisplayModeThreadRecord, key: string) => {
    setPinnedThreadKey(key);
    setPinnedThreadFiles([]);
    if (vsCodeOpen) {
      onOpenVsCodeForWorkspace(record.workspace.id, record.workspace.path);
    }
  }, [onOpenVsCodeForWorkspace, vsCodeOpen]);

  const focusRecord = expandedId
    ? (orderedThreads.find((r) => threadKey(r.workspace.id, r.session.id) === expandedId) ?? null)
    : null;
  const focusKey = focusRecord ? threadKey(focusRecord.workspace.id, focusRecord.session.id) : null;
  const restRecords = focusRecord
    ? orderedThreads.filter((r) => threadKey(r.workspace.id, r.session.id) !== expandedId)
    : orderedThreads;

  // Auto-select the pinned thread's workspace when VS Code opens without one already chosen.
  useEffect(() => {
    if (vsCodeOpen && !vsCodeWorkspaceId && !loading && orderedThreads.length > 0) {
      const target = pinnedThread ?? orderedThreads[0];
      if (target) onOpenVsCodeForWorkspace(target.workspace.id, target.workspace.path);
    }
  }, [vsCodeOpen, vsCodeWorkspaceId, loading, orderedThreads, pinnedThread, onOpenVsCodeForWorkspace]);

  // Collapse when expanded thread is filtered out
  useEffect(() => {
    if (expandedId && !focusRecord) setExpandedId(null);
  }, [expandedId, focusRecord]);

  const detectedUrls = useMemo(() => {
    const appOrigin = typeof window === "undefined" ? "" : window.location.origin;
    const seen = new Set<string>();
    for (const r of threads) {
      for (const msg of r.transcript) {
        if (msg.kind !== "message") continue;
        const matches = (msg as { text: string }).text.match(/https?:\/\/localhost:\d+/g);
        if (matches) {
          for (const url of matches) {
            if (url !== appOrigin) {
              seen.add(url);
            }
          }
        }
      }
    }
    return [...seen];
  }, [threads]);

  useEffect(() => {
    const appOrigin = typeof window === "undefined" ? "" : window.location.origin;
    if (previewUrl === appOrigin) {
      setPreviewUrl("");
    }
  }, [previewUrl]);

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
                isPinned={focusKey === pinnedThreadKey}
                isExpanded={true}
                compact={false}
                onFilesUpdate={focusKey === pinnedThreadKey ? setPinnedThreadFiles : undefined}
                onOpenThread={() => onOpenThread({ workspaceId: focusRecord.workspace.id, sessionId: focusRecord.session.id })}
                onOpenVSCode={() => onOpenVsCodeForWorkspace(focusRecord.workspace.id, focusRecord.workspace.path)}
                onPinPreview={() => pinThread(focusRecord, focusKey)}
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
                        isPinned={key === pinnedThreadKey}
                        isExpanded={false}
                        compact={compact}
                        onFilesUpdate={key === pinnedThreadKey ? setPinnedThreadFiles : undefined}
                        onOpenThread={() => onOpenThread({ workspaceId: record.workspace.id, sessionId: record.session.id })}
                        onOpenVSCode={() => onOpenVsCodeForWorkspace(record.workspace.id, record.workspace.path)}
                        onPinPreview={() => pinThread(record, key)}
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
                      isPinned={key === pinnedThreadKey}
                      isExpanded={false}
                      compact={compact}
                      onFilesUpdate={key === pinnedThreadKey ? setPinnedThreadFiles : undefined}
                      onOpenThread={() => onOpenThread({ workspaceId: record.workspace.id, sessionId: record.session.id })}
                      onOpenVSCode={() => onOpenVsCodeForWorkspace(record.workspace.id, record.workspace.path)}
                      onPinPreview={() => pinThread(record, key)}
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
      <aside
        ref={vsCodeOpen ? vscodeSlotRef : null}
        className={`display-mode-vscode${vsCodeOpen ? "" : " display-mode-vscode--hidden"}`}
        aria-hidden="true"
      />
    </section>
  );
}
