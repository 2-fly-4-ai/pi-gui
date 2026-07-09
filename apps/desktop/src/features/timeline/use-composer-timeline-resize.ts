import { useLayoutEffect, type RefObject } from "react";
import { isNearBottom } from "./timeline-viewport-utils";

interface UseComposerTimelineResizeOptions {
  readonly composerDraft: string;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly composerResizeBottomLockUntilRef: RefObject<number>;
  readonly followingLatestRef: RefObject<boolean>;
  readonly lastProgrammaticTimelineScrollAtRef: RefObject<number>;
  readonly lastTimelineScrollTopBySessionRef: RefObject<Map<string, number>>;
  readonly manualTimelineScrollRestoreRef: RefObject<boolean>;
  readonly manualTimelineScrollTopRef: RefObject<number | null>;
  readonly pinnedToBottomRef: RefObject<boolean>;
  readonly preserveBottomOnNextPaneResizeRef: RefObject<boolean>;
  readonly requestPinnedBottomAlignment: (behavior?: ScrollBehavior) => void;
  readonly selectedSessionKey: string;
  readonly suppressNativeTimelineScrollIntentUntilRef: RefObject<number>;
  readonly timelinePaneRef: RefObject<HTMLDivElement | null>;
}

export function useComposerTimelineResize({
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
}: UseComposerTimelineResizeOptions): void {
  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return undefined;
    }

    const pane = timelinePaneRef.current;
    const previousHeight = composer.getBoundingClientRect().height;
    const previousScrollTop = pane?.scrollTop ?? null;
    const composerResizeOwnsBottom = performance.now() < composerResizeBottomLockUntilRef.current;
    const paneIsAtBottom = pane ? isNearBottom(pane) : false;
    const shouldPreserveBottom = pane
      ? paneIsAtBottom || (followingLatestRef.current && (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current)) || composerResizeOwnsBottom
      : pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current || composerResizeOwnsBottom;

    composer.style.height = "0px";
    composer.style.height = `${Math.min(composer.scrollHeight, 220)}px`;

    const nextHeight = composer.getBoundingClientRect().height;
    if (Math.abs(nextHeight - previousHeight) >= 1 && shouldPreserveBottom) {
      const lockUntil = performance.now() + 300;
      composerResizeBottomLockUntilRef.current = lockUntil;
      suppressNativeTimelineScrollIntentUntilRef.current = lockUntil;
      preserveBottomOnNextPaneResizeRef.current = true;
      if (pane) {
        lastProgrammaticTimelineScrollAtRef.current = performance.now();
        pane.scrollTop += nextHeight - previousHeight;
      }
      requestPinnedBottomAlignment("auto");
      window.setTimeout(() => {
        if (composerResizeBottomLockUntilRef.current !== lockUntil) {
          return;
        }
        requestPinnedBottomAlignment("auto");
        preserveBottomOnNextPaneResizeRef.current = false;
        composerResizeBottomLockUntilRef.current = 0;
      }, 300);
      return;
    }

    if (Math.abs(nextHeight - previousHeight) >= 1 && pane && previousScrollTop !== null) {
      const targetScrollTop = manualTimelineScrollTopRef.current ?? previousScrollTop;
      const lockUntil = performance.now() + 300;
      suppressNativeTimelineScrollIntentUntilRef.current = lockUntil;
      manualTimelineScrollRestoreRef.current = true;
      lastProgrammaticTimelineScrollAtRef.current = performance.now();
      pane.scrollTop = targetScrollTop;
      manualTimelineScrollTopRef.current = targetScrollTop;
      lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, targetScrollTop);
      const restoreAcrossFrames = (remainingFrames: number) => {
        window.requestAnimationFrame(() => {
          if (timelinePaneRef.current !== pane) {
            manualTimelineScrollRestoreRef.current = false;
            return;
          }
          pane.scrollTop = targetScrollTop;
          if (remainingFrames <= 0) {
            manualTimelineScrollRestoreRef.current = false;
            return;
          }
          restoreAcrossFrames(remainingFrames - 1);
        });
      };
      restoreAcrossFrames(30);
      return;
    }

    if (composerResizeOwnsBottom && shouldPreserveBottom) {
      suppressNativeTimelineScrollIntentUntilRef.current = performance.now() + 300;
      requestPinnedBottomAlignment("auto");
    }
  }, [
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
  ]);
}
