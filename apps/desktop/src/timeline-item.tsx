import { memo, useEffect, useState } from "react";
import type { SessionTranscriptMessage } from "@pi-gui/pi-sdk-driver";
import type { TimelineActivity, TimelineToolCall, TimelineSummary, TranscriptMessage } from "./timeline-types";
import { MessageMarkdown } from "./message-markdown";
import { InlineDiff, extractDiffFromOutput } from "./diff-inline";
import { ChevronRightIcon, CopyIcon, DiffIcon, FileIcon } from "./icons";
import { extensionToLanguage } from "./syntax-highlight";
import userMessageIconUrl from "./assets/user-message-icon.png";
import ninjaStarUrl from "./assets/ninja-star.svg";

export const TimelineItem = memo(function TimelineItem({
  item,
  expandedToolCallIds,
  onToggleToolCall,
  onViewFileInDiff,
}: {
  readonly item: TranscriptMessage;
  readonly expandedToolCallIds?: ReadonlySet<string>;
  readonly onToggleToolCall?: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
}) {
  switch (item.kind) {
    case "message":
      return <TimelineMessage item={item} />;
    case "thinking":
      return <TimelineThinkingItem item={item} />;
    case "activity":
      return <TimelineActivityItem item={item} />;
    case "tool":
      return (
        <TimelineToolCallItem
          item={item}
          expanded={expandedToolCallIds?.has(item.callId) ?? false}
          onToggle={onToggleToolCall}
          onViewFileInDiff={onViewFileInDiff}
        />
      );
    case "summary":
      return <TimelineSummaryItem item={item} />;
    default:
      return null;
  }
}, areTimelineItemPropsEqual);

function areTimelineItemPropsEqual(
  previous: Readonly<{
    item: TranscriptMessage;
    expandedToolCallIds?: ReadonlySet<string>;
    onToggleToolCall?: (callId: string) => void;
    onViewFileInDiff?: (path: string) => void;
  }>,
  next: Readonly<{
    item: TranscriptMessage;
    expandedToolCallIds?: ReadonlySet<string>;
    onToggleToolCall?: (callId: string) => void;
    onViewFileInDiff?: (path: string) => void;
  }>,
): boolean {
  if (
    previous.item !== next.item ||
    previous.onToggleToolCall !== next.onToggleToolCall ||
    previous.onViewFileInDiff !== next.onViewFileInDiff
  ) {
    return false;
  }

  if (previous.item.kind !== "tool") {
    return true;
  }

  return (
    (previous.expandedToolCallIds?.has(previous.item.callId) ?? false) ===
    (next.expandedToolCallIds?.has(previous.item.callId) ?? false)
  );
}

function TimelineMessage({ item }: { readonly item: SessionTranscriptMessage }) {
  const wrappedCompactionSummary = extractWrappedCompactionSummary(item.text);
  if (wrappedCompactionSummary) {
    return <TimelineCompactionSummary item={{ ...item, role: "compactionSummary", text: wrappedCompactionSummary }} />;
  }

  if (item.role === "user") {
    return (
      <article className="timeline-item timeline-item--user">
        <div className="timeline-item__bubble">
          {item.attachments?.length ? (
            <div className="timeline-item__attachments">
              {item.attachments.map((attachment, index) =>
                attachment.kind === "image" ? (
                  <img
                    alt={attachment.name ?? `Attachment ${index + 1}`}
                    className="timeline-item__attachment timeline-item__attachment--image"
                    key={`${item.id}:${index}`}
                    src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  />
                ) : (
                  <div
                    className="timeline-item__attachment timeline-item__attachment--file"
                    key={`${item.id}:${index}`}
                    title={attachment.fsPath}
                  >
                    <span className="timeline-item__attachment-icon" aria-hidden="true">
                      <FileIcon />
                    </span>
                    <span className="timeline-item__attachment-name">{attachment.name}</span>
                  </div>
                ),
              )}
            </div>
          ) : null}
          <MessageMarkdown text={item.text} />
        </div>
        <img className="timeline-item__user-icon" src={userMessageIconUrl} alt="" aria-hidden="true" />
      </article>
    );
  }

  if (item.role === "compactionSummary") {
    return <TimelineCompactionSummary item={item} />;
  }

  if (item.role === "branchSummary") {
    return (
      <article className="timeline-item timeline-item--summary-card">
        <div className="timeline-item__summary-eyebrow">Branch summary</div>
        <MessageMarkdown text={item.text} />
      </article>
    );
  }

  return (
    <article className="timeline-item timeline-item--assistant">
      <MessageMarkdown text={item.text} />
    </article>
  );
}

