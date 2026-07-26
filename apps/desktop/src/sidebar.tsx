import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { AppView, SessionRecord, WorkspaceRecord, WorktreeRecord } from "./desktop-state";
import { ChevronDownIcon, ExtensionIcon, FolderIcon, MaximizeIcon, PlusIcon, SettingsIcon, SkillIcon, WorktreeIcon } from "./icons";
import type { PiDesktopApi } from "./ipc";
import { formatExactLocalTime, formatRelativeTime } from "./string-utils";
import type { WorkspaceMenuState } from "./hooks/use-workspace-menu";
import type { ThreadGroup, ThreadListEntry } from "./thread-groups";
import type { Dispatch, SetStateAction } from "react";
import type { DesktopAppState } from "./desktop-state";
import {
  groupThreadsByDate,
  matchesThreadOrganizationFilters,
  matchesThreadOrganizationQuery,
  type ThreadOrganizationFilter,
} from "./thread-organization";

interface SidebarProps {
  readonly activeView: AppView;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly visibleWorkspaces: readonly WorkspaceRecord[];
  readonly threadGroups: readonly ThreadGroup[];
  readonly linkedWorktreeByWorkspaceId: Map<string, WorktreeRecord>;
  readonly wsMenu: WorkspaceMenuState;
  readonly api: PiDesktopApi;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly onNewThread: () => void;
  readonly onSetActiveView: (view: AppView) => void;
  readonly onOpenSkills: (workspaceId?: string) => void;
  readonly onOpenExtensions: (workspaceId?: string) => void;
  readonly onOpenSettings: (workspaceId?: string) => void;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onUnarchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly getRuntimeBadgeCount: (session: SessionRecord | undefined) => number;
}

const SIDEBAR_WIDTH_STORAGE_KEY = "pi-gui:sidebar-width";
const PINNED_THREADS_STORAGE_KEY = "pi-gui:pinned-threads:v1";
const DEFAULT_SIDEBAR_WIDTH = 292;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 440;

function maxSidebarWidth(): number {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - 520));
}

function clampSidebarWidth(width: number): number {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxSidebarWidth(), width));
}

function readSidebarWidth(): number {
  try {
    const stored = Number.parseInt(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? "", 10);
    return clampSidebarWidth(Number.isFinite(stored) ? stored : DEFAULT_SIDEBAR_WIDTH);
  } catch {
    return clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  }
}

