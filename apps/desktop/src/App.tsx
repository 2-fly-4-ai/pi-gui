import type * as React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type Dispatch, type DragEvent, type KeyboardEvent, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import { DEFAULT_TOOL_ACCESS, type ToolAccessSelection } from "@pi-gui/session-driver";
import type { SessionTreeSnapshot } from "@pi-gui/session-driver/types";
import type { RuntimeSkillProfileRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import {
  getSelectedSession,
  getSelectedWorkspace,
  type AppView,
  type ComposerAttachment,
  type ComposerImageAttachment,
  type DesktopAppState,
  type NewThreadEnvironment,
  type SelectedTranscriptRecord,
  type StartThreadInput,
  type WorktreeRecord,
  type WorkspaceRecord,
} from "./desktop-state";
import type { AgentDefinitionsSnapshot, DeleteAgentDefinitionInput, ResetAgentDefinitionInput, SaveAgentDefinitionInput } from "./agent-definitions";
import { AddActionDialog } from "./add-action-dialog";
import { CommandPalette } from "./command-palette";
import type { CommandPaletteAction } from "./command-palette-model";
import { ComposerPanel } from "./composer-panel";
import { CheckoutSelector, type CheckoutSelectorOption } from "./checkout-selector";
import { DiffPanel, type DiffPanelFileRequest } from "./diff-panel";
import { PlanPanel } from "./plan-panel";
import { buildImplementPlanPrompt, detectLatestPlan } from "./plan-panel-model";
import { buildModelOptions } from "./composer-commands";
import { parseTreeComposerCommand } from "./composer-commands";
import { findSubmittedSkillPath, loadSkillUsage, recordSkillUse, saveSkillUsage, type SkillUsageByPath } from "./skill-usage";
import {
  desktopCommands,
  getDesktopCommandFromShortcut,
  getDesktopShortcutLabel,
  type DesktopNotificationPermissionStatus,
  type PiDesktopCommand,
} from "./ipc";
import { deriveModelOnboardingState } from "./model-onboarding";
import { SkillsView } from "./skills-view";
import { SkillProfileSelector } from "./skill-profile-selector";
import { ExtensionsView } from "./extensions-view";
import { SettingsView, type SettingsSection } from "./settings-view";
import { SecondarySurface } from "./secondary-surface";
import { DisplayModeView } from "./display-mode-view";
import { NewThreadView } from "./new-thread-view";
import { ReviewSurface } from "./review/ReviewSurface";
import type { ReviewSnapshot } from "./review/review-types";
import { VSCodePanel } from "./vscode-panel";
import { CommitDialog, CreatePrDialog, PushDialog, isSetUpstreamError, type ChangedFileSummaryItem } from "./git-action-dialogs";
import { createProjectAction, loadProjectActions, saveProjectActions, type ProjectActionRecord, type ProjectActionsByWorkspace } from "./project-actions";
import { buildThreadGroups } from "./thread-groups";
import { Sidebar } from "./sidebar";
import { SidebarToggleButton } from "./sidebar-toggle-button";
import { Topbar } from "./topbar";
import { TerminalPanel } from "./terminal-panel";
import { appendComposerContext } from "./terminal-selection-context";
import { ConversationTimeline, VIRTUALIZATION_THRESHOLD } from "./conversation-timeline";
import { useSlashMenu } from "./hooks/use-slash-menu";
import { useMentionMenu } from "./hooks/use-mention-menu";
import { useThreadSearch } from "./hooks/use-thread-search";
import { useWorkspaceMenu } from "./hooks/use-workspace-menu";
import { buildExtensionDockModel, ExtensionDialog, hasExtensionDockContent } from "./extension-session-ui";
import { TreeModal } from "./tree-modal";
import { getEffectiveModelRuntime } from "./model-settings";
import { resolveRepoWorkspaceId } from "./workspace-roots";
import {
  extractImageFilesFromClipboardData,
  extractFilesFromDataTransfer,
  readComposerAttachmentsFromFiles,
} from "./composer-attachments";
import { normalizeToolAccess } from "./tool-access";
import {
  clampVsCodeSidePanelWidth,
  getInitialVsCodeSidePanelWidth,
  getMaxVsCodeSidePanelWidth,
  getMinVsCodeSidePanelWidth,
  storeVsCodeSidePanelWidth,
} from "./vscode-panel-width";

function useDesktopAppState() {
  const [snapshot, setSnapshot] = useState<DesktopAppState | null>(null);
  const [selectedTranscript, setSelectedTranscript] = useState<SelectedTranscriptRecord | null>(null);

  useEffect(() => {
    let active = true;
    const api = window.piApp;
    if (!api) {
      return undefined;
    }

    void Promise.all([api.getState(), api.getSelectedTranscript()]).then(([state, transcript]) => {
      if (!active) {
        return;
      }
      setSnapshot(state);
      setSelectedTranscript(transcript);
    });

    const unsubscribeState = api.onStateChanged((state) => {
      if (active) {
        setSnapshot(state);
      }
    });
    const unsubscribeTranscript = api.onSelectedTranscriptChanged((payload) => {
      if (active) {
        setSelectedTranscript(payload);
      }
    });

    return () => {
      active = false;
      unsubscribeState();
      unsubscribeTranscript();
    };
  }, []);

  useEffect(() => {
    const api = window.piApp;
    if (!api) {
      return undefined;
    }

    const expectedWorkspaceId = snapshot?.selectedWorkspaceId;
    const expectedSessionId = snapshot?.selectedSessionId;
    if (!expectedWorkspaceId || !expectedSessionId) {
      setSelectedTranscript(null);
      return undefined;
    }

    let active = true;
    void api.getSelectedTranscript().then((transcript) => {
      if (!active) {
        return;
      }
      if (
        transcript &&
        transcript.workspaceId === expectedWorkspaceId &&
        transcript.sessionId === expectedSessionId
      ) {
        setSelectedTranscript(transcript);
      }
    });

    return () => {
      active = false;
    };
  }, [snapshot?.activeView, snapshot?.selectedWorkspaceId, snapshot?.selectedSessionId]);

  return [snapshot, setSnapshot, selectedTranscript] as const;
}

function updateSnapshot(
  api: NonNullable<typeof window.piApp>,
  setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
  action: () => Promise<DesktopAppState>,
) {
  return action().then((state) => {
    setSnapshot(state);
    return state;
  });
}

function isEventInsideTerminal(event: globalThis.KeyboardEvent): boolean {
  const target = event.target;
  return target instanceof Element && Boolean(target.closest("[data-pi-terminal]"));
}

function canTogglePrimarySidebar(view: AppView | undefined): boolean {
  return view === "threads" || view === "new-thread" || view === "display-mode";
}

function useRunningLabel(startedAt: string | undefined) {
  const [label, setLabel] = useState(() => formatRunningLabel(startedAt));

  useEffect(() => {
    setLabel(formatRunningLabel(startedAt));
    if (!startedAt) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setLabel(formatRunningLabel(startedAt));
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [startedAt]);

  return label;
}

function formatRunningLabel(startedAt: string | undefined): string {
  if (!startedAt) {
    return "Working…";
  }

  const diffMs = Math.max(0, Date.now() - Date.parse(startedAt));
  const seconds = Math.max(1, Math.floor(diffMs / 1000));
  if (seconds < 60) {
    return `Working for ${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining === 0 ? `Working for ${minutes}m` : `Working for ${minutes}m ${remaining}s`;
}

export default function App() {
  const [snapshot, setSnapshot, selectedTranscript] = useDesktopAppState();
  const [composerDraft, setComposerDraft] = useState("");
  const [skillUsageByPath, setSkillUsageByPath] = useState<SkillUsageByPath>(() => loadSkillUsage());
  const [projectActionsByWorkspace, setProjectActionsByWorkspace] = useState<ProjectActionsByWorkspace>(() => loadProjectActions());
  const [agentDefinitions, setAgentDefinitions] = useState<AgentDefinitionsSnapshot | undefined>();
  const [agentDefinitionsPending, setAgentDefinitionsPending] = useState(false);
  const [agentDefinitionsError, setAgentDefinitionsError] = useState<string | undefined>();
  const [addActionDialogOpen, setAddActionDialogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState("");
  const [skillsWorkspaceId, setSkillsWorkspaceId] = useState("");
  const [extensionsWorkspaceId, setExtensionsWorkspaceId] = useState("");
  const [pendingNewThreadWorkspaceId, setPendingNewThreadWorkspaceId] = useState("");
  const [newThreadRootWorkspaceId, setNewThreadRootWorkspaceId] = useState("");
  const [newThreadEnvironment, setNewThreadEnvironment] = useState<NewThreadEnvironment>("local");
  const [newThreadPrompt, setNewThreadPrompt] = useState("");
  const [newThreadAttachments, setNewThreadAttachments] = useState<readonly ComposerAttachment[]>([]);
  const [newThreadProvider, setNewThreadProvider] = useState<string | undefined>();
  const [newThreadModelId, setNewThreadModelId] = useState<string | undefined>();
  const [newThreadThinkingLevel, setNewThreadThinkingLevel] = useState<string | undefined>();
  const [newThreadToolAccess, setNewThreadToolAccess] = useState<ToolAccessSelection>(DEFAULT_TOOL_ACCESS);
  const [newThreadFastMode, setNewThreadFastMode] = useState<"auto" | "on" | "off">("auto");
  const [newThreadComposerError, setNewThreadComposerError] = useState<string | undefined>();
  const [themeMode, setThemeMode] = useState<"system" | "light" | "dark">("system");
  const [notificationPermissionStatus, setNotificationPermissionStatus] =
    useState<DesktopNotificationPermissionStatus>("unknown");
  const [notificationPermissionPending, setNotificationPermissionPending] = useState(false);
  const [dockExpandedBySession, setDockExpandedBySession] = useState<Record<string, boolean>>({});
  const [reviewSnapshot, setReviewSnapshot] = useState<ReviewSnapshot | undefined>();
  const [reviewLoading, setReviewLoading] = useState(false);
  const [treeModalState, setTreeModalState] = useState<{
    readonly open: boolean;
    readonly loading: boolean;
    readonly submitting: boolean;
    readonly tree?: SessionTreeSnapshot;
    readonly error?: string;
  }>({
    open: false,
    loading: false,
    submitting: false,
  });
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const newThreadComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const timelinePaneRef = useRef<HTMLDivElement | null>(null);
  const lastTranscriptMarkerRef = useRef("");
  const pinnedToBottomRef = useRef(true);
  const followingLatestRef = useRef(true);
  const autoAligningTimelineRef = useRef(false);
  const manualTimelineScrollRestoreRef = useRef(false);
  const userTimelineScrollIntentRef = useRef(false);
  const timelineScrollHandlerRef = useRef<() => void>(() => undefined);
  const manualTimelineScrollTopRef = useRef<number | null>(null);
  const previousTimelinePaneSizeRef = useRef<{ width: number; height: number } | null>(null);
  const lastTimelineScrollTopBySessionRef = useRef(new Map<string, number>());
  const lastTimelinePinnedBySessionRef = useRef(new Map<string, boolean>());
  const preserveBottomOnNextPaneResizeRef = useRef(false);
  const exactBottomRestoreSessionKeyRef = useRef<string | null>(null);
  const deferredPinnedBottomAlignmentRef = useRef(false);
  const pendingPinnedBottomBehaviorRef = useRef<ScrollBehavior>("auto");
  const previousActiveViewRef = useRef<AppView | null>(null);
  const hydratedComposerSessionKeyRef = useRef("");
  const handledComposerSyncNonceRef = useRef(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const [planPanelOpen, setPlanPanelOpen] = useState(false);
  const [dmDrawerOpen, setDmDrawerOpen] = useState(() => { try { return localStorage.getItem("dm:drawerOpen") !== "false"; } catch { return true; } });
  const toggleDmDrawer = useCallback(() => { setDmDrawerOpen((o) => { try { localStorage.setItem("dm:drawerOpen", String(!o)); } catch {} return !o; }); }, []);
  const [displayModeInitialPinnedThreadKey, setDisplayModeInitialPinnedThreadKey] = useState("");
  const [vsCodeOpen, setVsCodeOpen] = useState(false);
  const [vsCodeWorkspaceId, setVsCodeWorkspaceId] = useState<string | null>(null);
  const [vsCodeFolderPath, setVsCodeFolderPath] = useState<string | null>(null);
  const [vsCodeSlotElement, setVsCodeSlotElement] = useState<HTMLElement | null>(null);
  const [vsCodePanelStyle, setVsCodePanelStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  const [threadVsCodeWidth, setThreadVsCodeWidth] = useState(() => getInitialVsCodeSidePanelWidth());
  const threadVsCodeWidthRef = useRef(threadVsCodeWidth);
  const setThreadVsCodeCssWidth = useCallback((width: number) => {
    mainRef.current?.style.setProperty("--thread-vscode-width", `${width}px`);
  }, []);
  const getThreadVsCodeContainerWidth = useCallback(() => mainRef.current?.getBoundingClientRect().width ?? window.innerWidth, []);
  const applyThreadVsCodeWidth = useCallback((width: number, containerWidth = getThreadVsCodeContainerWidth()) => {
    const nextWidth = clampVsCodeSidePanelWidth(width, containerWidth);
    threadVsCodeWidthRef.current = nextWidth;
    setThreadVsCodeCssWidth(nextWidth);
    return nextWidth;
  }, [getThreadVsCodeContainerWidth, setThreadVsCodeCssWidth]);
  const setSharedVsCodeWidth = useCallback((width: number) => {
    threadVsCodeWidthRef.current = width;
    setThreadVsCodeCssWidth(width);
    flushSync(() => {
      setThreadVsCodeWidth(width);
    });
  }, [setThreadVsCodeCssWidth]);
  const toggleVsCode = useCallback(() => setVsCodeOpen((o) => !o), []);
  const openVsCodeForWorkspace = useCallback((workspaceId: string, folderPath: string) => {
    setVsCodeWorkspaceId(workspaceId);
    setVsCodeFolderPath(folderPath);
    setVsCodeOpen(true);
  }, []);
  const startThreadVsCodeResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = threadVsCodeWidthRef.current;
    const containerWidth = getThreadVsCodeContainerWidth();

    const onMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      applyThreadVsCodeWidth(startWidth + delta, containerWidth);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setThreadVsCodeWidth(threadVsCodeWidthRef.current);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [applyThreadVsCodeWidth, getThreadVsCodeContainerWidth]);
  const handleThreadVsCodeResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const containerWidth = getThreadVsCodeContainerWidth();
    let nextWidth: number | undefined;

    switch (event.key) {
      case "ArrowLeft":
        nextWidth = threadVsCodeWidthRef.current + 24;
        break;
      case "ArrowRight":
        nextWidth = threadVsCodeWidthRef.current - 24;
        break;
      case "Home":
        nextWidth = getMinVsCodeSidePanelWidth(containerWidth);
        break;
      case "End":
        nextWidth = getMaxVsCodeSidePanelWidth(containerWidth);
        break;
      default:
        return;
    }

    event.preventDefault();
    setThreadVsCodeWidth(applyThreadVsCodeWidth(nextWidth, containerWidth));
  }, [applyThreadVsCodeWidth, getThreadVsCodeContainerWidth]);
  const [openTerminalSessionKeys, setOpenTerminalSessionKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [takeoverTerminalSessionKeys, setTakeoverTerminalSessionKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [activeTerminalSessionKey, setActiveTerminalSessionKey] = useState("");
  const [terminalHeight, setTerminalHeight] = useState(340);
  const [gitDialog, setGitDialog] = useState<"commit" | "push" | "pr" | null>(null);
  const [gitChangedFiles, setGitChangedFiles] = useState<readonly ChangedFileSummaryItem[]>([]);
  const [gitBranchName, setGitBranchName] = useState<string | undefined>();
  const [gitActionPending, setGitActionPending] = useState(false);
  const [gitActionError, setGitActionError] = useState<string | undefined>();
  const [diffFileRequest, setDiffFileRequest] = useState<DiffPanelFileRequest | null>(null);
  const [timelinePaneMountVersion, setTimelinePaneMountVersion] = useState(0);
  const [disableTimelineVirtualization, setDisableTimelineVirtualization] = useState(true);
  const threadSearch = useThreadSearch(timelinePaneRef);
  const api = window.piApp;
  const sidebarToggleStateRef = useRef<{
    readonly api: typeof window.piApp;
    readonly activeView: AppView | undefined;
    readonly sidebarCollapsed: boolean;
  }>({
    api,
    activeView: undefined,
    sidebarCollapsed: false,
  });
  sidebarToggleStateRef.current = {
    api,
    activeView: snapshot?.activeView,
    sidebarCollapsed: snapshot?.sidebarCollapsed ?? false,
  };

  useEffect(() => {
    threadVsCodeWidthRef.current = threadVsCodeWidth;
    setThreadVsCodeCssWidth(threadVsCodeWidth);
    storeVsCodeSidePanelWidth(threadVsCodeWidth);
  }, [setThreadVsCodeCssWidth, threadVsCodeWidth]);

  useLayoutEffect(() => {
    if (!vsCodeOpen || !vsCodeSlotElement) {
      setVsCodePanelStyle({ visibility: "hidden" });
      return undefined;
    }

    let animationFrame = 0;
    const updatePosition = () => {
      const rect = vsCodeSlotElement.getBoundingClientRect();
      setVsCodePanelStyle({
        position: "fixed",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        visibility: rect.width > 0 && rect.height > 0 ? "visible" : "hidden",
      });
    };
    const scheduleUpdate = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(updatePosition);
    };

    updatePosition();
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(vsCodeSlotElement);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    animationFrame = requestAnimationFrame(updatePosition);

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
    };
  }, [dmDrawerOpen, snapshot?.activeView, snapshot?.sidebarCollapsed, threadVsCodeWidth, vsCodeOpen, vsCodeSlotElement]);

  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi) return;

    void piApi.getResolvedTheme().then((theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
    });

    void piApi.getThemeMode().then((mode) => {
      setThemeMode(mode);
    });

    const unsub = piApi.onThemeChanged((theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
    });

    return unsub;
  }, []);

  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi?.onNotificationPermissionStatusChanged) {
      return;
    }

    return piApi.onNotificationPermissionStatusChanged((status) => {
      setNotificationPermissionStatus(status);
    });
  }, []);

  const refreshNotificationPermissionStatus = useCallback(() => {
    if (!api?.getNotificationPermissionStatus) {
      return Promise.resolve("unknown" as DesktopNotificationPermissionStatus);
    }

    return api.getNotificationPermissionStatus().then((status) => {
      setNotificationPermissionStatus(status);
      return status;
    });
  }, [api]);

  useEffect(() => {
    if (snapshot?.activeView !== "settings" || settingsSection !== "notifications") {
      return undefined;
    }

    void refreshNotificationPermissionStatus();
    return undefined;
  }, [refreshNotificationPermissionStatus, settingsSection, snapshot?.activeView]);

  const selectedWorkspace = snapshot ? (getSelectedWorkspace(snapshot) ?? snapshot.workspaces[0]) : undefined;
  const selectedSession = snapshot ? (getSelectedSession(snapshot) ?? selectedWorkspace?.sessions[0]) : undefined;

  const toggleSelectedWorkspaceVsCode = useCallback(() => {
    if (!selectedWorkspace) return;
    setVsCodeWorkspaceId(selectedWorkspace.id);
    setVsCodeFolderPath(selectedWorkspace.path);
    setVsCodeOpen((open) => {
      const alreadyTargetingSelected = vsCodeWorkspaceId === selectedWorkspace.id && vsCodeFolderPath === selectedWorkspace.path;
      return alreadyTargetingSelected ? !open : true;
    });
  }, [selectedWorkspace, vsCodeFolderPath, vsCodeWorkspaceId]);
  const {
    activeWorktrees,
    linkedWorktreeByWorkspaceId,
    rootWorkspace,
    rootWorkspaceOptions,
    visibleWorkspaces,
  } = useMemo(() => {
    if (!snapshot) {
      return {
        activeWorktrees: [] as readonly WorktreeRecord[],
        linkedWorktreeByWorkspaceId: new Map<string, WorktreeRecord>(),
        rootWorkspace: undefined as WorkspaceRecord | undefined,
        rootWorkspaceOptions: [] as readonly WorkspaceRecord[],
        visibleWorkspaces: [] as readonly WorkspaceRecord[],
      };
    }

    const workspacesById = new Map(snapshot.workspaces.map((workspace) => [workspace.id, workspace] as const));
    const primaryWorkspaces = snapshot.workspaces.filter((workspace) => workspace.kind === "primary");
    const orphanWorkspaces = snapshot.workspaces.filter(
      (workspace) => workspace.kind === "worktree" && !workspacesById.has(workspace.rootWorkspaceId ?? ""),
    );
    const nextVisibleWorkspaces =
      primaryWorkspaces.length > 0 ? [...primaryWorkspaces, ...orphanWorkspaces] : snapshot.workspaces;
    const nextLinkedWorktreeByWorkspaceId = new Map(
      Object.values(snapshot.worktreesByWorkspace)
        .flat()
        .filter((worktree) => Boolean(worktree.linkedWorkspaceId))
        .map((worktree) => [worktree.linkedWorkspaceId as string, worktree] as const),
    );
    const nextRootWorkspaceId = resolveRepoWorkspaceId(snapshot.workspaces, selectedWorkspace?.id);
    const nextRootWorkspace =
      (nextRootWorkspaceId ? snapshot.workspaces.find((workspace) => workspace.id === nextRootWorkspaceId) : undefined)
      ?? selectedWorkspace;
    const nextRootWorkspaceOptions = [...new Set(snapshot.workspaces.map((workspace) => resolveRepoWorkspaceId(snapshot.workspaces, workspace.id) ?? workspace.id))]
      .map((workspaceId) => snapshot.workspaces.find((workspace) => workspace.id === workspaceId))
      .filter((workspace): workspace is WorkspaceRecord => Boolean(workspace));

    return {
      activeWorktrees: nextRootWorkspace ? snapshot.worktreesByWorkspace[nextRootWorkspace.id] ?? [] : [],
      linkedWorktreeByWorkspaceId: nextLinkedWorktreeByWorkspaceId,
      rootWorkspace: nextRootWorkspace,
      rootWorkspaceOptions: nextRootWorkspaceOptions,
      visibleWorkspaces: nextVisibleWorkspaces,
    };
  }, [selectedWorkspace, snapshot]);
  const selectedRuntime = selectedWorkspace ? snapshot?.runtimeByWorkspace[selectedWorkspace.id] : undefined;
  const selectedModelRuntime = snapshot ? getEffectiveModelRuntime(snapshot, selectedWorkspace) : undefined;
  const selectedWorktree = selectedWorkspace ? linkedWorktreeByWorkspaceId.get(selectedWorkspace.id) : undefined;
  const settingsWorkspace = settingsWorkspaceId
    ? rootWorkspaceOptions.find((workspace) => workspace.id === settingsWorkspaceId)
    : undefined;
  const skillsWorkspace = skillsWorkspaceId
    ? rootWorkspaceOptions.find((workspace) => workspace.id === skillsWorkspaceId)
    : undefined;
  const extensionsWorkspace = extensionsWorkspaceId
    ? rootWorkspaceOptions.find((workspace) => workspace.id === extensionsWorkspaceId)
    : undefined;
  const settingsRuntime = settingsWorkspace ? snapshot?.runtimeByWorkspace[settingsWorkspace.id] : undefined;
  const settingsModelRuntime = snapshot ? getEffectiveModelRuntime(snapshot, settingsWorkspace) : undefined;
  const loadAgentDefinitions = useCallback((workspaceId?: string) => {
    if (!api || !workspaceId) {
      setAgentDefinitions(undefined);
      return;
    }
    setAgentDefinitionsPending(true);
    setAgentDefinitionsError(undefined);
    void api.listAgentDefinitions(workspaceId).then(setAgentDefinitions).catch((error) => {
      setAgentDefinitionsError(error instanceof Error ? error.message : String(error));
      console.warn("Failed to load agent definitions", error);
    }).finally(() => setAgentDefinitionsPending(false));
  }, [api]);

  useEffect(() => {
    if (snapshot?.activeView === "settings" && settingsSection === "agents") {
      loadAgentDefinitions(settingsWorkspace?.id);
    }
  }, [loadAgentDefinitions, settingsSection, settingsWorkspace?.id, snapshot?.activeView]);

  const skillsRuntime = skillsWorkspace ? snapshot?.runtimeByWorkspace[skillsWorkspace.id] : undefined;
  const extensionsRuntime = extensionsWorkspace ? snapshot?.runtimeByWorkspace[extensionsWorkspace.id] : undefined;
  const extensionsCommandCompatibility = extensionsWorkspace
    ? snapshot?.extensionCommandCompatibilityByWorkspace[extensionsWorkspace.id] ?? []
    : [];
  const newThreadWorkspace =
    rootWorkspaceOptions.find((entry) => entry.id === newThreadRootWorkspaceId) ?? rootWorkspaceOptions[0];
  const newThreadRuntime = snapshot ? getEffectiveModelRuntime(snapshot, newThreadWorkspace) : undefined;
  const newThreadDefaultEnabled = buildModelOptions(newThreadRuntime).some(
    (m) => m.providerId === newThreadRuntime?.settings.defaultProvider && m.modelId === newThreadRuntime?.settings.defaultModelId,
  );
  const selectedDefaultEnabled = buildModelOptions(selectedModelRuntime).some(
    (m) => m.providerId === selectedModelRuntime?.settings.defaultProvider && m.modelId === selectedModelRuntime?.settings.defaultModelId,
  );
  const resolvedSessionProvider =
    selectedSession?.config?.provider ??
    (selectedDefaultEnabled ? selectedModelRuntime?.settings.defaultProvider : undefined);
  const resolvedSessionModelId =
    selectedSession?.config?.modelId ??
    (selectedDefaultEnabled ? selectedModelRuntime?.settings.defaultModelId : undefined);
  const resolvedSessionThinkingLevel =
    selectedSession?.config?.thinkingLevel ?? selectedModelRuntime?.settings.defaultThinkingLevel;
  const resolvedNewThreadProvider = newThreadProvider ?? (newThreadDefaultEnabled ? newThreadRuntime?.settings.defaultProvider : undefined);
  const resolvedNewThreadModelId = newThreadModelId ?? (newThreadDefaultEnabled ? newThreadRuntime?.settings.defaultModelId : undefined);
  const resolvedNewThreadThinkingLevel = newThreadThinkingLevel ?? newThreadRuntime?.settings.defaultThinkingLevel;
  const resolvedNewThreadToolAccess = normalizeToolAccess(newThreadToolAccess);
  const selectedSessionModelOnboarding = deriveModelOnboardingState(selectedModelRuntime, {
    provider: resolvedSessionProvider,
    modelId: resolvedSessionModelId,
  });
  const newThreadModelOnboarding = deriveModelOnboardingState(newThreadRuntime, {
    provider: resolvedNewThreadProvider,
    modelId: resolvedNewThreadModelId,
  });
  const [attachmentsClearedOnSubmit, setAttachmentsClearedOnSubmit] = useState(false);
  const composerAttachments = attachmentsClearedOnSubmit ? [] : (snapshot?.composerAttachments ?? []);
  const queuedComposerMessages = snapshot?.queuedComposerMessages ?? [];
  const editingQueuedMessageId = snapshot?.editingQueuedMessageId;
  const runningLabel = useRunningLabel(selectedSession?.status === "running" ? selectedSession.runningSince : undefined);
  const selectedSessionKey = selectedWorkspace && selectedSession ? `${selectedWorkspace.id}:${selectedSession.id}` : "";
  const resolvedSessionToolAccess = normalizeToolAccess(selectedSession?.config?.toolAccess);
  const isTerminalVisibleForSelectedThread = Boolean(selectedSessionKey) && openTerminalSessionKeys.has(selectedSessionKey);
  const openTerminalTargets = useMemo(() => {
    if (!snapshot) return [];
    return [...openTerminalSessionKeys].flatMap((key) => {
      const parsed = parseTerminalSessionKey(key);
      if (!parsed) return [];
      const workspace = snapshot.workspaces.find((entry) => entry.id === parsed.workspaceId);
      const session = workspace?.sessions.find((entry) => entry.id === parsed.sessionId);
      return workspace && session ? [{ key, workspace, session }] : [];
    });
  }, [openTerminalSessionKeys, snapshot]);
  const visibleTerminalKey = openTerminalSessionKeys.has(activeTerminalSessionKey)
    ? activeTerminalSessionKey
    : isTerminalVisibleForSelectedThread
      ? selectedSessionKey
      : openTerminalTargets[0]?.key ?? "";
  const visibleTerminalTarget = openTerminalTargets.find((target) => target.key === visibleTerminalKey);
  const isTerminalVisible = Boolean(visibleTerminalTarget);
  const isVisibleTerminalTakeover = Boolean(visibleTerminalKey) && takeoverTerminalSessionKeys.has(visibleTerminalKey);
  const rawActiveTranscript =
    selectedTranscript &&
    selectedWorkspace &&
    selectedSession &&
    selectedTranscript.workspaceId === selectedWorkspace.id &&
    selectedTranscript.sessionId === selectedSession.id
      ? selectedTranscript.transcript
      : [];
  const showThinking = snapshot?.showThinking ?? false;
  const showThinkingRequestRef = useRef(showThinking);
  showThinkingRequestRef.current = showThinking;
  const thinkingActive = rawActiveTranscript.some((item) => item.kind === "thinking" && item.status === "running");
  const activeTranscript = showThinking
    ? rawActiveTranscript
    : rawActiveTranscript.filter((item) => item.kind !== "thinking");
  const activeTranscriptMarker = buildTranscriptChangeMarker(selectedSessionKey, activeTranscript);
  const latestPlan = useMemo(() => detectLatestPlan(rawActiveTranscript), [rawActiveTranscript, activeTranscriptMarker]);
  const planSurfaceAvailable = snapshot?.activeView === "threads" && Boolean(selectedWorkspace && selectedSession && latestPlan);
  const isTranscriptLoading = Boolean(selectedSession) && activeTranscript.length === 0 && (
    !selectedTranscript ||
    selectedTranscript.workspaceId !== selectedWorkspace?.id ||
    selectedTranscript.sessionId !== selectedSession?.id
  );
  const selectedSessionCommands = selectedSession ? snapshot?.sessionCommandsBySession[selectedSessionKey] ?? [] : [];
  const selectedExtensionUi = selectedSession ? snapshot?.sessionExtensionUiBySession[selectedSessionKey] : undefined;
  const selectedWorkspaceCommandCompatibility = selectedWorkspace
    ? snapshot?.extensionCommandCompatibilityByWorkspace[selectedWorkspace.id] ?? []
    : [];

  useEffect(() => {
    if (!planSurfaceAvailable) {
      setPlanPanelOpen(false);
    }
  }, [planSurfaceAvailable]);

  useEffect(() => {
    if (!api || snapshot?.activeView !== "review" || !selectedWorkspace) {
      return;
    }

    let cancelled = false;
    setReviewLoading(true);
    setReviewSnapshot(undefined);
    void api.createReviewSnapshot(selectedWorkspace.id, snapshot.reviewRequest)
      .then((next) => {
        if (cancelled) {
          return;
        }

        setReviewSnapshot(next);
        setReviewLoading(false);

        if (!snapshot.reviewRequest?.agent || !selectedSession) {
          return;
        }

        void api.runReviewAgentPreReview(selectedWorkspace.id, selectedSession.id, next)
          .then((agentComments) => {
            if (!cancelled) {
              setReviewSnapshot((current) => current?.id === next.id ? { ...current, agentComments } : current);
            }
          });
      })
      .finally(() => {
        if (!cancelled) {
          setReviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, selectedSession?.id, selectedWorkspace?.id, snapshot?.activeView, snapshot?.reviewRequest]);

  useEffect(() => {
    if (snapshot && snapshot.workspaces.length === 0) {
      setOpenTerminalSessionKeys(new Set());
      setTakeoverTerminalSessionKeys(new Set());
    }
  }, [snapshot]);
  useEffect(() => {
    if (snapshot?.activeView !== "display-mode" && selectedSessionKey && openTerminalSessionKeys.has(selectedSessionKey)) {
      setActiveTerminalSessionKey(selectedSessionKey);
    }
  }, [openTerminalSessionKeys, selectedSessionKey, snapshot?.activeView]);
  const selectedProjectActions = selectedWorkspace ? projectActionsByWorkspace[selectedWorkspace.rootWorkspaceId || selectedWorkspace.id] ?? [] : [];
  const newThreadProjectActions = newThreadWorkspace ? projectActionsByWorkspace[newThreadWorkspace.rootWorkspaceId || newThreadWorkspace.id] ?? [] : [];
  const topbarProjectActions = snapshot?.activeView === "new-thread" ? newThreadProjectActions : selectedProjectActions;
  const selectedExtensionDock = useMemo(() => buildExtensionDockModel(selectedExtensionUi), [selectedExtensionUi]);
  const displayedSessionTitle = selectedExtensionUi?.title ?? selectedSession?.title ?? "";
  const activeExtensionDialog = selectedExtensionUi?.pendingDialogs[0];
  const isSelectedExtensionDockExpanded = dockExpandedBySession[selectedSessionKey] ?? false;
  const persistedComposerDraft = snapshot?.composerDraft ?? "";
  const threadGroups = useMemo(
    () => (snapshot ? buildThreadGroups(snapshot) : []),
    [snapshot?.workspaces, snapshot?.worktreesByWorkspace, snapshot?.workspaceOrder],
  );
  const focusComposer = () => {
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  };
  const recordSubmittedSkillUsage = (text: string, runtime: RuntimeSnapshot | undefined) => {
    const skillPath = findSubmittedSkillPath(text, runtime);
    if (!skillPath) {
      return;
    }
    setSkillUsageByPath((current) => {
      const next = recordSkillUse(current, skillPath);
      saveSkillUsage(next);
      return next;
    });
  };
  const openAddActionDialog = useCallback(() => {
    setAddActionDialogOpen(true);
  }, []);

  const saveProjectAction = (input: {
    readonly name: string;
    readonly command: string;
    readonly keybinding?: string;
    readonly runOnWorktreeCreation: boolean;
  }) => {
    const targetWorkspace = snapshot?.activeView === "new-thread" ? newThreadWorkspace : selectedWorkspace;
    const workspaceId = targetWorkspace?.rootWorkspaceId || targetWorkspace?.id;
    if (!workspaceId) {
      return;
    }
    const action = createProjectAction({ workspaceId, ...input });
    setProjectActionsByWorkspace((current) => {
      const next = {
        ...current,
        [workspaceId]: [...(current[workspaceId] ?? []), action],
      };
      saveProjectActions(next);
      return next;
    });
    setAddActionDialogOpen(false);
  };

  const runProjectAction = (action: ProjectActionRecord) => {
    if (!api || !selectedWorkspace || !selectedSession) {
      return;
    }
    setOpenTerminalSessionKeys((current) => {
      const next = new Set(current);
      next.add(selectedSessionKey);
      return next;
    });
    setActiveTerminalSessionKey(selectedSessionKey);
    void api.ensureTerminalPanel(selectedWorkspace.id, selectedSession.id, { cols: 80, rows: 24 }).then((panel) => {
      const terminalId = panel.activeSessionId;
      if (terminalId) {
        void api.writeTerminal(terminalId, `${action.command.trim()}\n`);
      }
    });
  };

  const loadGitChangedFiles = useCallback(async () => {
    if (!api || !selectedWorkspace) {
      return [] as const;
    }
    const files = await api.getChangedFiles(selectedWorkspace.id);
    setGitChangedFiles(files);
    return files;
  }, [api, selectedWorkspace]);

  const openGitDialog = useCallback((dialog: "commit" | "push" | "pr") => {
    setGitActionError(undefined);
    setGitActionPending(false);
    setGitDialog(dialog);
    setGitBranchName(selectedWorkspace?.branchName);
    if (api && selectedWorkspace) {
      void api.getCurrentBranch(selectedWorkspace.id).then((branch) => {
        setGitBranchName(branch ?? selectedWorkspace.branchName);
      }).catch(() => {
        setGitBranchName(selectedWorkspace.branchName);
      });
    }
    if (dialog === "commit") {
      void loadGitChangedFiles().catch((error) => {
        setGitActionError(error instanceof Error ? error.message : String(error));
      });
    }
  }, [api, loadGitChangedFiles, selectedWorkspace]);

  const closeGitDialog = useCallback(() => {
    setGitDialog(null);
    setGitActionError(undefined);
    setGitActionPending(false);
  }, []);

  const handleCommitChanges = useCallback(async (input: { readonly message: string; readonly stageAll: boolean }) => {
    if (!api || !selectedWorkspace) {
      return;
    }
    setGitActionPending(true);
    setGitActionError(undefined);
    try {
      if (input.stageAll) {
        await api.stageAllFiles(selectedWorkspace.id);
      }
      await api.commitChanges(selectedWorkspace.id, input.message.trim());
      await updateSnapshot(api, setSnapshot, () => api.syncCurrentWorkspace());
      closeGitDialog();
    } catch (error) {
      setGitActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setGitActionPending(false);
    }
  }, [api, closeGitDialog, selectedWorkspace]);

  const handlePushBranch = useCallback(async (options?: { readonly setUpstream?: boolean }) => {
    if (!api || !selectedWorkspace) {
      return;
    }
    setGitActionPending(true);
    setGitActionError(undefined);
    try {
      await api.pushBranch(selectedWorkspace.id, options);
      closeGitDialog();
    } catch (error) {
      setGitActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setGitActionPending(false);
    }
  }, [api, closeGitDialog, selectedWorkspace]);

  const handleCreatePullRequest = useCallback(async (input: { readonly title: string; readonly body: string; readonly base: string; readonly openInBrowser: boolean }) => {
    if (!api || !selectedWorkspace) {
      return;
    }
    setGitActionPending(true);
    setGitActionError(undefined);
    try {
      const result = await api.createPullRequest(selectedWorkspace.id, {
        title: input.title,
        body: input.body,
        base: input.base,
      });
      if (input.openInBrowser && result.url) {
        await api.openExternal(result.url);
      }
      closeGitDialog();
    } catch (error) {
      setGitActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setGitActionPending(false);
    }
  }, [api, closeGitDialog, selectedWorkspace]);

  const toggleTerminal = useCallback(() => {
    if (!selectedSessionKey) {
      return;
    }
    setOpenTerminalSessionKeys((current) => {
      const next = new Set(current);
      if (next.has(selectedSessionKey)) {
        next.delete(selectedSessionKey);
        setTakeoverTerminalSessionKeys((currentTakeover) => {
          const nextTakeover = new Set(currentTakeover);
          nextTakeover.delete(selectedSessionKey);
          return nextTakeover;
        });
        return next;
      }
      next.add(selectedSessionKey);
      setActiveTerminalSessionKey(selectedSessionKey);
      return next;
    });
  }, [selectedSessionKey]);
  const addTerminalSelectionToComposer = useCallback((context: string) => {
    setComposerDraft((current) => appendComposerContext(current, context));
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  }, []);
  const askPiToImplementLatestPlan = useCallback(() => {
    if (!latestPlan) return;
    setComposerDraft((current) => {
      const prompt = buildImplementPlanPrompt(latestPlan);
      return current.trim() ? `${current.trimEnd()}\n\n${prompt}` : prompt;
    });
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }, [latestPlan]);
  const focusNewThreadComposer = () => {
    window.requestAnimationFrame(() => {
      newThreadComposerRef.current?.focus();
    });
  };
  const resetExactBottomRestoreState = (nextSessionKey: string | null = null) => {
    exactBottomRestoreSessionKeyRef.current = nextSessionKey;
    deferredPinnedBottomAlignmentRef.current = false;
    pendingPinnedBottomBehaviorRef.current = "auto";
  };
  const updateNewThreadPrompt = useCallback((value: SetStateAction<string>) => {
    setNewThreadComposerError(undefined);
    setNewThreadPrompt(value);
  }, []);
  const scrollTimelineToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const pane = timelinePaneRef.current;
    if (!pane) {
      return;
    }

    const align = (remainingChecks: number) => {
      autoAligningTimelineRef.current = true;
      if (behavior === "auto") {
        pane.scrollTop = pane.scrollHeight;
      } else {
        pane.scrollTo({ top: pane.scrollHeight, behavior });
      }
      pinnedToBottomRef.current = true;
      followingLatestRef.current = true;
      manualTimelineScrollTopRef.current = null;
      lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
      lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, true);
      setShowJumpToLatest(false);

      window.requestAnimationFrame(() => {
        const remaining = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
        if (remainingChecks > 0 && remaining > 1) {
          align(remainingChecks - 1);
          return;
        }
        autoAligningTimelineRef.current = false;
      });
    };

    align(6);
  }, [selectedSessionKey]);

  const requestPinnedBottomAlignment = useCallback((
    behavior: ScrollBehavior = "auto",
    options?: { readonly preferExactRestore?: boolean },
  ) => {
    if (exactBottomRestoreSessionKeyRef.current === selectedSessionKey && selectedSessionKey) {
      pendingPinnedBottomBehaviorRef.current = behavior;
      deferredPinnedBottomAlignmentRef.current = true;
      return;
    }

    if (options?.preferExactRestore && selectedSessionKey && activeTranscript.length > VIRTUALIZATION_THRESHOLD) {
      exactBottomRestoreSessionKeyRef.current = selectedSessionKey;
      pendingPinnedBottomBehaviorRef.current = behavior;
      preserveBottomOnNextPaneResizeRef.current = true;
      setDisableTimelineVirtualization(true);
      return;
    }

    scrollTimelineToBottom(behavior);
  }, [activeTranscript.length, scrollTimelineToBottom, selectedSessionKey]);

  const restoreManualTimelineScrollTop = useCallback(() => {
    const pane = timelinePaneRef.current;
    const savedScrollTop = manualTimelineScrollTopRef.current ?? lastTimelineScrollTopBySessionRef.current.get(selectedSessionKey);
    if (pane && savedScrollTop !== undefined && savedScrollTop !== null && Math.abs(pane.scrollTop - savedScrollTop) > 1) {
      manualTimelineScrollRestoreRef.current = true;
      pane.scrollTop = savedScrollTop;
      window.requestAnimationFrame(() => {
        manualTimelineScrollRestoreRef.current = false;
      });
    }
  }, [selectedSessionKey]);

  const finalizeTimelineVirtualizationDisable = useCallback(() => {
    const pane = timelinePaneRef.current;
    const restoreSessionKey = exactBottomRestoreSessionKeyRef.current;
    if (!pane || snapshot?.activeView !== "threads") {
      resetExactBottomRestoreState();
      setDisableTimelineVirtualization(false);
      return;
    }

    if (restoreSessionKey !== selectedSessionKey || !restoreSessionKey) {
      setDisableTimelineVirtualization(false);
      return;
    }

    const shouldRestoreBottom =
      pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current || deferredPinnedBottomAlignmentRef.current;
    if (!shouldRestoreBottom) {
      resetExactBottomRestoreState();
      setDisableTimelineVirtualization(false);
      return;
    }

    const finishRestore = (remainingChecks: number, stableChecks: number) => {
      window.requestAnimationFrame(() => {
        if (timelinePaneRef.current !== pane || exactBottomRestoreSessionKeyRef.current !== restoreSessionKey) {
          return;
        }

        if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
          scrollTimelineToBottom();
        }

        const remaining = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
        const nextStableChecks = remaining <= 16 ? stableChecks + 1 : 0;
        if (remainingChecks <= 1 || nextStableChecks >= 2) {
          const shouldApplyDeferredAlignment = deferredPinnedBottomAlignmentRef.current;
          resetExactBottomRestoreState();
          if (shouldApplyDeferredAlignment) {
            scrollTimelineToBottom();
          }
          preserveBottomOnNextPaneResizeRef.current = false;
          return;
        }

        finishRestore(remainingChecks - 1, nextStableChecks);
      });
    };

    if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
      scrollTimelineToBottom();
    }

    window.requestAnimationFrame(() => {
      if (timelinePaneRef.current !== pane || exactBottomRestoreSessionKeyRef.current !== restoreSessionKey) {
        return;
      }
      setDisableTimelineVirtualization(false);
      scrollTimelineToBottom(pendingPinnedBottomBehaviorRef.current);
      pendingPinnedBottomBehaviorRef.current = "auto";
      finishRestore(6, 0);
    });
  }, [scrollTimelineToBottom, selectedSessionKey, snapshot?.activeView]);

  const setTimelinePaneElement = useCallback((node: HTMLDivElement | null) => {
    timelinePaneRef.current = node;
    if (!node) {
      return;
    }

    setTimelinePaneMountVersion((current) => current + 1);

    const savedPinned = lastTimelinePinnedBySessionRef.current.get(selectedSessionKey);
    const savedScrollTop = lastTimelineScrollTopBySessionRef.current.get(selectedSessionKey);

    if (!selectedSessionKey || snapshot?.activeView !== "threads") {
      setDisableTimelineVirtualization(false);
      return;
    }

    const shouldRestoreBottom = followingLatestRef.current || (savedPinned ?? pinnedToBottomRef.current) || preserveBottomOnNextPaneResizeRef.current;
    if (shouldRestoreBottom) {
      preserveBottomOnNextPaneResizeRef.current = true;
      node.scrollTop = node.scrollHeight;
      window.requestAnimationFrame(() => {
        if (timelinePaneRef.current !== node) {
          return;
        }
        if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
          requestPinnedBottomAlignment("auto", { preferExactRestore: true });
        }
      });
      return;
    }

    if (savedScrollTop == null) {
      setDisableTimelineVirtualization(false);
      return;
    }

    node.scrollTop = savedScrollTop;
    pinnedToBottomRef.current = false;
    followingLatestRef.current = false;
    manualTimelineScrollTopRef.current = savedScrollTop;
    resetExactBottomRestoreState();
    lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, false);
    window.requestAnimationFrame(() => {
      if (timelinePaneRef.current !== node) {
        return;
      }
      setDisableTimelineVirtualization(false);
    });
  }, [scrollTimelineToBottom, selectedSessionKey, snapshot?.activeView]);

  const schedulePinnedBottomRealignment = useCallback((delayFrames = 0) => {
    const waitForFrames = (remainingFrames: number) => {
      window.requestAnimationFrame(() => {
        if (remainingFrames > 0) {
          waitForFrames(remainingFrames - 1);
          return;
        }
        requestPinnedBottomAlignment("auto", { preferExactRestore: true });
        window.requestAnimationFrame(() => {
          preserveBottomOnNextPaneResizeRef.current = false;
          if (pinnedToBottomRef.current) {
            requestPinnedBottomAlignment("auto", { preferExactRestore: true });
          }
        });
      });
    };

    waitForFrames(delayFrames);
  }, [requestPinnedBottomAlignment]);

  const handleViewFileInDiff = useCallback((path: string) => {
    setShowDiffPanel(true);
    setDiffFileRequest({ path, nonce: Date.now() });
  }, []);

  const toggleDiffPanel = useCallback(() => {
    const pane = timelinePaneRef.current;
    const shouldPreserveBottom = pane ? isNearBottom(pane) || pinnedToBottomRef.current : pinnedToBottomRef.current;
    if (shouldPreserveBottom) {
      preserveBottomOnNextPaneResizeRef.current = true;
    }

    setShowDiffPanel((prev) => !prev);

    if (!shouldPreserveBottom) {
      return;
    }

    schedulePinnedBottomRealignment(3);
  }, [schedulePinnedBottomRealignment]);

  const openSettings = (workspaceId?: string, section?: SettingsSection) => {
    if (!api) {
      return;
    }
    const nextWorkspaceId =
      workspaceId && rootWorkspaceOptions.some((workspace) => workspace.id === workspaceId)
        ? workspaceId
        : settingsWorkspace?.id || rootWorkspaceOptions[0]?.id || "";
    if (nextWorkspaceId) {
      setSettingsWorkspaceId(nextWorkspaceId);
    }
    if (section) {
      setSettingsSection(section);
    }
    void updateSnapshot(api, setSnapshot, () => api.setActiveView("settings"));
  };

  const selectedRootWorkspaceId = selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id;
  const commandPaletteActions = useMemo<readonly CommandPaletteAction[]>(
    () => [
      {
        id: "new-thread",
        title: "New thread",
        subtitle: "Start a new pi session",
        keywords: ["chat", "session", "thread"],
        run: () => openNewThreadSurface(selectedRootWorkspaceId),
      },
      {
        id: "toggle-terminal",
        title: "Toggle terminal",
        subtitle: "Show or hide the integrated terminal",
        keywords: ["terminal", "shell", "command line"],
        disabled: !selectedSession,
        run: toggleTerminal,
      },
      {
        id: "toggle-changes",
        title: "Toggle changes",
        subtitle: "Show or hide the workspace diff panel",
        keywords: ["diff", "changes", "files"],
        disabled: !selectedWorkspace,
        run: toggleDiffPanel,
      },
      {
        id: "settings",
        title: "Settings",
        subtitle: "Configure pi and model providers",
        keywords: ["preferences", "configuration", "model"],
        run: () => openSettings(selectedRootWorkspaceId),
      },
      {
        id: "skills",
        title: "Skills",
        subtitle: "Manage available pi skills",
        keywords: ["skills", "slash commands", "capabilities"],
        run: () => openSkills(selectedRootWorkspaceId),
      },
      {
        id: "extensions",
        title: "Extensions",
        subtitle: "Manage pi extensions",
        keywords: ["extensions", "plugins", "integrations"],
        run: () => openExtensions(selectedRootWorkspaceId),
      },
    ],
    [selectedRootWorkspaceId, selectedSession, selectedWorkspace, snapshot, toggleDiffPanel, toggleTerminal],
  );

  const closeTreeModal = useCallback(() => {
    setTreeModalState((current) =>
      current.submitting
        ? current
        : {
            open: false,
            loading: false,
            submitting: false,
          },
    );
    focusComposer();
  }, []);

  const openTreeModal = useCallback(() => {
    if (!api || !selectedWorkspace || !selectedSession) {
      return;
    }

    setTreeModalState({
      open: true,
      loading: true,
      submitting: false,
    });
    setComposerDraft("");

    void api
      .getSessionTree({
        workspaceId: selectedWorkspace.id,
        sessionId: selectedSession.id,
      })
      .then((tree) => {
        setTreeModalState({
          open: true,
          loading: false,
          submitting: false,
          tree,
        });
      })
      .catch((error) => {
        setTreeModalState({
          open: true,
          loading: false,
          submitting: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [api, selectedSession, selectedWorkspace]);

  const navigateTreeSelection = useCallback(
    (targetId: string, options?: { readonly summarize?: boolean; readonly customInstructions?: string }) => {
      if (!api || !selectedWorkspace || !selectedSession) {
        return;
      }

      setTreeModalState((current) => ({ ...current, submitting: true, error: undefined }));
      void api
        .navigateSessionTree(
          {
            workspaceId: selectedWorkspace.id,
            sessionId: selectedSession.id,
          },
          targetId,
          options,
        )
        .then(({ state, result }) => {
          setSnapshot(state);
          setTreeModalState({
            open: false,
            loading: false,
            submitting: false,
          });
          setComposerDraft((current) =>
            !current.trim() && result.editorText ? result.editorText : state.composerDraft,
          );
          focusComposer();
        })
        .catch((error) => {
          setTreeModalState((current) => ({
            ...current,
            submitting: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        });
    },
    [api, selectedSession, selectedWorkspace],
  );

  const slashMenu = useSlashMenu({
    composerDraft,
    setComposerDraft,
    selectedRuntime,
    selectedModelRuntime,
    sessionCommands: selectedSessionCommands,
    commandCompatibility: selectedWorkspaceCommandCompatibility,
    selectedSessionKey,
    selectedSession,
    selectedWorkspace,
    isRunning: selectedSession?.status === "running",
    api,
    setSnapshot,
    focusComposer,
    openSettings,
    updateSnapshot,
    allowTreeCommand: true,
    onRunTreeCommand: openTreeModal,
  });

  const mentionMenu = useMentionMenu({
    composerDraft,
    setComposerDraft,
    composerRef,
    workspaceId: selectedWorkspace?.id,
    api,
  });

  const newThreadSlashMenu = useSlashMenu({
    composerDraft: newThreadPrompt,
    setComposerDraft: updateNewThreadPrompt,
    selectedRuntime: newThreadRuntime,
    selectedModelRuntime: newThreadRuntime,
    sessionCommands: [],
    commandCompatibility: [],
    selectedSessionKey: `new-thread:${newThreadWorkspace?.id ?? ""}`,
    selectedSession: undefined,
    selectedWorkspace: newThreadWorkspace,
    isRunning: false,
    api,
    setSnapshot,
    focusComposer: focusNewThreadComposer,
    openSettings,
    updateSnapshot,
    allowTreeCommand: false,
    immediateCommandMode: "prefill",
    onSelectModelOption: (provider, modelId) => {
      setNewThreadProvider(provider);
      setNewThreadModelId(modelId);
    },
    onSelectThinkingOption: setNewThreadThinkingLevel,
    onSelectLoginProvider: (providerId) => {
      if (!api || !newThreadWorkspace) {
        return;
      }
      void updateSnapshot(api, setSnapshot, () => api.loginProvider(newThreadWorkspace.id, providerId));
    },
    onSelectLogoutProvider: (providerId) => {
      if (!api || !newThreadWorkspace) {
        return;
      }
      void updateSnapshot(api, setSnapshot, () => api.logoutProvider(newThreadWorkspace.id, providerId));
    },
  });

  const newThreadMentionMenu = useMentionMenu({
    composerDraft: newThreadPrompt,
    setComposerDraft: setNewThreadPrompt,
    composerRef: newThreadComposerRef,
    workspaceId: newThreadWorkspace?.id,
    api,
  });

  const wsMenu = useWorkspaceMenu({
    api,
    setSnapshot,
    updateSnapshot,
  });

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    if (hydratedComposerSessionKeyRef.current !== selectedSessionKey) {
      hydratedComposerSessionKeyRef.current = selectedSessionKey;
      handledComposerSyncNonceRef.current = snapshot.composerDraftSyncNonce;
      setComposerDraft(snapshot.composerDraft);
      return;
    }

    if (snapshot.composerDraftSyncNonce === handledComposerSyncNonceRef.current) {
      return;
    }

    handledComposerSyncNonceRef.current = snapshot.composerDraftSyncNonce;
    if (snapshot.composerDraftSyncSource === "persist" || snapshot.composerDraftSyncSource === "state") {
      return;
    }

    setComposerDraft(snapshot.composerDraft);
  }, [
    selectedSessionKey,
    snapshot?.composerDraft,
    snapshot?.composerDraftSyncNonce,
    snapshot?.composerDraftSyncSource,
  ]);

  useEffect(() => {
    const sessionExtensionUiBySession = snapshot?.sessionExtensionUiBySession;
    if (!sessionExtensionUiBySession) {
      setDockExpandedBySession((current) => (Object.keys(current).length > 0 ? {} : current));
      return;
    }

    setDockExpandedBySession((current) => {
      let next: Record<string, boolean> | undefined;
      for (const [sessionKey, expanded] of Object.entries(current)) {
        if (!expanded && sessionExtensionUiBySession[sessionKey]) {
          continue;
        }
        if (hasExtensionDockContent(sessionExtensionUiBySession[sessionKey])) {
          continue;
        }
        if (!next) {
          next = { ...current };
        }
        delete next[sessionKey];
      }
      return next ?? current;
    });
  }, [snapshot?.sessionExtensionUiBySession]);

  useEffect(() => {
    if (rootWorkspaceOptions.length === 0) {
      setSettingsWorkspaceId("");
      setSkillsWorkspaceId("");
      setExtensionsWorkspaceId("");
      setPendingNewThreadWorkspaceId("");
      setNewThreadRootWorkspaceId("");
      setNewThreadEnvironment("local");
      setNewThreadAttachments([]);
      return;
    }
    setSettingsWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
    setSkillsWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
    setExtensionsWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
    setNewThreadRootWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
  }, [rootWorkspaceOptions]);

  useEffect(() => {
    if (!snapshot || !pendingNewThreadWorkspaceId) {
      return;
    }
    const nextRootWorkspaceId = resolveRepoWorkspaceId(snapshot.workspaces, pendingNewThreadWorkspaceId);
    if (!nextRootWorkspaceId || !rootWorkspaceOptions.some((workspace) => workspace.id === nextRootWorkspaceId)) {
      return;
    }
    setNewThreadRootWorkspaceId(nextRootWorkspaceId);
    setPendingNewThreadWorkspaceId("");
  }, [pendingNewThreadWorkspaceId, rootWorkspaceOptions, snapshot]);

  const resetNewThreadSurface = (workspaceId?: string) => {
    const nextWorkspaceId =
      (workspaceId && (
        rootWorkspaceOptions.find((workspace) => workspace.id === workspaceId)?.id ||
        (snapshot ? resolveRepoWorkspaceId(snapshot.workspaces, workspaceId) : undefined)
      )) ||
      rootWorkspace?.id ||
      visibleWorkspaces[0]?.id ||
      "";
    if (nextWorkspaceId) {
      setNewThreadRootWorkspaceId(nextWorkspaceId);
    }
    setNewThreadEnvironment("local");
    setNewThreadPrompt("");
    setNewThreadAttachments([]);
    setNewThreadProvider(undefined);
    setNewThreadModelId(undefined);
    setNewThreadThinkingLevel(undefined);
    setNewThreadToolAccess(DEFAULT_TOOL_ACCESS);
    setNewThreadComposerError(undefined);
  };

  const primarySidebarToggleVisible = canTogglePrimarySidebar(snapshot?.activeView);
  const handleTogglePrimarySidebar = useCallback(() => {
    if (!api || !snapshot || !canTogglePrimarySidebar(snapshot.activeView)) {
      return false;
    }
    const nextCollapsed = !snapshot.sidebarCollapsed;
    setSnapshot((current) => current ? { ...current, sidebarCollapsed: nextCollapsed } : current);
    void updateSnapshot(api, setSnapshot, () => api.setSidebarCollapsed(nextCollapsed));
    return true;
  }, [api, snapshot, setSnapshot]);
  const sidebarToggleShortcutLabel = api ? getDesktopShortcutLabel(api.platform, "B") : "";

  useEffect(() => {
    const handleCommand = (command: PiDesktopCommand): boolean => {
      if (command === desktopCommands.openCommandPalette) {
        setCommandPaletteOpen(true);
        return true;
      } else if (command === desktopCommands.openSettings) {
        openSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id);
        return true;
      } else if (command === desktopCommands.openNewThread) {
        openNewThreadSurface(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id);
        return true;
      } else if (command === desktopCommands.toggleTerminal) {
        toggleTerminal();
        return true;
      } else if (command === desktopCommands.toggleSidebar) {
        return handleTogglePrimarySidebar();
      }
      return false;
    };

    const removeCommandListener = window.piApp?.onCommand?.(handleCommand);
    const removeWorkspacePickedListener = window.piApp?.onWorkspacePicked?.((workspaceId) => {
      setPendingNewThreadWorkspaceId(workspaceId);
      resetNewThreadSurface();
    });
    const removeClipboardImageListener = window.piApp?.onClipboardImagePasted?.(handlePastedClipboardImage);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEventInsideTerminal(event)) {
        const command = getDesktopCommandFromShortcut({
          modifier: event.metaKey || event.ctrlKey,
          shift: event.shiftKey,
          key: event.key,
          code: event.code,
        });
        if (command === desktopCommands.toggleTerminal || command === desktopCommands.openCommandPalette) {
          event.preventDefault();
          handleCommand(command);
        }
        return;
      }
      // Cmd+F toggles thread search
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && !event.shiftKey) {
        event.preventDefault();
        if (threadSearch.isOpen) {
          threadSearch.close();
        } else {
          threadSearch.open();
        }
        return;
      }
      // Cmd+D toggles diff panel
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && !event.shiftKey) {
        event.preventDefault();
        toggleDiffPanel();
        return;
      }
      const command = getDesktopCommandFromShortcut({
        modifier: event.metaKey || event.ctrlKey,
        shift: event.shiftKey,
        key: event.key,
        code: event.code,
      });
      if (command && handleCommand(command)) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      removeCommandListener?.();
      removeWorkspacePickedListener?.();
      removeClipboardImageListener?.();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    selectedWorkspace?.id,
    selectedWorkspace?.rootWorkspaceId,
    threadSearch,
    api,
    toggleDiffPanel,
    toggleTerminal,
    handleTogglePrimarySidebar,
  ]);

  useLayoutEffect(() => {
    setShowJumpToLatest(false);
    lastTranscriptMarkerRef.current = "";
    pinnedToBottomRef.current = true;
    followingLatestRef.current = true;
    autoAligningTimelineRef.current = false;
    manualTimelineScrollRestoreRef.current = false;
    userTimelineScrollIntentRef.current = false;
    manualTimelineScrollTopRef.current = null;
    previousTimelinePaneSizeRef.current = null;
    preserveBottomOnNextPaneResizeRef.current = false;
    resetExactBottomRestoreState(selectedSessionKey || null);
    setDisableTimelineVirtualization(Boolean(selectedSessionKey));
  }, [selectedSessionKey]);

  useLayoutEffect(() => {
    if (snapshot?.activeView !== "threads" || !selectedSession || activeTranscript.length === 0) {
      return;
    }
    if (exactBottomRestoreSessionKeyRef.current !== selectedSessionKey) {
      return;
    }
    if (!followingLatestRef.current || (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current)) {
      return;
    }

    scrollTimelineToBottom();
  }, [
    activeTranscript,
    disableTimelineVirtualization,
    scrollTimelineToBottom,
    selectedSession,
    selectedSessionKey,
    snapshot?.activeView,
  ]);

  useEffect(() => {
    setTreeModalState((current) =>
      current.open
        ? {
            open: false,
            loading: false,
            submitting: false,
          }
        : current,
    );
  }, [selectedSessionKey, snapshot?.activeView]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    if (snapshot.activeView === "new-thread" && previousActiveViewRef.current !== "new-thread") {
      const nextRootWorkspaceId = resolveRepoWorkspaceId(snapshot.workspaces, selectedWorkspace?.id);
      if (nextRootWorkspaceId) {
        setNewThreadRootWorkspaceId(nextRootWorkspaceId);
      }
    }

    if (snapshot.activeView !== "threads") {
      previousTimelinePaneSizeRef.current = null;
      resetExactBottomRestoreState();
    }

    if (
      snapshot.activeView === "threads" &&
      previousActiveViewRef.current !== "threads" &&
      selectedSession
    ) {
      focusComposer();
      if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
        preserveBottomOnNextPaneResizeRef.current = true;
        schedulePinnedBottomRealignment(1);
      }
    }

    previousActiveViewRef.current = snapshot.activeView;
  }, [schedulePinnedBottomRealignment, selectedSession, selectedWorkspace?.id, snapshot]);

  useEffect(() => {
    if (!api || composerDraft === persistedComposerDraft) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      void api.updateComposerDraft(composerDraft);
    }, 100);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [api, composerDraft, persistedComposerDraft, setSnapshot]);

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return undefined;
    }

    const pane = timelinePaneRef.current;
    const previousHeight = composer.getBoundingClientRect().height;
    const shouldPreserveBottom = followingLatestRef.current && (pane
      ? isNearBottom(pane) || pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current
      : pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current);

    composer.style.height = "0px";
    composer.style.height = `${Math.min(composer.scrollHeight, 220)}px`;

    const nextHeight = composer.getBoundingClientRect().height;
    if (Math.abs(nextHeight - previousHeight) >= 1 && shouldPreserveBottom) {
      preserveBottomOnNextPaneResizeRef.current = true;
      requestPinnedBottomAlignment("auto", { preferExactRestore: true });
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          preserveBottomOnNextPaneResizeRef.current = false;
          if (pinnedToBottomRef.current) {
            requestPinnedBottomAlignment("auto", { preferExactRestore: true });
          }
        });
      });
    }
  }, [composerDraft, requestPinnedBottomAlignment]);

  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane || snapshot?.activeView !== "threads" || !selectedSession) {
      return undefined;
    }

    const markUserScrollIntent = () => {
      userTimelineScrollIntentRef.current = true;
    };

    const handleNativeScroll = () => {
      timelineScrollHandlerRef.current();
    };

    pane.addEventListener("wheel", markUserScrollIntent, { passive: true });
    pane.addEventListener("touchstart", markUserScrollIntent, { passive: true });
    pane.addEventListener("pointerdown", markUserScrollIntent, { passive: true });
    pane.addEventListener("scroll", handleNativeScroll, { passive: true });

    return () => {
      pane.removeEventListener("wheel", markUserScrollIntent);
      pane.removeEventListener("touchstart", markUserScrollIntent);
      pane.removeEventListener("pointerdown", markUserScrollIntent);
      pane.removeEventListener("scroll", handleNativeScroll);
    };
  }, [selectedSession, selectedSessionKey, snapshot?.activeView, timelinePaneMountVersion]);

  useLayoutEffect(() => {
    if (snapshot?.activeView !== "threads" || !selectedSession) {
      return undefined;
    }

    return () => {
      const pane = timelinePaneRef.current;
      if (!pane) {
        return;
      }
      lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
      lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, isNearBottom(pane));
    };
  }, [selectedSession, selectedSessionKey, snapshot?.activeView]);

  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane || !selectedSession || snapshot?.activeView !== "threads") {
      previousTimelinePaneSizeRef.current = null;
      return undefined;
    }

    const stickToBottomAfterLayoutChange = () => {
      preserveBottomOnNextPaneResizeRef.current = false;
      pinnedToBottomRef.current = true;
      followingLatestRef.current = true;
      window.requestAnimationFrame(() => {
        requestPinnedBottomAlignment("auto", { preferExactRestore: true });
        window.requestAnimationFrame(() => {
          if (pinnedToBottomRef.current) {
            requestPinnedBottomAlignment("auto", { preferExactRestore: true });
          }
        });
      });
    };

    const updateMeasuredSize = (nextSize: { width: number; height: number }) => {
      const previousSize = previousTimelinePaneSizeRef.current;
      previousTimelinePaneSizeRef.current = nextSize;
      const shouldStickToBottom = preserveBottomOnNextPaneResizeRef.current || pinnedToBottomRef.current;
      const widthChanged = previousSize ? Math.abs(nextSize.width - previousSize.width) >= 1 : false;
      const heightChanged = previousSize ? Math.abs(nextSize.height - previousSize.height) >= 1 : false;
      if (!previousSize || (!widthChanged && !heightChanged) || !shouldStickToBottom) {
        return;
      }

      stickToBottomAfterLayoutChange();
    };

    const paneRect = pane.getBoundingClientRect();
    updateMeasuredSize({ width: paneRect.width, height: paneRect.height });

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      updateMeasuredSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });

    resizeObserver.observe(pane);
    return () => {
      resizeObserver.disconnect();
      previousTimelinePaneSizeRef.current = null;
    };
  }, [requestPinnedBottomAlignment, selectedSessionKey, showDiffPanel, snapshot?.activeView, timelinePaneMountVersion]);

  useEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane || !selectedSession) {
      return;
    }

    const marker = buildTranscriptChangeMarker(selectedSessionKey, activeTranscript);
    if (marker === lastTranscriptMarkerRef.current) {
      return;
    }
    lastTranscriptMarkerRef.current = marker;

    if (followingLatestRef.current) {
      requestPinnedBottomAlignment("auto");
      return;
    }

    restoreManualTimelineScrollTop();
    window.requestAnimationFrame(restoreManualTimelineScrollTop);
    setShowJumpToLatest(true);
  }, [activeTranscript, requestPinnedBottomAlignment, restoreManualTimelineScrollTop, selectedSession, selectedSessionKey]);

  const handleTimelineContentHeightChange = useCallback(() => {
    if (!followingLatestRef.current) {
      window.requestAnimationFrame(restoreManualTimelineScrollTop);
      return;
    }

    if (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (!followingLatestRef.current || (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current)) {
        return;
      }
      requestPinnedBottomAlignment("auto");
    });
  }, [requestPinnedBottomAlignment, restoreManualTimelineScrollTop]);

  if (!api || !snapshot) {
    return (
      <div className="shell shell--loading">
        <main className="loading-card">
          <div className="loading-card__eyebrow">pi-gui</div>
          <h1>Loading sessions</h1>
          <p>The desktop shell is restoring folder and thread state from the main process.</p>
        </main>
      </div>
    );
  }

  const showTerminalTakeover = isTerminalVisible && isVisibleTerminalTakeover && Boolean(visibleTerminalTarget);
  const threadVsCodeTarget = selectedWorkspace
    ? { workspaceId: selectedWorkspace.id, folderPath: selectedWorkspace.path }
    : vsCodeWorkspaceId && vsCodeFolderPath
      ? { workspaceId: vsCodeWorkspaceId, folderPath: vsCodeFolderPath }
      : null;
  const displayVsCodeTarget = vsCodeWorkspaceId && vsCodeFolderPath
    ? { workspaceId: vsCodeWorkspaceId, folderPath: vsCodeFolderPath }
    : null;
  const persistentVsCodeTarget = snapshot.activeView === "threads"
    ? threadVsCodeTarget
    : snapshot.activeView === "display-mode"
      ? displayVsCodeTarget
      : null;
  const showPersistentVsCodePanel = vsCodeOpen && persistentVsCodeTarget !== null && (snapshot.activeView === "threads" || snapshot.activeView === "display-mode");
  const showThreadVsCodePanel = snapshot.activeView === "threads" && showPersistentVsCodePanel && threadVsCodeTarget !== null;
  const showPlanPanel = planPanelOpen && planSurfaceAvailable;
  const mainClassName = [
    "main",
    showDiffPanel ? "main--with-diff" : "",
    showThreadVsCodePanel ? "main--with-vscode" : "",
    showPlanPanel ? "main--with-plan" : "",
    isTerminalVisible ? "main--with-terminal" : "",
    showTerminalTakeover ? "main--terminal-takeover" : "",
  ].filter(Boolean).join(" ");
  const threadVsCodeContainerWidth = getThreadVsCodeContainerWidth();
  const threadVsCodeMinWidth = getMinVsCodeSidePanelWidth(threadVsCodeContainerWidth);
  const threadVsCodeMaxWidth = getMaxVsCodeSidePanelWidth(threadVsCodeContainerWidth);
  const terminalPanel = isTerminalVisible && visibleTerminalTarget ? (
    <div className="terminal-stack">
      {openTerminalTargets.length > 1 ? (
        <div className="terminal-stack__tabs" role="tablist" aria-label="Open card terminals">
          {openTerminalTargets.map((target) => (
            <button
              className={`terminal-stack__tab${target.key === visibleTerminalKey ? " terminal-stack__tab--active" : ""}`}
              key={target.key}
              type="button"
              role="tab"
              aria-selected={target.key === visibleTerminalKey}
              data-testid="open-terminal-tab"
              onClick={() => setActiveTerminalSessionKey(target.key)}
            >
              {target.workspace.name} / {target.session.title}
            </button>
          ))}
        </div>
      ) : null}
      <TerminalPanel
        key={visibleTerminalTarget.key}
        workspace={visibleTerminalTarget.workspace}
        sessionId={visibleTerminalTarget.session.id}
        height={terminalHeight}
        isTakeover={isVisibleTerminalTakeover}
        onAddSelectionToComposer={addTerminalSelectionToComposer}
        onHeightChange={(nextHeight) => {
          setTerminalHeight(nextHeight);
          setTakeoverTerminalSessionKeys((current) => {
            const next = new Set(current);
            next.delete(visibleTerminalTarget.key);
            return next;
          });
        }}
        onToggleTakeover={() => {
          setTakeoverTerminalSessionKeys((current) => {
            const next = new Set(current);
            if (next.has(visibleTerminalTarget.key)) {
              next.delete(visibleTerminalTarget.key);
            } else {
              next.add(visibleTerminalTarget.key);
            }
            return next;
          });
        }}
        onHide={() => {
          setOpenTerminalSessionKeys((current) => {
            const next = new Set(current);
            next.delete(visibleTerminalTarget.key);
            if (activeTerminalSessionKey === visibleTerminalTarget.key) {
              setActiveTerminalSessionKey([...next][0] ?? "");
            }
            return next;
          });
          setTakeoverTerminalSessionKeys((current) => {
            const next = new Set(current);
            next.delete(visibleTerminalTarget.key);
            return next;
          });
          focusComposer();
        }}
      />
    </div>
  ) : null;

  const setActiveView = (view: AppView) => {
    if (view !== "review") {
      setReviewSnapshot(undefined);
    }
    if (view === "display-mode" && snapshot.activeView === "threads" && selectedWorkspace && selectedSession) {
      setDisplayModeInitialPinnedThreadKey(`${selectedWorkspace.id}:${selectedSession.id}`);
      if (vsCodeOpen) {
        openVsCodeForWorkspace(selectedWorkspace.id, selectedWorkspace.path);
      }
    } else if (view !== "display-mode") {
      setDisplayModeInitialPinnedThreadKey("");
    }
    void updateSnapshot(api, setSnapshot, () => api.setActiveView(view));
  };

  const fillComposerFromReview = (prompt: string) => {
    setComposerDraft(prompt);
    void updateSnapshot(api, setSnapshot, () => api.updateComposerDraft(prompt));
  };

  function openSkills(workspaceId?: string) {
    const nextWorkspaceId =
      workspaceId && rootWorkspaceOptions.some((workspace) => workspace.id === workspaceId)
        ? workspaceId
        : skillsWorkspace?.id || rootWorkspaceOptions[0]?.id || "";
    if (nextWorkspaceId) {
      setSkillsWorkspaceId(nextWorkspaceId);
    }
    setActiveView("skills");
  }

  function openExtensions(workspaceId?: string) {
    const nextWorkspaceId =
      workspaceId && rootWorkspaceOptions.some((workspace) => workspace.id === workspaceId)
        ? workspaceId
        : extensionsWorkspace?.id || rootWorkspaceOptions[0]?.id || "";
    if (nextWorkspaceId) {
      setExtensionsWorkspaceId(nextWorkspaceId);
    }
    setActiveView("extensions");
  }

  function openNewThreadSurface(workspaceId?: string) {
    setPendingNewThreadWorkspaceId("");
    resetNewThreadSurface(workspaceId);
    setActiveView("new-thread");
  }

  const handleSelectNewThreadWorkspace = (workspaceId: string) => {
    setPendingNewThreadWorkspaceId("");
    setNewThreadRootWorkspaceId(workspaceId);
    setNewThreadAttachments([]);
    setNewThreadProvider(undefined);
    setNewThreadModelId(undefined);
    setNewThreadThinkingLevel(undefined);
    setNewThreadComposerError(undefined);
  };

  const createCheckoutSelector = (
    workspace: WorkspaceRecord | undefined,
    selectionMode: "app" | "new-thread" = "app",
  ) => {
    if (!snapshot || !workspace) {
      return undefined;
    }

    const root = snapshot.workspaces.find((entry) => entry.id === (workspace.rootWorkspaceId ?? workspace.id));
    if (!root) {
      return undefined;
    }

    const currentWorktree = linkedWorktreeByWorkspaceId.get(workspace.id);
    const currentRef =
      currentWorktree?.branchName ??
      currentWorktree?.name ??
      workspace.branchName ??
      root.branchName ??
      (workspace.kind === "worktree" ? "worktree" : "main");
    const selectLocalCheckout = () => {
      if (selectionMode === "new-thread") {
        setNewThreadRootWorkspaceId(root.id);
        setNewThreadEnvironment("local");
        return;
      }
      wsMenu.selectWorkspace(root.id);
    };
    const selectWorktreeCheckout = (linkedWorkspace: WorkspaceRecord | undefined, status: WorktreeRecord["status"]) => {
      if (!linkedWorkspace || status !== "ready") {
        return;
      }
      if (selectionMode === "new-thread") {
        setNewThreadRootWorkspaceId(root.id);
        setNewThreadEnvironment("worktree");
        return;
      }
      wsMenu.selectWorkspace(linkedWorkspace.id);
    };
    const worktreeOptions = selectionMode === "app" ? snapshot.worktreesByWorkspace[root.id] ?? [] : [];
    const options: CheckoutSelectorOption[] = [
      {
        id: root.id,
        label: root.branchName ?? "main",
        detail: "Local checkout",
        current: workspace.id === root.id,
        onSelect: selectLocalCheckout,
      },
      ...worktreeOptions.map((worktree) => {
        const linkedWorkspace = worktree.linkedWorkspaceId
          ? snapshot.workspaces.find((entry) => entry.id === worktree.linkedWorkspaceId)
          : undefined;
        const selectable = Boolean(linkedWorkspace) && worktree.status === "ready";

        return {
          id: worktree.id,
          label: worktree.branchName ?? worktree.name,
          detail: selectable ? worktree.name : `${worktree.name} · ${worktree.status === "ready" ? "unavailable" : worktree.status}`,
          current: linkedWorkspace?.id === workspace.id,
          disabled: !selectable,
          onSelect: () => selectWorktreeCheckout(linkedWorkspace, worktree.status),
        } satisfies CheckoutSelectorOption;
      }),
    ];

    return <CheckoutSelector label="Local checkout" currentRef={currentRef} options={options} />;
  };

  const submitComposerDraft = (options: { readonly deliverAs?: "steer" | "followUp" } = {}) => {
    if (!selectedSession) {
      return;
    }

    const hasComposerInput = composerDraft.trim().length > 0 || composerAttachments.length > 0;
    if (selectedSession.status === "running" && !hasComposerInput) {
      void updateSnapshot(api, setSnapshot, () => api.cancelCurrentRun());
      return;
    }

    if (!hasComposerInput) {
      return;
    }
    if (selectedSessionModelOnboarding.requiresModelSelection) {
      return;
    }

    const treeCommand = parseTreeComposerCommand(composerDraft);
    if (treeCommand?.type === "error") {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              lastError: treeCommand.message,
            }
          : current,
      );
      return;
    }
    if (treeCommand?.type === "tree") {
      openTreeModal();
      return;
    }

    const previousDraft = composerDraft;
    recordSubmittedSkillUsage(previousDraft, selectedRuntime);
    setComposerDraft("");
    setAttachmentsClearedOnSubmit(true);
    void (async () => {
      const nextState = await updateSnapshot(api, setSnapshot, () =>
        api.submitComposer(previousDraft, selectedSession.status === "running" ? { deliverAs: options.deliverAs ?? "followUp" } : undefined),
      );
      setComposerDraft(nextState.composerDraft);
      setAttachmentsClearedOnSubmit(false);
    })().catch(() => {
      setComposerDraft(previousDraft);
      setAttachmentsClearedOnSubmit(false);
    });
  };

  const handlePickAttachments = () => {
    void updateSnapshot(api, setSnapshot, () => api.pickComposerAttachments());
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.removeComposerAttachment(attachmentId));
  };

  const handleEditQueuedMessage = (messageId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.editQueuedComposerMessage(messageId, composerDraft)).then(() => {
      composerRef.current?.focus();
    });
  };

  const handleCancelQueuedEdit = () => {
    void updateSnapshot(api, setSnapshot, () => api.cancelQueuedComposerEdit()).then(() => {
      composerRef.current?.focus();
    });
  };

  const handleRemoveQueuedMessage = (messageId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.removeQueuedComposerMessage(messageId));
  };

  const handleSteerQueuedMessage = (messageId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.steerQueuedComposerMessage(messageId));
  };

  const handleNewThreadAddAttachments = (files: File[]) => {
    void readComposerAttachmentsFromFiles(files).then((attachments) => {
      if (attachments.length === 0) {
        return;
      }
      setNewThreadAttachments((current) => [...current, ...attachments]);
    });
  };

  const handleNewThreadRemoveAttachment = (attachmentId: string) => {
    setNewThreadAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  };

  const handleImagePaste = (event: ClipboardEvent<HTMLDivElement>, onFiles: (files: File[]) => void) => {
    const files = extractImageFilesFromClipboardData(event.clipboardData);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    onFiles(files);
  };

  const handleAttachmentDrop = (event: DragEvent<HTMLDivElement>, onFiles: (files: File[]) => void) => {
    event.preventDefault();
    const files = extractFilesFromDataTransfer(event.dataTransfer);
    if (files.length === 0) {
      return;
    }
    onFiles(files);
  };

  const handleComposerPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    handleImagePaste(event, (files) => {
      void addAttachmentsToSessionComposer(files);
    });
  };

  const handleNewThreadComposerPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    handleImagePaste(event, handleNewThreadAddAttachments);
  };

  const handleComposerDrop = (event: DragEvent<HTMLDivElement>) => {
    handleAttachmentDrop(event, (files) => {
      void addAttachmentsToSessionComposer(files);
    });
  };

  const handleNewThreadComposerDrop = (event: DragEvent<HTMLDivElement>) => {
    handleAttachmentDrop(event, handleNewThreadAddAttachments);
  };

  async function addAttachmentsToSessionComposer(files: File[]) {
    if (!api) {
      return;
    }
    const valid = await readComposerAttachmentsFromFiles(files);
    if (valid.length === 0) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.addComposerAttachments(valid));
  }

  const handleClipboardImageShortcut = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    onImage: (attachment: ComposerImageAttachment) => void,
  ): boolean => {
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== "v") {
      return false;
    }

    const clipboardImage = api?.readClipboardImage();
    if (!clipboardImage) {
      return false;
    }

    event.preventDefault();
    onImage(clipboardImage);
    return true;
  };

  function handlePastedClipboardImage(clipboardImage: ComposerImageAttachment) {
    const activeElement = document.activeElement;
    if (activeElement === composerRef.current) {
      if (!api) {
        return;
      }
      void updateSnapshot(api, setSnapshot, () => api.addComposerAttachments([clipboardImage]));
      return;
    }

    if (activeElement === newThreadComposerRef.current) {
      setNewThreadAttachments((current) => [...current, clipboardImage]);
    }
  }

  const handleSetSessionModel = (provider: string, modelId: string) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () =>
      api.setSessionModel(selectedWorkspace.id, selectedSession.id, provider, modelId),
    );
  };

  const handleSetSessionThinking = (level: string) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () =>
      api.setSessionThinkingLevel(
        selectedWorkspace.id,
        selectedSession.id,
        level as NonNullable<RuntimeSnapshot["settings"]["defaultThinkingLevel"]>,
      ),
    );
  };

  const handleToggleShowThinking = () => {
    const nextShowThinking = !showThinkingRequestRef.current;
    showThinkingRequestRef.current = nextShowThinking;
    setSnapshot((current) => current ? { ...current, showThinking: nextShowThinking } : current);
    void api.setShowThinking(nextShowThinking).then((state) => {
      if (showThinkingRequestRef.current === nextShowThinking) {
        setSnapshot(state);
      }
    });
  };

  const handleSetSessionToolAccess = (selection: ToolAccessSelection) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () =>
      api.setSessionToolAccess(selectedWorkspace.id, selectedSession.id, selection),
    );
  };

  const handleRunFastCommand = (command: string) => {
    if (!selectedSession) {
      return;
    }
    const previousDraft = composerDraft;
    setComposerDraft("");
    void updateSnapshot(api, setSnapshot, () => api.submitComposer(command)).then((nextState) => {
      setComposerDraft(nextState.composerDraft);
    }).catch(() => {
      setComposerDraft(previousDraft);
    });
  };

  const handleSetDefaultModel = (provider: string, modelId: string) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setDefaultModel(settingsWorkspace.id, provider, modelId));
  };

  const handleSetThinkingLevel = (thinkingLevel: RuntimeSnapshot["settings"]["defaultThinkingLevel"]) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setDefaultThinkingLevel(settingsWorkspace.id, thinkingLevel));
  };

  const handleToggleSkillCommands = (enabled: boolean) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setEnableSkillCommands(settingsWorkspace.id, enabled));
  };

  const handleSetScopedModelPatterns = (patterns: readonly string[]) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setScopedModelPatterns(settingsWorkspace.id, patterns));
  };

  const handleSaveAgentDefinition = async (input: SaveAgentDefinitionInput) => {
    if (!api || !settingsWorkspace) {
      return;
    }
    setAgentDefinitionsPending(true);
    setAgentDefinitionsError(undefined);
    try {
      setAgentDefinitions(await api.saveAgentDefinition(settingsWorkspace.id, input));
    } catch (error) {
      setAgentDefinitionsError(error instanceof Error ? error.message : String(error));
      console.warn("Failed to save agent definition", error);
      throw error;
    } finally {
      setAgentDefinitionsPending(false);
    }
  };

  const handleResetAgentDefinition = async (input: ResetAgentDefinitionInput) => {
    if (!api || !settingsWorkspace) {
      return;
    }
    setAgentDefinitionsPending(true);
    setAgentDefinitionsError(undefined);
    try {
      setAgentDefinitions(await api.resetAgentDefinition(settingsWorkspace.id, input));
    } catch (error) {
      setAgentDefinitionsError(error instanceof Error ? error.message : String(error));
      console.warn("Failed to reset agent definition", error);
      throw error;
    } finally {
      setAgentDefinitionsPending(false);
    }
  };

  const handleDeleteAgentDefinition = async (input: DeleteAgentDefinitionInput) => {
    if (!api || !settingsWorkspace) {
      return;
    }
    setAgentDefinitionsPending(true);
    setAgentDefinitionsError(undefined);
    try {
      setAgentDefinitions(await api.deleteAgentDefinition(settingsWorkspace.id, input));
    } catch (error) {
      setAgentDefinitionsError(error instanceof Error ? error.message : String(error));
      console.warn("Failed to delete agent definition", error);
      throw error;
    } finally {
      setAgentDefinitionsPending(false);
    }
  };

  const handleSetModelSettingsScopeMode = (mode: "app-global" | "per-repo") => {
    if (!api) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setModelSettingsScopeMode(mode));
  };

  const handleLoginProvider = (providerId: string) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.loginProvider(settingsWorkspace.id, providerId));
  };

  const handleLogoutProvider = (providerId: string) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.logoutProvider(settingsWorkspace.id, providerId));
  };

  const handleSetProviderApiKey = async (providerId: string, apiKey: string): Promise<string | undefined> => {
    if (!api || !settingsWorkspace) {
      return "Select a workspace first.";
    }
    const state = await updateSnapshot(api, setSnapshot, () =>
      api.setProviderApiKey(settingsWorkspace.id, providerId, apiKey),
    );
    return state.lastError;
  };

  const handleRemoveProviderApiKey = async (providerId: string): Promise<string | undefined> => {
    if (!api || !settingsWorkspace) {
      return "Select a workspace first.";
    }
    const state = await updateSnapshot(api, setSnapshot, () =>
      api.logoutProvider(settingsWorkspace.id, providerId),
    );
    return state.lastError;
  };

  const handleSetSkillMode = (filePath: string, mode: "auto" | "manual" | "off") => {
    if (!skillsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setSkillMode(skillsWorkspace.id, filePath, mode));
  };

  const handleSetActiveSkillProfile = (workspaceId: string | undefined, profileId: string) => {
    if (!workspaceId) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setActiveSkillProfile(workspaceId, profileId));
  };

  const handleSaveSkillProfile = (workspaceId: string | undefined, profile: RuntimeSkillProfileRecord) => {
    if (!workspaceId) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.saveSkillProfile(workspaceId, profile));
  };

  const handleDeleteSkillProfile = (workspaceId: string | undefined, profileId: string) => {
    if (!workspaceId) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.deleteSkillProfile(workspaceId, profileId));
  };

  const openSkillProfiles = (workspaceId?: string) => {
    openSkills(workspaceId);
  };

  const handleOpenSkillFolder = (filePath: string) => {
    if (!skillsWorkspace) {
      return;
    }
    void api.openSkillInFinder(skillsWorkspace.id, filePath);
  };

  const handleToggleExtension = (filePath: string, enabled: boolean) => {
    if (!extensionsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setExtensionEnabled(extensionsWorkspace.id, filePath, enabled));
  };

  const handleOpenExtensionFolder = (filePath: string) => {
    if (!extensionsWorkspace) {
      return;
    }
    void api.openExtensionInFinder(extensionsWorkspace.id, filePath);
  };

  const handleTrySkill = (command: string) => {
    void updateSnapshot(api, setSnapshot, () => api.setActiveView("threads"));
    slashMenu.fillComposerFromSlash(command);
  };

  const handleSetThemeMode = (mode: "system" | "light" | "dark") => {
    if (!api) return;
    setThemeMode(mode);
    void api.setThemeMode(mode);
  };

  const handleSetNotificationPreferences = (preferences: Partial<DesktopAppState["notificationPreferences"]>) => {
    void updateSnapshot(api, setSnapshot, () => api.setNotificationPreferences(preferences));
  };

  const handleSetIntegratedTerminalShell = (shellPath: string) => {
    void updateSnapshot(api, setSnapshot, () => api.setIntegratedTerminalShell(shellPath));
  };

  const handleRequestNotificationPermission = () => {
    if (!api?.requestNotificationPermission) {
      return;
    }
    setNotificationPermissionPending(true);
    void api
      .requestNotificationPermission()
      .then((status) => {
        setNotificationPermissionStatus(status);
      })
      .finally(() => {
        setNotificationPermissionPending(false);
      });
  };

  const handleOpenSystemNotificationSettings = () => {
    if (!api?.openSystemNotificationSettings) {
      return;
    }
    setNotificationPermissionPending(true);
    void api
      .openSystemNotificationSettings()
      .finally(() => {
        setNotificationPermissionPending(false);
      });
  };

  const handleArchiveSession = (target: { workspaceId: string; sessionId: string }) => {
    void updateSnapshot(api, setSnapshot, () => api.archiveSession(target));
  };

  const handleSelectSession = (target: { workspaceId: string; sessionId: string }) => {
    if (vsCodeOpen) {
      const targetWorkspace = snapshot.workspaces.find((workspace) => workspace.id === target.workspaceId);
      if (targetWorkspace) {
        flushSync(() => {
          setVsCodeWorkspaceId(targetWorkspace.id);
          setVsCodeFolderPath(targetWorkspace.path);
        });
      }
    }

    void updateSnapshot(api, setSnapshot, () => api.selectSession(target)).then(() => {
      focusComposer();
    });
  };

  const handleRespondToExtensionDialog = (
    response:
      | { readonly requestId: string; readonly value: string }
      | { readonly requestId: string; readonly confirmed: boolean }
      | { readonly requestId: string; readonly cancelled: true },
  ) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }

    void updateSnapshot(api, setSnapshot, () =>
      api.respondToHostUiRequest(selectedWorkspace.id, selectedSession.id, response),
    ).then(() => {
      focusComposer();
    });
  };

  const handleToggleExtensionDock = () => {
    if (!selectedExtensionDock) {
      return;
    }

    setDockExpandedBySession((current) => ({
      ...current,
      [selectedSessionKey]: !(current[selectedSessionKey] ?? false),
    }));
  };

  const handleUnarchiveSession = (target: { workspaceId: string; sessionId: string }) => {
    void updateSnapshot(api, setSnapshot, () => api.unarchiveSession(target));
  };

  const handleStartThread = () => {
    if (!newThreadRootWorkspaceId || (!newThreadPrompt.trim() && newThreadAttachments.length === 0)) {
      return;
    }
    if (newThreadModelOnboarding.requiresModelSelection) {
      return;
    }
    const treeCommand = parseTreeComposerCommand(newThreadPrompt);
    if (treeCommand?.type === "error") {
      setNewThreadComposerError(treeCommand.message);
      return;
    }
    if (treeCommand?.type === "tree") {
      setNewThreadComposerError("/tree is only available inside an existing session.");
      return;
    }
    recordSubmittedSkillUsage(newThreadPrompt, newThreadRuntime);
    const modelConfig = {
      prompt: newThreadPrompt,
      attachments: newThreadAttachments,
      provider: resolvedNewThreadProvider,
      modelId: resolvedNewThreadModelId,
      thinkingLevel: resolvedNewThreadThinkingLevel,
      toolAccess: resolvedNewThreadToolAccess,
      fastMode: newThreadFastMode,
    };
    const input: StartThreadInput = {
      rootWorkspaceId: newThreadRootWorkspaceId,
      environment: newThreadEnvironment,
      ...modelConfig,
    };
    wsMenu.expandWorkspace(newThreadRootWorkspaceId);
    void updateSnapshot(api, setSnapshot, () =>
      api.startThread(input),
    ).then(() => {
      setNewThreadPrompt("");
      setNewThreadAttachments([]);
      setNewThreadProvider(undefined);
      setNewThreadModelId(undefined);
      setNewThreadThinkingLevel(undefined);
      setNewThreadToolAccess(DEFAULT_TOOL_ACCESS);
      setNewThreadFastMode("auto");
      setNewThreadEnvironment("local");
    });
  };

  const handleTimelineScroll = () => {
    const pane = timelinePaneRef.current;
    if (!pane) {
      return;
    }

    const pinned = isNearBottom(pane);
    const userScrollIntent = userTimelineScrollIntentRef.current;
    userTimelineScrollIntentRef.current = false;

    if (!pinned) {
      if (!userScrollIntent) {
        if (manualTimelineScrollRestoreRef.current) {
          return;
        }
        const previousScrollTop = lastTimelineScrollTopBySessionRef.current.get(selectedSessionKey);
        const scrolledUpWithoutIntent = previousScrollTop !== undefined && pane.scrollTop < previousScrollTop - 2;
        if (
          (followingLatestRef.current || pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) &&
          !scrolledUpWithoutIntent
        ) {
          return;
        }
      }
      pinnedToBottomRef.current = false;
      followingLatestRef.current = false;
      manualTimelineScrollTopRef.current = pane.scrollTop;
      preserveBottomOnNextPaneResizeRef.current = false;
      resetExactBottomRestoreState();
      lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
      lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, false);
      return;
    }

    pinnedToBottomRef.current = true;
    followingLatestRef.current = true;
    manualTimelineScrollTopRef.current = null;
    lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
    lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, true);
    setShowJumpToLatest(false);
  };

  timelineScrollHandlerRef.current = handleTimelineScroll;

  const jumpToLatest = () => {
    followingLatestRef.current = true;
    requestPinnedBottomAlignment("smooth", { preferExactRestore: true });
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (handleClipboardImageShortcut(event, (clipboardImage) => {
      void updateSnapshot(api, setSnapshot, () => api.addComposerAttachments([clipboardImage]));
    })) {
      return;
    }

    if (mentionMenu.handleMentionKeyDown(event)) {
      return;
    }

    if (slashMenu.handleSlashKeyDown(event)) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && selectedSession?.status === "running") {
      event.preventDefault();
      submitComposerDraft({ deliverAs: (event.metaKey || event.ctrlKey) ? "steer" : "followUp" });
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    if (!composerDraft.trim() && composerAttachments.length === 0) {
      return;
    }
    if (selectedSessionModelOnboarding.requiresModelSelection) {
      return;
    }

    submitComposerDraft();
  };

  const handleNewThreadComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (handleClipboardImageShortcut(event, (clipboardImage) => {
      setNewThreadAttachments((current) => [...current, clipboardImage]);
    })) {
      return;
    }

    if (newThreadMentionMenu.handleMentionKeyDown(event)) {
      return;
    }

    if (newThreadSlashMenu.handleSlashKeyDown(event)) {
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    if (!newThreadPrompt.trim() && newThreadAttachments.length === 0) {
      return;
    }
    if (newThreadModelOnboarding.requiresModelSelection) {
      return;
    }

    handleStartThread();
  };

  const settingsNav = [
    { id: "appearance", label: "Appearance" },
    { id: "general", label: "General" },
    { id: "providers", label: "Providers" },
    { id: "models", label: "Models" },
    { id: "agents", label: "Subagents" },
    { id: "notifications", label: "Notifications" },
  ] as const;

  const commandPalette = commandPaletteOpen ? (
    <CommandPalette actions={commandPaletteActions} onClose={() => setCommandPaletteOpen(false)} />
  ) : null;

  if (snapshot.activeView === "settings") {
    return (
      <>
        {commandPalette}
        <SecondarySurface
        activeNavId={settingsSection}
        navItems={settingsNav}
        onBack={() => setActiveView("threads")}
        onSelectNav={(section) => setSettingsSection(section as SettingsSection)}
        testId="settings-surface"
        title="Settings"
      >
        {settingsSection === "providers" || settingsSection === "agents" || (settingsSection === "models" && snapshot.modelSettingsScopeMode === "per-repo") ? (
          <div className="surface-toolbar">
            <label className="surface-toolbar__field">
              <span>Discovery workspace</span>
              <select
                value={settingsWorkspace?.id ?? ""}
                onChange={(event) => setSettingsWorkspaceId(event.target.value)}
              >
                {rootWorkspaceOptions.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        <SettingsView
          workspace={settingsWorkspace}
          runtime={settingsSection === "models" || settingsSection === "agents" ? settingsModelRuntime : settingsRuntime}
          section={settingsSection}
          notificationPreferences={snapshot.notificationPreferences}
          agentDefinitions={agentDefinitions}
          agentDefinitionsPending={agentDefinitionsPending}
          agentDefinitionsError={agentDefinitionsError}
          notificationPermissionStatus={notificationPermissionStatus}
          notificationPermissionPending={notificationPermissionPending}
          modelSettingsScopeMode={snapshot.modelSettingsScopeMode}
          integratedTerminalShell={snapshot.integratedTerminalShell}
          themeMode={themeMode}
          onLoginProvider={handleLoginProvider}
          onLogoutProvider={handleLogoutProvider}
          onSetProviderApiKey={handleSetProviderApiKey}
          onRemoveProviderApiKey={handleRemoveProviderApiKey}
          onSetModelSettingsScopeMode={handleSetModelSettingsScopeMode}
          onSetDefaultModel={handleSetDefaultModel}
          onSetNotificationPreferences={handleSetNotificationPreferences}
          onSetIntegratedTerminalShell={handleSetIntegratedTerminalShell}
          onRequestNotificationPermission={handleRequestNotificationPermission}
          onOpenSystemNotificationSettings={handleOpenSystemNotificationSettings}
          onSetScopedModelPatterns={handleSetScopedModelPatterns}
          onSetThemeMode={handleSetThemeMode}
          onSetThinkingLevel={handleSetThinkingLevel}
          onToggleSkillCommands={handleToggleSkillCommands}
          onSaveAgentDefinition={handleSaveAgentDefinition}
          onResetAgentDefinition={handleResetAgentDefinition}
          onDeleteAgentDefinition={handleDeleteAgentDefinition}
          onOpenAgentsSettings={() => setSettingsSection("agents")}
        />
        </SecondarySurface>
      </>
    );
  }

  if (snapshot.activeView === "review") {
    return (
      <>
        {commandPalette}
        <SecondarySurface onBack={() => setActiveView("threads")} testId="review-surface-shell" title="Review changes">
        {reviewLoading || !reviewSnapshot ? (
          <section className="canvas canvas--empty">
            <div className="empty-panel">
              <div className="session-header__eyebrow">Review</div>
              <h1>Loading review…</h1>
              <p>Freezing the current working-tree diff.</p>
            </div>
          </section>
        ) : (
          <ReviewSurface
            snapshot={reviewSnapshot}
            onCancel={() => setActiveView("threads")}
            onSubmitPrompt={(prompt) => {
              fillComposerFromReview(prompt);
              setActiveView("threads");
            }}
          />
        )}
        </SecondarySurface>
      </>
    );
  }

  if (snapshot.activeView === "skills") {
    return (
      <>
        {commandPalette}
        <SecondarySurface onBack={() => setActiveView("threads")} testId="skills-surface" title="Skills">
        <SkillsView
          workspace={skillsWorkspace}
          runtime={skillsRuntime}
          usageByPath={skillUsageByPath}
          discoveryWorkspaceControl={rootWorkspaceOptions.length > 1 ? (
            <label className="skills-discovery-select" title="Project-local skills are loaded from the selected workspace.">
              <span>Project skills</span>
              <select
                aria-label="Project-local skill workspace"
                value={skillsWorkspace?.id ?? ""}
                onChange={(event) => setSkillsWorkspaceId(event.target.value)}
              >
                {rootWorkspaceOptions.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
          ) : undefined}
          onOpenSkillFolder={handleOpenSkillFolder}
          onRefresh={() => {
            if (!skillsWorkspace) {
              return;
            }
            void updateSnapshot(api, setSnapshot, () => api.refreshRuntime(skillsWorkspace.id));
          }}
          onSetSkillMode={handleSetSkillMode}
          onSetActiveProfile={(profileId) => handleSetActiveSkillProfile(skillsWorkspace?.id, profileId)}
          onSaveProfile={(profile) => handleSaveSkillProfile(skillsWorkspace?.id, profile)}
          onDeleteProfile={(profileId) => handleDeleteSkillProfile(skillsWorkspace?.id, profileId)}
          onTrySkill={(skill) =>
            handleTrySkill(
              skill.filePath
                ? `${skill.slashCommand} `
                : "Create a new skill for this workspace and explain which files you will add.",
            )
          }
        />
        </SecondarySurface>
      </>
    );
  }

  if (snapshot.activeView === "extensions") {
    return (
      <>
        {commandPalette}
        <SecondarySurface onBack={() => setActiveView("threads")} testId="extensions-surface" title="Extensions">
        <div className="surface-toolbar">
          <label className="surface-toolbar__field">
            <span>Workspace</span>
            <select
              value={extensionsWorkspace?.id ?? ""}
              onChange={(event) => setExtensionsWorkspaceId(event.target.value)}
            >
              {rootWorkspaceOptions.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ExtensionsView
          workspace={extensionsWorkspace}
          runtime={extensionsRuntime}
          commandCompatibility={extensionsCommandCompatibility}
          onOpenExtensionFolder={handleOpenExtensionFolder}
          onRefresh={() => {
            if (!extensionsWorkspace) {
              return;
            }
            void updateSnapshot(api, setSnapshot, () => api.refreshRuntime(extensionsWorkspace.id));
          }}
          onToggleExtension={handleToggleExtension}
        />
        </SecondarySurface>
      </>
    );
  }

  const shellClassName = `shell${snapshot.sidebarCollapsed ? " shell--sidebar-collapsed" : ""}`;

  return (
    <div className={shellClassName}>
      {commandPalette}
      {primarySidebarToggleVisible ? (
        <SidebarToggleButton
          collapsed={snapshot.sidebarCollapsed}
          shortcutLabel={sidebarToggleShortcutLabel}
          onToggle={handleTogglePrimarySidebar}
        />
      ) : null}
      {!snapshot.sidebarCollapsed ? (
        <Sidebar
          activeView={snapshot.activeView}
          selectedWorkspace={selectedWorkspace}
          selectedSession={selectedSession}
          visibleWorkspaces={visibleWorkspaces}
          threadGroups={threadGroups}
          linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
          wsMenu={wsMenu}
          api={api}
          setSnapshot={setSnapshot}
          updateSnapshot={updateSnapshot}
          onNewThread={() => openNewThreadSurface(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)}
          onSetActiveView={setActiveView}
          onOpenSkills={openSkills}
          onOpenExtensions={openExtensions}
          onOpenSettings={openSettings}
          onArchiveSession={handleArchiveSession}
          onSelectSession={handleSelectSession}
          onUnarchiveSession={handleUnarchiveSession}
        />
      ) : null}

      <main
        ref={mainRef}
        className={mainClassName}
        style={{ "--thread-vscode-width": `${threadVsCodeWidth}px` } as React.CSSProperties}
      >
        <Topbar
          activeView={snapshot.activeView}
          rootWorkspace={rootWorkspace}
          selectedWorkspace={selectedWorkspace}
          selectedSession={selectedSession}
          selectedSessionTitle={displayedSessionTitle || selectedSession?.title}
          selectedSessionRunningLabel={selectedSession?.status === "running" ? runningLabel : undefined}
          selectedWorktree={selectedWorktree}
          activeWorktrees={activeWorktrees}
          workspaces={snapshot.workspaces}
          wsMenu={wsMenu}
          api={api}
          setSnapshot={setSnapshot}
          updateSnapshot={updateSnapshot}
          terminalAvailable={Boolean(selectedSessionKey) || snapshot.activeView === "new-thread"}
          terminalVisible={isTerminalVisible}
          projectActions={topbarProjectActions}
          onAddAction={openAddActionDialog}
          onRunProjectAction={runProjectAction}
          onToggleTerminal={toggleTerminal}
          planAvailable={planSurfaceAvailable}
          planPanelOpen={planPanelOpen}
          onTogglePlanPanel={() => setPlanPanelOpen((open) => !open)}
          showDiffPanel={showDiffPanel}
          onToggleDiffPanel={toggleDiffPanel}
          drawerOpen={snapshot.activeView === "display-mode" ? dmDrawerOpen : undefined}
          onToggleDrawer={snapshot.activeView === "display-mode" ? toggleDmDrawer : undefined}
          vsCodeOpen={snapshot.activeView === "threads" || snapshot.activeView === "display-mode" ? vsCodeOpen : undefined}
          onToggleVsCode={snapshot.activeView === "threads" ? toggleSelectedWorkspaceVsCode : snapshot.activeView === "display-mode" ? toggleVsCode : undefined}
          onGitCommit={snapshot.activeView === "threads" ? () => openGitDialog("commit") : undefined}
          onGitPush={snapshot.activeView === "threads" ? () => openGitDialog("push") : undefined}
          onGitCreatePr={snapshot.activeView === "threads" ? () => openGitDialog("pr") : undefined}
        />

        {showTerminalTakeover ? (
          terminalPanel
        ) : (
          <>
        {snapshot.activeView === "display-mode" ? (
          <DisplayModeView
            api={api}
            drawerOpen={dmDrawerOpen}
            onToggleDrawer={toggleDmDrawer}
            vsCodeOpen={vsCodeOpen}
            vsCodeWorkspaceId={vsCodeWorkspaceId}
            vsCodeFolderPath={vsCodeFolderPath}
            vsCodeWidth={threadVsCodeWidth}
            onVsCodeWidthChange={setSharedVsCodeWidth}
            onToggleVsCode={toggleVsCode}
            onOpenVsCodeForWorkspace={openVsCodeForWorkspace}
            initialPinnedThreadKey={displayModeInitialPinnedThreadKey}
            vscodeSlotRef={setVsCodeSlotElement}
            runtimeByWorkspace={snapshot.runtimeByWorkspace}
            sessionCommandsBySession={snapshot.sessionCommandsBySession}
            commandCompatibilityByWorkspace={snapshot.extensionCommandCompatibilityByWorkspace}
            setSnapshot={setSnapshot}
            openSettings={openSettings}
            updateSnapshot={updateSnapshot}
            onOpenThread={handleSelectSession}
          />
        ) : snapshot.activeView === "new-thread" ? (
          rootWorkspaceOptions.length > 0 ? (
            <NewThreadView
              workspaces={rootWorkspaceOptions}
              selectedWorkspaceId={newThreadRootWorkspaceId || rootWorkspaceOptions[0]?.id || ""}
              runtime={newThreadRuntime}
              environment={newThreadEnvironment}
              prompt={newThreadPrompt}
              attachments={newThreadAttachments}
              lastError={newThreadComposerError}
              provider={resolvedNewThreadProvider}
              modelId={resolvedNewThreadModelId}
              thinkingLevel={resolvedNewThreadThinkingLevel}
              showThinking={showThinking}
              modelOnboarding={newThreadModelOnboarding}
              toolAccess={resolvedNewThreadToolAccess}
              fastMode={newThreadFastMode}
              skillProfileControl={newThreadRuntime ? (
                <SkillProfileSelector
                  profiles={newThreadRuntime.skillProfiles}
                  activeProfileId={newThreadRuntime.activeSkillProfileId}
                  onSelectProfile={(profileId) => handleSetActiveSkillProfile(newThreadWorkspace?.id, profileId)}
                  onOpenSkillProfiles={() => openSkillProfiles(newThreadWorkspace?.id)}
                />
              ) : undefined}
              composerRef={newThreadComposerRef}
              activeSlashCommand={newThreadSlashMenu.activeSlashFlow?.command}
              activeSlashCommandMeta={newThreadSlashMenu.activeSlashFlow?.command?.description}
              slashSections={newThreadSlashMenu.slashSections}
              slashOptions={newThreadSlashMenu.slashOptions}
              selectedSlashCommand={newThreadSlashMenu.activeSlashOptionCommand ?? newThreadSlashMenu.selectedSlashCommand}
              selectedSlashOption={newThreadSlashMenu.selectedSlashOption}
              showSlashMenu={newThreadSlashMenu.showSlashMenu}
              showSlashOptionMenu={newThreadSlashMenu.showSlashOptionMenu}
              slashOptionEmptyState={newThreadSlashMenu.slashOptionEmptyState}
              showMentionMenu={newThreadMentionMenu.showMentionMenu}
              mentionOptions={newThreadMentionMenu.mentionOptions}
              selectedMentionIndex={newThreadMentionMenu.selectedIndex}
              onChangePrompt={setNewThreadPrompt}
              onSelectEnvironment={setNewThreadEnvironment}
              onSelectWorkspace={handleSelectNewThreadWorkspace}
              onSetModel={(provider, modelId) => { setNewThreadProvider(provider); setNewThreadModelId(modelId); }}
              onSetThinking={setNewThreadThinkingLevel}
              onToggleShowThinking={handleToggleShowThinking}
              onSetToolAccess={setNewThreadToolAccess}
              onSetFastMode={setNewThreadFastMode}
              onOpenModelSettings={(section) => openSettings(newThreadWorkspace?.id, section)}
              onComposerKeyDown={handleNewThreadComposerKeyDown}
              onComposerPaste={handleNewThreadComposerPaste}
              onComposerDrop={handleNewThreadComposerDrop}
              onClearSlashCommand={newThreadSlashMenu.resetSlashUi}
              onSelectSlashCommand={(command) => {
                newThreadSlashMenu.applySlashCommandSelection(command, "click");
              }}
              onSelectSlashOption={(option) => {
                newThreadSlashMenu.applySlashOptionSelection(option);
              }}
              onSelectMention={newThreadMentionMenu.insertMention}
              onAddAttachments={handleNewThreadAddAttachments}
              onRemoveAttachment={handleNewThreadRemoveAttachment}
              onSubmit={handleStartThread}
              checkoutSelector={createCheckoutSelector(newThreadWorkspace, "new-thread")}
            />
          ) : (
            <section className="canvas canvas--empty">
              <div className="empty-panel">
                <div className="session-header__eyebrow">Workspace</div>
                <h1>Open a folder to start</h1>
                <p>Add a project folder before creating a new thread.</p>
              </div>
            </section>
          )
        ) : selectedWorkspace && selectedSession ? (
          <>
            <section className="canvas canvas--thread">
              <div className="conversation conversation--thread">
                <ConversationTimeline
                  transcript={activeTranscript}
                  isTranscriptLoading={isTranscriptLoading}
                  timelinePaneRef={timelinePaneRef}
                  timelinePaneElementRef={setTimelinePaneElement}
                  disableVirtualization={disableTimelineVirtualization}
                  onDisableVirtualizationReady={finalizeTimelineVirtualizationDisable}
                  onTimelineScroll={handleTimelineScroll}
                  threadSearch={threadSearch}
                  showJumpToLatest={showJumpToLatest}
                  onJumpToLatest={jumpToLatest}
                  onContentHeightChange={handleTimelineContentHeightChange}
                  onViewFileInDiff={handleViewFileInDiff}
                />
              </div>
            </section>
            <ComposerPanel
              key={selectedSessionKey}
              activeSlashCommand={slashMenu.activeSlashFlow?.command}
              activeSlashCommandMeta={slashMenu.activeSlashFlow?.command?.description}
              attachments={composerAttachments}
              queuedMessages={queuedComposerMessages}
              editingQueuedMessageId={editingQueuedMessageId}
              composerDraft={composerDraft}
              composerRef={composerRef}
              runtime={selectedModelRuntime}
              provider={resolvedSessionProvider}
              modelId={resolvedSessionModelId}
              thinkingLevel={resolvedSessionThinkingLevel}
              showThinking={showThinking}
              thinkingActive={thinkingActive}
              toolAccess={resolvedSessionToolAccess}
              sessionCommands={selectedSessionCommands}
              onSetToolAccess={handleSetSessionToolAccess}
              onClearSlashCommand={slashMenu.resetSlashUi}
              onComposerKeyDown={handleComposerKeyDown}
              onComposerPaste={handleComposerPaste}
              onComposerDrop={handleComposerDrop}
              onPickAttachments={handlePickAttachments}
              onRemoveAttachment={handleRemoveAttachment}
              onEditQueuedMessage={handleEditQueuedMessage}
              onCancelQueuedEdit={handleCancelQueuedEdit}
              onRemoveQueuedMessage={handleRemoveQueuedMessage}
              onSteerQueuedMessage={handleSteerQueuedMessage}
              onSelectSlashCommand={(command) => {
                slashMenu.applySlashCommandSelection(command, "click");
              }}
              onSelectSlashOption={(option) => {
                slashMenu.applySlashOptionSelection(option);
              }}
              onSetModel={handleSetSessionModel}
              onSetThinking={handleSetSessionThinking}
              onToggleShowThinking={handleToggleShowThinking}
              onRunFastCommand={handleRunFastCommand}
              skillProfileControl={selectedRuntime ? (
                <SkillProfileSelector
                  profiles={selectedRuntime.skillProfiles}
                  activeProfileId={selectedRuntime.activeSkillProfileId}
                  onSelectProfile={(profileId) => handleSetActiveSkillProfile(selectedWorkspace?.id, profileId)}
                  onOpenSkillProfiles={() => openSkillProfiles(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)}
                />
              ) : undefined}
              modelOnboarding={selectedSessionModelOnboarding}
              onOpenModelSettings={(section) =>
                openSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id, section)
              }
              onSubmit={submitComposerDraft}
              sessionStatus={selectedSession.status}
              lastError={snapshot.lastError}
              selectedSlashCommand={slashMenu.activeSlashOptionCommand ?? slashMenu.selectedSlashCommand}
              selectedSlashOption={slashMenu.selectedSlashOption}
              slashOptionEmptyState={slashMenu.slashOptionEmptyState}
              setComposerDraft={setComposerDraft}
              showSlashOptionMenu={slashMenu.showSlashOptionMenu}
              showSlashMenu={slashMenu.showSlashMenu}
              slashOptions={slashMenu.slashOptions}
              slashSections={slashMenu.slashSections}
              showMentionMenu={mentionMenu.showMentionMenu}
              mentionOptions={mentionMenu.mentionOptions}
              selectedMentionIndex={mentionMenu.selectedIndex}
              onSelectMention={mentionMenu.insertMention}
              extensionDock={selectedExtensionDock}
              extensionDockExpanded={isSelectedExtensionDockExpanded}
              onToggleExtensionDock={handleToggleExtensionDock}
              checkoutSelector={createCheckoutSelector(selectedWorkspace)}
            />
            {activeExtensionDialog ? (
              <ExtensionDialog dialog={activeExtensionDialog} onRespond={handleRespondToExtensionDialog} />
            ) : null}
            {gitDialog === "commit" ? (
              <CommitDialog
                branchName={gitBranchName}
                error={gitActionError}
                files={gitChangedFiles}
                workspaceName={selectedWorkspace.name}
                pending={gitActionPending}
                onClose={closeGitDialog}
                onSubmit={handleCommitChanges}
              />
            ) : null}
            {gitDialog === "push" ? (
              <PushDialog
                allowSetUpstream={isSetUpstreamError(gitActionError)}
                branchName={gitBranchName ?? selectedWorkspace.branchName}
                error={gitActionError}
                pending={gitActionPending}
                onClose={closeGitDialog}
                onSubmit={handlePushBranch}
              />
            ) : null}
            {gitDialog === "pr" ? (
              <CreatePrDialog
                branchName={gitBranchName ?? selectedWorkspace.branchName}
                error={gitActionError}
                pending={gitActionPending}
                onClose={closeGitDialog}
                onSubmit={handleCreatePullRequest}
              />
            ) : null}
            {treeModalState.open ? (
              <TreeModal
                error={treeModalState.error}
                loading={treeModalState.loading}
                submitting={treeModalState.submitting}
                tree={treeModalState.tree}
                onClose={closeTreeModal}
                onNavigate={navigateTreeSelection}
              />
            ) : null}
            {showPlanPanel && latestPlan ? (
              <PlanPanel
                plan={latestPlan}
                onClose={() => setPlanPanelOpen(false)}
                onImplement={askPiToImplementLatestPlan}
              />
            ) : null}
          </>
        ) : selectedWorkspace ? (
          <section className="canvas canvas--empty">
            <div className="empty-panel">
              <div className="session-header__eyebrow">Workspace</div>
              <h1>{selectedWorkspace.name}</h1>
              <p>Create a thread for this folder, then jump between sessions from the sidebar.</p>
              <div className="empty-panel__actions">
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => openNewThreadSurface(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)}
                >
                  New thread
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="canvas canvas--empty">
            <div className="empty-panel">
              <div className="session-header__eyebrow">Workspace</div>
              <h1>Open a folder to start</h1>
              <p>Add project folders, group sessions under them, and jump between threads from the sidebar.</p>
            </div>
          </section>
        )}

        {terminalPanel}
          </>
        )}
        {showThreadVsCodePanel && threadVsCodeTarget ? (
          <>
            <div
              className="thread-vscode-resize-handle"
              role="separator"
              tabIndex={0}
              aria-label="Resize VS Code panel"
              aria-orientation="vertical"
              aria-valuemin={threadVsCodeMinWidth}
              aria-valuemax={threadVsCodeMaxWidth}
              aria-valuenow={threadVsCodeWidth}
              onKeyDown={handleThreadVsCodeResizeKeyDown}
              onPointerDown={startThreadVsCodeResize}
            />
            <div
              ref={setVsCodeSlotElement}
              className="thread-vscode-panel thread-vscode-panel--slot"
              aria-hidden="true"
            />
          </>
        ) : null}
        {showPersistentVsCodePanel && persistentVsCodeTarget ? (
          <VSCodePanel
            api={api}
            workspaceId={persistentVsCodeTarget.workspaceId}
            folderPath={persistentVsCodeTarget.folderPath}
            className="persistent-vscode-panel"
            testId={snapshot.activeView === "display-mode" ? "display-mode-vscode-panel" : "thread-vscode-panel"}
            style={vsCodePanelStyle}
          />
        ) : null}
        {showDiffPanel && selectedWorkspace && selectedSession ? (
          <DiffPanel
            workspaceId={selectedWorkspace.id}
            sessionId={selectedSession.id}
            api={api}
            sessionStatus={selectedSession.status}
            fileRequest={diffFileRequest}
          />
        ) : null}
      </main>
      {addActionDialogOpen ? (
        <AddActionDialog
          onClose={() => setAddActionDialogOpen(false)}
          onSave={saveProjectAction}
        />
      ) : null}
    </div>
  );
}

function buildTranscriptChangeMarker(sessionKey: string, transcript: SelectedTranscriptRecord["transcript"]): string {
  const lastItem = transcript.at(-1);
  if (!lastItem) {
    return `${sessionKey}:0:empty`;
  }

  switch (lastItem.kind) {
    case "message": {
      const tail = lastItem.text.slice(-48);
      const attachmentCount = lastItem.attachments?.length ?? 0;
      return [
        sessionKey,
        transcript.length,
        lastItem.id,
        lastItem.kind,
        lastItem.role,
        lastItem.text.length,
        tail,
        attachmentCount,
      ].join(":");
    }
    case "thinking":
      return [
        sessionKey,
        transcript.length,
        lastItem.id,
        lastItem.kind,
        lastItem.status,
        lastItem.text.length,
        lastItem.text.slice(-48),
      ].join(":");
    case "tool": {
      const inputSize = estimateUnknownSize(lastItem.input);
      const outputSize = estimateUnknownSize(lastItem.output);
      return [
        sessionKey,
        transcript.length,
        lastItem.id,
        lastItem.kind,
        lastItem.callId,
        lastItem.status,
        lastItem.label,
        lastItem.detail ?? "",
        inputSize,
        outputSize,
      ].join(":");
    }
    case "activity":
      return [
        sessionKey,
        transcript.length,
        lastItem.id,
        lastItem.kind,
        lastItem.label,
        lastItem.detail ?? "",
        lastItem.metadata ?? "",
        lastItem.tone ?? "",
      ].join(":");
    case "summary":
      return [
        sessionKey,
        transcript.length,
        lastItem.id,
        lastItem.kind,
        lastItem.presentation,
        lastItem.label.length,
        lastItem.label.slice(-48),
        lastItem.metadata ?? "",
      ].join(":");
  }
}

function estimateUnknownSize(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "string") return value.length;
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length;
  return 1;
}

function parseTerminalSessionKey(key: string): { workspaceId: string; sessionId: string } | null {
  const separatorIndex = key.lastIndexOf(":");
  if (separatorIndex <= 0 || separatorIndex === key.length - 1) {
    return null;
  }
  return {
    workspaceId: key.slice(0, separatorIndex),
    sessionId: key.slice(separatorIndex + 1),
  };
}

function isNearBottom(element: HTMLDivElement): boolean {
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
  return remaining < 32;
}
