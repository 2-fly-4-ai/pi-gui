import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { AppView, SelectedTranscriptRecord } from "../../desktop-state";
import { VIRTUALIZATION_THRESHOLD } from "../../conversation-timeline";
import { useTimelineDiagnostics } from "../../timeline-diagnostics";
import { useComposerTimelineResize } from "./use-composer-timeline-resize";
import { useTimelineInputIntent } from "./use-timeline-input-intent";
import { useTimelinePaneResize } from "./use-timeline-pane-resize";
import { useTimelineSessionScrollSnapshot } from "./use-timeline-session-scroll-snapshot";
import { buildTranscriptChangeMarker, isNearBottom, type TimelinePaneElement, type TimelinePaneSize } from "./timeline-viewport-utils";

interface TimelineFollowRow {
  readonly id: string;
  readonly index: number;
}

interface LegendListInternalState {
  readonly reprocessCurrentScroll?: () => void;
  readonly triggerCalculateItemsInView?: (params?: Record<string, unknown>) => void;
}

const VIRTUALIZED_GAP_FALLBACK_ROW_ID = "__timeline-virtualized-gap-fallback";

interface UseTimelineViewportOptions {
  readonly activeView: AppView | undefined;
  readonly composerDraft: string;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly hasSelectedSession: boolean;
  readonly selectedSessionKey: string;
  readonly showDiffPanel: boolean;
  readonly transcript: SelectedTranscriptRecord["transcript"];
}

