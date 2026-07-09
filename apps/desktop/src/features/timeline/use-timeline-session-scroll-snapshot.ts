import { useLayoutEffect, type RefObject } from "react";
import type { AppView } from "../../desktop-state";
import { isNearBottom } from "./timeline-viewport-utils";

interface UseTimelineSessionScrollSnapshotOptions {
  readonly activeView: AppView | undefined;
  readonly followingLatestRef: RefObject<boolean>;
  readonly forceActualSnapshotSessionKeysRef: RefObject<Set<string>>;
  readonly hasSelectedSession: boolean;
  readonly lastTimelinePinnedBySessionRef: RefObject<Map<string, boolean>>;
  readonly lastTimelineScrollTopBySessionRef: RefObject<Map<string, number>>;
  readonly pinnedToBottomRef: RefObject<boolean>;
  readonly preserveBottomOnNextPaneResizeRef: RefObject<boolean>;
  readonly selectedSessionKey: string;
  readonly timelinePaneRef: RefObject<HTMLDivElement | null>;
}

export function useTimelineSessionScrollSnapshot({
  activeView,
  followingLatestRef,
  forceActualSnapshotSessionKeysRef,
  hasSelectedSession,
  lastTimelinePinnedBySessionRef,
  lastTimelineScrollTopBySessionRef,
  pinnedToBottomRef,
  preserveBottomOnNextPaneResizeRef,
  selectedSessionKey,
  timelinePaneRef,
}: UseTimelineSessionScrollSnapshotOptions): void {
  useLayoutEffect(() => {
    if (activeView !== "threads" || !hasSelectedSession) {
      return undefined;
    }
    const lastTimelineScrollTopBySession = lastTimelineScrollTopBySessionRef.current;
    const lastTimelinePinnedBySession = lastTimelinePinnedBySessionRef.current;
    const forceActualSnapshotSessionKeys = forceActualSnapshotSessionKeysRef.current;
    const pane = timelinePaneRef.current;
    const shouldPreservePinnedState = () => (
      followingLatestRef.current ||
      pinnedToBottomRef.current ||
      preserveBottomOnNextPaneResizeRef.current
    );

    return () => {
      if (!pane) {
        return;
      }
      const paneIsNearBottom = isNearBottom(pane);
      const savedPinned = lastTimelinePinnedBySession.get(selectedSessionKey);
      const savedScrollTop = lastTimelineScrollTopBySession.get(selectedSessionKey);
      const maxScrollTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
      const savedOffBottomPositionIsStillHydrating =
        savedPinned === false &&
        savedScrollTop !== undefined &&
        maxScrollTop < savedScrollTop - 2;
      if (savedOffBottomPositionIsStillHydrating) {
        return;
      }
      const shouldPreserveSemanticPinnedState =
        !forceActualSnapshotSessionKeys.has(selectedSessionKey) &&
        savedPinned !== false &&
        shouldPreservePinnedState();
      lastTimelineScrollTopBySession.set(selectedSessionKey, pane.scrollTop);
      lastTimelinePinnedBySession.set(
        selectedSessionKey,
        forceActualSnapshotSessionKeys.has(selectedSessionKey)
          ? paneIsNearBottom
          : shouldPreserveSemanticPinnedState || paneIsNearBottom,
      );
    };
  }, [
    activeView,
    followingLatestRef,
    forceActualSnapshotSessionKeysRef,
    hasSelectedSession,
    lastTimelinePinnedBySessionRef,
    lastTimelineScrollTopBySessionRef,
    pinnedToBottomRef,
    preserveBottomOnNextPaneResizeRef,
    selectedSessionKey,
    timelinePaneRef,
  ]);
}