function TimelineThinkingItem({ item }: { readonly item: Extract<TranscriptMessage, { kind: "thinking" }> }) {
  const running = item.status === "running";
  const body = item.text.trim() || "Thinking…";
  return (
    <article className={`timeline-item timeline-item--thinking${running ? " timeline-item--thinking-running" : ""}`}>
      <div className="timeline-thinking__header">
        <img className="timeline-thinking__icon" src={ninjaStarUrl} alt="" aria-hidden="true" />
        <span>{running ? "Thinking…" : "Thinking"}</span>
      </div>
      <div className="timeline-thinking__body">
        <MessageMarkdown text={body} />
      </div>
    </article>
  );
}

function extractWrappedCompactionSummary(text: string): string | undefined {
  if (!text.startsWith("The conversation history before this point was compacted")) {
    return undefined;
  }
  const match = text.match(/<summary>\s*([\s\S]*?)\s*<\/summary>/);
  return match?.[1]?.trim() || undefined;
}

function TimelineCompactionSummary({ item }: { readonly item: SessionTranscriptMessage }) {
  const [expanded, setExpanded] = useState(false);
  const preview = compactionPreview(item.text);

  return (
    <article className="timeline-item timeline-item--summary-card timeline-item--compaction-summary" data-testid="timeline-compaction-summary">
      <div className="timeline-item__summary-eyebrow">Compaction summary</div>
      <p className="timeline-item__compaction-preview">{preview}</p>
      <button
        aria-expanded={expanded}
        className="timeline-item__compaction-toggle"
        type="button"
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? "Hide compacted context" : "Show compacted context"}
      </button>
      {expanded ? (
        <div className="timeline-item__compaction-body">
          <MessageMarkdown text={item.text} />
        </div>
      ) : null}
    </article>
  );
}

function compactionPreview(text: string): string {
  const goalLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !line.startsWith("<"));
  const preview = goalLine ?? "This session was compacted. Open it to inspect the preserved context.";
  return preview.length > 180 ? `${preview.slice(0, 177)}…` : preview;
}

function TimelineActivityItem({ item }: { readonly item: TimelineActivity }) {
  return (
    <div className={`timeline-activity timeline-activity--${item.tone ?? "neutral"}`}>
      <span className="timeline-activity__label">{item.label}</span>
      {item.detail ? <span className="timeline-activity__detail">{item.detail}</span> : null}
      {item.metadata ? <span className="timeline-activity__meta">{item.metadata}</span> : null}
    </div>
  );
}

function useElapsedLabel(startedAt: string, active: boolean): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active]);

  return formatElapsed(startedAt, now);
}

function formatElapsed(startedAt: string, now = Date.now()): string {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) {
    return "0s";
  }
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function RunningElapsedText({ startedAt }: { readonly startedAt: string }) {
  const elapsed = useElapsedLabel(startedAt, true);
  return <>{elapsed}</>;
}

function RunningToolMeta({ toolName, startedAt }: { readonly toolName: string; readonly startedAt: string }) {
  return (
    <>
      {toolName} · running for <RunningElapsedText startedAt={startedAt} />
    </>
  );
}

function CommandOutputTitle({
  running,
  startedAt,
  status,
}: {
  readonly running: boolean;
  readonly startedAt: string;
  readonly status: TimelineToolCall["status"];
}) {
  return (
    <>
      {`Command output · ${running ? "running for " : statusLabel(status)}`}
      {running ? <RunningElapsedText startedAt={startedAt} /> : null}
    </>
  );
}

