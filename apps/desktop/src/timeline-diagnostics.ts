import { useEffect, type MutableRefObject, type RefObject } from "react";
import type { TranscriptMessage } from "./desktop-state";
import { reportRendererDiagnostic } from "./renderer-diagnostics";

interface TimelineDiagnosticsOptions {
  readonly timelinePaneRef: MutableRefObject<HTMLDivElement | null>;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly transcript: readonly TranscriptMessage[];
  readonly selectedSessionKey: string;
  readonly followingLatestRef: MutableRefObject<boolean>;
  readonly pinnedToBottomRef: MutableRefObject<boolean>;
}

type TimelineDiagnosticFlag = "PI_APP_LAYOUT_MONITOR" | "PI_APP_PERF_MONITOR";

interface LayoutShiftAttributionLike {
  readonly node?: Node;
  readonly previousRect?: DOMRectReadOnly;
  readonly currentRect?: DOMRectReadOnly;
}

interface LayoutShiftEntryLike extends PerformanceEntry {
  readonly value?: number;
  readonly hadRecentInput?: boolean;
  readonly sources?: readonly LayoutShiftAttributionLike[];
}

interface LongTaskEntryLike extends PerformanceEntry {
  readonly attribution?: readonly unknown[];
}

export function useTimelineDiagnostics(options: TimelineDiagnosticsOptions): void {
  useLayoutShiftDiagnostics(options);
  useRowResizeDiagnostics(options);
  useScrollFrameDiagnostics(options);
  useComposerResizeDiagnostics(options);
  useLongTaskDiagnostics(options);
}

function diagnosticsEnabled(name: TimelineDiagnosticFlag): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const localOverride = window.localStorage.getItem(name);
  if (localOverride === "1") {
    return true;
  }
  if (localOverride === "0") {
    return false;
  }

  const search = new URLSearchParams(window.location.search);
  if (search.get(name) === "1") {
    return true;
  }

  const flags = window.piApp?.diagnosticFlags;
  return name === "PI_APP_LAYOUT_MONITOR" ? Boolean(flags?.layoutMonitor) : Boolean(flags?.perfMonitor);
}

function useLayoutShiftDiagnostics({ selectedSessionKey }: TimelineDiagnosticsOptions): void {
  useEffect(() => {
    if (!diagnosticsEnabled("PI_APP_LAYOUT_MONITOR") || typeof PerformanceObserver === "undefined") {
      return undefined;
    }

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as LayoutShiftEntryLike[]) {
        if (entry.hadRecentInput) {
          continue;
        }
        emitTimelineDiagnostic("timeline-layout-shift", {
          sessionKey: selectedSessionKey,
          value: entry.value ?? 0,
          startTime: round(entry.startTime),
          sources: (entry.sources ?? []).slice(0, 5).map((source) => ({
            node: describeNode(source.node),
            previousRect: rectSummary(source.previousRect),
            currentRect: rectSummary(source.currentRect),
          })),
        });
      }
    });

    try {
      observer.observe({ type: "layout-shift", buffered: true });
    } catch {
      return undefined;
    }

    return () => observer.disconnect();
  }, [selectedSessionKey]);
}

function useRowResizeDiagnostics({ timelinePaneRef, transcript, selectedSessionKey }: TimelineDiagnosticsOptions): void {
  useEffect(() => {
    if (!diagnosticsEnabled("PI_APP_LAYOUT_MONITOR")) {
      return undefined;
    }

    const pane = timelinePaneRef.current;
    if (!pane) {
      return undefined;
    }

    const heights = new Map<string, number>();
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const row = entry.target instanceof HTMLElement ? entry.target : undefined;
        const rowId = row?.dataset.timelineRowId;
        if (!row || !rowId) {
          continue;
        }
        const nextHeight = Math.round(entry.contentRect.height);
        const previousHeight = heights.get(rowId);
        heights.set(rowId, nextHeight);
        if (previousHeight === undefined || Math.abs(nextHeight - previousHeight) < 2) {
          continue;
        }
        const item = transcript.find((candidate) => candidate.id === rowId);
        emitTimelineDiagnostic("timeline-row-resize", {
          sessionKey: selectedSessionKey,
          rowId,
          itemKind: item?.kind,
          status: "status" in (item ?? {}) ? (item as { readonly status?: string }).status : undefined,
          delta: nextHeight - previousHeight,
          previousHeight,
          nextHeight,
          row: describeElement(row),
        });
      }
    });

    const observed = new WeakSet<Element>();
    const observeRows = () => {
      for (const row of Array.from(pane.querySelectorAll<HTMLElement>("[data-timeline-row-id]"))) {
        if (observed.has(row)) {
          continue;
        }
        observed.add(row);
        heights.set(row.dataset.timelineRowId ?? "", Math.round(row.getBoundingClientRect().height));
        resizeObserver.observe(row);
      }
    };

    observeRows();
    const mutationObserver = new MutationObserver(observeRows);
    mutationObserver.observe(pane, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [selectedSessionKey, timelinePaneRef, transcript]);
}

