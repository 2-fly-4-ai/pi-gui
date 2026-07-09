import type * as React from "react";
import { flushSync } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AppView, DesktopAppState, WorkspaceRecord } from "../../desktop-state";
import { logIgnoredError } from "../../renderer-diagnostics";
import {
  clampBrowserSidePanelWidth,
  getDefaultBrowserSidePanelWidth,
  getMaxBrowserSidePanelWidth,
  getMinBrowserSidePanelWidth,
  storeBrowserSidePanelWidth,
} from "../../browser-panel-width";
import {
  clampVsCodeSidePanelWidth,
  getInitialVsCodeSidePanelWidth,
  getMaxVsCodeSidePanelWidth,
  getMinVsCodeSidePanelWidth,
  storeVsCodeSidePanelWidth,
} from "../../vscode-panel-width";

interface PanelLayoutOptions {
  readonly activeView: AppView | undefined;
  readonly sidebarCollapsed: boolean;
  readonly workspaceCount: number;
  readonly selectedSessionKey: string;
  readonly mainRef: React.MutableRefObject<HTMLElement | null>;
}

export function usePanelLayout({
  activeView,
  sidebarCollapsed,
  workspaceCount,
  selectedSessionKey,
  mainRef,
}: PanelLayoutOptions) {
  const [dmDrawerOpen, setDmDrawerOpen] = useState(() => {
    try {
      return localStorage.getItem("dm:drawerOpen") !== "false";
    } catch (error) {
      logIgnoredError("app.dmDrawerOpen.readLocalStorage", error);
      return true;
    }
  });
  const [logsOpen, setLogsOpen] = useState(() => {
    try {
      return localStorage.getItem("logs:open") === "true";
    } catch (error) {
      logIgnoredError("app.logsOpen.readLocalStorage", error);
      return false;
    }
  });
  const [vsCodeOpen, setVsCodeOpen] = useState(false);
  const [vsCodeWorkspaceId, setVsCodeWorkspaceId] = useState<string | null>(null);
  const [vsCodeFolderPath, setVsCodeFolderPath] = useState<string | null>(null);
  const [vsCodeSlotElement, setVsCodeSlotElement] = useState<HTMLElement | null>(null);
  const [vsCodePanelStyle, setVsCodePanelStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  const [threadVsCodeWidth, setThreadVsCodeWidth] = useState(() => getInitialVsCodeSidePanelWidth());
  const [sideBrowserOpen, setSideBrowserOpen] = useState(false);
  const [sideBrowserUrl, setSideBrowserUrl] = useState<string | undefined>();
  const [browserPanelWidth, setBrowserPanelWidth] = useState(() => getDefaultBrowserSidePanelWidth());
  const [openTerminalSessionKeys, setOpenTerminalSessionKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [takeoverTerminalSessionKeys, setTakeoverTerminalSessionKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [activeTerminalSessionKey, setActiveTerminalSessionKey] = useState("");
  const [terminalHeight, setTerminalHeight] = useState(340);
  const threadVsCodeWidthRef = useRef(threadVsCodeWidth);
  const browserPanelWidthRef = useRef(browserPanelWidth);

  const setThreadVsCodeCssWidth = useCallback((width: number) => {
    mainRef.current?.style.setProperty("--thread-vscode-width", `${width}px`);
  }, [mainRef]);
  const setBrowserPanelCssWidth = useCallback((width: number) => {
    mainRef.current?.style.setProperty("--thread-browser-width", `${width}px`);
  }, [mainRef]);

  const getThreadVsCodeContainerWidth = useCallback(
    () => mainRef.current?.getBoundingClientRect().width ?? window.innerWidth,
    [mainRef],
  );
  const getThreadBrowserContainerWidth = useCallback(
    () => mainRef.current?.getBoundingClientRect().width ?? window.innerWidth,
    [mainRef],
  );

  const applyThreadVsCodeWidth = useCallback((width: number, containerWidth = getThreadVsCodeContainerWidth()) => {
    const nextWidth = clampVsCodeSidePanelWidth(width, containerWidth);
    threadVsCodeWidthRef.current = nextWidth;
    setThreadVsCodeCssWidth(nextWidth);
    return nextWidth;
  }, [getThreadVsCodeContainerWidth, setThreadVsCodeCssWidth]);

  const applyThreadBrowserWidth = useCallback((width: number, containerWidth = getThreadBrowserContainerWidth()) => {
    const nextWidth = clampBrowserSidePanelWidth(width, containerWidth);
    browserPanelWidthRef.current = nextWidth;
    setBrowserPanelCssWidth(nextWidth);
    return nextWidth;
  }, [getThreadBrowserContainerWidth, setBrowserPanelCssWidth]);

  const setSharedVsCodeWidth = useCallback((width: number) => {
    threadVsCodeWidthRef.current = width;
    setThreadVsCodeCssWidth(width);
    flushSync(() => {
      setThreadVsCodeWidth(width);
    });
  }, [setThreadVsCodeCssWidth]);

  const toggleDmDrawer = useCallback(() => {
    setDmDrawerOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem("dm:drawerOpen", String(next));
      } catch (error) {
        logIgnoredError("app.dmDrawerOpen.writeLocalStorage", error);
      }
      return next;
    });
  }, []);

  const setLogsPanelOpen = useCallback((open: boolean) => {
    try {
      localStorage.setItem("logs:open", String(open));
    } catch (error) {
      logIgnoredError("app.logsOpen.writeLocalStorage", error);
    }
    setLogsOpen(open);
  }, []);

  const toggleLogsPanel = useCallback(() => {
    setLogsOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem("logs:open", String(next));
      } catch (error) {
        logIgnoredError("app.logsOpen.toggleLocalStorage", error);
      }
      return next;
    });
  }, []);

  const toggleVsCode = useCallback(() => setVsCodeOpen((open) => !open), []);
  const openVsCodeForWorkspace = useCallback((workspaceId: string, folderPath: string) => {
    setVsCodeWorkspaceId(workspaceId);
    setVsCodeFolderPath(folderPath);
    setVsCodeOpen(true);
  }, []);

  const updateVsCodeTarget = useCallback((workspace: WorkspaceRecord) => {
    flushSync(() => {
      setVsCodeWorkspaceId(workspace.id);
      setVsCodeFolderPath(workspace.path);
    });
  }, []);

  const toggleSelectedWorkspaceVsCode = useCallback((workspace: WorkspaceRecord | undefined) => {
    if (!workspace) {
      return;
    }
    setVsCodeWorkspaceId(workspace.id);
    setVsCodeFolderPath(workspace.path);
    setVsCodeOpen((open) => {
      const alreadyTargetingSelected = vsCodeWorkspaceId === workspace.id && vsCodeFolderPath === workspace.path;
      return alreadyTargetingSelected ? !open : true;
    });
  }, [vsCodeFolderPath, vsCodeWorkspaceId]);

  const toggleSideBrowser = useCallback(() => {
    setSideBrowserOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        setVsCodeOpen(false);
      }
      return nextOpen;
    });
  }, []);

  const openSideBrowserUrl = useCallback((url: string) => {
    setSideBrowserUrl(url);
    setSideBrowserOpen(true);
    setVsCodeOpen(false);
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

  const startThreadBrowserResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = browserPanelWidthRef.current;
    const containerWidth = getThreadBrowserContainerWidth();

    const onMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      applyThreadBrowserWidth(startWidth + delta, containerWidth);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setBrowserPanelWidth(browserPanelWidthRef.current);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [applyThreadBrowserWidth, getThreadBrowserContainerWidth]);

  const handleThreadBrowserResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const containerWidth = getThreadBrowserContainerWidth();
    let nextWidth: number | undefined;

    switch (event.key) {
      case "ArrowLeft":
        nextWidth = browserPanelWidthRef.current + 24;
        break;
      case "ArrowRight":
        nextWidth = browserPanelWidthRef.current - 24;
        break;
      case "Home":
        nextWidth = getMinBrowserSidePanelWidth(containerWidth);
        break;
      case "End":
        nextWidth = getMaxBrowserSidePanelWidth(containerWidth);
        break;
      default:
        return;
    }

    event.preventDefault();
    setBrowserPanelWidth(applyThreadBrowserWidth(nextWidth, containerWidth));
  }, [applyThreadBrowserWidth, getThreadBrowserContainerWidth]);

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

  const openTerminalForSession = useCallback((sessionKey: string) => {
    setOpenTerminalSessionKeys((current) => {
      const next = new Set(current);
      next.add(sessionKey);
      return next;
    });
    setActiveTerminalSessionKey(sessionKey);
  }, []);

  const closeTerminal = useCallback((sessionKey: string) => {
    setOpenTerminalSessionKeys((current) => {
      const next = new Set(current);
      next.delete(sessionKey);
      if (activeTerminalSessionKey === sessionKey) {
        setActiveTerminalSessionKey([...next][0] ?? "");
      }
      return next;
    });
    setTakeoverTerminalSessionKeys((current) => {
      const next = new Set(current);
      next.delete(sessionKey);
      return next;
    });
  }, [activeTerminalSessionKey]);

  const removeTerminalTakeover = useCallback((sessionKey: string) => {
    setTakeoverTerminalSessionKeys((current) => {
      const next = new Set(current);
      next.delete(sessionKey);
      return next;
    });
  }, []);

  const toggleTerminalTakeover = useCallback((sessionKey: string) => {
    setTakeoverTerminalSessionKeys((current) => {
      const next = new Set(current);
      if (next.has(sessionKey)) {
        next.delete(sessionKey);
      } else {
        next.add(sessionKey);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (workspaceCount === 0) {
      setOpenTerminalSessionKeys(new Set());
      setTakeoverTerminalSessionKeys(new Set());
    }
  }, [workspaceCount]);

  useEffect(() => {
    if (activeView !== "display-mode" && selectedSessionKey && openTerminalSessionKeys.has(selectedSessionKey)) {
      setActiveTerminalSessionKey(selectedSessionKey);
    }
  }, [activeView, openTerminalSessionKeys, selectedSessionKey]);

  useEffect(() => {
    threadVsCodeWidthRef.current = threadVsCodeWidth;
    setThreadVsCodeCssWidth(threadVsCodeWidth);
    storeVsCodeSidePanelWidth(threadVsCodeWidth);
  }, [setThreadVsCodeCssWidth, threadVsCodeWidth]);

  useEffect(() => {
    browserPanelWidthRef.current = browserPanelWidth;
    setBrowserPanelCssWidth(browserPanelWidth);
    storeBrowserSidePanelWidth(browserPanelWidth);
  }, [browserPanelWidth, setBrowserPanelCssWidth]);

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
  }, [activeView, dmDrawerOpen, sidebarCollapsed, threadVsCodeWidth, vsCodeOpen, vsCodeSlotElement]);

  const getThreadVsCodePanelBounds = useCallback(() => {
    const containerWidth = getThreadVsCodeContainerWidth();
    return {
      containerWidth,
      minWidth: getMinVsCodeSidePanelWidth(containerWidth),
      maxWidth: getMaxVsCodeSidePanelWidth(containerWidth),
    };
  }, [getThreadVsCodeContainerWidth]);

  const getThreadBrowserPanelBounds = useCallback(() => {
    const containerWidth = getThreadBrowserContainerWidth();
    return {
      containerWidth,
      minWidth: getMinBrowserSidePanelWidth(containerWidth),
      maxWidth: getMaxBrowserSidePanelWidth(containerWidth),
    };
  }, [getThreadBrowserContainerWidth]);

  const showLogsPanel = logsOpen && (activeView === "threads" || activeView === "display-mode");
  const showThreadBrowserPanel = activeView === "threads" && sideBrowserOpen;

  return {
    activeTerminalSessionKey,
    applyThreadBrowserWidth,
    applyThreadVsCodeWidth,
    browserPanelWidth,
    closeTerminal,
    dmDrawerOpen,
    getThreadBrowserPanelBounds,
    getThreadVsCodePanelBounds,
    handleThreadBrowserResizeKeyDown,
    handleThreadVsCodeResizeKeyDown,
    logsOpen,
    openSideBrowserUrl,
    openTerminalForSession,
    openTerminalSessionKeys,
    openVsCodeForWorkspace,
    removeTerminalTakeover,
    setActiveTerminalSessionKey,
    setBrowserPanelWidth,
    setBrowserPanelWidthFromInteraction: setBrowserPanelWidth,
    setLogsPanelOpen,
    setSharedVsCodeWidth,
    setSideBrowserOpen,
    setSideBrowserUrl,
    setTerminalHeight,
    setThreadVsCodeWidth,
    setThreadVsCodeWidthFromInteraction: setThreadVsCodeWidth,
    setVsCodeSlotElement,
    showLogsPanel,
    showThreadBrowserPanel,
    sideBrowserOpen,
    sideBrowserUrl,
    startThreadBrowserResize,
    startThreadVsCodeResize,
    takeoverTerminalSessionKeys,
    terminalHeight,
    threadVsCodeWidth,
    toggleDmDrawer,
    toggleLogsPanel,
    toggleSelectedWorkspaceVsCode,
    toggleSideBrowser,
    toggleTerminal,
    toggleTerminalTakeover,
    toggleVsCode,
    updateVsCodeTarget,
    vsCodeFolderPath,
    vsCodeOpen,
    vsCodePanelStyle,
    vsCodeWorkspaceId,
  } satisfies {
    readonly activeTerminalSessionKey: string;
    readonly applyThreadBrowserWidth: (width: number, containerWidth?: number) => number;
    readonly applyThreadVsCodeWidth: (width: number, containerWidth?: number) => number;
    readonly browserPanelWidth: number;
    readonly closeTerminal: (sessionKey: string) => void;
    readonly dmDrawerOpen: boolean;
    readonly getThreadBrowserPanelBounds: () => { readonly containerWidth: number; readonly minWidth: number; readonly maxWidth: number };
    readonly getThreadVsCodePanelBounds: () => { readonly containerWidth: number; readonly minWidth: number; readonly maxWidth: number };
    readonly handleThreadBrowserResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
    readonly handleThreadVsCodeResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
    readonly logsOpen: boolean;
    readonly openSideBrowserUrl: (url: string) => void;
    readonly openTerminalForSession: (sessionKey: string) => void;
    readonly openTerminalSessionKeys: ReadonlySet<string>;
    readonly openVsCodeForWorkspace: (workspaceId: string, folderPath: string) => void;
    readonly removeTerminalTakeover: (sessionKey: string) => void;
    readonly setActiveTerminalSessionKey: React.Dispatch<React.SetStateAction<string>>;
    readonly setBrowserPanelWidth: React.Dispatch<React.SetStateAction<number>>;
    readonly setBrowserPanelWidthFromInteraction: React.Dispatch<React.SetStateAction<number>>;
    readonly setLogsPanelOpen: (open: boolean) => void;
    readonly setSharedVsCodeWidth: (width: number) => void;
    readonly setSideBrowserOpen: React.Dispatch<React.SetStateAction<boolean>>;
    readonly setSideBrowserUrl: React.Dispatch<React.SetStateAction<string | undefined>>;
    readonly setTerminalHeight: React.Dispatch<React.SetStateAction<number>>;
    readonly setThreadVsCodeWidth: React.Dispatch<React.SetStateAction<number>>;
    readonly setThreadVsCodeWidthFromInteraction: React.Dispatch<React.SetStateAction<number>>;
    readonly setVsCodeSlotElement: React.Dispatch<React.SetStateAction<HTMLElement | null>>;
    readonly showLogsPanel: boolean;
    readonly showThreadBrowserPanel: boolean;
    readonly sideBrowserOpen: boolean;
    readonly sideBrowserUrl: string | undefined;
    readonly startThreadBrowserResize: (event: React.PointerEvent<HTMLDivElement>) => void;
    readonly startThreadVsCodeResize: (event: React.PointerEvent<HTMLDivElement>) => void;
    readonly takeoverTerminalSessionKeys: ReadonlySet<string>;
    readonly terminalHeight: number;
    readonly threadVsCodeWidth: number;
    readonly toggleDmDrawer: () => void;
    readonly toggleLogsPanel: () => void;
    readonly toggleSelectedWorkspaceVsCode: (workspace: WorkspaceRecord | undefined) => void;
    readonly toggleSideBrowser: () => void;
    readonly toggleTerminal: () => void;
    readonly toggleTerminalTakeover: (sessionKey: string) => void;
    readonly toggleVsCode: () => void;
    readonly updateVsCodeTarget: (workspace: WorkspaceRecord) => void;
    readonly vsCodeFolderPath: string | null;
    readonly vsCodeOpen: boolean;
    readonly vsCodePanelStyle: React.CSSProperties;
    readonly vsCodeWorkspaceId: string | null;
  };
}

export function buildOpenTerminalTargets(
  openTerminalSessionKeys: ReadonlySet<string>,
  snapshot: DesktopAppState | null,
) {
  if (!snapshot) {
    return [];
  }

  return [...openTerminalSessionKeys].flatMap((key) => {
    const parsed = parseTerminalSessionKey(key);
    if (!parsed) {
      return [];
    }
    const workspace = snapshot.workspaces.find((entry) => entry.id === parsed.workspaceId);
    const session = workspace?.sessions.find((entry) => entry.id === parsed.sessionId);
    return workspace && session ? [{ key, workspace, session }] : [];
  });
}

function parseTerminalSessionKey(key: string): { workspaceId: string; sessionId: string } | null {
  const separator = key.lastIndexOf(":");
  if (separator <= 0 || separator === key.length - 1) {
    return null;
  }
  return {
    workspaceId: key.slice(0, separator),
    sessionId: key.slice(separator + 1),
  };
}