function TimelineToolCallItem({
  item,
  expanded,
  onToggle,
  onViewFileInDiff,
}: {
  readonly item: TimelineToolCall;
  readonly expanded: boolean;
  readonly onToggle?: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
}) {
  const command = extractCommand(item.input);
  const outputText = item.outputText ?? extractToolText(item.output) ?? item.detail;
  const hasVisibleOutput = Boolean(outputText?.trim());
  const hasDetails = item.input !== undefined || item.output !== undefined;
  const running = item.status === "running";
  const diffText = isWriteTool(item.toolName) ? extractDiffFromOutput(item.output) : undefined;
  const diffStats = diffText ? countDiffStats(diffText) : undefined;
  const compactLabel = buildCompactLabel(item);
  const filePath = isWriteTool(item.toolName) ? extractFilename(item.input) || undefined : undefined;
  const diffLanguage = diffText && filePath ? extensionToLanguage(filePath) : undefined;

  const handleCopy = () => {
    const text = diffText ?? outputText ?? command ?? formatToolContent(item.input, item.output);
    void navigator.clipboard.writeText(text);
  };

  return (
    <article className={`timeline-tool timeline-tool--${item.status}`}>
      <div className="timeline-tool__header-row">
        <button
          className="timeline-tool__header"
          type="button"
          aria-expanded={expanded}
          disabled={!hasDetails && !hasVisibleOutput}
          onClick={() => onToggle?.(item.callId)}
        >
          {item.status === "running" ? <span className="timeline-tool__spinner" aria-hidden="true" /> : null}
          {hasDetails || hasVisibleOutput ? (
            <span className={`timeline-tool__chevron ${expanded ? "timeline-tool__chevron--expanded" : ""}`}>
              <ChevronRightIcon />
            </span>
          ) : null}
          <span className="timeline-tool__label">{compactLabel}</span>
          {diffStats ? (
            <span className="timeline-tool__diff-stats">
              <span className="timeline-tool__stat-add">+{diffStats.added}</span>
              {" "}
              <span className="timeline-tool__stat-del">-{diffStats.removed}</span>
            </span>
          ) : null}
          <span className="timeline-tool__meta-inline">
            {running ? <RunningToolMeta toolName={item.toolName} startedAt={item.createdAt} /> : `${item.toolName} · ${statusLabel(item.status)}`}
          </span>
        </button>
        {filePath && onViewFileInDiff ? (
          <button
            aria-label={`View ${filePath} in changes`}
            className="icon-button timeline-tool__view-in-diff"
            data-testid="timeline-tool-view-in-diff"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onViewFileInDiff(filePath);
            }}
          >
            <DiffIcon />
          </button>
        ) : null}
      </div>
      {expanded && (hasDetails || hasVisibleOutput) ? (
        <div className="timeline-tool__body">
          {diffText ? (
            <>
              <div className="timeline-tool__diff-header">
                <span className="timeline-tool__diff-filename">
                  {extractFilename(item.input)}
                  {diffStats ? (
                    <span className="timeline-tool__diff-stats">
                      {" "}<span className="timeline-tool__stat-add">+{diffStats.added}</span>
                      {" "}<span className="timeline-tool__stat-del">-{diffStats.removed}</span>
                    </span>
                  ) : null}
                </span>
                <button className="icon-button timeline-tool__copy" type="button" onClick={handleCopy} aria-label="Copy">
                  <CopyIcon />
                </button>
              </div>
              <InlineDiff diff={diffText} language={diffLanguage} />
            </>
          ) : (
            <>
              <div className="timeline-tool__body-actions">
                <span className="timeline-tool__body-title">
                  {command ? (
                    <CommandOutputTitle running={running} startedAt={item.createdAt} status={item.status} />
                  ) : item.status === "running" ? (
                    "Live output"
                  ) : (
                    "Tool output"
                  )}
                </span>
                <button className="icon-button timeline-tool__copy" type="button" onClick={handleCopy} aria-label="Copy">
                  <CopyIcon />
                </button>
              </div>
              {command ? <pre className="timeline-tool__command">$ {command}</pre> : null}
              {hasVisibleOutput ? (
                <pre className="timeline-tool__pre">{outputText}</pre>
              ) : item.status === "running" ? (
                <div className="timeline-tool__waiting">
                  <strong>Still running.</strong>
                  <span>No stdout/stderr emitted yet.</span>
                </div>
              ) : (
                <pre className="timeline-tool__pre">{formatToolContent(undefined, item.output)}</pre>
              )}
              {item.input !== undefined && !command ? (
                <details className="timeline-tool__details">
                  <summary>Details</summary>
                  <pre>{formatToolContent(item.input, undefined)}</pre>
                </details>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}

function isWriteTool(toolName: string): boolean {
  return /write|edit|patch|apply/i.test(toolName);
}

function buildCompactLabel(item: TimelineToolCall): string {
  const statusVerb = item.status === "running" ? "Running" : item.status === "error" ? "Failed" : "Ran";
  const command = extractCommand(item.input);
  if (item.toolName === "bash" && command) {
    return `${statusVerb} ${shortenCommand(command)}`;
  }
  if (isWriteTool(item.toolName)) {
    const filename = extractFilename(item.input);
    if (filename) {
      return `Edited ${shortenPath(filename)}`;
    }
  }
  if (item.status === "running" && item.label.startsWith("Ran ")) {
    return item.label.replace(/^Ran /, "Running ");
  }
  return item.label;
}

function extractCommand(input: unknown): string {
  if (typeof input === "object" && input !== null) {
    const command = (input as Record<string, unknown>).command;
    return typeof command === "string" ? command : "";
  }
  return "";
}

function extractToolText(output: unknown): string | undefined {
  if (typeof output === "string") {
    return output;
  }
  if (typeof output !== "object" || output === null || !Array.isArray((output as Record<string, unknown>).content)) {
    return undefined;
  }
  const content = (output as { content: readonly unknown[] }).content;
  const text = content
    .map((part) =>
      typeof part === "object" && part !== null &&
      (part as Record<string, unknown>).type === "text" &&
      typeof (part as Record<string, unknown>).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .join("\n")
    .trim();
  return text || undefined;
}

function extractFilename(input: unknown): string {
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    const path = record.file_path ?? record.filePath ?? record.path ?? record.filename;
    if (typeof path === "string") {
      return path;
    }
  }
  return "";
}

function shortenPath(filePath: string): string {
  // Show last 2-3 path segments for readability
  const parts = filePath.split("/");
  if (parts.length <= 3) {
    return filePath;
  }
  return parts.slice(-3).join("/");
}

function shortenCommand(command: string): string {
  const singleLine = command.replace(/\s+/g, " ").trim();
  return singleLine.length > 96 ? `${singleLine.slice(0, 93)}…` : singleLine;
}

function countDiffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed += 1;
    }
  }
  return { added, removed };
}

function formatToolContent(input: unknown, output: unknown): string {
  const parts: string[] = [];
  if (input !== undefined) {
    parts.push(typeof input === "string" ? input : JSON.stringify(input, null, 2));
  }
  if (output !== undefined) {
    parts.push(typeof output === "string" ? output : JSON.stringify(output, null, 2));
  }
  return parts.join("\n\n");
}

function statusLabel(status: "running" | "success" | "error") {
  if (status === "running") return "running";
  if (status === "success") return "done";
  return "failed";
}

function TimelineSummaryItem({ item }: { readonly item: TimelineSummary }) {
  if (item.presentation === "divider") {
    return (
      <div className="timeline-summary">
        <span>{item.label}</span>
        {item.metadata ? <span className="timeline-summary__meta">{item.metadata}</span> : null}
      </div>
    );
  }

  return (
    <div className="timeline-activity timeline-activity--summary">
      <span className="timeline-activity__label">{item.label}</span>
      {item.metadata ? <span className="timeline-activity__meta">{item.metadata}</span> : null}
    </div>
  );
}
