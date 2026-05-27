import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type RefCallback, type RefObject } from "react";
import type { TranscriptMessage } from "./desktop-state";
import { ThreadSearchBar } from "./thread-search";
import { TimelineItem } from "./timeline-item";
import { useStableTranscriptRows } from "./conversation-timeline-rows";

export const VIRTUALIZATION_THRESHOLD = 80;

function isCommandTool(item: TranscriptMessage): item is Extract<TranscriptMessage, { kind: "tool" }> {
  if (item.kind !== "tool") {
    return false;
  }
  const toolName = item.toolName.toLowerCase();
  if (toolName !== "bash" && !toolName.endsWith(".bash")) {
    return false;
  }
  return typeof item.input === "object" && item.input !== null && typeof (item.input as Record<string, unknown>).command === "string";
}

function hasSearchableCommand(item: TranscriptMessage): boolean {
  if (isCommandTool(item)) {
    return true;
  }
  if (item.kind === "runtime-job") {
    return Boolean(item.job.command);
  }
  return false;
}

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
  readonly transcript: readonly TranscriptMessage[];
  readonly isTranscriptLoading: boolean;
  readonly timelinePaneRef: MutableRefObject<HTMLDivElement | null>;
  readonly timelinePaneElementRef?: RefCallback<HTMLDivElement>;
  readonly disableVirtualization?: boolean;
  readonly onDisableVirtualizationReady?: () => void;
  readonly onTimelineScroll: () => void;
  readonly threadSearch: ThreadSearchModel;
  readonly showJumpToLatest: boolean;
  readonly onJumpToLatest: () => void;
  readonly onContentHeightChange: () => void;
  readonly onViewFileInDiff?: (path: string) => void;
}

