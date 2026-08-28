import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject, type RefCallback, type RefObject } from "react";
import type { TranscriptMessage } from "./desktop-state";
import { readAppearancePreferences, type TimelineCompressionMode } from "./appearance-preferences";
import { ThreadSearchBar } from "./thread-search";
import { TimelineItem } from "./timeline-item";
import { useStableTranscriptRows } from "./conversation-timeline-rows";
import { compressTimelineRows, type TimelineDisplayRow } from "./semantic-timeline-compression";
import type { PiDesktopApi } from "./ipc";
import { useTaskEvidence } from "./features/evidence/use-task-evidence";
import { deriveAttentionMarkers, type AttentionMarker } from "./attention-markers";
import { buildTimelineMinimap, type TimelineMinimapSegment } from "./timeline-minimap";
import { LoadingState } from "./loading-state";

export const VIRTUALIZATION_THRESHOLD = 80;

type TimelinePaneElement = HTMLDivElement & {
  __legendListRef?: LegendListRef | null;
};

interface ThreadSearchModel {
  readonly isOpen: boolean;
  readonly query: string;
  readonly matchCount: number;
  readonly activeIndex: number;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly search: (query: string) => void;
  readonly goToMatch: (direction: 1 | -1) => void;
  readonly close: () => void;
}

interface ConversationTimelineProps {
  readonly api: PiDesktopApi;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly timelineSessionKey: string;
  readonly transcript: readonly TranscriptMessage[];
  readonly isTranscriptLoading: boolean;
  readonly timelinePaneRef: MutableRefObject<HTMLDivElement | null>;
  readonly timelinePaneElementRef?: RefCallback<HTMLDivElement>;
  readonly disableVirtualization?: boolean;
  readonly onDisableVirtualizationReady?: () => void;
  readonly onTimelineScroll: () => void;
  readonly onTimelineNavigate: () => void;
  readonly threadSearch: ThreadSearchModel;
  readonly showJumpToLatest: boolean;
  readonly scrollbarDragging?: boolean;
  readonly onJumpToLatest: () => void;
  readonly onContentHeightChange: () => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onOpenUrl?: (url: string) => void;
  readonly onBranchFromMessage?: (messageId: string, role: "user" | "assistant", text: string) => Promise<void>;
}

