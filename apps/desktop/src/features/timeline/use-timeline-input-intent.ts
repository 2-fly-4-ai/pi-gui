import { useLayoutEffect, type RefObject } from "react";
import type { AppView } from "../../desktop-state";
import { BoundedTimelineScheduler } from "./bounded-timeline-scheduler";

interface UseTimelineInputIntentOptions {
  readonly activeView: AppView | undefined;
  readonly autoAligningTimelineRef: RefObject<boolean>;
  readonly hasSelectedSession: boolean;
  readonly lastExplicitTimelineScrollIntentAtRef: RefObject<number>;
  readonly lastExplicitTimelineWheelDeltaYRef: RefObject<number>;
  readonly lastTimelineScrollbarDragAtRef: RefObject<number>;
  readonly lastUserTimelineScrollIntentAtRef: RefObject<number>;
  readonly onExplicitTimelineScrollIntent: () => void;
  readonly onScrollbarDragEnd: () => void;
  readonly onScrollbarDragStart: () => void;
  readonly preserveBottomOnNextPaneResizeRef: RefObject<boolean>;
  readonly sessionsWithExplicitTimelineScrollRef: RefObject<Set<string>>;
  readonly selectedSessionKey: string;
  readonly timelineBottomAlignmentGenerationRef: RefObject<number>;
  readonly timelinePaneMountVersion: number;
  readonly timelinePaneRef: RefObject<HTMLDivElement | null>;
  readonly timelineScrollbarDragActiveRef: RefObject<boolean>;
  readonly timelineScrollHandlerRef: RefObject<() => void>;
  readonly userTimelineScrollIntentRef: RefObject<boolean>;
}