function readPinnedThreadKeys(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PINNED_THREADS_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function threadKey(thread: Pick<ThreadListEntry, "workspaceId" | "session">): string {
  return `${thread.workspaceId}:${thread.session.id}`;
}

export function Sidebar(props: SidebarProps) {
  const {
    activeView,
    selectedWorkspace,
    selectedSession,
    visibleWorkspaces,
    threadGroups,
    linkedWorktreeByWorkspaceId,
    wsMenu,
    api,
    setSnapshot,
    onNewThread,
    onSetActiveView,
    onOpenSkills,
    onOpenExtensions,
    onOpenSettings,
    onArchiveSession,
    onSelectSession,
    onUnarchiveSession,
    getRuntimeBadgeCount,
  } = props;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [pinnedThreadKeys, setPinnedThreadKeys] = useState(readPinnedThreadKeys);
  const [threadQuery, setThreadQuery] = useState("");
  const [threadFilters, setThreadFilters] = useState<ReadonlySet<ThreadOrganizationFilter>>(new Set());
  const [includeArchived, setIncludeArchived] = useState(false);
  const [activeThreadResult, setActiveThreadResult] = useState(0);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const threadSearchInputRef = useRef<HTMLInputElement | null>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const pinnedThreadKeySet = new Set(pinnedThreadKeys);
  const organizationActive = Boolean(threadQuery.trim() || threadFilters.size > 0 || includeArchived);
  const organizedThreadGroups = threadGroups.map((group) => ({
    ...group,
    threads: group.threads.filter((thread) =>
      matchesThreadOrganizationQuery(thread, group.rootWorkspace.name, threadQuery)
      && matchesThreadOrganizationFilters(thread, threadFilters)),
    archivedThreads: includeArchived
      ? group.archivedThreads.filter((thread) =>
          matchesThreadOrganizationQuery(thread, group.rootWorkspace.name, threadQuery)
          && matchesThreadOrganizationFilters(thread, threadFilters))
      : organizationActive
        ? []
        : group.archivedThreads,
  })).filter((group) => group.threads.length > 0 || group.archivedThreads.length > 0 || !organizationActive);
  const organizationResults = organizedThreadGroups.flatMap((group) => [
    ...group.threads,
    ...group.archivedThreads,
  ]);
  const togglePinnedThread = (key: string) => {
    setPinnedThreadKeys((current) => {
      const next = current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [...current, key];
      try {
        localStorage.setItem(PINNED_THREADS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Pinning remains available for this window when storage is unavailable.
      }
      return next;
    });
  };

  const applySidebarWidth = (width: number, persist = true) => {
    const next = clampSidebarWidth(width);
    sidebarWidthRef.current = next;
    sidebarRef.current?.closest<HTMLElement>(".shell")?.style.setProperty("--sidebar-width", `${next}px`);
    setSidebarWidth(next);
    if (persist) {
      try {
        localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(next));
      } catch {
        // The width remains available for this window when storage is unavailable.
      }
    }
  };

  useEffect(() => {
    applySidebarWidth(sidebarWidthRef.current, false);
    const handleWindowResize = () => applySidebarWidth(sidebarWidthRef.current);
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

  useEffect(() => {
    const focusSearch = () => {
      onSetActiveView("threads");
      setTimeout(() => threadSearchInputRef.current?.focus(), 0);
    };
    window.addEventListener("pi-gui:focus-thread-list-search", focusSearch);
    return () => window.removeEventListener("pi-gui:focus-thread-list-search", focusSearch);
  }, [onSetActiveView]);

  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = sidebarWidthRef.current;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const next = clampSidebarWidth(startWidth + moveEvent.clientX - startX);
      sidebarWidthRef.current = next;
      sidebarRef.current?.closest<HTMLElement>(".shell")?.style.setProperty("--sidebar-width", `${next}px`);
    };
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      applySidebarWidth(sidebarWidthRef.current);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleSidebarResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      applySidebarWidth(DEFAULT_SIDEBAR_WIDTH);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    applySidebarWidth(sidebarWidthRef.current + direction * (event.shiftKey ? 32 : 8));
  };

  // Collision detection based on workspace row headers only (~30px top of each group),
  // not the full group height including all sessions.
  const headerCollision: CollisionDetection = (args) => {
    const pointerY = args.pointerCoordinates?.y;
    if (pointerY == null) return [];

    let closest: { id: string; distance: number } | null = null;
    for (const container of args.droppableContainers) {
      const rect = container.rect.current;
      if (!rect) continue;
      const headerCenter = rect.top + 15; // center of the ~30px workspace row header
      const distance = Math.abs(pointerY - headerCenter);
      if (!closest || distance < closest.distance) {
        closest = { id: String(container.id), distance };
      }
    }
    return closest ? [{ id: closest.id, data: { droppableContainer: args.droppableContainers.find((c) => String(c.id) === closest!.id)! } }] : [];
  };

  const rootGroups = organizedThreadGroups.filter((g) => g.rootWorkspace.kind === "primary");
  const orphanGroups = organizedThreadGroups.filter((g) => g.rootWorkspace.kind !== "primary");
  const rootGroupIds = rootGroups.map((g) => g.rootWorkspace.id);
  const canDrag = rootGroups.length > 1 && !organizationActive;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = rootGroupIds.indexOf(String(active.id));
    const newIndex = rootGroupIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const newOrder = arrayMove(rootGroupIds, oldIndex, newIndex);
    // Optimistically update local state to avoid snap-back animation
    setSnapshot((prev) => prev ? { ...prev, workspaceOrder: newOrder } : prev);
    void api.reorderWorkspaces(newOrder);
  }

  const activeGroup = activeId ? rootGroups.find((g) => g.rootWorkspace.id === activeId) : undefined;

  return (
    <aside className="sidebar" ref={sidebarRef}>
      <div
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemax={maxSidebarWidth()}
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuenow={sidebarWidth}
        className="sidebar__resize"
        role="separator"
        tabIndex={0}
        title="Drag to resize · Arrow keys adjust · Home resets"
        onDoubleClick={() => applySidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
        onKeyDown={handleSidebarResizeKeyDown}
        onPointerDown={startSidebarResize}
      />
      <div className="sidebar__top">
        <button
          className="sidebar__new"
          type="button"
          disabled={!selectedWorkspace}
          onClick={onNewThread}
        >
          <PlusIcon />
          <span>New thread</span>
        </button>

        <div className="sidebar__nav">
          <button
            className={`sidebar__nav-item ${activeView === "threads" ? "sidebar__nav-item--active" : ""}`}
            type="button"
            onClick={() => onSetActiveView("threads")}
          >
            <FolderIcon />
            <span>Threads</span>
          </button>
          <button
            className={`sidebar__nav-item ${activeView === "display-mode" ? "sidebar__nav-item--active" : ""}`}
            type="button"
            onClick={() => onSetActiveView("display-mode")}
          >
            <MaximizeIcon />
            <span>Display Mode</span>
          </button>
          <button
            className="sidebar__nav-item"
            type="button"
            onClick={() => onOpenSkills(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)}
          >
            <SkillIcon />
            <span>Skills</span>
          </button>
          <button
            className="sidebar__nav-item"
            type="button"
            onClick={() => onOpenExtensions(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)}
          >
            <ExtensionIcon />
            <span>Extensions</span>
          </button>
          <button
            className="sidebar__nav-item"
            type="button"
            onClick={() => onOpenSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)}
          >
            <SettingsIcon />
            <span>Settings</span>
          </button>
        </div>
      </div>

      <div className="sidebar__section">
        <div className="section__head">
          <span>Threads</span>
          <div className="section__tools">
            <button
              aria-label="Open folder"
              className="icon-button"
              type="button"
              onClick={() => {
                void api.pickWorkspace().then(() => api.getState()).then(setSnapshot);
              }}
            >
              <FolderIcon />
            </button>
          </div>
        </div>

        <div className="thread-organizer" data-testid="thread-organizer">
          <label className="thread-organizer__search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={threadSearchInputRef}
              aria-label="Search threads"
              placeholder="Search titles and safe metadata"
              type="search"
              value={threadQuery}
              onChange={(event) => {
                setThreadQuery(event.target.value);
                setActiveThreadResult(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const direction = event.key === "ArrowDown" ? 1 : -1;
                  setActiveThreadResult((current) =>
                    organizationResults.length === 0
                      ? 0
                      : (current + direction + organizationResults.length) % organizationResults.length);
                } else if (event.key === "Enter") {
                  const result = organizationResults[activeThreadResult];
                  if (result) {
                    event.preventDefault();
                    onSelectSession({ workspaceId: result.workspaceId, sessionId: result.session.id });
                  }
                } else if (event.key === "Escape" && organizationActive) {
                  event.preventDefault();
                  setThreadQuery("");
                  setThreadFilters(new Set());
                  setIncludeArchived(false);
                  setActiveThreadResult(0);
                }
              }}
            />
          </label>
          <details className="thread-organizer__filters">
            <summary>
              Filters{threadFilters.size > 0 || includeArchived ? ` (${threadFilters.size + Number(includeArchived)})` : ""}
            </summary>
            <div className="thread-organizer__filter-menu">
              {(["running", "waiting", "failed", "completed", "interrupted", "unverified"] as const).map((filter) => (
                <label key={filter}>
                  <input
                    checked={threadFilters.has(filter)}
                    type="checkbox"
                    onChange={() => {
                      setThreadFilters((current) => {
                        const next = new Set(current);
                        if (next.has(filter)) next.delete(filter);
                        else next.add(filter);
                        return next;
                      });
                      setActiveThreadResult(0);
                    }}
                  />
                  <span>{filter[0]?.toUpperCase()}{filter.slice(1)}</span>
                </label>
              ))}
              <label>
                <input
                  checked={includeArchived}
                  type="checkbox"
                  onChange={(event) => {
                    setIncludeArchived(event.target.checked);
                    setActiveThreadResult(0);
                  }}
                />
                <span>Archived</span>
              </label>
              <button
                disabled={!organizationActive}
                type="button"
                onClick={() => {
                  setThreadQuery("");
                  setThreadFilters(new Set());
                  setIncludeArchived(false);
                  setActiveThreadResult(0);
                  threadSearchInputRef.current?.focus();
                }}
              >
                Reset
              </button>
            </div>
          </details>
          {organizationActive ? (
            <span className="thread-organizer__result-count" aria-live="polite">
              {organizationResults.length} result{organizationResults.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>

        {visibleWorkspaces.length === 0 ? (
          <div className="empty-state" data-testid="empty-state">
            <h2>No folders yet</h2>
            <p>Open a project folder to start building a workspace and session list.</p>
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                void api.pickWorkspace().then(() => api.getState()).then(setSnapshot);
              }}
            >
              Open first folder
            </button>
          </div>
        ) : organizationActive && organizationResults.length === 0 ? (
          <div className="thread-organizer__empty">
            <strong>No matching threads</strong>
            <span>Search covers titles, workspace names, branches, and status only—not transcript bodies.</span>
            <button
              type="button"
              onClick={() => {
                setThreadQuery("");
                setThreadFilters(new Set());
                setIncludeArchived(false);
                threadSearchInputRef.current?.focus();
              }}
            >
              Clear search and filters
            </button>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={headerCollision} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <SortableContext items={rootGroupIds} strategy={verticalListSortingStrategy}>
              <div className="workspace-list" data-testid="workspace-list">
                {rootGroups.map((group) => (
                  <SortableWorkspaceGroup
                    key={group.rootWorkspace.id}
                    group={group}
                    canDrag={canDrag}
                    selectedWorkspace={selectedWorkspace}
                    selectedSession={selectedSession}
                    linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                    wsMenu={wsMenu}
                    api={api}
                    onArchiveSession={onArchiveSession}
                    onSelectSession={onSelectSession}
                    onUnarchiveSession={onUnarchiveSession}
                    getRuntimeBadgeCount={getRuntimeBadgeCount}
                    pinnedThreadKeys={pinnedThreadKeySet}
                    onTogglePinnedThread={togglePinnedThread}
                    showArchivedResults={organizationActive && includeArchived}
                  />
                ))}
                {orphanGroups.map((group) => (
                  <WorkspaceGroupContent
                    key={group.rootWorkspace.id}
                    group={group}
                    canDrag={false}
                    selectedWorkspace={selectedWorkspace}
                    selectedSession={selectedSession}
                    linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                    wsMenu={wsMenu}
                    api={api}
                    onArchiveSession={onArchiveSession}
                    onSelectSession={onSelectSession}
                    onUnarchiveSession={onUnarchiveSession}
                    getRuntimeBadgeCount={getRuntimeBadgeCount}
                    pinnedThreadKeys={pinnedThreadKeySet}
                    onTogglePinnedThread={togglePinnedThread}
                    showArchivedResults={organizationActive && includeArchived}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeGroup ? (
                <div className="workspace-group workspace-group--overlay">
                  <WorkspaceGroupContent
                    group={activeGroup}
                    canDrag={false}
                    selectedWorkspace={selectedWorkspace}
                    selectedSession={selectedSession}
                    linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                    wsMenu={wsMenu}
                    api={api}
                    onArchiveSession={onArchiveSession}
                    onSelectSession={onSelectSession}
                    onUnarchiveSession={onUnarchiveSession}
                    getRuntimeBadgeCount={getRuntimeBadgeCount}
                    pinnedThreadKeys={pinnedThreadKeySet}
                    onTogglePinnedThread={togglePinnedThread}
                    showArchivedResults={organizationActive && includeArchived}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </aside>
  );
}

/* ── Sortable workspace group wrapper ──────────────────── */

interface WorkspaceGroupProps {
  readonly group: ThreadGroup;
  readonly canDrag: boolean;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly linkedWorktreeByWorkspaceId: Map<string, WorktreeRecord>;
  readonly wsMenu: WorkspaceMenuState;
  readonly api: PiDesktopApi;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onUnarchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly getRuntimeBadgeCount: (session: SessionRecord | undefined) => number;
  readonly pinnedThreadKeys: ReadonlySet<string>;
  readonly onTogglePinnedThread: (key: string) => void;
  readonly showArchivedResults: boolean;
}

function SortableWorkspaceGroup(props: WorkspaceGroupProps) {
  const { group, wsMenu } = props;
  const isRenaming = wsMenu.workspaceRenameId === group.rootWorkspace.id;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.rootWorkspace.id,
    disabled: isRenaming,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : undefined,
  };

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={`workspace-group ${isDragging ? "workspace-group--dragging" : ""}`}
    >
      <WorkspaceGroupContent
        {...props}
        dragHandleProps={props.canDrag && !isRenaming ? { attributes, listeners } : undefined}
      />
    </section>
  );
}

/* ── Workspace group content (used both inline and in overlay) ──── */

interface DragHandleProps {
  readonly attributes: DraggableAttributes;
  readonly listeners: DraggableSyntheticListeners;
}

function WorkspaceGroupContent(
  props: WorkspaceGroupProps & { readonly dragHandleProps?: DragHandleProps },
) {
  const {
    group: { rootWorkspace, threads, archivedThreads },
    selectedWorkspace,
    selectedSession,
    linkedWorktreeByWorkspaceId,
    wsMenu,
    api,
    onArchiveSession,
    onSelectSession,
    onUnarchiveSession,
    getRuntimeBadgeCount,
    pinnedThreadKeys,
    onTogglePinnedThread,
    showArchivedResults,
    dragHandleProps,
  } = props;

  const workspaceActive =
    rootWorkspace.id === selectedWorkspace?.id ||
    rootWorkspace.id === selectedWorkspace?.rootWorkspaceId;
  const linkedWorktree = linkedWorktreeByWorkspaceId.get(rootWorkspace.id);
  const archivedSectionOpen = showArchivedResults || (wsMenu.expandedArchivedByWorkspace[rootWorkspace.id] ?? false);
  const isCollapsed = wsMenu.collapsedWorkspaces[rootWorkspace.id] ?? false;
  const orderedThreads = [...threads].sort((left, right) => {
    const pinDifference = Number(pinnedThreadKeys.has(threadKey(right))) - Number(pinnedThreadKeys.has(threadKey(left)));
    return pinDifference;
  });
  const pinnedThreads = orderedThreads.filter((thread) => pinnedThreadKeys.has(threadKey(thread)));
  const datedThreadGroups = groupThreadsByDate(
    orderedThreads.filter((thread) => !pinnedThreadKeys.has(threadKey(thread))),
  );

  return (
    <>
      <div className={`workspace-row ${workspaceActive ? "workspace-row--active" : ""}`}>
        <button
          className={`workspace-row__select ${dragHandleProps ? "workspace-row__select--draggable" : ""}`}
          onClick={() => wsMenu.toggleWorkspaceCollapsed(rootWorkspace.id)}
          type="button"
          {...(dragHandleProps ? { ...dragHandleProps.attributes, ...dragHandleProps.listeners } : {})}
        >
          <span className="workspace-row__icon" aria-hidden="true" data-collapsed={isCollapsed || undefined}>
            <span className="workspace-row__icon-folder"><FolderIcon /></span>
            <span className="workspace-row__icon-chevron"><ChevronDownIcon /></span>
          </span>
          <span className="workspace-row__name">{rootWorkspace.name}</span>
        </button>
        <span
          className="workspace-row__menu-wrap"
          ref={wsMenu.workspaceMenuId === rootWorkspace.id ? wsMenu.workspaceMenuWrapRef : undefined}
        >
          <button
            aria-label={`Workspace actions for ${rootWorkspace.name}`}
            aria-haspopup="menu"
            className="icon-button workspace-row__menu-button"
            aria-expanded={wsMenu.workspaceMenuId === rootWorkspace.id}
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              wsMenu.openWorkspaceMenu(rootWorkspace.id);
            }}
          >
            …
          </button>
          {wsMenu.workspaceMenuId === rootWorkspace.id ? (
            <div className="workspace-menu">
              <button
                className="workspace-menu__item"
                type="button"
                onClick={(event) =>
                  wsMenu.runWorkspaceMenuAction(event, () => {
                    void api.openWorkspaceInFinder(rootWorkspace.id);
                  })
                }
              >
                Open folder
              </button>
              {linkedWorktree ? (
                <button
                  className="workspace-menu__item workspace-menu__item--danger"
                  type="button"
                  onClick={(event) =>
                    wsMenu.runWorkspaceMenuAction(event, () =>
                      wsMenu.removeWorktree(linkedWorktree.rootWorkspaceId || rootWorkspace.id, linkedWorktree),
                    )
                  }
                >
                  Remove worktree
                </button>
              ) : (
                <button
                  className="workspace-menu__item"
                  type="button"
                  onClick={(event) =>
                    wsMenu.runWorkspaceMenuAction(event, () => wsMenu.createWorktree(rootWorkspace.id))
                  }
                >
                  Create permanent worktree
                </button>
              )}
              <button
                className="workspace-menu__item"
                type="button"
                onClick={(event) => wsMenu.runWorkspaceMenuAction(event, () => wsMenu.startRename(rootWorkspace))}
              >
                Edit name
              </button>
              <button
                className="workspace-menu__item workspace-menu__item--danger"
                type="button"
                onClick={(event) => wsMenu.runWorkspaceMenuAction(event, () => wsMenu.removeWorkspace(rootWorkspace))}
              >
                Remove
              </button>
            </div>
          ) : null}
        </span>
      </div>
      {wsMenu.workspaceRenameId === rootWorkspace.id ? (
        <form
          className="workspace-rename"
          ref={wsMenu.workspaceRenamePanelRef}
          onSubmit={(event) => {
            event.preventDefault();
            wsMenu.submitRename(rootWorkspace);
          }}
        >
          <input
            aria-label={`Rename ${rootWorkspace.name}`}
            className="workspace-rename__input"
            ref={wsMenu.workspaceRenameInputRef}
            value={wsMenu.workspaceRenameDraft}
            onChange={(event) => {
              wsMenu.setWorkspaceRenameDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                wsMenu.cancelRename();
              }
            }}
          />
          <div className="workspace-rename__actions">
            <button className="workspace-rename__button" type="button" onClick={wsMenu.cancelRename}>
              Cancel
            </button>
            <button className="workspace-rename__button workspace-rename__button--primary" type="submit">
              Save
            </button>
          </div>
        </form>
      ) : null}
      {!isCollapsed ? (
        <>
          <div className="session-list">
            {pinnedThreads.length > 0 ? (
              <ThreadDateSection
                label="Pinned"
                threads={pinnedThreads}
                {...{
                  api,
                  selectedWorkspace,
                  selectedSession,
                  onArchiveSession,
                  onSelectSession,
                  getRuntimeBadgeCount,
                  pinnedThreadKeys,
                  onTogglePinnedThread,
                }}
              />
            ) : null}
            {datedThreadGroups.map((dateGroup) => (
              <ThreadDateSection
                key={dateGroup.label}
                label={dateGroup.label}
                threads={dateGroup.threads}
                {...{
                  api,
                  selectedWorkspace,
                  selectedSession,
                  onArchiveSession,
                  onSelectSession,
                  getRuntimeBadgeCount,
                  pinnedThreadKeys,
                  onTogglePinnedThread,
                }}
              />
            ))}
          </div>
          {archivedThreads.length > 0 ? (
            <div className="archived-thread-group">
              <button
                aria-expanded={archivedSectionOpen}
                className="archived-thread-group__toggle"
                type="button"
                onClick={() => wsMenu.toggleArchived(rootWorkspace.id, !archivedSectionOpen)}
              >
                <span
                  aria-hidden="true"
                  className={`archived-thread-group__chevron ${archivedSectionOpen ? "archived-thread-group__chevron--open" : ""}`}
                >
                  <ChevronDownIcon />
                </span>
                <span>Archived</span>
                <span className="archived-thread-group__count">{archivedThreads.length}</span>
              </button>
              {archivedSectionOpen ? (
                <div className="session-list session-list--archived">
                  {archivedThreads.map((thread) => {
                    const active =
                      thread.workspaceId === selectedWorkspace?.id && thread.session.id === selectedSession?.id;
                    return (
                      <ThreadSessionRow
                        key={`${thread.workspaceId}:${thread.session.id}`}
                        active={active}
                        archived
                        thread={thread}
                        onArchive={() => onUnarchiveSession({ workspaceId: thread.workspaceId, sessionId: thread.session.id })}
                        onRename={(title) => void api.renameSession({ workspaceId: thread.workspaceId, sessionId: thread.session.id }, title)}
                        onSelect={() => onSelectSession({ workspaceId: thread.workspaceId, sessionId: thread.session.id })}
                        runtimeBadgeCount={getRuntimeBadgeCount(thread.session)}
                        pinned={pinnedThreadKeys.has(threadKey(thread))}
                        onTogglePinned={() => onTogglePinnedThread(threadKey(thread))}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/* ── Thread session row ────────────────────────────────── */

interface ThreadDateSectionProps {
  readonly label: string;
  readonly threads: readonly ThreadListEntry[];
  readonly api: PiDesktopApi;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly getRuntimeBadgeCount: (session: SessionRecord | undefined) => number;
  readonly pinnedThreadKeys: ReadonlySet<string>;
  readonly onTogglePinnedThread: (key: string) => void;
}

function ThreadDateSection({
  label,
  threads,
  api,
  selectedWorkspace,
  selectedSession,
  onArchiveSession,
  onSelectSession,
  getRuntimeBadgeCount,
  pinnedThreadKeys,
  onTogglePinnedThread,
}: ThreadDateSectionProps) {
  return (
    <>
      <div className="thread-date-section__label">{label}</div>
      {threads.map((thread) => {
        const active = thread.workspaceId === selectedWorkspace?.id && thread.session.id === selectedSession?.id;
        return (
          <ThreadSessionRow
            key={`${thread.workspaceId}:${thread.session.id}`}
            active={active}
            thread={thread}
            onArchive={() => onArchiveSession({ workspaceId: thread.workspaceId, sessionId: thread.session.id })}
            onRename={(title) => void api.renameSession({ workspaceId: thread.workspaceId, sessionId: thread.session.id }, title)}
            onSelect={() => onSelectSession({ workspaceId: thread.workspaceId, sessionId: thread.session.id })}
            runtimeBadgeCount={getRuntimeBadgeCount(thread.session)}
            pinned={pinnedThreadKeys.has(threadKey(thread))}
            onTogglePinned={() => onTogglePinnedThread(threadKey(thread))}
          />
        );
      })}
    </>
  );
}

function sessionIndicatorVariant(thread: ThreadListEntry): "running" | "failed" | "unseen" | "none" {
  if (thread.session.status === "running") return "running";
  if (thread.session.status === "failed") return "failed";
  if (thread.session.hasUnseenUpdate) return "unseen";
  return "none";
}

function ThreadSessionRow({
  active,
  archived = false,
  thread,
  onArchive,
  onRename,
  onSelect,
  onTogglePinned,
  pinned,
  runtimeBadgeCount,
}: {
  readonly active: boolean;
  readonly archived?: boolean;
  readonly thread: ThreadListEntry;
  readonly onArchive: () => void;
  readonly onRename: (title: string) => void;
  readonly onSelect: () => void;
  readonly onTogglePinned: () => void;
  readonly pinned: boolean;
  readonly runtimeBadgeCount: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const menuWrapRef = useRef<HTMLSpanElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const indicatorVariant = sessionIndicatorVariant(thread);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Focus rename input when it opens
  useEffect(() => {
    if (renaming) renameInputRef.current?.select();
  }, [renaming]);

  const startRename = () => {
    setMenuOpen(false);
    setRenameDraft(thread.session.title);
    setRenaming(true);
  };

  const submitRename = () => {
    const t = renameDraft.trim();
    if (t && t !== thread.session.title) onRename(t);
    setRenaming(false);
  };

  const copyTitle = () => {
    setMenuOpen(false);
    void navigator.clipboard.writeText(thread.session.title);
  };

  return (
    <div
      className={`session-row ${active ? "session-row--active" : ""}`}
      data-sidebar-indicator={indicatorVariant}
      data-session-id={thread.session.id}
      data-menu-open={menuOpen || undefined}
    >
      <button className="session-row__select" onClick={onSelect} title={thread.session.title} type="button">
        <span className="session-row__leading" aria-hidden="true">
          {indicatorVariant === "running" ? <span className="session-row__status session-row__status--running" /> : null}
          {indicatorVariant === "failed" ? <span className="session-row__status session-row__status--failed">!</span> : null}
          {indicatorVariant === "unseen" ? <span className="session-row__status session-row__status--unseen" /> : null}
        </span>
        {renaming ? (
          <span className="session-row__rename" onClick={(e) => e.stopPropagation()}>
            <input
              ref={renameInputRef}
              className="session-row__rename-input"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); submitRename(); }
                if (e.key === "Escape") { e.preventDefault(); setRenaming(false); }
              }}
              onBlur={submitRename}
            />
          </span>
        ) : (
          <span className="session-row__body">
            <span className="session-row__title-line">
              <span className="session-row__title">{thread.session.title}</span>
              {pinned ? <span aria-label="Pinned" className="session-row__pin" title="Pinned">★</span> : null}
              {runtimeBadgeCount > 0 ? (
                <span className="session-row__runtime-badge" data-testid="session-runtime-badge">
                  {runtimeBadgeCount}
                </span>
              ) : null}
            </span>
            {thread.session.preview ? <span className="session-row__preview">{thread.session.preview}</span> : null}
            {indicatorVariant !== "none" ? (
              <span className="sr-only">
                {indicatorVariant === "running" ? "Running" : indicatorVariant === "failed" ? "Failed" : "Unread update"}
              </span>
            ) : null}
          </span>
        )}
      </button>
      <span className="session-row__trailing">
        {thread.environment.kind === "worktree" && !renaming ? (
          <span className="session-row__workspace-icon" aria-hidden="true" title="Worktree">
            <WorktreeIcon />
          </span>
        ) : null}
        {!renaming && (
          <time
            aria-label={`Updated ${formatExactLocalTime(thread.session.updatedAt)}`}
            className="session-row__time"
            dateTime={thread.session.updatedAt}
            tabIndex={0}
            title={formatExactLocalTime(thread.session.updatedAt)}
          >
            {formatRelativeTime(thread.session.updatedAt)}
          </time>
        )}
        {!renaming && (
          <span className="session-row__menu-wrap" ref={menuWrapRef}>
            <button
              aria-label={`Thread actions for ${thread.session.title}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="icon-button session-row__action"
              type="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
            >
              …
            </button>
            {menuOpen && (
              <div className="session-row__menu" role="menu">
                <button className="session-row__menu-item" type="button" role="menuitem" onClick={startRename}>
                  Rename
                </button>
                <button
                  className="session-row__menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); onTogglePinned(); }}
                >
                  {pinned ? "Unpin" : "Pin"}
                </button>
                <button
                  className="session-row__menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); onArchive(); }}
                >
                  {archived ? "Restore" : "Archive"}
                </button>
                <button className="session-row__menu-item" type="button" role="menuitem" onClick={copyTitle}>
                  Copy title
                </button>
              </div>
            )}
          </span>
        )}
      </span>
    </div>
  );
}
