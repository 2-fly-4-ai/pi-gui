import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import type { RuntimeCommandRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { LRUCache } from "lru-cache";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
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
import type {
  DesktopAppState,
  DisplayModeThreadProjection,
  DisplayModeThreadRecord,
  ExtensionCommandCompatibilityRecord,
} from "./desktop-state";
import { DisplayModeTile } from "./features/display-mode/display-mode-tile";
import type { ChangedFile, ColumnMode, DisplayModeFilter, DrawerTab } from "./features/display-mode/display-mode-types";
import {
  fileBadge,
  filterLabel,
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
import type { FastModeSelection } from "./fast-mode-selector";
import { codexUsageStatusFrom } from "./codex-usage-status";
import { formatExactLocalTime, formatRelativeTime } from "./string-utils";
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
  readonly workspaces: DesktopAppState["workspaces"];
  readonly sessionCommandsBySession: Readonly<Record<string, readonly RuntimeCommandRecord[]>>;
  readonly commandCompatibilityByWorkspace: Readonly<Record<string, readonly ExtensionCommandCompatibilityRecord[]>>;
  readonly sessionExtensionUiBySession: DesktopAppState["sessionExtensionUiBySession"];
  readonly fastMode: FastModeSelection;
  readonly fastModeAvailable: boolean;
  readonly showThinking: boolean;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly openSettings: (workspaceId?: string, section?: SettingsSection) => void;
  readonly openSkillProfiles: (workspaceId?: string) => void;
  readonly onOpenThread: (target: { readonly workspaceId: string; readonly sessionId: string }) => void;
}

const DISPLAY_MODE_RENDERER_PROJECTION_CACHE_BYTES = 12 * 1024 * 1024;

export function DisplayModeView({
  api, drawerOpen, onToggleDrawer,
  vsCodeOpen, vsCodeWorkspaceId, vsCodeWidth, onVsCodeWidthChange, onOpenVsCodeForWorkspace,
  initialPinnedThreadKey, vscodeSlotRef,
  runtimeByWorkspace, sessionCommandsBySession, commandCompatibilityByWorkspace, sessionExtensionUiBySession,
  workspaces,
  fastMode, fastModeAvailable, showThinking,
  setSnapshot, openSettings, openSkillProfiles, onOpenThread,
}: DisplayModeViewProps) {
  const [projectionsByThread, setProjectionsByThread] = useState<
    Readonly<Record<string, DisplayModeThreadProjection>>
  >({});
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
  const projectionsByThreadRef = useRef(projectionsByThread);
  const projectionCacheRef = useRef(new LRUCache<string, DisplayModeThreadProjection>({
    maxSize: DISPLAY_MODE_RENDERER_PROJECTION_CACHE_BYTES,
    sizeCalculation: (projection) => Math.max(1, projection.serializedBytes),
  }));
  const projectionRequestsRef = useRef(new Map<string, Promise<void>>());
  const changedFilesRequestsRef = useRef(new Map<string, Promise<readonly ChangedFile[]>>());
  const sectionRef = useRef<HTMLElement | null>(null);
  const drawerWidthRef = useRef(drawerWidth);
  const vsCodeWidthRef = useRef(vsCodeWidth);
  const appliedInitialPinnedThreadKeyRef = useRef("");
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const virtualGridRef = useRef<HTMLDivElement | null>(null);
  const [resolvedColumnCount, setResolvedColumnCount] = useState(3);
  const resolvedColumnCountRef = useRef(3);
  const resolvedColumnsInitializedRef = useRef(false);
  const [virtualViewport, setVirtualViewport] = useState({ scrollTop: 0, height: 0 });
  const [interactionPinnedKeys, setInteractionPinnedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [focusedThreadKey, setFocusedThreadKey] = useState<string | null>(null);
  const splitRestRef = useRef<HTMLDivElement | null>(null);
  const [splitViewport, setSplitViewport] = useState({ scrollTop: 0, height: 0 });
  const [splitColumnCount, setSplitColumnCount] = useState(2);
  const projectionGenerationRef = useRef(0);
  const showThinkingRef = useRef(showThinking);
  const [staleProjectionResponseCount, setStaleProjectionResponseCount] = useState(0);

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

  useEffect(() => {
    const element = mainScrollRef.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setVirtualViewport({ scrollTop: element.scrollTop, height: element.clientHeight });
        const contentWidth = Math.max(0, element.clientWidth - 40);
        const responsiveMaximum = contentWidth <= 760 ? 1 : contentWidth <= 1180 ? 2 : 8;
        const requested = colCount === "auto"
          ? Math.max(1, Math.min(8, Math.floor((contentWidth + 14) / 354)))
          : colCount;
        const next = Math.min(responsiveMaximum, requested);
        const previous = resolvedColumnCountRef.current;
        if (next !== previous) {
          if (!resolvedColumnsInitializedRef.current) {
            resolvedColumnsInitializedRef.current = true;
            resolvedColumnCountRef.current = next;
            setResolvedColumnCount(next);
            return;
          }
          const rowHeight = compact ? 92 : 514;
          const gridOffset = virtualGridRef.current?.offsetTop ?? 0;
          const relativeTop = Math.max(0, element.scrollTop - gridOffset);
          const anchorIndex = Math.floor(relativeTop / rowHeight) * previous;
          const rowOffset = relativeTop % rowHeight;
          resolvedColumnCountRef.current = next;
          setResolvedColumnCount(next);
          requestAnimationFrame(() => {
            const nextGridOffset = virtualGridRef.current?.offsetTop ?? gridOffset;
            element.scrollTop = nextGridOffset + Math.floor(anchorIndex / next) * rowHeight + rowOffset;
          });
        } else {
          resolvedColumnsInitializedRef.current = true;
        }
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, [colCount, compact]);

  useEffect(() => {
    const element = splitRestRef.current;
    if (!element || !expandedId) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setSplitViewport({ scrollTop: element.scrollTop, height: element.clientHeight });
        const contentWidth = Math.max(0, element.clientWidth - 24);
        const requested = colCount === "auto"
          ? Math.max(1, Math.min(4, Math.floor((contentWidth + 10) / 350)))
          : colCount;
        setSplitColumnCount(Math.max(1, Math.min(requested, Math.floor((contentWidth + 10) / 280) || 1)));
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, [colCount, expandedId]);
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

  useEffect(() => {
    projectionsByThreadRef.current = projectionsByThread;
  }, [projectionsByThread]);

  const threads = useMemo<readonly DisplayModeThreadRecord[]>(() =>
    workspaces.flatMap((workspace) => {
      const lightweightWorkspace = { ...workspace, sessions: [] };
      return workspace.sessions
        .filter((session) => !session.archivedAt)
        .map((session) => {
          const key = threadKey(workspace.id, session.id);
          const projection = projectionsByThread[key];
          return {
            workspace: lightweightWorkspace,
            session,
            transcript: projection?.excerptRows ?? [],
            ...(projection?.subagentActivity ? { subagentActivity: projection.subagentActivity } : {}),
          };
        });
    }).sort((left, right) => {
      const leftRunning = left.session.status === "running" ? 0 : 1;
      const rightRunning = right.session.status === "running" ? 0 : 1;
      if (leftRunning !== rightRunning) return leftRunning - rightRunning;
      return Date.parse(right.session.updatedAt) - Date.parse(left.session.updatedAt);
    }), [projectionsByThread, workspaces]);

  useEffect(() => {
    setPinnedThreadKey((current) =>
      current ||
      initialPinnedThreadKey ||
      (threads[0] ? threadKey(threads[0].workspace.id, threads[0].session.id) : ""),
    );
  }, [initialPinnedThreadKey, threads]);

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

  const requestProjection = useCallback((workspaceId: string, sessionId: string) => {
    const key = threadKey(workspaceId, sessionId);
    const existingRequest = projectionRequestsRef.current.get(key);
    if (existingRequest) return existingRequest;
    const requestGeneration = projectionGenerationRef.current;
    const knownRevision = projectionsByThreadRef.current[key]?.revision;
    const request = api.getDisplayModeThreadProjection(
      { workspaceId, sessionId },
      knownRevision,
    ).then((response) => {
      if (response.kind !== "projection") return;
      if (
        requestGeneration !== projectionGenerationRef.current ||
        response.projection.showThinking !== showThinkingRef.current
      ) {
        setStaleProjectionResponseCount((count) => count + 1);
        return;
      }
      setProjectionsByThread((current) => {
        const existing = current[key];
        if (existing && existing.revision > response.projection.revision) return current;
        projectionCacheRef.current.set(key, response.projection);
        return Object.fromEntries(projectionCacheRef.current.entries());
      });
    }).finally(() => {
      if (projectionRequestsRef.current.get(key) === request) {
        projectionRequestsRef.current.delete(key);
      }
    });
    projectionRequestsRef.current.set(key, request);
    return request;
  }, [api]);

  useEffect(() => api.onDisplayModeProjectionChanged((event) => {
    const key = threadKey(event.workspaceId, event.sessionId);
    if (!projectionsByThreadRef.current[key]) return;
    void requestProjection(event.workspaceId, event.sessionId);
  }), [api, requestProjection]);

  useEffect(() => {
    showThinkingRef.current = showThinking;
    projectionGenerationRef.current += 1;
    projectionRequestsRef.current.clear();
    projectionCacheRef.current.clear();
    setProjectionsByThread({});
  }, [showThinking]);

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

  const allKeysStr = useMemo(
    () => threads.map((r) => threadKey(r.workspace.id, r.session.id)).join(","),
    [threads],
  );

  useEffect(() => {
    const keys = allKeysStr ? allKeysStr.split(",") : [];
    setTileOrder((c) => {
      const s = new Set(keys);
      return [...c.filter((k) => s.has(k)), ...keys.filter((k) => !c.includes(k))];
    });
  }, [allKeysStr]);

  const orderedThreads = useMemo(() => {
    if (tileOrder.length === 0) return visibleThreads;
    const m = new Map(tileOrder.map((k, i) => [k, i]));
    return [...visibleThreads].sort((a, b) => {
      const ia = m.get(threadKey(a.workspace.id, a.session.id)) ?? Infinity;
      const ib = m.get(threadKey(b.workspace.id, b.session.id)) ?? Infinity;
      return ia - ib;
    });
  }, [visibleThreads, tileOrder]);

  const virtualRowHeight = compact ? 92 : 514;
  const virtualRows = useMemo(() => {
    const rows: DisplayModeThreadRecord[][] = [];
    for (let index = 0; index < orderedThreads.length; index += resolvedColumnCount) {
      rows.push(orderedThreads.slice(index, index + resolvedColumnCount));
    }
    return rows;
  }, [orderedThreads, resolvedColumnCount]);
  const virtualGridOffset = virtualGridRef.current?.offsetTop ?? 0;
  const relativeScrollTop = Math.max(0, virtualViewport.scrollTop - virtualGridOffset);
  const firstVisibleVirtualRow = Math.max(0, Math.floor(relativeScrollTop / virtualRowHeight) - 2);
  const lastVisibleVirtualRow = Math.min(
    virtualRows.length - 1,
    Math.ceil((relativeScrollTop + virtualViewport.height) / virtualRowHeight) + 2,
  );
  const virtualResidentRows = useMemo(() => {
    const indexes = new Set<number>();
    for (let index = firstVisibleVirtualRow; index <= lastVisibleVirtualRow; index += 1) {
      if (index >= 0) indexes.add(index);
    }
    const pinnedKeys = new Set([
      ...interactionPinnedKeys,
      ...localTerminalKeys,
      ...(focusedThreadKey ? [focusedThreadKey] : []),
      ...(draggingId ? [draggingId] : []),
    ]);
    for (const key of pinnedKeys) {
      const recordIndex = orderedThreads.findIndex((record) =>
        threadKey(record.workspace.id, record.session.id) === key,
      );
      if (recordIndex >= 0) indexes.add(Math.floor(recordIndex / resolvedColumnCount));
    }
    return [...indexes].sort((left, right) => left - right);
  }, [
    draggingId,
    firstVisibleVirtualRow,
    focusedThreadKey,
    interactionPinnedKeys,
    lastVisibleVirtualRow,
    localTerminalKeys,
    orderedThreads,
    resolvedColumnCount,
  ]);
  const virtualResidentKeys = useMemo(() => new Set(
    virtualResidentRows.flatMap((rowIndex) =>
      (virtualRows[rowIndex] ?? []).map((record) => threadKey(record.workspace.id, record.session.id)),
    ),
  ), [virtualResidentRows, virtualRows]);

  const setInteractionResidency = useCallback((key: string, active: boolean) => {
    setInteractionPinnedKeys((current) => {
      if (current.has(key) === active) return current;
      const next = new Set(current);
      if (active) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const runningCount = threads.filter((r) => r.session.status === "running").length;
  const errorCount = threads.filter((r) => r.session.status === "failed").length;
  const pinnedThread = threads.find((r) => threadKey(r.workspace.id, r.session.id) === pinnedThreadKey);
  const pinnedWorkspaceId = pinnedThread?.workspace.id;
  useEffect(() => {
    if (!drawerOpen || drawerTab !== "files" || !pinnedWorkspaceId) return;
    let active = true;
    const workspaceId = pinnedWorkspaceId;
    let request = changedFilesRequestsRef.current.get(workspaceId);
    if (!request) {
      request = api.getChangedFiles(workspaceId).finally(() => {
        changedFilesRequestsRef.current.delete(workspaceId);
      });
      changedFilesRequestsRef.current.set(workspaceId, request);
    }
    void request.then((files) => {
      if (active) setPinnedThreadFiles(files.slice(0, 8));
    });
    return () => {
      active = false;
    };
  }, [api, drawerOpen, drawerTab, pinnedWorkspaceId]);
  const pinThread = useCallback((record: DisplayModeThreadRecord, key: string) => {
    setPinnedThreadKey(key);
    setPinnedThreadFiles([]);
    if (!drawerOpen) {
      onToggleDrawer();
    }
    if (vsCodeOpen) {
      onOpenVsCodeForWorkspace(record.workspace.id, record.workspace.path);
    }
  }, [drawerOpen, onOpenVsCodeForWorkspace, onToggleDrawer, vsCodeOpen]);

  const focusRecord = expandedId
    ? (orderedThreads.find((r) => threadKey(r.workspace.id, r.session.id) === expandedId) ?? null)
    : null;
  const focusKey = focusRecord ? threadKey(focusRecord.workspace.id, focusRecord.session.id) : null;
  const restRecords = focusRecord
    ? orderedThreads.filter((r) => threadKey(r.workspace.id, r.session.id) !== expandedId)
    : orderedThreads;
  const splitRowHeight = compact ? 88 : 510;
  const splitRows = useMemo(() => {
    const rows: DisplayModeThreadRecord[][] = [];
    for (let index = 0; index < restRecords.length; index += splitColumnCount) {
      rows.push(restRecords.slice(index, index + splitColumnCount));
    }
    return rows;
  }, [restRecords, splitColumnCount]);
  const splitFirstRow = Math.max(0, Math.floor(splitViewport.scrollTop / splitRowHeight) - 2);
  const splitLastRow = Math.min(
    splitRows.length - 1,
    Math.ceil((splitViewport.scrollTop + splitViewport.height) / splitRowHeight) + 2,
  );
  const splitResidentRows = useMemo(() => {
    const indexes = new Set<number>();
    for (let index = splitFirstRow; index <= splitLastRow; index += 1) {
      if (index >= 0) indexes.add(index);
    }
    const pinnedKeys = new Set([
      ...interactionPinnedKeys,
      ...localTerminalKeys,
      ...(focusedThreadKey ? [focusedThreadKey] : []),
      ...(draggingId ? [draggingId] : []),
    ]);
    for (const key of pinnedKeys) {
      const recordIndex = restRecords.findIndex((record) =>
        threadKey(record.workspace.id, record.session.id) === key,
      );
      if (recordIndex >= 0) indexes.add(Math.floor(recordIndex / splitColumnCount));
    }
    return [...indexes].sort((left, right) => left - right);
  }, [
    draggingId,
    focusedThreadKey,
    interactionPinnedKeys,
    localTerminalKeys,
    restRecords,
    splitColumnCount,
    splitFirstRow,
    splitLastRow,
  ]);
  const splitResidentKeys = useMemo(() => new Set(
    splitResidentRows.flatMap((rowIndex) =>
      (splitRows[rowIndex] ?? []).map((record) => threadKey(record.workspace.id, record.session.id)),
    ),
  ), [splitResidentRows, splitRows]);

  // Auto-select the pinned thread's workspace when VS Code opens without one already chosen.
  useEffect(() => {
    if (vsCodeOpen && !vsCodeWorkspaceId && orderedThreads.length > 0) {
      const target = pinnedThread ?? orderedThreads[0];
      if (target) onOpenVsCodeForWorkspace(target.workspace.id, target.workspace.path);
    }
  }, [vsCodeOpen, vsCodeWorkspaceId, orderedThreads, pinnedThread, onOpenVsCodeForWorkspace]);

  // Collapse when expanded thread is filtered out
  useEffect(() => {
    if (expandedId && !focusRecord) setExpandedId(null);
  }, [expandedId, focusRecord]);

  const detectedUrls = useMemo(() => {
    const appOrigin = typeof window === "undefined" ? "" : window.location.origin;
    const seen = new Set<string>();
    if (pinnedThread) {
      for (const msg of pinnedThread.transcript) {
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
  }, [pinnedThread]);

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
      data-projection-cache-bytes={[...projectionCacheRef.current.values()]
        .reduce((total, projection) => total + projection.serializedBytes, 0)}
      data-projection-cache-count={projectionCacheRef.current.size}
      data-stale-projection-responses={staleProjectionResponseCount}
    >
      <div
        ref={mainScrollRef}
        className={`display-mode__main${expandedId ? " display-mode__main--split" : ""}`}
        onFocusCapture={(event) => {
          const tile = (event.target as HTMLElement).closest<HTMLElement>("[data-thread-key]");
          if (tile?.dataset.threadKey) setFocusedThreadKey(tile.dataset.threadKey);
        }}
        onBlurCapture={() => {
          window.requestAnimationFrame(() => {
            const activeTile = document.activeElement?.closest?.("[data-thread-key]") as HTMLElement | null;
            setFocusedThreadKey(activeTile?.dataset.threadKey ?? null);
          });
        }}
      >
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
            <label className="display-mode__layout-control">
              <span>Layout</span>
              <select
                aria-label="Grid columns"
                value={String(colCount)}
                onChange={(event) => {
                  const value = event.target.value;
                  setColCount(value === "auto" ? "auto" : Number(value) as ColumnMode);
                }}
              >
                <option value="auto">Auto</option>
                {([1, 2, 3, 4, 5, 6, 7, 8] as const).map((count) => (
                  <option key={count} value={count}>{count} columns</option>
                ))}
              </select>
            </label>
            <button
              aria-pressed={drawerOpen}
              className={`display-mode__preview-toggle${drawerOpen ? " display-mode__preview-toggle--active" : ""}`}
              type="button"
              onClick={onToggleDrawer}
            >
              Preview
            </button>
            <button
              aria-label={compact ? "Use detailed Display Mode cards" : "Use compact Display Mode cards"}
              aria-pressed={compact}
              className={`display-mode__compact-toggle${compact ? " display-mode__compact-toggle--active" : ""}`}
              title="Changes Display Mode cards only; transcript and app density stay unchanged."
              type="button"
              onClick={() => setCompact((c) => !c)}
            >
              {compact ? "Detailed cards" : "Compact cards"}
            </button>
            <div className="display-mode__summary">
              <span><strong>{runningCount}</strong> running</span>
              <span><strong>{errorCount}</strong> failed</span>
              <span><strong>{threads.length}</strong> threads</span>
            </div>
            <button className="button display-mode__pause-btn" type="button" disabled={runningCount === 0} onClick={pauseAll}>
              Pause all
            </button>
          </div>
        </header>

        {orderedThreads.length === 0 ? (
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
                openSkillProfiles={openSkillProfiles}
                isPinned={focusKey === pinnedThreadKey}
                isExpanded={true}
                compact={false}
                fastMode={fastMode}
                fastModeAvailable={fastModeAvailable}
                showThinking={showThinking}
                codexUsageStatus={codexUsageStatusFrom(sessionExtensionUiBySession[focusKey])}
                onOpenThread={() => onOpenThread({ workspaceId: focusRecord.workspace.id, sessionId: focusRecord.session.id })}
                onOpenVSCode={() => onOpenVsCodeForWorkspace(focusRecord.workspace.id, focusRecord.workspace.path)}
                onPinPreview={() => pinThread(focusRecord, focusKey)}
                onToggleTerminal={() => toggleTerminal(focusKey)}
                onToggleExpand={() => setExpandedId(null)}
                onRequestProjection={requestProjection}
                onInteractionResidencyChange={setInteractionResidency}
              />
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <SortableContext
                items={restRecords.map((record) => threadKey(record.workspace.id, record.session.id))}
                strategy={rectSortingStrategy}
              >
                <div
                  ref={splitRestRef}
                  className="display-mode__split-rest display-mode__split-rest--virtual"
                  data-resident-row-count={splitResidentRows.length}
                >
                  <div
                    className="display-mode__split-virtual-canvas"
                    style={{ height: `${Math.max(0, splitRows.length * splitRowHeight - 10)}px` }}
                  >
                    {draggingId ? (
                      <div
                        className="display-mode__virtual-drop-layer"
                        style={{
                          gridTemplateColumns: `repeat(${splitColumnCount}, minmax(0, 1fr))`,
                          gridAutoRows: `${splitRowHeight - 10}px`,
                          gap: "10px",
                        }}
                        aria-hidden="true"
                      >
                        {restRecords.map((record) => {
                          const key = threadKey(record.workspace.id, record.session.id);
                          return splitResidentKeys.has(key)
                            ? <div key={key} />
                            : <VirtualDropTarget id={key} key={key} />;
                        })}
                      </div>
                    ) : null}
                    {splitResidentRows.map((rowIndex) => (
                      <div
                        className="display-mode__virtual-row"
                        key={rowIndex}
                        style={{
                          gridTemplateColumns: `repeat(${splitColumnCount}, minmax(0, 1fr))`,
                          gap: "10px",
                          height: `${splitRowHeight - 10}px`,
                          transform: `translateY(${rowIndex * splitRowHeight}px)`,
                        }}
                      >
                        {(splitRows[rowIndex] ?? []).map((record) => {
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
                              openSkillProfiles={openSkillProfiles}
                              isPinned={key === pinnedThreadKey}
                              isExpanded={false}
                              compact={compact}
                              fastMode={fastMode}
                              fastModeAvailable={fastModeAvailable}
                              showThinking={showThinking}
                              codexUsageStatus={codexUsageStatusFrom(sessionExtensionUiBySession[key])}
                              onOpenThread={() => onOpenThread({ workspaceId: record.workspace.id, sessionId: record.session.id })}
                              onOpenVSCode={() => onOpenVsCodeForWorkspace(record.workspace.id, record.workspace.path)}
                              onPinPreview={() => pinThread(record, key)}
                              onToggleTerminal={() => toggleTerminal(key)}
                              onToggleExpand={() => setExpandedId(key)}
                              onRequestProjection={requestProjection}
                              onInteractionResidencyChange={setInteractionResidency}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
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
            <SortableContext
              items={orderedThreads.map((record) => threadKey(record.workspace.id, record.session.id))}
              strategy={rectSortingStrategy}
            >
              <div
                ref={virtualGridRef}
                className="display-mode__grid display-mode__grid--virtual"
                style={{
                  gridTemplateColumns: `repeat(${resolvedColumnCount}, minmax(0, 1fr))`,
                  height: `${Math.max(0, virtualRows.length * virtualRowHeight - 14)}px`,
                }}
                data-testid="display-mode-virtual-grid"
                data-resident-row-count={virtualResidentRows.length}
                data-total-row-count={virtualRows.length}
                data-column-count={resolvedColumnCount}
              >
                {draggingId ? (
                  <div
                    className="display-mode__virtual-drop-layer"
                    style={{
                      gridTemplateColumns: `repeat(${resolvedColumnCount}, minmax(0, 1fr))`,
                      gridAutoRows: `${virtualRowHeight - 14}px`,
                    }}
                    aria-hidden="true"
                  >
                    {orderedThreads.map((record) => {
                      const key = threadKey(record.workspace.id, record.session.id);
                      return virtualResidentKeys.has(key)
                        ? <div key={key} />
                        : <VirtualDropTarget id={key} key={key} />;
                    })}
                  </div>
                ) : null}
                {virtualResidentRows.map((rowIndex) => (
                  <div
                    className="display-mode__virtual-row"
                    key={rowIndex}
                    style={{
                      gridTemplateColumns: `repeat(${resolvedColumnCount}, minmax(0, 1fr))`,
                      height: `${virtualRowHeight - 14}px`,
                      transform: `translateY(${rowIndex * virtualRowHeight}px)`,
                    }}
                  >
                    {(virtualRows[rowIndex] ?? []).map((record) => {
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
                          openSkillProfiles={openSkillProfiles}
                          isPinned={key === pinnedThreadKey}
                          isExpanded={false}
                          compact={compact}
                          fastMode={fastMode}
                          fastModeAvailable={fastModeAvailable}
                          showThinking={showThinking}
                          codexUsageStatus={codexUsageStatusFrom(sessionExtensionUiBySession[key])}
                          onOpenThread={() => onOpenThread({ workspaceId: record.workspace.id, sessionId: record.session.id })}
                          onOpenVSCode={() => onOpenVsCodeForWorkspace(record.workspace.id, record.workspace.path)}
                          onPinPreview={() => pinThread(record, key)}
                          onToggleTerminal={() => toggleTerminal(key)}
                          onToggleExpand={() => setExpandedId((current) => current === key ? null : key)}
                          onRequestProjection={requestProjection}
                          onInteractionResidencyChange={setInteractionResidency}
                        />
                      );
                    })}
                  </div>
                ))}
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
      <aside aria-hidden={!drawerOpen} className="display-mode-drawer">
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
              <button aria-pressed={previewDevice === "desktop"} className={previewDevice === "desktop" ? "is-active" : ""} type="button" onClick={() => setPreviewDevice("desktop")}>Desktop</button>
              <button aria-pressed={previewDevice === "mobile"} className={previewDevice === "mobile" ? "is-active" : ""} type="button" onClick={() => setPreviewDevice("mobile")}>Mobile</button>
            </div>
            {isHttpUrl(previewUrl) ? (
              <div className={`display-mode-preview display-mode-preview--${previewDevice}`}>
                <iframe title="Preview" src={previewUrl} />
              </div>
            ) : (
              <div className="display-mode-preview__empty">
                Enter or select a local preview URL. The preview stays closed until you ask for it.
              </div>
            )}
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
                          <time
                            aria-label={`Updated ${formatExactLocalTime(r.session.updatedAt)}`}
                            className="display-mode-log-entry__time"
                            dateTime={r.session.updatedAt}
                            tabIndex={0}
                            title={formatExactLocalTime(r.session.updatedAt)}
                          >
                            {formatRelativeTime(r.session.updatedAt)}
                          </time>
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

function VirtualDropTarget({ id }: { readonly id: string }) {
  const { setNodeRef } = useDroppable({ id });
  return <div ref={setNodeRef} className="display-mode__virtual-drop-target" />;
}