export function useTimelineViewport({
  activeView,
  composerDraft,
  composerRef,
  hasSelectedSession,
  selectedSessionKey,
  showDiffPanel,
  transcript,
}: UseTimelineViewportOptions) {
  const timelinePaneRef = useRef<HTMLDivElement | null>(null);
  const timelinePaneElementRef = useRef<HTMLDivElement | null>(null);
  const selectedSessionKeyRef = useRef(selectedSessionKey);
  const transcriptLengthRef = useRef(transcript.length);
  const latestFollowRowRef = useRef<TimelineFollowRow | null>(resolveLatestFollowRow(transcript));
  const lastTranscriptMarkerRef = useRef("");
  const lastTranscriptChangeAtRef = useRef(0);
  const pinnedToBottomRef = useRef(true);
  const followingLatestRef = useRef(true);
  const autoAligningTimelineRef = useRef(false);
  const timelineBottomAlignmentGenerationRef = useRef(0);
  const manualTimelineScrollRestoreRef = useRef(false);
  const userTimelineScrollIntentRef = useRef(false);
  const lastUserTimelineScrollIntentAtRef = useRef(0);
  const lastExplicitTimelineScrollIntentAtRef = useRef(0);
  const timelineScrollbarDragActiveRef = useRef(false);
  const lastTimelineScrollbarDragAtRef = useRef(0);
  const sessionsWithExplicitTimelineScrollRef = useRef(new Set<string>());
  const lastProgrammaticTimelineScrollAtRef = useRef(0);
  const suppressNativeTimelineScrollIntentUntilRef = useRef(0);
  const suppressVirtualizedHydrationScrollIntentUntilRef = useRef(0);
  const timelineScrollHandlerRef = useRef<() => void>(() => undefined);
  const manualTimelineScrollTopRef = useRef<number | null>(null);
  const manualTimelineAnchorRef = useRef<{ rowId: string; offsetTop: number } | null>(null);
  const previousTimelinePaneSizeRef = useRef<TimelinePaneSize | null>(null);
  const lastTimelineScrollTopBySessionRef = useRef(new Map<string, number>());
  const previousTimelineScrollTopRef = useRef<number | null>(null);
  const lastTimelinePinnedBySessionRef = useRef(new Map<string, boolean>());
  const previousActiveViewRef = useRef<AppView | null>(null);
  const shouldDisableTimelineVirtualizationRef = useRef(false);
  const requestPinnedBottomAlignmentRef = useRef<(behavior?: ScrollBehavior) => void>(() => undefined);
  const preserveBottomOnNextPaneResizeRef = useRef(false);
  const composerResizeBottomLockUntilRef = useRef(0);
  const exactBottomRestoreSessionKeyRef = useRef<string | null>(null);
  const deferredPinnedBottomAlignmentRef = useRef(false);
  const pendingPinnedBottomBehaviorRef = useRef<ScrollBehavior>("auto");
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [timelinePaneMountVersion, setTimelinePaneMountVersion] = useState(0);
  const [disableTimelineVirtualization, setDisableTimelineVirtualization] = useState(true);
  selectedSessionKeyRef.current = selectedSessionKey;
  transcriptLengthRef.current = transcript.length;
  latestFollowRowRef.current = resolveLatestFollowRow(transcript);
  const shouldDisableTimelineVirtualization = Boolean(
    disableTimelineVirtualization &&
    activeView === "threads" &&
    selectedSessionKey &&
    transcript.length > VIRTUALIZATION_THRESHOLD &&
    exactBottomRestoreSessionKeyRef.current === selectedSessionKey,
  );
  shouldDisableTimelineVirtualizationRef.current = shouldDisableTimelineVirtualization;

  useTimelineDiagnostics({
    timelinePaneRef,
    composerRef,
    transcript,
    selectedSessionKey,
    followingLatestRef,
    pinnedToBottomRef,
  });

  const resetExactBottomRestoreState = useCallback((nextSessionKey: string | null = null) => {
    exactBottomRestoreSessionKeyRef.current = nextSessionKey;
    deferredPinnedBottomAlignmentRef.current = false;
    pendingPinnedBottomBehaviorRef.current = "auto";
  }, []);

  const scrollLatestTimelineRowIntoView = useCallback((pane: TimelinePaneElement, animated: boolean) => {
    const targetRow = latestFollowRowRef.current;
    if (targetRow) {
      void pane.__legendListRef?.scrollToIndex?.({
        animated,
        index: targetRow.index,
        viewPosition: 1,
      });
    }
    void pane.__legendListRef?.scrollToEnd({ animated });
  }, []);

  const isLatestTimelineRowVisible = useCallback((pane: TimelinePaneElement) => {
    const latestRowId = latestFollowRowRef.current?.id;
    if (!latestRowId) {
      return true;
    }
    const latestRow = pane.querySelector<HTMLElement>(`[data-timeline-row-id="${CSS.escape(latestRowId)}"]`);
    if (!latestRow) {
      return false;
    }
    const paneRect = pane.getBoundingClientRect();
    const rowRect = latestRow.getBoundingClientRect();
    return rowRect.bottom > paneRect.top + 1 && rowRect.top < paneRect.bottom - 1;
  }, []);

  const scrollTimelineToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const pane = timelinePaneRef.current as TimelinePaneElement | null;
    const sessionKey = selectedSessionKeyRef.current;
    if (!pane || pane.dataset.timelineSessionKey !== sessionKey) {
      return;
    }
    const isVirtualizedFollowHydration =
      followingLatestRef.current &&
      transcriptLengthRef.current > VIRTUALIZATION_THRESHOLD &&
      performance.now() < suppressVirtualizedHydrationScrollIntentUntilRef.current;
    if (lastTimelinePinnedBySessionRef.current.get(sessionKey) === false && !isVirtualizedFollowHydration) {
      return;
    }

    const alignmentGeneration = timelineBottomAlignmentGenerationRef.current + 1;
    timelineBottomAlignmentGenerationRef.current = alignmentGeneration;

    const align = (remainingChecks: number) => {
      if (timelineBottomAlignmentGenerationRef.current !== alignmentGeneration) {
        autoAligningTimelineRef.current = false;
        return;
      }
      autoAligningTimelineRef.current = true;
      lastProgrammaticTimelineScrollAtRef.current = performance.now();
      scrollLatestTimelineRowIntoView(pane, behavior !== "auto");
      if (behavior === "auto") {
        pane.scrollTop = pane.scrollHeight;
      } else {
        pane.scrollTo({ top: pane.scrollHeight, behavior });
      }
      pinnedToBottomRef.current = true;
      followingLatestRef.current = true;
      manualTimelineScrollTopRef.current = null;
      if (pane.dataset.timelineSessionKey === sessionKey) {
        lastTimelineScrollTopBySessionRef.current.set(sessionKey, pane.scrollTop);
        lastTimelinePinnedBySessionRef.current.set(sessionKey, true);
      }
      setShowJumpToLatest(false);

      window.requestAnimationFrame(() => {
        if (timelineBottomAlignmentGenerationRef.current !== alignmentGeneration) {
          autoAligningTimelineRef.current = false;
          return;
        }
        const remaining = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
        const latestRowVisible = isLatestTimelineRowVisible(pane);
        if (remaining <= 1 && latestRowVisible) {
          suppressVirtualizedHydrationScrollIntentUntilRef.current = 0;
        }
        if (remainingChecks > 0 && (remaining > 1 || !latestRowVisible)) {
          align(remainingChecks - 1);
          return;
        }
        autoAligningTimelineRef.current = false;
      });
    };

    align(40);
  }, [isLatestTimelineRowVisible, scrollLatestTimelineRowIntoView]);

  const requestPinnedBottomAlignment = useCallback((behavior: ScrollBehavior = "auto") => {
    const sessionKey = selectedSessionKeyRef.current;
    if (
      shouldDisableTimelineVirtualizationRef.current &&
      exactBottomRestoreSessionKeyRef.current === sessionKey &&
      sessionKey
    ) {
      pendingPinnedBottomBehaviorRef.current = behavior;
      deferredPinnedBottomAlignmentRef.current = true;
      return;
    }

    scrollTimelineToBottom(behavior);
  }, [scrollTimelineToBottom]);
  requestPinnedBottomAlignmentRef.current = requestPinnedBottomAlignment;

  const restoreManualTimelineScrollTop = useCallback(() => {
    const pane = timelinePaneRef.current;
    const sessionKey = selectedSessionKeyRef.current;
    if (pane?.dataset.timelineSessionKey !== sessionKey) {
      return;
    }
    const savedScrollTop = manualTimelineScrollTopRef.current ?? lastTimelineScrollTopBySessionRef.current.get(sessionKey);
    if (pane && savedScrollTop !== undefined && savedScrollTop !== null && Math.abs(pane.scrollTop - savedScrollTop) > 1) {
      manualTimelineScrollRestoreRef.current = true;
      lastProgrammaticTimelineScrollAtRef.current = performance.now();
      pane.scrollTop = savedScrollTop;
      window.requestAnimationFrame(() => {
        manualTimelineScrollRestoreRef.current = false;
      });
    }
  }, []);

  const captureManualTimelineAnchor = useCallback(() => {
    const pane = timelinePaneRef.current;
    if (!pane) {
      manualTimelineAnchorRef.current = null;
      return;
    }

    const paneTop = pane.getBoundingClientRect().top;
    const rows = Array.from(pane.querySelectorAll<HTMLElement>("[data-timeline-row-id]"));
    const anchorRow = rows.find((row) => row.getBoundingClientRect().bottom > paneTop + 1);
    const rowId = anchorRow?.dataset.timelineRowId;
    if (!anchorRow || !rowId) {
      manualTimelineAnchorRef.current = null;
      return;
    }

    manualTimelineAnchorRef.current = {
      rowId,
      offsetTop: anchorRow.getBoundingClientRect().top - paneTop,
    };
  }, []);

  const restoreManualTimelineAnchor = useCallback(() => {
    const pane = timelinePaneRef.current;
    const anchor = manualTimelineAnchorRef.current;
    if (!pane || pane.dataset.timelineSessionKey !== selectedSessionKeyRef.current || !anchor) {
      return false;
    }

    const paneTop = pane.getBoundingClientRect().top;
    const anchorRow = Array.from(pane.querySelectorAll<HTMLElement>("[data-timeline-row-id]")).find(
      (row) => row.dataset.timelineRowId === anchor.rowId,
    );
    if (!anchorRow) {
      return false;
    }

    const currentOffset = anchorRow.getBoundingClientRect().top - paneTop;
    const delta = currentOffset - anchor.offsetTop;
    if (Math.abs(delta) > 1) {
      manualTimelineScrollRestoreRef.current = true;
      lastProgrammaticTimelineScrollAtRef.current = performance.now();
      pane.scrollTop += delta;
      window.requestAnimationFrame(() => {
        manualTimelineScrollRestoreRef.current = false;
      });
    }
    return true;
  }, []);

  const restoreManualTimelinePosition = useCallback(() => {
    restoreManualTimelineScrollTop();
    restoreManualTimelineAnchor();
    captureManualTimelineAnchor();
  }, [captureManualTimelineAnchor, restoreManualTimelineAnchor, restoreManualTimelineScrollTop]);

  const restoreManualTimelinePositionAcrossFrames = useCallback((remainingFrames = 4) => {
    if (followingLatestRef.current) {
      return;
    }
    restoreManualTimelinePosition();
    if (remainingFrames <= 0) {
      return;
    }
    window.requestAnimationFrame(() => restoreManualTimelinePositionAcrossFrames(remainingFrames - 1));
  }, [restoreManualTimelinePosition]);

  const recoverBlankVirtualizedFollowViewport = useCallback(() => {
    const pane = timelinePaneRef.current as TimelinePaneElement | null;
    const sessionKey = selectedSessionKeyRef.current;
    const transcriptLength = transcriptLengthRef.current;
    const recentUserScrollIntent = performance.now() - lastUserTimelineScrollIntentAtRef.current < 1_000;
    if (
      !pane ||
      pane.dataset.timelineSessionKey !== sessionKey ||
      transcriptLength <= VIRTUALIZATION_THRESHOLD ||
      !followingLatestRef.current ||
      lastExplicitTimelineScrollIntentAtRef.current !== 0 ||
      recentUserScrollIntent ||
      sessionsWithExplicitTimelineScrollRef.current.has(sessionKey)
    ) {
      return false;
    }

    if (!reprocessBlankVirtualizedViewport(pane, transcriptLength)) {
      return false;
    }

    lastProgrammaticTimelineScrollAtRef.current = performance.now();
    scrollLatestTimelineRowIntoView(pane, false);
    pane.scrollTop = pane.scrollHeight;
    pinnedToBottomRef.current = true;
    followingLatestRef.current = true;
    manualTimelineScrollTopRef.current = null;
    lastTimelinePinnedBySessionRef.current.set(sessionKey, true);
    setShowJumpToLatest(false);
    return true;
  }, [scrollLatestTimelineRowIntoView]);

  const recoverBlankVirtualizedFollowViewportAcrossFrames = useCallback((remainingFrames = 8) => {
    const recovered = recoverBlankVirtualizedFollowViewport();
    const pane = timelinePaneRef.current as TimelinePaneElement | null;
    if (remainingFrames <= 0) {
      return;
    }
    if (recovered || (pane && !isLatestTimelineRowVisible(pane))) {
      window.requestAnimationFrame(() => recoverBlankVirtualizedFollowViewportAcrossFrames(remainingFrames - 1));
    }
  }, [isLatestTimelineRowVisible, recoverBlankVirtualizedFollowViewport]);

  const finalizeTimelineVirtualizationDisable = useCallback(() => {
    const pane = timelinePaneRef.current;
    const restoreSessionKey = exactBottomRestoreSessionKeyRef.current;
    if (!pane || activeView !== "threads") {
      resetExactBottomRestoreState();
      setDisableTimelineVirtualization(false);
      return;
    }

    if (restoreSessionKey !== selectedSessionKey || !restoreSessionKey) {
      setDisableTimelineVirtualization(false);
      return;
    }

    const shouldRestoreInitialBottom =
      lastExplicitTimelineScrollIntentAtRef.current === 0 && restoreSessionKey === selectedSessionKey;
    const shouldRestoreBottom =
      shouldRestoreInitialBottom ||
      pinnedToBottomRef.current ||
      preserveBottomOnNextPaneResizeRef.current ||
      deferredPinnedBottomAlignmentRef.current;
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
        const latestRowVisible = isLatestTimelineRowVisible(pane);
        const nextStableChecks = remaining <= 16 && latestRowVisible ? stableChecks + 1 : 0;
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
      finishRestore(40, 0);
    });
  }, [activeView, isLatestTimelineRowVisible, resetExactBottomRestoreState, scrollTimelineToBottom, selectedSessionKey]);

  const setTimelinePaneElement = useCallback((node: HTMLDivElement | null) => {
    if (timelinePaneElementRef.current === node) {
      timelinePaneRef.current = node;
      return;
    }

    timelinePaneElementRef.current = node;
    timelinePaneRef.current = node;
    if (!node) {
      return;
    }

    setTimelinePaneMountVersion((current) => current + 1);
    previousTimelineScrollTopRef.current = node.scrollTop;

    const savedPinned = lastTimelinePinnedBySessionRef.current.get(selectedSessionKey);
    const savedScrollTop = lastTimelineScrollTopBySessionRef.current.get(selectedSessionKey);

    if (!selectedSessionKey || activeView !== "threads") {
      setDisableTimelineVirtualization(false);
      return;
    }

    const shouldRestoreBottom = savedPinned ?? (
      followingLatestRef.current ||
      pinnedToBottomRef.current ||
      preserveBottomOnNextPaneResizeRef.current
    );
    if (shouldRestoreBottom) {
      preserveBottomOnNextPaneResizeRef.current = true;
      lastProgrammaticTimelineScrollAtRef.current = performance.now();
      node.scrollTop = node.scrollHeight;
      window.requestAnimationFrame(() => {
        if (timelinePaneRef.current !== node) {
          return;
        }
        if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
          requestPinnedBottomAlignmentRef.current("auto");
        }
      });
      return;
    }

    if (savedScrollTop == null) {
      setDisableTimelineVirtualization(false);
      return;
    }

    lastProgrammaticTimelineScrollAtRef.current = performance.now();
    node.scrollTop = savedScrollTop;
    pinnedToBottomRef.current = false;
    followingLatestRef.current = false;
    manualTimelineScrollTopRef.current = savedScrollTop;
    userTimelineScrollIntentRef.current = false;
    lastExplicitTimelineScrollIntentAtRef.current = 0;
    resetExactBottomRestoreState();
    lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, false);
    window.requestAnimationFrame(() => {
      if (timelinePaneRef.current !== node) {
        return;
      }
      setDisableTimelineVirtualization(false);
    });
  }, [activeView, resetExactBottomRestoreState, selectedSessionKey]);

  const schedulePinnedBottomRealignment = useCallback((delayFrames = 0) => {
    const scheduledGeneration = timelineBottomAlignmentGenerationRef.current;
    const waitForFrames = (remainingFrames: number) => {
      window.requestAnimationFrame(() => {
        if (timelineBottomAlignmentGenerationRef.current !== scheduledGeneration || !pinnedToBottomRef.current) {
          preserveBottomOnNextPaneResizeRef.current = false;
          return;
        }
        if (remainingFrames > 0) {
          waitForFrames(remainingFrames - 1);
          return;
        }
        requestPinnedBottomAlignment("auto");
        window.requestAnimationFrame(() => {
          preserveBottomOnNextPaneResizeRef.current = false;
          if (timelineBottomAlignmentGenerationRef.current === scheduledGeneration && pinnedToBottomRef.current) {
            requestPinnedBottomAlignment("auto");
          }
        });
      });
    };

    waitForFrames(delayFrames);
  }, [requestPinnedBottomAlignment]);

  const preserveTimelineBottomForLayoutChange = useCallback((delayFrames = 0) => {
    const pane = timelinePaneRef.current;
    const shouldPreserveBottom = pane ? isNearBottom(pane) || pinnedToBottomRef.current : pinnedToBottomRef.current;
    if (!shouldPreserveBottom) {
      return;
    }

    preserveBottomOnNextPaneResizeRef.current = true;
    schedulePinnedBottomRealignment(delayFrames);
  }, [schedulePinnedBottomRealignment]);

  useLayoutEffect(() => {
    const savedPinned = lastTimelinePinnedBySessionRef.current.get(selectedSessionKey);
    const savedScrollTop = lastTimelineScrollTopBySessionRef.current.get(selectedSessionKey);
    const shouldFollowLatest = savedPinned ?? true;

    setShowJumpToLatest(false);
    lastTranscriptMarkerRef.current = "";
    pinnedToBottomRef.current = shouldFollowLatest;
    followingLatestRef.current = shouldFollowLatest;
    autoAligningTimelineRef.current = false;
    timelineBottomAlignmentGenerationRef.current += 1;
    manualTimelineScrollRestoreRef.current = false;
    userTimelineScrollIntentRef.current = false;
    lastExplicitTimelineScrollIntentAtRef.current = 0;
    lastTimelineScrollbarDragAtRef.current = 0;
    suppressVirtualizedHydrationScrollIntentUntilRef.current = 0;
    timelineScrollbarDragActiveRef.current = false;
    manualTimelineScrollTopRef.current = shouldFollowLatest ? null : (savedScrollTop ?? null);
    previousTimelineScrollTopRef.current = null;
    manualTimelineAnchorRef.current = null;
    previousTimelinePaneSizeRef.current = null;
    preserveBottomOnNextPaneResizeRef.current = false;
    resetExactBottomRestoreState(shouldFollowLatest ? (selectedSessionKey || null) : null);
    setDisableTimelineVirtualization(Boolean(selectedSessionKey));
    if (!shouldFollowLatest && savedScrollTop != null) {
      window.requestAnimationFrame(() => {
        restoreManualTimelinePositionAcrossFrames();
        setShowJumpToLatest(true);
      });
    }
  }, [resetExactBottomRestoreState, restoreManualTimelinePositionAcrossFrames, selectedSessionKey]);

  useLayoutEffect(() => {
    if (activeView !== "threads" || !hasSelectedSession || transcript.length === 0) {
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
    activeView,
    disableTimelineVirtualization,
    hasSelectedSession,
    scrollTimelineToBottom,
    selectedSessionKey,
    transcript,
  ]);

  useEffect(() => {
    if (activeView !== "threads") {
      previousTimelinePaneSizeRef.current = null;
      resetExactBottomRestoreState();
      setDisableTimelineVirtualization(false);
    }

    if (activeView === "threads" && previousActiveViewRef.current !== "threads" && hasSelectedSession) {
      window.requestAnimationFrame(() => {
        composerRef.current?.focus();
      });
      if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
        preserveBottomOnNextPaneResizeRef.current = true;
        schedulePinnedBottomRealignment(1);
      }
    }

    previousActiveViewRef.current = activeView ?? null;
  }, [activeView, composerRef, hasSelectedSession, resetExactBottomRestoreState, schedulePinnedBottomRealignment]);

  useComposerTimelineResize({
    composerDraft,
    composerRef,
    composerResizeBottomLockUntilRef,
    followingLatestRef,
    lastProgrammaticTimelineScrollAtRef,
    lastTimelineScrollTopBySessionRef,
    manualTimelineScrollRestoreRef,
    manualTimelineScrollTopRef,
    pinnedToBottomRef,
    preserveBottomOnNextPaneResizeRef,
    requestPinnedBottomAlignment,
    selectedSessionKey,
    suppressNativeTimelineScrollIntentUntilRef,
    timelinePaneRef,
  });

  const snapshotExplicitTimelineScrollPosition = useCallback(() => {
    const sessionKey = selectedSessionKeyRef.current;
    window.requestAnimationFrame(() => {
      const pane = timelinePaneRef.current;
      if (!pane || pane.dataset.timelineSessionKey !== sessionKey) {
        return;
      }
      lastTimelineScrollTopBySessionRef.current.set(sessionKey, pane.scrollTop);
      lastTimelinePinnedBySessionRef.current.set(sessionKey, isNearBottom(pane));
    });
  }, []);
  const handleScrollbarDragStart = useCallback(() => {
    followingLatestRef.current = false;
    pinnedToBottomRef.current = false;
    preserveBottomOnNextPaneResizeRef.current = false;
    suppressVirtualizedHydrationScrollIntentUntilRef.current = 0;
    resetExactBottomRestoreState();
  }, [resetExactBottomRestoreState]);

  useTimelineInputIntent({
    activeView,
    autoAligningTimelineRef,
    hasSelectedSession,
    lastExplicitTimelineScrollIntentAtRef,
    lastTimelineScrollbarDragAtRef,
    lastUserTimelineScrollIntentAtRef,
    onExplicitTimelineScrollIntent: snapshotExplicitTimelineScrollPosition,
    onScrollbarDragStart: handleScrollbarDragStart,
    preserveBottomOnNextPaneResizeRef,
    sessionsWithExplicitTimelineScrollRef,
    selectedSessionKey,
    timelineBottomAlignmentGenerationRef,
    timelinePaneMountVersion,
    timelinePaneRef,
    timelineScrollbarDragActiveRef,
    timelineScrollHandlerRef,
    userTimelineScrollIntentRef,
  });

  useTimelineSessionScrollSnapshot({
    activeView,
    followingLatestRef,
    forceActualSnapshotSessionKeysRef: sessionsWithExplicitTimelineScrollRef,
    hasSelectedSession,
    lastTimelinePinnedBySessionRef,
    lastTimelineScrollTopBySessionRef,
    pinnedToBottomRef,
    preserveBottomOnNextPaneResizeRef,
    selectedSessionKey,
    timelinePaneRef,
  });

  useTimelinePaneResize({
    activeView,
    followingLatestRef,
    pinnedToBottomRef,
    preserveBottomOnNextPaneResizeRef,
    previousTimelinePaneSizeRef,
    requestPinnedBottomAlignment,
    selectedSessionKey,
    showDiffPanel,
    timelinePaneMountVersion,
    timelinePaneRef,
  });

  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane || !hasSelectedSession) {
      return;
    }

    const marker = buildTranscriptChangeMarker(selectedSessionKey, transcript);
    if (marker === lastTranscriptMarkerRef.current) {
      return;
    }
    lastTranscriptMarkerRef.current = marker;
    lastTranscriptChangeAtRef.current = performance.now();

    suppressNativeTimelineScrollIntentUntilRef.current = performance.now() + 250;

    const shouldForceInitialHydrationBottom =
      transcript.length > VIRTUALIZATION_THRESHOLD &&
      !sessionsWithExplicitTimelineScrollRef.current.has(selectedSessionKey) &&
      lastExplicitTimelineScrollIntentAtRef.current === 0;
    if (shouldForceInitialHydrationBottom) {
      const forceInitialBottomAlignment = () => {
        if (
          lastExplicitTimelineScrollIntentAtRef.current !== 0 ||
          sessionsWithExplicitTimelineScrollRef.current.has(selectedSessionKey)
        ) {
          return;
        }
        const pane = timelinePaneRef.current as TimelinePaneElement | null;
        if (!pane || pane.dataset.timelineSessionKey !== selectedSessionKey) {
          return;
        }
        lastProgrammaticTimelineScrollAtRef.current = performance.now();
        scrollLatestTimelineRowIntoView(pane, false);
        pane.scrollTop = pane.scrollHeight;
        pinnedToBottomRef.current = true;
        followingLatestRef.current = true;
        manualTimelineScrollTopRef.current = null;
        lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, true);
        setShowJumpToLatest(false);
      };
      forceInitialBottomAlignment();
      window.requestAnimationFrame(forceInitialBottomAlignment);
      window.setTimeout(forceInitialBottomAlignment, 100);
      window.setTimeout(forceInitialBottomAlignment, 250);
      window.setTimeout(forceInitialBottomAlignment, 500);
      window.setTimeout(forceInitialBottomAlignment, 1_000);
      window.setTimeout(forceInitialBottomAlignment, 1_750);
      window.setTimeout(forceInitialBottomAlignment, 2_500);
    }

    if (
      exactBottomRestoreSessionKeyRef.current === selectedSessionKey &&
      lastExplicitTimelineScrollIntentAtRef.current === 0
    ) {
      pinnedToBottomRef.current = true;
      followingLatestRef.current = true;
      manualTimelineScrollTopRef.current = null;
      lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, true);
    }

    if (followingLatestRef.current) {
      if (transcript.length > VIRTUALIZATION_THRESHOLD) {
        suppressVirtualizedHydrationScrollIntentUntilRef.current = performance.now() + 4_000;
      }
      requestPinnedBottomAlignment("auto");
      return;
    }

    if (lastTimelinePinnedBySessionRef.current.get(selectedSessionKey) === false) {
      const savedScrollTop = lastTimelineScrollTopBySessionRef.current.get(selectedSessionKey);
      if (savedScrollTop != null) {
        manualTimelineScrollTopRef.current = savedScrollTop;
        restoreManualTimelineScrollTop();
      }
    }
    restoreManualTimelinePositionAcrossFrames(30);
    setShowJumpToLatest(true);
  }, [
    hasSelectedSession,
    requestPinnedBottomAlignment,
    recoverBlankVirtualizedFollowViewportAcrossFrames,
    restoreManualTimelinePositionAcrossFrames,
    restoreManualTimelineScrollTop,
    scrollLatestTimelineRowIntoView,
    selectedSessionKey,
    transcript,
  ]);

  useLayoutEffect(() => {
    if (
      activeView !== "threads" ||
      !hasSelectedSession ||
      transcript.length <= VIRTUALIZATION_THRESHOLD ||
      !followingLatestRef.current
    ) {
      return;
    }

    recoverBlankVirtualizedFollowViewportAcrossFrames(12);
  }, [
    activeView,
    disableTimelineVirtualization,
    hasSelectedSession,
    recoverBlankVirtualizedFollowViewportAcrossFrames,
    timelinePaneMountVersion,
    transcript.length,
  ]);

  const handleTimelineContentHeightChange = useCallback(() => {
    const now = performance.now();
    const recentUserScroll = now - lastUserTimelineScrollIntentAtRef.current < 350;
    if (timelineScrollbarDragActiveRef.current || recentUserScroll) {
      return;
    }

    suppressNativeTimelineScrollIntentUntilRef.current = now + 250;
    if (!followingLatestRef.current) {
      if (lastTimelinePinnedBySessionRef.current.get(selectedSessionKey) === false) {
        const savedScrollTop = lastTimelineScrollTopBySessionRef.current.get(selectedSessionKey);
        if (savedScrollTop != null) {
          manualTimelineScrollTopRef.current = savedScrollTop;
          restoreManualTimelineScrollTop();
        }
      }
      restoreManualTimelinePositionAcrossFrames(30);
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
  }, [requestPinnedBottomAlignment, restoreManualTimelinePositionAcrossFrames, restoreManualTimelineScrollTop, selectedSessionKey]);

  const handleTimelineScroll = useCallback(() => {
    const pane = timelinePaneRef.current;
    const sessionKey = selectedSessionKeyRef.current;
    const transcriptLength = transcriptLengthRef.current;
    if (!pane || pane.dataset.timelineSessionKey !== sessionKey) {
      return;
    }
    const pinned = isNearBottom(pane);
    const previousScrollTop = previousTimelineScrollTopRef.current;
    const nextScrollTop = pane.scrollTop;
    const movedWithoutExplicitInput = previousScrollTop !== null && Math.abs(nextScrollTop - previousScrollTop) > 2;
    const viewportWasBlank = reprocessBlankVirtualizedViewport(pane, transcriptLength);
    if (viewportWasBlank && followingLatestRef.current) {
      recoverBlankVirtualizedFollowViewportAcrossFrames(8);
    }
    if (transcriptLength > VIRTUALIZATION_THRESHOLD) {
      window.requestAnimationFrame(() => {
        if (timelinePaneRef.current === pane && pane.dataset.timelineSessionKey === sessionKey) {
          const viewportStillBlank = reprocessBlankVirtualizedViewport(pane, transcriptLength);
          if (viewportStillBlank && followingLatestRef.current) {
            recoverBlankVirtualizedFollowViewportAcrossFrames(8);
          }
        }
      });
    }

    const maxScrollTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
    const movedAwayFromBottom = !pinned && (
      previousScrollTop !== null
        ? nextScrollTop < previousScrollTop - 2
        : nextScrollTop < maxScrollTop - 2
    );
    const now = performance.now();
    const recentExplicitUserScrollIntent = now - lastExplicitTimelineScrollIntentAtRef.current < 600;
    const recentScrollbarDragIntent =
      timelineScrollbarDragActiveRef.current ||
      now - lastTimelineScrollbarDragAtRef.current < 600;
    const explicitUserScrollIntent =
      recentScrollbarDragIntent ||
      (userTimelineScrollIntentRef.current && recentExplicitUserScrollIntent) ||
      recentExplicitUserScrollIntent;
    const recentProgrammaticScroll = now - lastProgrammaticTimelineScrollAtRef.current < 180;
    const suppressNativeScrollIntent = now < suppressNativeTimelineScrollIntentUntilRef.current;
    const suppressVirtualizedHydrationScrollIntent =
      transcriptLength > VIRTUALIZATION_THRESHOLD &&
      now < suppressVirtualizedHydrationScrollIntentUntilRef.current;
    const virtualizedFollowRestorePending =
      transcriptLength > VIRTUALIZATION_THRESHOLD &&
      followingLatestRef.current &&
      !isLatestTimelineRowVisible(pane);
    const composerResizeOwnsBottom = now < composerResizeBottomLockUntilRef.current;
    const transcriptRecentlyChanged =
      now - lastTranscriptChangeAtRef.current < 600 || suppressVirtualizedHydrationScrollIntent;
    const strongAwayFromBottomIntent =
      !transcriptRecentlyChanged &&
      !virtualizedFollowRestorePending &&
      movedAwayFromBottom &&
      previousScrollTop !== null &&
      maxScrollTop - previousScrollTop <= 24 &&
      previousScrollTop - nextScrollTop > 120;
    const strongManualScrollIntent =
      manualTimelineScrollTopRef.current !== null &&
      !transcriptRecentlyChanged &&
      !virtualizedFollowRestorePending &&
      previousScrollTop !== null &&
      Math.abs(nextScrollTop - previousScrollTop) > 120;
    const inferredNativeScrollIntent =
      !transcriptRecentlyChanged &&
      !virtualizedFollowRestorePending &&
      !autoAligningTimelineRef.current &&
      !recentProgrammaticScroll &&
      !suppressNativeScrollIntent &&
      (movedWithoutExplicitInput || movedAwayFromBottom);
    const nativeUserScrollIntent =
      !composerResizeOwnsBottom &&
      !manualTimelineScrollRestoreRef.current &&
      (
        strongAwayFromBottomIntent ||
        strongManualScrollIntent ||
        inferredNativeScrollIntent
      );
    const userScrollIntent = explicitUserScrollIntent || nativeUserScrollIntent;
    const observedStableOffBottomPosition =
      !pinned &&
      Boolean(sessionKey) &&
      sessionsWithExplicitTimelineScrollRef.current.has(sessionKey) &&
      !transcriptRecentlyChanged &&
      !virtualizedFollowRestorePending &&
      !autoAligningTimelineRef.current &&
      !recentProgrammaticScroll &&
      !suppressNativeScrollIntent;
    const savedManualScrollTop = manualTimelineScrollTopRef.current;
    const manualRestorePending =
      savedManualScrollTop !== null &&
      lastTimelinePinnedBySessionRef.current.get(sessionKey) === false;
    const manualRestoreClampedByContent =
      manualRestorePending &&
      savedManualScrollTop !== null &&
      maxScrollTop < savedManualScrollTop - 2;
    const shouldCacheObservedPosition =
      !manualRestoreClampedByContent && (pinned || explicitUserScrollIntent || observedStableOffBottomPosition);
    if (sessionKey && shouldCacheObservedPosition) {
      lastTimelineScrollTopBySessionRef.current.set(sessionKey, nextScrollTop);
      lastTimelinePinnedBySessionRef.current.set(sessionKey, pinned);
    }
    if (userScrollIntent) {
      lastUserTimelineScrollIntentAtRef.current = now;
    }
    if (explicitUserScrollIntent && sessionKey) {
      sessionsWithExplicitTimelineScrollRef.current.add(sessionKey);
    }
    previousTimelineScrollTopRef.current = nextScrollTop;
    userTimelineScrollIntentRef.current = false;

    if (!pinned) {
      if (composerResizeOwnsBottom && !explicitUserScrollIntent) {
        pinnedToBottomRef.current = true;
        followingLatestRef.current = true;
        manualTimelineScrollTopRef.current = null;
        window.requestAnimationFrame(() => {
          requestPinnedBottomAlignment("auto");
        });
        return;
      }

      if (
        (suppressVirtualizedHydrationScrollIntent || virtualizedFollowRestorePending) &&
        !userScrollIntent &&
        (followingLatestRef.current || preserveBottomOnNextPaneResizeRef.current)
      ) {
        pinnedToBottomRef.current = true;
        followingLatestRef.current = true;
        manualTimelineScrollTopRef.current = null;
        lastTimelinePinnedBySessionRef.current.set(sessionKey, true);
        window.requestAnimationFrame(() => {
          requestPinnedBottomAlignment("auto");
        });
        return;
      }

      if (!userScrollIntent && lastTimelinePinnedBySessionRef.current.get(sessionKey) === false) {
        const savedScrollTop = lastTimelineScrollTopBySessionRef.current.get(sessionKey);
        if (savedScrollTop != null) {
          manualTimelineScrollTopRef.current = savedScrollTop;
        }
        pinnedToBottomRef.current = false;
        followingLatestRef.current = false;
        restoreManualTimelinePositionAcrossFrames(30);
        return;
      }

      if (!userScrollIntent) {
        if (manualTimelineScrollRestoreRef.current) {
          return;
        }
        if (followingLatestRef.current || pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current || autoAligningTimelineRef.current) {
          requestPinnedBottomAlignment("auto");
          return;
        }
        restoreManualTimelinePositionAcrossFrames(30);
        return;
      }
      pinnedToBottomRef.current = false;
      followingLatestRef.current = false;
      autoAligningTimelineRef.current = false;
      timelineBottomAlignmentGenerationRef.current += 1;
      manualTimelineScrollTopRef.current = pane.scrollTop;
      if (recentScrollbarDragIntent) {
        manualTimelineAnchorRef.current = null;
      } else {
        captureManualTimelineAnchor();
      }
      preserveBottomOnNextPaneResizeRef.current = false;
      resetExactBottomRestoreState();
      lastTimelineScrollTopBySessionRef.current.set(sessionKey, pane.scrollTop);
      lastTimelinePinnedBySessionRef.current.set(sessionKey, false);
      return;
    }

    if ((manualRestoreClampedByContent || !explicitUserScrollIntent) && manualTimelineScrollTopRef.current !== null) {
      restoreManualTimelinePositionAcrossFrames(30);
      setShowJumpToLatest(true);
      return;
    }

    pinnedToBottomRef.current = true;
    followingLatestRef.current = true;
    suppressVirtualizedHydrationScrollIntentUntilRef.current = 0;
    manualTimelineScrollTopRef.current = null;
    manualTimelineAnchorRef.current = null;
    lastTimelineScrollTopBySessionRef.current.set(sessionKey, pane.scrollTop);
    lastTimelinePinnedBySessionRef.current.set(sessionKey, true);
    setShowJumpToLatest(false);
  }, [
    captureManualTimelineAnchor,
    isLatestTimelineRowVisible,
    recoverBlankVirtualizedFollowViewportAcrossFrames,
    requestPinnedBottomAlignment,
    resetExactBottomRestoreState,
    restoreManualTimelinePositionAcrossFrames,
  ]);

  timelineScrollHandlerRef.current = handleTimelineScroll;

  const jumpToLatest = useCallback(() => {
    const pane = timelinePaneRef.current as TimelinePaneElement | null;
    followingLatestRef.current = true;
    pinnedToBottomRef.current = true;
    suppressVirtualizedHydrationScrollIntentUntilRef.current = 0;
    manualTimelineScrollTopRef.current = null;
    manualTimelineAnchorRef.current = null;
    lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, true);
    if (pane?.dataset.timelineSessionKey === selectedSessionKey) {
      lastProgrammaticTimelineScrollAtRef.current = performance.now();
      scrollLatestTimelineRowIntoView(pane, false);
      pane.scrollTop = pane.scrollHeight;
      lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollHeight);
    }
    requestPinnedBottomAlignment("smooth");
  }, [requestPinnedBottomAlignment, scrollLatestTimelineRowIntoView, selectedSessionKey]);

  return {
    finalizeTimelineVirtualizationDisable,
    handleTimelineContentHeightChange,
    handleTimelineScroll,
    jumpToLatest,
    preserveTimelineBottomForLayoutChange,
    setTimelinePaneElement,
    shouldDisableTimelineVirtualization,
    showJumpToLatest,
    timelinePaneRef,
  };
}