export function ConversationTimeline({
  api,
  workspaceId,
  sessionId,
  timelineSessionKey,
  transcript,
  isTranscriptLoading,
  timelinePaneRef,
  timelinePaneElementRef,
  disableVirtualization = false,
  onDisableVirtualizationReady,
  onTimelineScroll,
  onTimelineNavigate,
  threadSearch,
  showJumpToLatest,
  scrollbarDragging = false,
  onJumpToLatest,
  onContentHeightChange,
  onViewFileInDiff,
  onOpenUrl,
  onBranchFromMessage,
}: ConversationTimelineProps) {
  const stableTranscript = useStableTranscriptRows(transcript);
  const { records: taskEvidence } = useTaskEvidence(api, workspaceId, sessionId);
  const [compressionMode, setCompressionMode] = useState<TimelineCompressionMode>(
    () => readAppearancePreferences().timelineCompression,
  );
  const [minimapEnabled, setMinimapEnabled] = useState(() => readAppearancePreferences().timelineMinimap);
  useEffect(() => {
    const handleAppearanceChange = (event: Event) => {
      const detail = (event as CustomEvent<{
        readonly timelineCompression?: TimelineCompressionMode;
        readonly timelineMinimap?: boolean;
      }>).detail;
      if (detail?.timelineCompression) setCompressionMode(detail.timelineCompression);
      if (detail?.timelineMinimap !== undefined) setMinimapEnabled(detail.timelineMinimap);
    };
    window.addEventListener("pi-gui:appearance-preferences-changed", handleAppearanceChange);
    return () => window.removeEventListener("pi-gui:appearance-preferences-changed", handleAppearanceChange);
  }, []);
  const displayRows = useMemo(
    () => compressTimelineRows(stableTranscript, threadSearch.isOpen ? "expanded" : compressionMode),
    [compressionMode, stableTranscript, threadSearch.isOpen],
  );
  const attentionMarkers = useMemo(() => {
    const rawMarkers = deriveAttentionMarkers(stableTranscript, taskEvidence);
    const displayRowByRawId = new Map<string, string>();
    for (const row of displayRows) {
      if (row.kind === "semantic-group") {
        for (const item of row.items) displayRowByRawId.set(item.id, row.id);
      } else {
        displayRowByRawId.set(row.id, row.id);
      }
    }
    return rawMarkers.map((marker) => ({
      ...marker,
      rowId: displayRowByRawId.get(marker.rowId) ?? marker.rowId,
    }));
  }, [displayRows, stableTranscript, taskEvidence]);
  const markersByRow = useMemo(() => {
    const result = new Map<string, AttentionMarker[]>();
    for (const marker of attentionMarkers) {
      const existing = result.get(marker.rowId);
      if (existing) existing.push(marker);
      else result.set(marker.rowId, [marker]);
    }
    return result;
  }, [attentionMarkers]);
  const completionMarkers = useMemo(
    () => attentionMarkers.filter((marker) => marker.type === "milestone" && !marker.evidenceId),
    [attentionMarkers],
  );
  const [activeMarkerIndex, setActiveMarkerIndex] = useState(0);
  const [activeTarget, setActiveTarget] = useState<{
    readonly sessionKey: string;
    readonly rowId: string;
  }>();
  const activeTargetRowId = activeTarget?.sessionKey === timelineSessionKey
    ? activeTarget.rowId
    : undefined;
  useEffect(() => {
    setActiveMarkerIndex((current) => Math.min(current, Math.max(0, completionMarkers.length - 1)));
  }, [completionMarkers.length]);
  const minimapSegments = useMemo(
    () => minimapEnabled ? buildTimelineMinimap(stableTranscript, displayRows, attentionMarkers) : [],
    [attentionMarkers, displayRows, minimapEnabled, stableTranscript],
  );
  // Long transcripts must never fall back to full DOM rendering. The parent may
  // temporarily request disabled virtualization while restoring scroll position,
  // but rendering thousands of historical rows is what makes the renderer memory
  // spike and eventually crash. For long threads, stay virtualized and let the
  // parent finish its scroll restore against the virtual scroller.
  const shouldVirtualize =
    !threadSearch.isOpen &&
    stableTranscript.length > VIRTUALIZATION_THRESHOLD;
  const [expandedToolCallIds, setExpandedToolCallIds] = useState<Set<string>>(() => new Set());
  const measuredHeightsRef = useRef(new Map<string, number>());
  const measurementUpdateFrameRef = useRef<number | null>(null);
  const [measurementVersion, setMeasurementVersion] = useState(0);

  const scheduleMeasurementVersionUpdate = useCallback(() => {
    if (measurementUpdateFrameRef.current !== null) {
      return;
    }
    measurementUpdateFrameRef.current = window.requestAnimationFrame(() => {
      measurementUpdateFrameRef.current = null;
      setMeasurementVersion((current) => current + 1);
    });
  }, []);

  useEffect(() => () => {
    if (measurementUpdateFrameRef.current !== null) {
      window.cancelAnimationFrame(measurementUpdateFrameRef.current);
      measurementUpdateFrameRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    const availableToolCallIds = new Set(
      stableTranscript
        .filter((item): item is Extract<TranscriptMessage, { kind: "tool" }> => item.kind === "tool")
        .map((item) => item.callId),
    );

    setExpandedToolCallIds((current) => {
      if (current.size === 0) {
        return current;
      }
      let changed = false;
      const next = new Set<string>();
      for (const callId of current) {
        if (!availableToolCallIds.has(callId)) {
          changed = true;
          continue;
        }
        next.add(callId);
      }
      return changed ? next : current;
    });
  }, [stableTranscript]);

  useLayoutEffect(() => {
    const knownIds = new Set(displayRows.map((item) => item.id));
    let removedAny = false;
    for (const id of measuredHeightsRef.current.keys()) {
      if (knownIds.has(id)) {
        continue;
      }
      measuredHeightsRef.current.delete(id);
      removedAny = true;
    }
    if (removedAny) {
      scheduleMeasurementVersionUpdate();
    }
  }, [displayRows, scheduleMeasurementVersionUpdate]);

  useLayoutEffect(() => {
    if (!disableVirtualization || isTranscriptLoading || displayRows.length === 0) {
      return;
    }
    const measuredCount = displayRows.reduce(
      (count, item) => count + (measuredHeightsRef.current.has(item.id) ? 1 : 0),
      0,
    );
    const allRowsMeasured = measuredCount === displayRows.length;
    const enoughRowsMeasuredForVirtualRestore =
      displayRows.length > VIRTUALIZATION_THRESHOLD && measuredCount >= VIRTUALIZATION_THRESHOLD;
    if (!allRowsMeasured && !enoughRowsMeasuredForVirtualRestore) {
      return;
    }
    onDisableVirtualizationReady?.();
  }, [disableVirtualization, displayRows, isTranscriptLoading, measurementVersion, onDisableVirtualizationReady]);

  const toggleToolCall = useCallback((callId: string) => {
    setExpandedToolCallIds((current) => {
      const next = new Set(current);
      if (next.has(callId)) {
        next.delete(callId);
      } else {
        next.add(callId);
      }
      return next;
    });
  }, []);

  const updateMeasuredHeight = useCallback((id: string, height: number) => {
    const nextHeight = Math.max(1, Math.ceil(height));
    const currentHeight = measuredHeightsRef.current.get(id);
    if (currentHeight === nextHeight) {
      return;
    }
    measuredHeightsRef.current.set(id, nextHeight);
    scheduleMeasurementVersionUpdate();
  }, [scheduleMeasurementVersionUpdate]);

  const assignTimelinePaneRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      node.dataset.timelineSessionKey = timelineSessionKey;
    }
    timelinePaneRef.current = node;
    timelinePaneElementRef?.(node);
  }, [timelinePaneElementRef, timelinePaneRef, timelineSessionKey]);

  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane) {
      return undefined;
    }

    let lastScrollHeight = pane.scrollHeight;
    let pendingFrame: number | undefined;
    const notifyWhenHeightChanges = () => {
      pendingFrame = undefined;
      const nextScrollHeight = pane.scrollHeight;
      if (Math.abs(nextScrollHeight - lastScrollHeight) < 1) {
        return;
      }
      lastScrollHeight = nextScrollHeight;
      onContentHeightChange();
    };
    const observer = new MutationObserver(() => {
      if (pendingFrame === undefined) {
        pendingFrame = window.requestAnimationFrame(notifyWhenHeightChanges);
      }
    });
    observer.observe(pane, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      if (pendingFrame !== undefined) {
        window.cancelAnimationFrame(pendingFrame);
      }
    };
  }, [onContentHeightChange, timelinePaneRef, timelineSessionKey]);

  const handleTimelineClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!onOpenUrl || event.defaultPrevented) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const anchor = target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    event.preventDefault();
    onOpenUrl(anchor.href);
  }, [onOpenUrl]);

  const navigateToRow = useCallback((rowId: string) => {
    const rowIndex = displayRows.findIndex((row) => row.id === rowId);
    if (rowIndex < 0) return;
    setActiveTarget({ sessionKey: timelineSessionKey, rowId });
    onTimelineNavigate();
    const referencedPane = timelinePaneRef.current as TimelinePaneElement | null;
    const pane = referencedPane?.dataset.timelineSessionKey === timelineSessionKey
      ? referencedPane
      : document.querySelector<TimelinePaneElement>(
        `[data-testid="timeline-pane"][data-timeline-session-key="${CSS.escape(timelineSessionKey)}"]`,
      );
    if (!pane) return;
    const approximateOffset = displayRows.length > 1
      ? rowIndex / (displayRows.length - 1) * Math.max(0, pane.scrollHeight - pane.clientHeight)
      : 0;
    const positionTarget = () => {
      pane.scrollTop = approximateOffset;
      void pane.__legendListRef?.scrollToOffset?.({ offset: approximateOffset, animated: false });
      return pane.__legendListRef?.scrollToIndex?.({
        index: rowIndex,
        animated: false,
        viewPosition: 0.5,
      });
    };
    const highlight = (attempt = 0) => {
      pane.querySelectorAll(".timeline-attention-target").forEach((row) => row.classList.remove("timeline-attention-target"));
      const target = pane.querySelector<HTMLElement>(`[data-timeline-row-id="${CSS.escape(rowId)}"]`);
      if (target) {
        target.classList.add("timeline-attention-target");
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      } else if (attempt < 80) {
        void positionTarget();
        window.setTimeout(() => highlight(attempt + 1), 50);
      }
    };
    if (pane.__legendListRef?.scrollToIndex) {
      const result = positionTarget();
      void Promise.resolve(result).then(() => {
        onTimelineNavigate();
        highlight();
      });
      window.setTimeout(() => highlight(), 50);
    } else {
      highlight();
    }
  }, [displayRows, onTimelineNavigate, timelinePaneRef, timelineSessionKey]);

  const navigateToMarker = useCallback((requestedIndex: number) => {
    if (completionMarkers.length === 0) return;
    const index = (requestedIndex + completionMarkers.length) % completionMarkers.length;
    const marker = completionMarkers[index];
    if (!marker) return;
    setActiveMarkerIndex(index);
    navigateToRow(marker.rowId);
  }, [completionMarkers, navigateToRow]);

  useEffect(() => {
    const handleAttentionShortcut = (event: KeyboardEvent) => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      if (completionMarkers.length === 0) return;
      event.preventDefault();
      navigateToMarker(activeMarkerIndex + (event.key === "ArrowDown" ? 1 : -1));
    };
    document.addEventListener("keydown", handleAttentionShortcut);
    return () => document.removeEventListener("keydown", handleAttentionShortcut);
  }, [activeMarkerIndex, completionMarkers.length, navigateToMarker]);

  const attentionNavigation = completionMarkers.length ? (
    <TimelineAttentionNavigation
      markers={completionMarkers}
      activeIndex={activeMarkerIndex}
      onNavigate={navigateToMarker}
    />
  ) : null;
  const timelineMinimap = minimapSegments.length ? (
    <TimelineMinimap segments={minimapSegments} activeTargetRowId={activeTargetRowId} onNavigate={navigateToRow} />
  ) : null;

  if (shouldVirtualize && !isTranscriptLoading && stableTranscript.length > 0) {
    return (
      <div className="timeline-pane-frame timeline-pane-frame--thread" data-testid="transcript" onClickCapture={handleTimelineClickCapture}>
        <LegendTranscriptList
          timelineSessionKey={timelineSessionKey}
          transcript={displayRows}
          scrollbarDragging={scrollbarDragging}
          followLatest={!showJumpToLatest}
          assignTimelinePaneRef={assignTimelinePaneRef}
          onTimelineScroll={onTimelineScroll}
          expandedToolCallIds={expandedToolCallIds}
          onToggleToolCall={toggleToolCall}
          onViewFileInDiff={onViewFileInDiff}
          onContentHeightChange={onContentHeightChange}
          onOpenUrl={onOpenUrl}
          onBranchFromMessage={onBranchFromMessage}
          markersByRow={markersByRow}
          activeTargetRowId={activeTargetRowId}
        />
        {attentionNavigation}
        {timelineMinimap}
        <div className="timeline-scrollbar-hit-area" aria-hidden="true" />
        {showJumpToLatest ? (
          <button
            className="timeline-jump"
            data-testid="timeline-jump"
            type="button"
            onPointerDown={onJumpToLatest}
            onClick={onJumpToLatest}
          >
            Show latest activity
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="timeline-pane-frame timeline-pane-frame--thread" onClickCapture={handleTimelineClickCapture}>
      <div
        className="timeline-pane timeline-pane--thread"
        data-timeline-session-key={timelineSessionKey}
        data-testid="timeline-pane"
        ref={assignTimelinePaneRef}
        onScroll={onTimelineScroll}
      >
      {threadSearch.isOpen ? (
        <ThreadSearchBar
          query={threadSearch.query}
          matchCount={threadSearch.matchCount}
          activeIndex={threadSearch.activeIndex}
          inputRef={threadSearch.inputRef}
          onSearch={threadSearch.search}
          onNext={() => threadSearch.goToMatch(1)}
          onPrev={() => threadSearch.goToMatch(-1)}
          onClose={threadSearch.close}
        />
      ) : null}
      {attentionNavigation}
      {timelineMinimap}
      {isTranscriptLoading ? (
        <div className="timeline" data-testid="transcript">
          <LoadingState compact label="Loading transcript" detail="Restoring the latest session events…" />
        </div>
      ) : displayRows.length === 0 ? (
        <div className="timeline" data-testid="transcript">
          <div className="timeline-empty">Send a prompt to start the session.</div>
        </div>
      ) : (
        <div className="timeline" data-testid="transcript">
          {displayRows.map((item) => (
            <MeasuredTimelineItem
              item={item}
              key={item.id}
              onHeightChange={updateMeasuredHeight}
              expandedToolCallIds={expandedToolCallIds}
              onToggleToolCall={toggleToolCall}
              onViewFileInDiff={onViewFileInDiff}
              onOpenUrl={onOpenUrl}
              onBranchFromMessage={onBranchFromMessage}
              markers={markersByRow.get(item.id)}
              activeTarget={activeTargetRowId === item.id}
            />
          ))}
        </div>
      )}
      </div>
      {showJumpToLatest ? (
        <button
          className="timeline-jump"
          data-testid="timeline-jump"
          type="button"
          onPointerDown={onJumpToLatest}
          onClick={onJumpToLatest}
        >
          Show latest activity
        </button>
      ) : null}
    </div>
  );
}

function TimelineAttentionNavigation({
  markers,
  activeIndex,
  onNavigate,
}: {
  readonly markers: readonly AttentionMarker[];
  readonly activeIndex: number;
  readonly onNavigate: (index: number) => void;
}) {
  const marker = markers[activeIndex] ?? markers[0];
  if (!marker) return null;
  return (
    <nav className="timeline-attention-nav" data-testid="timeline-attention-nav" aria-label="Completed runs">
      <button type="button" aria-label="Previous completed run" onClick={() => onNavigate(activeIndex - 1)}>↑</button>
      <button
        className="timeline-attention-nav__current"
        type="button"
        aria-label={`Current completed run: ${marker.label}`}
        onClick={() => onNavigate(activeIndex)}
      >
        <span>{activeIndex + 1} of {markers.length}</span>
        <strong>Completed</strong>
      </button>
      <button type="button" aria-label="Next completed run" onClick={() => onNavigate(activeIndex + 1)}>↓</button>
      <span className="sr-only">Option+Up and Option+Down navigate completed runs.</span>
    </nav>
  );
}

function TimelineMinimap({
  segments,
  activeTargetRowId,
  onNavigate,
}: {
  readonly segments: readonly TimelineMinimapSegment[];
  readonly activeTargetRowId?: string;
  readonly onNavigate: (rowId: string) => void;
}) {
  return (
    <nav className="timeline-minimap" data-testid="timeline-minimap" aria-label="Timeline minimap">
      {segments.map((segment) => (
        <button
          key={segment.id}
          type="button"
          className={`timeline-minimap__segment${activeTargetRowId === segment.rowId ? " timeline-minimap__segment--active" : ""}`}
          data-signal-types={segment.types.join(" ")}
          data-timeline-target-row-id={segment.rowId}
          aria-current={activeTargetRowId === segment.rowId ? "location" : undefined}
          style={{ top: `${segment.position * 100}%` }}
          aria-label={`${segment.label}. ${segment.count} event${segment.count === 1 ? "" : "s"}.`}
          title={segment.label}
          onClick={() => onNavigate(segment.rowId)}
        />
      ))}
    </nav>
  );
}

function LegendTranscriptList({
  timelineSessionKey,
  transcript,
  scrollbarDragging,
  followLatest,
  assignTimelinePaneRef,
  onTimelineScroll,
  expandedToolCallIds,
  onToggleToolCall,
  onViewFileInDiff,
  onContentHeightChange,
  onOpenUrl,
  onBranchFromMessage,
  markersByRow,
  activeTargetRowId,
}: {
  readonly timelineSessionKey: string;
  readonly transcript: readonly TimelineDisplayRow[];
  readonly scrollbarDragging: boolean;
  readonly followLatest: boolean;
  readonly assignTimelinePaneRef: RefCallback<HTMLDivElement>;
  readonly onTimelineScroll: () => void;
  readonly expandedToolCallIds: ReadonlySet<string>;
  readonly onToggleToolCall: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onContentHeightChange: () => void;
  readonly onOpenUrl?: (url: string) => void;
  readonly onBranchFromMessage?: (messageId: string, role: "user" | "assistant", text: string) => Promise<void>;
  readonly markersByRow: ReadonlyMap<string, readonly AttentionMarker[]>;
  readonly activeTargetRowId?: string;
}) {
  const legendListRef = useRef<LegendListRef | null>(null);
  const activeTargetIndex = useMemo(
    () => activeTargetRowId ? transcript.findIndex((row) => row.id === activeTargetRowId) : -1,
    [activeTargetRowId, transcript],
  );
  const extraData = useMemo(
    () => ({ activeTargetRowId, expandedToolCallIds, markersByRow }),
    [activeTargetRowId, expandedToolCallIds, markersByRow],
  );

  useLayoutEffect(() => {
    let frame: number | undefined;
    let pane: TimelinePaneElement | null = null;
    let attempts = 0;
    const connectPane = () => {
      const node = legendListRef.current?.getScrollableNode?.();
      pane = node instanceof HTMLDivElement ? (node as TimelinePaneElement) : null;
      if (pane) {
        pane.__legendListRef = legendListRef.current;
        assignTimelinePaneRef(pane);
        return;
      }
      attempts += 1;
      if (attempts < 60) frame = window.requestAnimationFrame(connectPane);
    };
    connectPane();
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (pane) {
        pane.__legendListRef = null;
      }
      assignTimelinePaneRef(null);
    };
  }, [assignTimelinePaneRef]);

  useLayoutEffect(() => {
    if (activeTargetIndex < 0) return undefined;
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        void legendListRef.current?.scrollToIndex?.({
          index: activeTargetIndex,
          animated: false,
          viewPosition: 0.5,
        });
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTargetIndex]);

  const renderItem = useCallback(({ item }: { item: TimelineDisplayRow }) => (
    <div
      className={`timeline__legend-row timeline__virtual-row${markersByRow.has(item.id) ? " timeline-row--attention" : ""}${activeTargetRowId === item.id ? " timeline-attention-target" : ""}`}
      data-timeline-row-id={item.id}
      data-attention-types={markersByRow.get(item.id)?.map((marker) => marker.type).join(" ")}
      title={markersByRow.get(item.id)?.map((marker) => marker.label).join("\n")}
    >
      <TimelineItem
        item={item}
        expandedToolCallIds={expandedToolCallIds}
        onToggleToolCall={onToggleToolCall}
        onViewFileInDiff={onViewFileInDiff}
        onOpenUrl={onOpenUrl}
        onBranchFromMessage={onBranchFromMessage}
      />
    </div>
  ), [activeTargetRowId, expandedToolCallIds, markersByRow, onBranchFromMessage, onOpenUrl, onToggleToolCall, onViewFileInDiff]);

  return (
    <LegendList<TimelineDisplayRow>
      ref={legendListRef}
      data={transcript}
      dataKey={timelineSessionKey}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      estimatedItemSize={90}
      drawDistance={2_400}
      initialScrollAtEnd
      maintainScrollAtEnd={followLatest && !scrollbarDragging}
      maintainScrollAtEndThreshold={0.1}
      maintainVisibleContentPosition={followLatest && !scrollbarDragging}
      recycleItems
      extraData={extraData}
      onItemSizeChanged={onContentHeightChange}
      onScroll={onTimelineScroll}
      data-timeline-session-key={timelineSessionKey}
      data-testid="timeline-pane"
      className="timeline-pane timeline-pane--thread timeline-pane--legend timeline--virtualized"
    />
  );
}

const MeasuredTimelineItem = memo(function MeasuredTimelineItem({
  item,
  onHeightChange,
  expandedToolCallIds,
  onToggleToolCall,
  onViewFileInDiff,
  onOpenUrl,
  onBranchFromMessage,
  markers,
  activeTarget,
}: {
  readonly item: TimelineDisplayRow;
  readonly onHeightChange: (id: string, height: number) => void;
  readonly expandedToolCallIds: ReadonlySet<string>;
  readonly onToggleToolCall: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onOpenUrl?: (url: string) => void;
  readonly onBranchFromMessage?: (messageId: string, role: "user" | "assistant", text: string) => Promise<void>;
  readonly markers?: readonly AttentionMarker[];
  readonly activeTarget: boolean;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = rowRef.current;
    if (!element) {
      return undefined;
    }

    const measure = () => {
      onHeightChange(item.id, element.getBoundingClientRect().height);
    };

    measure();
    const resizeObserver = new ResizeObserver(() => {
      measure();
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [item.id, onHeightChange]);

  return (
    <div
      className={`${markers?.length ? "timeline-row--attention " : ""}${activeTarget ? "timeline-attention-target" : ""}`.trim() || undefined}
      data-timeline-row-id={item.id}
      data-attention-types={markers?.map((marker) => marker.type).join(" ")}
      title={markers?.map((marker) => marker.label).join("\n")}
      ref={rowRef}
    >
      <TimelineItem
        item={item}
        expandedToolCallIds={expandedToolCallIds}
        onToggleToolCall={onToggleToolCall}
        onViewFileInDiff={onViewFileInDiff}
        onOpenUrl={onOpenUrl}
        onBranchFromMessage={onBranchFromMessage}
      />
    </div>
  );
}, areMeasuredTimelineItemPropsEqual);

function areMeasuredTimelineItemPropsEqual(
  previous: Readonly<{
    item: TimelineDisplayRow;
    onHeightChange: (id: string, height: number) => void;
    expandedToolCallIds: ReadonlySet<string>;
    onToggleToolCall: (callId: string) => void;
    onViewFileInDiff?: (path: string) => void;
    onOpenUrl?: (url: string) => void;
    markers?: readonly AttentionMarker[];
    activeTarget: boolean;
  }>,
  next: Readonly<{
    item: TimelineDisplayRow;
    onHeightChange: (id: string, height: number) => void;
    expandedToolCallIds: ReadonlySet<string>;
    onToggleToolCall: (callId: string) => void;
    onViewFileInDiff?: (path: string) => void;
    onOpenUrl?: (url: string) => void;
    markers?: readonly AttentionMarker[];
    activeTarget: boolean;
  }>,
): boolean {
  if (
    previous.item !== next.item ||
    previous.onHeightChange !== next.onHeightChange ||
    previous.onToggleToolCall !== next.onToggleToolCall ||
    previous.onViewFileInDiff !== next.onViewFileInDiff ||
    previous.onOpenUrl !== next.onOpenUrl ||
    previous.markers !== next.markers ||
    previous.activeTarget !== next.activeTarget
  ) {
    return false;
  }

  if (previous.item.kind !== "tool") {
    return true;
  }

  return (
    previous.expandedToolCallIds.has(previous.item.callId) ===
    next.expandedToolCallIds.has(previous.item.callId)
  );
}