export function useTimelineInputIntent({
  activeView,
  autoAligningTimelineRef,
  hasSelectedSession,
  lastExplicitTimelineScrollIntentAtRef,
  lastExplicitTimelineWheelDeltaYRef,
  lastTimelineScrollbarDragAtRef,
  lastUserTimelineScrollIntentAtRef,
  onExplicitTimelineScrollIntent,
  onScrollbarDragEnd,
  onScrollbarDragStart,
  preserveBottomOnNextPaneResizeRef,
  sessionsWithExplicitTimelineScrollRef,
  selectedSessionKey,
  timelineBottomAlignmentGenerationRef,
  timelinePaneMountVersion,
  timelinePaneRef,
  timelineScrollbarDragActiveRef,
  timelineScrollHandlerRef,
  userTimelineScrollIntentRef,
}: UseTimelineInputIntentOptions): void {
  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane || activeView !== "threads" || !hasSelectedSession) {
      return undefined;
    }
    const scheduler = new BoundedTimelineScheduler();
    let scrollbarDragState: {
      readonly startScrollTop: number;
      readonly startY: number;
      readonly trackHeight: number;
    } | null = null;
    const markUserScrollIntent = () => {
      userTimelineScrollIntentRef.current = true;
      lastUserTimelineScrollIntentAtRef.current = performance.now();
      lastExplicitTimelineScrollIntentAtRef.current = lastUserTimelineScrollIntentAtRef.current;
      if (selectedSessionKey) {
        sessionsWithExplicitTimelineScrollRef.current.add(selectedSessionKey);
      }
      onExplicitTimelineScrollIntent();
    };
    const markWheelScrollIntent = (event: WheelEvent) => {
      lastExplicitTimelineWheelDeltaYRef.current = event.deltaY;
      markUserScrollIntent();
    };

    const startScrollbarDrag = (clientY: number) => {
      timelineScrollbarDragActiveRef.current = true;
      lastTimelineScrollbarDragAtRef.current = performance.now();
      autoAligningTimelineRef.current = false;
      timelineBottomAlignmentGenerationRef.current += 1;
      preserveBottomOnNextPaneResizeRef.current = false;
      onScrollbarDragStart();
      scrollbarDragState = {
        startScrollTop: pane.scrollTop,
        startY: clientY,
        trackHeight: Math.max(1, pane.clientHeight),
      };
    };

    const dragScrollbar = (clientY: number) => {
      if (!scrollbarDragState || !timelineScrollbarDragActiveRef.current) return;
      const now = performance.now();
      userTimelineScrollIntentRef.current = true;
      lastUserTimelineScrollIntentAtRef.current = now;
      lastExplicitTimelineScrollIntentAtRef.current = now;
      if (selectedSessionKey) sessionsWithExplicitTimelineScrollRef.current.add(selectedSessionKey);
      const maxScrollTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
      const deltaY = clientY - scrollbarDragState.startY;
      pane.scrollTop = Math.min(
        maxScrollTop,
        Math.max(0, scrollbarDragState.startScrollTop + deltaY * (maxScrollTop / scrollbarDragState.trackHeight)),
      );
      timelineScrollHandlerRef.current();
    };

    const markDragPositionAsExplicit = () => {
      const now = performance.now();
      userTimelineScrollIntentRef.current = true;
      lastUserTimelineScrollIntentAtRef.current = now;
      lastExplicitTimelineScrollIntentAtRef.current = now;
      lastTimelineScrollbarDragAtRef.current = now;
      if (selectedSessionKey) {
        sessionsWithExplicitTimelineScrollRef.current.add(selectedSessionKey);
      }
    };

    const stabilizeScrollbarDragPosition = (targetScrollTop: number) => {
      const startedAt = performance.now();
      const stabilize = () => {
        if (timelineScrollbarDragActiveRef.current || performance.now() - startedAt > 700) {
          return;
        }
        const maxScrollTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
        const nextScrollTop = Math.min(maxScrollTop, Math.max(0, targetScrollTop));
        markDragPositionAsExplicit();
        if (Math.abs(pane.scrollTop - nextScrollTop) > 1) {
          pane.scrollTop = nextScrollTop;
          timelineScrollHandlerRef.current();
        }
        scheduler.scheduleAnimationFrame("scrollbar-stabilization-frame", stabilize);
      };
      scheduler.scheduleAnimationFrame("scrollbar-stabilization-frame", stabilize);
      for (const delay of [100, 250, 500]) {
        scheduler.scheduleTimeout(`scrollbar-stabilization:${delay}`, stabilize, delay);
      }
    };

    const markPointerScrollIntent = (event: PointerEvent) => {
      const paneRect = pane.getBoundingClientRect();
      const eventTarget = event.target;
      const isInsidePane = eventTarget instanceof Node && pane.contains(eventTarget);
      const isOnScrollbarEdge =
        event.clientX >= paneRect.right - 16 &&
        event.clientX <= paneRect.right + 1 &&
        event.clientY >= paneRect.top &&
        event.clientY <= paneRect.bottom;
      if (!isInsidePane && !isOnScrollbarEdge) {
        return;
      }

      markUserScrollIntent();
      if (isOnScrollbarEdge) {
        if (event.cancelable) event.preventDefault();
        startScrollbarDrag(event.clientY);
      }
    };
    const markMouseScrollIntent = (event: MouseEvent) => {
      const paneRect = pane.getBoundingClientRect();
      const eventTarget = event.target;
      const isInsidePane = eventTarget instanceof Node && pane.contains(eventTarget);
      const isOnScrollbarEdge =
        event.clientX >= paneRect.right - 16 &&
        event.clientX <= paneRect.right + 1 &&
        event.clientY >= paneRect.top &&
        event.clientY <= paneRect.bottom;
      if (!isInsidePane && !isOnScrollbarEdge) {
        return;
      }

      markUserScrollIntent();
      if (isOnScrollbarEdge) {
        if (event.cancelable) event.preventDefault();
        startScrollbarDrag(event.clientY);
      }
    };

    const clearScrollbarDragIntent = () => {
      const wasDragging = timelineScrollbarDragActiveRef.current;
      if (wasDragging) {
        lastTimelineScrollbarDragAtRef.current = performance.now();
        stabilizeScrollbarDragPosition(pane.scrollTop);
      }
      timelineScrollbarDragActiveRef.current = false;
      scrollbarDragState = null;
      if (wasDragging) onScrollbarDragEnd();
    };

    const handlePointerMove = (event: PointerEvent) => dragScrollbar(event.clientY);
    const handleMouseMove = (event: MouseEvent) => dragScrollbar(event.clientY);

    const handleNativeScroll = () => {
      timelineScrollHandlerRef.current();
    };

    pane.addEventListener("wheel", markWheelScrollIntent, { passive: true });
    pane.addEventListener("touchstart", markUserScrollIntent, { passive: true });
    pane.addEventListener("pointerdown", markPointerScrollIntent);
    pane.addEventListener("scroll", handleNativeScroll, { passive: true });
    window.addEventListener("pointerdown", markPointerScrollIntent, { capture: true });
    window.addEventListener("mousedown", markMouseScrollIntent, { capture: true });
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("pointerup", clearScrollbarDragIntent, { passive: true });
    window.addEventListener("pointercancel", clearScrollbarDragIntent, { passive: true });
    window.addEventListener("mouseup", clearScrollbarDragIntent, { passive: true });
    window.addEventListener("blur", clearScrollbarDragIntent);

    return () => {
      pane.removeEventListener("wheel", markWheelScrollIntent);
      pane.removeEventListener("touchstart", markUserScrollIntent);
      pane.removeEventListener("pointerdown", markPointerScrollIntent);
      pane.removeEventListener("scroll", handleNativeScroll);
      window.removeEventListener("pointerdown", markPointerScrollIntent, { capture: true });
      window.removeEventListener("mousedown", markMouseScrollIntent, { capture: true });
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("pointerup", clearScrollbarDragIntent);
      window.removeEventListener("pointercancel", clearScrollbarDragIntent);
      window.removeEventListener("mouseup", clearScrollbarDragIntent);
      window.removeEventListener("blur", clearScrollbarDragIntent);
      scheduler.cancelAll();
      timelineScrollbarDragActiveRef.current = false;
      scrollbarDragState = null;
    };
  }, [
    activeView,
    autoAligningTimelineRef,
    hasSelectedSession,
    lastExplicitTimelineScrollIntentAtRef,
    lastExplicitTimelineWheelDeltaYRef,
    lastTimelineScrollbarDragAtRef,
    lastUserTimelineScrollIntentAtRef,
    onExplicitTimelineScrollIntent,
    onScrollbarDragEnd,
    onScrollbarDragStart,
    preserveBottomOnNextPaneResizeRef,
    sessionsWithExplicitTimelineScrollRef,
    selectedSessionKey,
    timelineBottomAlignmentGenerationRef,
    timelinePaneMountVersion,
    timelinePaneRef,
    timelineScrollbarDragActiveRef,
    timelineScrollHandlerRef,
    userTimelineScrollIntentRef,
  ]);
}