export function ConversationTimeline({
  transcript,
  isTranscriptLoading,
  timelinePaneRef,
  timelinePaneElementRef,
  disableVirtualization = false,
  onDisableVirtualizationReady,
  onTimelineScroll,
  threadSearch,
  showJumpToLatest,
  onJumpToLatest,
  onContentHeightChange,
  onViewFileInDiff,
}: ConversationTimelineProps) {
  const stableTranscript = useStableTranscriptRows(transcript);
  // Long transcripts must never fall back to full DOM rendering. The parent may
  // temporarily request disabled virtualization while restoring scroll position,
  // but rendering thousands of historical rows is what makes the renderer memory
  // spike and eventually crash. For long threads, stay virtualized and let the
  // parent finish its scroll restore against the virtual scroller.
  const shouldVirtualize =
    !threadSearch.isOpen &&
    stableTranscript.length > VIRTUALIZATION_THRESHOLD;
  const [expandedToolCallIds, setExpandedToolCallIds] = useState<Set<string>>(() => new Set());
  const userCollapsedRunningToolIdsRef = useRef(new Set<string>());
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

    for (const callId of [...userCollapsedRunningToolIdsRef.current]) {
      if (!availableToolCallIds.has(callId)) {
        userCollapsedRunningToolIdsRef.current.delete(callId);
      }
    }

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
    const runningCommandToolIds = stableTranscript
      .filter(isCommandTool)
      .filter((item) => item.status === "running")
      .map((item) => item.callId);

    if (runningCommandToolIds.length === 0) {
      return;
    }

    setExpandedToolCallIds((current) => {
      let changed = false;
      const next = new Set(current);
      for (const callId of runningCommandToolIds) {
        if (userCollapsedRunningToolIdsRef.current.has(callId) || next.has(callId)) {
          continue;
        }
        next.add(callId);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [stableTranscript]);

  useLayoutEffect(() => {
    const knownIds = new Set(stableTranscript.map((item) => item.id));
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
  }, [scheduleMeasurementVersionUpdate, stableTranscript]);

  useEffect(() => {
    if (!disableVirtualization || isTranscriptLoading || stableTranscript.length <= VIRTUALIZATION_THRESHOLD) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      onDisableVirtualizationReady?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [disableVirtualization, isTranscriptLoading, onDisableVirtualizationReady, stableTranscript.length]);

  useLayoutEffect(() => {
    if (!disableVirtualization || isTranscriptLoading || stableTranscript.length === 0) {
      return;
    }
    const measuredCount = stableTranscript.reduce(
      (count, item) => count + (measuredHeightsRef.current.has(item.id) ? 1 : 0),
      0,
    );
    const allRowsMeasured = measuredCount === stableTranscript.length;
    const enoughRowsMeasuredForVirtualRestore =
      stableTranscript.length > VIRTUALIZATION_THRESHOLD && measuredCount >= VIRTUALIZATION_THRESHOLD;
    if (!allRowsMeasured && !enoughRowsMeasuredForVirtualRestore) {
      return;
    }
    onDisableVirtualizationReady?.();
  }, [disableVirtualization, isTranscriptLoading, measurementVersion, onDisableVirtualizationReady, stableTranscript]);

  const toggleToolCall = useCallback((callId: string) => {
    setExpandedToolCallIds((current) => {
      const next = new Set(current);
      if (next.has(callId)) {
        next.delete(callId);
        userCollapsedRunningToolIdsRef.current.add(callId);
      } else {
        next.add(callId);
        userCollapsedRunningToolIdsRef.current.delete(callId);
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
    timelinePaneRef.current = node;
    timelinePaneElementRef?.(node);
  }, [timelinePaneElementRef, timelinePaneRef]);

  if (shouldVirtualize && !isTranscriptLoading && stableTranscript.length > 0) {
    return (
      <div className="timeline-pane-frame timeline-pane-frame--thread" data-testid="transcript">
        <LegendTranscriptList
          transcript={stableTranscript}
          assignTimelinePaneRef={assignTimelinePaneRef}
          onTimelineScroll={onTimelineScroll}
          expandedToolCallIds={expandedToolCallIds}
          onToggleToolCall={toggleToolCall}
          onViewFileInDiff={onViewFileInDiff}
          onContentHeightChange={onContentHeightChange}
        />
        {showJumpToLatest ? (
          <button className="timeline-jump" data-testid="timeline-jump" type="button" onClick={onJumpToLatest}>
            New activity below
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="timeline-pane timeline-pane--thread"
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
      {isTranscriptLoading ? (
        <div className="timeline" data-testid="transcript">
          <div className="timeline-empty">Loading transcript…</div>
        </div>
      ) : stableTranscript.length === 0 ? (
        <div className="timeline" data-testid="transcript">
          <div className="timeline-empty">Send a prompt to start the session.</div>
        </div>
      ) : (
        <div className="timeline" data-testid="transcript">
          {stableTranscript.map((item) => (
            <MeasuredTimelineItem
              item={item}
              key={item.id}
              onHeightChange={updateMeasuredHeight}
              expandedToolCallIds={expandedToolCallIds}
              onToggleToolCall={toggleToolCall}
              onViewFileInDiff={onViewFileInDiff}
            />
          ))}
        </div>
      )}
      {showJumpToLatest ? (
        <button className="timeline-jump" data-testid="timeline-jump" type="button" onClick={onJumpToLatest}>
          New activity below
        </button>
      ) : null}
    </div>
  );
}

function LegendTranscriptList({
  transcript,
  assignTimelinePaneRef,
  onTimelineScroll,
  expandedToolCallIds,
  onToggleToolCall,
  onViewFileInDiff,
  onContentHeightChange,
}: {
  readonly transcript: readonly TranscriptMessage[];
  readonly assignTimelinePaneRef: RefCallback<HTMLDivElement>;
  readonly onTimelineScroll: () => void;
  readonly expandedToolCallIds: ReadonlySet<string>;
  readonly onToggleToolCall: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onContentHeightChange: () => void;
}) {
  const legendListRef = useRef<LegendListRef | null>(null);

  useLayoutEffect(() => {
    const node = legendListRef.current?.getScrollableNode?.();
    assignTimelinePaneRef(node instanceof HTMLDivElement ? node : null);
    return () => {
      assignTimelinePaneRef(null);
    };
  }, [assignTimelinePaneRef]);

  const renderItem = useCallback(({ item }: { item: TranscriptMessage }) => (
    <div className="timeline__legend-row" data-timeline-row-id={item.id}>
      <TimelineItem
        item={item}
        expandedToolCallIds={expandedToolCallIds}
        onToggleToolCall={onToggleToolCall}
        onViewFileInDiff={onViewFileInDiff}
      />
    </div>
  ), [expandedToolCallIds, onToggleToolCall, onViewFileInDiff]);

  return (
    <LegendList<TranscriptMessage>
      ref={legendListRef}
      data={transcript}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      estimatedItemSize={90}
      getEstimatedItemSize={estimateLegendTimelineItemHeightForRow}
      drawDistance={2_400}
      maintainScrollAtEnd
      maintainScrollAtEndThreshold={0.1}
      maintainVisibleContentPosition
      recycleItems
      extraData={expandedToolCallIds}
      onItemSizeChanged={onContentHeightChange}
      onScroll={onTimelineScroll}
      data-testid="timeline-pane"
      className="timeline-pane timeline-pane--thread timeline-pane--legend"
    />
  );
}

const MeasuredTimelineItem = memo(function MeasuredTimelineItem({
  item,
  onHeightChange,
  expandedToolCallIds,
  onToggleToolCall,
  onViewFileInDiff,
}: {
  readonly item: TranscriptMessage;
  readonly onHeightChange: (id: string, height: number) => void;
  readonly expandedToolCallIds: ReadonlySet<string>;
  readonly onToggleToolCall: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
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
    <div data-timeline-row-id={item.id} ref={rowRef}>
      <TimelineItem
        item={item}
        expandedToolCallIds={expandedToolCallIds}
        onToggleToolCall={onToggleToolCall}
        onViewFileInDiff={onViewFileInDiff}
      />
    </div>
  );
}, areMeasuredTimelineItemPropsEqual);

function areMeasuredTimelineItemPropsEqual(
  previous: Readonly<{
    item: TranscriptMessage;
    onHeightChange: (id: string, height: number) => void;
    expandedToolCallIds: ReadonlySet<string>;
    onToggleToolCall: (callId: string) => void;
    onViewFileInDiff?: (path: string) => void;
  }>,
  next: Readonly<{
    item: TranscriptMessage;
    onHeightChange: (id: string, height: number) => void;
    expandedToolCallIds: ReadonlySet<string>;
    onToggleToolCall: (callId: string) => void;
    onViewFileInDiff?: (path: string) => void;
  }>,
): boolean {
  if (
    previous.item !== next.item ||
    previous.onHeightChange !== next.onHeightChange ||
    previous.onToggleToolCall !== next.onToggleToolCall ||
    previous.onViewFileInDiff !== next.onViewFileInDiff
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


function estimateLegendTimelineItemHeightForRow(item: TranscriptMessage): number {
  return estimateLegendTimelineItemHeight(item);
}

function estimateLegendTimelineItemHeight(item: TranscriptMessage): number {
  if (item.kind === "message") {
    const attachmentHeight = item.attachments?.some((attachment) => attachment.kind === "image")
      ? 120
      : item.attachments?.length
        ? 56
        : 0;
    const textLength = Math.max(item.text.length, 1);
    return 48 + attachmentHeight + Math.min(240, Math.ceil(textLength / 90) * 20);
  }
  if (item.kind === "thinking") {
    const textLength = Math.max(item.text.length, 1);
    return 52 + Math.min(220, Math.ceil(textLength / 100) * 20);
  }
  if (item.kind === "tool") {
    return 52;
  }
  if (item.kind === "runtime-job") {
    return hasSearchableCommand(item) ? 180 : 132;
  }
  if (item.kind === "summary") {
    return item.presentation === "divider" ? 44 : 38;
  }
  return 38;
}
