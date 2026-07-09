import { useLayoutEffect, type RefObject } from "react";
import type { AppView } from "../../desktop-state";
import type { TimelinePaneSize } from "./timeline-viewport-utils";

interface UseTimelinePaneResizeOptions {
  readonly activeView: AppView | undefined;
  readonly followingLatestRef: RefObject<boolean>;
  readonly pinnedToBottomRef: RefObject<boolean>;
  readonly preserveBottomOnNextPaneResizeRef: RefObject<boolean>;
  readonly previousTimelinePaneSizeRef: RefObject<TimelinePaneSize | null>;
  readonly requestPinnedBottomAlignment: (behavior?: ScrollBehavior) => void;
  readonly selectedSessionKey: string;
  readonly showDiffPanel: boolean;
  readonly timelinePaneMountVersion: number;
  readonly timelinePaneRef: RefObject<HTMLDivElement | null>;
}

export function useTimelinePaneResize({
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
}: UseTimelinePaneResizeOptions): void {
  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane || !selectedSessionKey || activeView !== "threads") {
      previousTimelinePaneSizeRef.current = null;
      return undefined;
    }

    const stickToBottomAfterLayoutChange = () => {
      preserveBottomOnNextPaneResizeRef.current = false;
      pinnedToBottomRef.current = true;
      followingLatestRef.current = true;
      window.requestAnimationFrame(() => {
        requestPinnedBottomAlignment("auto");
        window.requestAnimationFrame(() => {
          if (pinnedToBottomRef.current) {
            requestPinnedBottomAlignment("auto");
          }
        });
      });
    };

    const updateMeasuredSize = (nextSize: TimelinePaneSize) => {
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
  }, [
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
  ]);
}