function useScrollFrameDiagnostics({
  timelinePaneRef,
  transcript,
  selectedSessionKey,
  followingLatestRef,
  pinnedToBottomRef,
}: TimelineDiagnosticsOptions): void {
  useEffect(() => {
    if (!diagnosticsEnabled("PI_APP_LAYOUT_MONITOR")) {
      return undefined;
    }

    const pane = timelinePaneRef.current;
    if (!pane || !selectedSessionKey) {
      return undefined;
    }

    const startedAt = performance.now();
    let lastEmitAt = 0;
    let frame = 0;
    let cancelled = false;

    const sample = () => {
      if (cancelled) {
        return;
      }

      const now = performance.now();
      if (now - lastEmitAt >= 250) {
        lastEmitAt = now;
        emitTimelineDiagnostic("timeline-scroll-frame", {
          sessionKey: selectedSessionKey,
          frame,
          scrollTop: Math.round(pane.scrollTop),
          scrollHeight: Math.round(pane.scrollHeight),
          clientHeight: Math.round(pane.clientHeight),
          remainingFromBottom: Math.round(pane.scrollHeight - pane.scrollTop - pane.clientHeight),
          followingLatest: followingLatestRef.current,
          pinnedToBottom: pinnedToBottomRef.current,
          visibleRows: visibleRowIds(pane),
          transcriptLength: transcript.length,
        });
      }

      frame += 1;
      if (now - startedAt < 30_000) {
        window.requestAnimationFrame(sample);
      }
    };

    window.requestAnimationFrame(sample);
    return () => {
      cancelled = true;
    };
  }, [followingLatestRef, pinnedToBottomRef, selectedSessionKey, timelinePaneRef, transcript.length]);
}

function useComposerResizeDiagnostics({ composerRef, selectedSessionKey }: TimelineDiagnosticsOptions): void {
  useEffect(() => {
    if (!diagnosticsEnabled("PI_APP_LAYOUT_MONITOR")) {
      return undefined;
    }

    const composer = composerRef.current;
    if (!composer) {
      return undefined;
    }

    let previousHeight = Math.round(composer.getBoundingClientRect().height);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const nextHeight = Math.round(entry.contentRect.height);
      if (Math.abs(nextHeight - previousHeight) < 1) {
        return;
      }
      emitTimelineDiagnostic("timeline-composer-resize", {
        sessionKey: selectedSessionKey,
        previousHeight,
        nextHeight,
        delta: nextHeight - previousHeight,
      });
      previousHeight = nextHeight;
    });

    observer.observe(composer);
    return () => observer.disconnect();
  }, [composerRef, selectedSessionKey]);
}

function useLongTaskDiagnostics({ selectedSessionKey }: TimelineDiagnosticsOptions): void {
  useEffect(() => {
    if (!diagnosticsEnabled("PI_APP_PERF_MONITOR") || typeof PerformanceObserver === "undefined") {
      return undefined;
    }

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as LongTaskEntryLike[]) {
        emitTimelineDiagnostic("timeline-long-task", {
          sessionKey: selectedSessionKey,
          name: entry.name,
          startTime: round(entry.startTime),
          duration: round(entry.duration),
          attributionCount: entry.attribution?.length ?? 0,
        });
      }
    });

    try {
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      return undefined;
    }

    return () => observer.disconnect();
  }, [selectedSessionKey]);
}

function emitTimelineDiagnostic(kind: string, details: Record<string, unknown>): void {
  reportRendererDiagnostic({
    kind,
    message: `[DEBUG-timeline] ${kind}`,
    details,
  });
}

function visibleRowIds(pane: HTMLElement): { readonly first?: string; readonly last?: string } {
  const paneRect = pane.getBoundingClientRect();
  const visibleRows = Array.from(pane.querySelectorAll<HTMLElement>("[data-timeline-row-id]"))
    .filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > paneRect.top && rect.top < paneRect.bottom;
    })
    .map((row) => row.dataset.timelineRowId)
    .filter((rowId): rowId is string => Boolean(rowId));

  return {
    ...(visibleRows[0] ? { first: visibleRows[0] } : {}),
    ...(visibleRows.at(-1) ? { last: visibleRows.at(-1) } : {}),
  };
}

function describeNode(node: Node | undefined): string | undefined {
  return node instanceof Element ? describeElement(node) : undefined;
}

function describeElement(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const classes = Array.from(element.classList).slice(0, 4).map((className) => `.${className}`).join("");
  const testId = element instanceof HTMLElement && element.dataset.testid ? `[data-testid=${element.dataset.testid}]` : "";
  const rowId = element instanceof HTMLElement && element.dataset.timelineRowId ? `[row=${element.dataset.timelineRowId}]` : "";
  return `${tag}${id}${classes}${testId}${rowId}`;
}

function rectSummary(rect: DOMRectReadOnly | undefined): Record<string, number> | undefined {
  if (!rect) {
    return undefined;
  }
  return {
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