function resolveLatestFollowRow(transcript: SelectedTranscriptRecord["transcript"]): TimelineFollowRow | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (!item) {
      continue;
    }
    if (item.kind !== "summary") {
      return { id: item.id, index };
    }
  }
  const fallback = transcript.at(-1);
  return fallback ? { id: fallback.id, index: transcript.length - 1 } : null;
}

function reprocessBlankVirtualizedViewport(pane: TimelinePaneElement, transcriptLength: number): boolean {
  if (transcriptLength <= VIRTUALIZATION_THRESHOLD) {
    return false;
  }
  const paneRect = pane.getBoundingClientRect();
  const hasVisibleRows = Array.from(
    pane.querySelectorAll<HTMLElement>("[data-timeline-row-id]:not([data-timeline-gap-fallback='true'])"),
  ).some((row) => {
    const rowRect = row.getBoundingClientRect();
    return rowRect.bottom > paneRect.top + 1 && rowRect.top < paneRect.bottom - 1;
  });
  if (hasVisibleRows) {
    removeVirtualizedGapFallback(pane);
    return false;
  }
  const state = pane.__legendListRef?.getState?.() as LegendListInternalState | undefined;
  state?.reprocessCurrentScroll?.();
  state?.triggerCalculateItemsInView?.();
  showVirtualizedGapFallback(pane);
  return true;
}

function showVirtualizedGapFallback(pane: TimelinePaneElement): void {
  const existing = pane.querySelector<HTMLElement>(`[data-timeline-row-id="${VIRTUALIZED_GAP_FALLBACK_ROW_ID}"]`);
  const fallback = existing ?? document.createElement("div");
  fallback.className = "timeline__legend-row timeline__virtual-gap-fallback";
  fallback.dataset.timelineRowId = VIRTUALIZED_GAP_FALLBACK_ROW_ID;
  fallback.dataset.timelineGapFallback = "true";
  fallback.textContent = "Rendering transcript...";
  fallback.style.top = `${pane.scrollTop + Math.max(24, pane.clientHeight / 2 - 18)}px`;
  if (!existing) {
    pane.append(fallback);
  }
  window.setTimeout(() => {
    if (fallback.isConnected) {
      fallback.remove();
    }
  }, 180);
}

function removeVirtualizedGapFallback(pane: TimelinePaneElement): void {
  pane.querySelector<HTMLElement>(`[data-timeline-row-id="${VIRTUALIZED_GAP_FALLBACK_ROW_ID}"]`)?.remove();
}
