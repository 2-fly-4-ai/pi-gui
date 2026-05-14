import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { DisplayModeThreadRecord, SessionRecord } from "./desktop-state";
import { ComposerSurface } from "./composer-surface";
import { TimelineItem } from "./timeline-item";
import { TerminalPanel } from "./terminal-panel";
import { ArrowUpIcon, MaximizeIcon, StopSquareIcon, TerminalIcon } from "./icons";
import type { PiDesktopApi } from "./ipc";
import { formatRelativeTime } from "./string-utils";

type DisplayModeFilter = "all" | "running" | "waiting" | "error";
type DrawerTab = "preview" | "logs" | "files";

interface DisplayModeViewProps {
  readonly api: PiDesktopApi;
}

export function DisplayModeView({ api }: DisplayModeViewProps) {
  const [threads, setThreads] = useState<readonly DisplayModeThreadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DisplayModeFilter>("all");
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [terminalKeys, setTerminalKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("preview");
  const [previewUrl, setPreviewUrl] = useState("http://localhost:5173");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [pinnedThreadKey, setPinnedThreadKey] = useState<string>("");

  // Throttle: track last-fetch timestamp and any pending timer so rapid onStateChanged
  // firings (one per token during a run) collapse to at most ~1 refresh/sec.
  const lastFetchAt = useRef<number>(0);
  const pendingRefresh = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const applyRecords = useCallback((records: readonly DisplayModeThreadRecord[]) => {
    setThreads(records);
    setExpandedKeys((current) => {
      if (current.size > 0) return current;
      const runningKeys = records
        .filter((r) => r.session.status === "running")
        .slice(0, 2)
        .map((r) => threadKey(r.workspace.id, r.session.id));
      if (runningKeys.length > 0) return new Set(runningKeys);
      return new Set(records[0] ? [threadKey(records[0].workspace.id, records[0].session.id)] : []);
    });
    setPinnedThreadKey((current) =>
      current || (records[0] ? threadKey(records[0].workspace.id, records[0].session.id) : ""),
    );
  }, []);

  useEffect(() => {
    let active = true;

    const doFetch = () => {
      lastFetchAt.current = Date.now();
      void api.getDisplayModeThreads().then((records) => {
        if (active) applyRecords(records);
      });
    };

    const scheduleRefresh = () => {
      if (!active) return;
      clearTimeout(pendingRefresh.current);
      const elapsed = Date.now() - lastFetchAt.current;
      const delay = Math.max(0, 1000 - elapsed);
      pendingRefresh.current = setTimeout(() => {
        if (active) doFetch();
      }, delay);
    };

    // Initial load — show spinner only here
    setLoading(true);
    void api.getDisplayModeThreads().then((records) => {
      if (!active) return;
      lastFetchAt.current = Date.now();
      applyRecords(records);
      setLoading(false);
    }).catch(() => {
      if (active) setLoading(false);
    });

    // Live updates — silently re-fetch on state changes, throttled to 1/sec
    const unsub = api.onStateChanged(scheduleRefresh);

    return () => {
      active = false;
      clearTimeout(pendingRefresh.current);
      unsub();
    };
  }, [api, applyRecords]);

  const visibleThreads = useMemo(() => threads.filter((record) => matchesFilter(record.session, filter)), [filter, threads]);
  const runningCount = threads.filter((record) => record.session.status === "running").length;
  const errorCount = threads.filter((record) => record.session.status === "failed").length;
  const pinnedThread = threads.find((record) => threadKey(record.workspace.id, record.session.id) === pinnedThreadKey);

  const toggleExpanded = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleTerminal = (key: string) => {
    setTerminalKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const pauseAll = () => {
    for (const record of threads) {
      if (record.session.status !== "running") {
        continue;
      }
      void api.cancelSessionRun({ workspaceId: record.workspace.id, sessionId: record.session.id });
    }
  };

  return (
    <section className="display-mode" data-testid="display-mode-surface">
      <div className="display-mode__main">
        <header className="display-mode__header">
          <div>
            <div className="display-mode__eyebrow">Display Mode</div>
            <h1>Command center</h1>
            <p>Watch running threads, reply inline, open terminals, and keep a preview pinned.</p>
          </div>
          <div className="display-mode__controls">
            <div className="display-mode__filters" aria-label="Display mode filters">
              {(["all", "running", "waiting", "error"] as const).map((nextFilter) => (
                <button
                  className={`display-mode__filter ${filter === nextFilter ? "display-mode__filter--active" : ""}`}
                  key={nextFilter}
                  type="button"
                  onClick={() => setFilter(nextFilter)}
                >
                  {filterLabel(nextFilter)}
                </button>
              ))}
            </div>
            <button className="button display-mode__pause-btn" type="button" disabled={runningCount === 0} onClick={pauseAll}>
              Pause all
            </button>
          </div>
        </header>

        <div className="display-mode__summary" aria-label="Display mode summary">
          <span><strong>{runningCount}</strong> running</span>
          <span><strong>{errorCount}</strong> errors</span>
          <span><strong>{threads.length}</strong> visible threads</span>
        </div>

        {loading ? (
          <div className="display-mode__empty">Loading active threads…</div>
        ) : visibleThreads.length === 0 ? (
          <div className="display-mode__empty">No threads match this filter.</div>
        ) : (
          <div className="display-mode__grid">
            {visibleThreads.map((record) => {
              const key = threadKey(record.workspace.id, record.session.id);
              return (
                <DisplayModeTile
                  api={api}
                  expanded={expandedKeys.has(key)}
                  key={key}
                  record={record}
                  terminalOpen={terminalKeys.has(key)}
                  onOpenThread={() => {
                    void api.selectSession({ workspaceId: record.workspace.id, sessionId: record.session.id });
                  }}
                  onOpenVSCode={() => {
                    void api.openWorkspaceInVSCode(record.workspace.id);
                  }}
                  onPinPreview={() => setPinnedThreadKey(key)}
                  onToggleExpanded={() => toggleExpanded(key)}
                  onToggleTerminal={() => toggleTerminal(key)}
                />
              );
            })}
          </div>
        )}
      </div>

      <aside className="display-mode-drawer">
        <div className="display-mode-drawer__tabs" role="tablist" aria-label="Display drawer">
          {(["preview", "logs", "files"] as const).map((tab) => (
            <button
              className={`display-mode-drawer__tab ${drawerTab === tab ? "display-mode-drawer__tab--active" : ""}`}
              key={tab}
              type="button"
              role="tab"
              aria-selected={drawerTab === tab}
              onClick={() => setDrawerTab(tab)}
            >
              {drawerTabLabel(tab)}
            </button>
          ))}
        </div>
        {drawerTab === "preview" ? (
          <div className="display-mode-drawer__body">
            <div className="display-mode-drawer__meta">
              Pinned to: {pinnedThread ? `${pinnedThread.workspace.name} / ${pinnedThread.session.title}` : "No thread"}
            </div>
            <label className="display-mode-drawer__field">
              <span>Preview URL</span>
              <input value={previewUrl} onChange={(event) => setPreviewUrl(event.target.value)} />
            </label>
            <div className="display-mode-drawer__device-toggle">
              <button className={previewDevice === "desktop" ? "is-active" : ""} type="button" onClick={() => setPreviewDevice("desktop")}>Desktop</button>
              <button className={previewDevice === "mobile" ? "is-active" : ""} type="button" onClick={() => setPreviewDevice("mobile")}>Mobile</button>
            </div>
            <div className={`display-mode-preview display-mode-preview--${previewDevice}`}>
              {isHttpUrl(previewUrl) ? (
                <iframe title="Pinned preview" src={previewUrl} />
              ) : (
                <div className="display-mode-preview__empty">Enter an http:// or https:// URL.</div>
              )}
            </div>
            <button className="button" type="button" disabled={!isHttpUrl(previewUrl)} onClick={() => void api.openExternal(previewUrl)}>
              Open browser
            </button>
          </div>
        ) : drawerTab === "logs" ? (
          <div className="display-mode-drawer__body">
            <div className="display-mode-drawer__placeholder">Logs will aggregate run and terminal output here.</div>
          </div>
        ) : (
          <div className="display-mode-drawer__body">
            <div className="display-mode-drawer__placeholder">Files will show changed files for the pinned thread.</div>
          </div>
        )}
      </aside>
    </section>
  );
}

function DisplayModeTile({
  api,
  record,
  expanded,
  terminalOpen,
  onOpenThread,
  onOpenVSCode,
  onPinPreview,
  onToggleExpanded,
  onToggleTerminal,
}: {
  readonly api: PiDesktopApi;
  readonly record: DisplayModeThreadRecord;
  readonly expanded: boolean;
  readonly terminalOpen: boolean;
  readonly onOpenThread: () => void;
  readonly onOpenVSCode: () => void;
  readonly onPinPreview: () => void;
  readonly onToggleExpanded: () => void;
  readonly onToggleTerminal: () => void;
}) {
  const [replyDraft, setReplyDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [changedFiles, setChangedFiles] = useState<readonly ChangedFile[]>([]);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const key = threadKey(record.workspace.id, record.session.id);
  const status = statusTone(record.session);
  const recentTranscript = record.transcript.slice(-6);
  const hasReplyInput = replyDraft.trim().length > 0;

  useEffect(() => {
    let active = true;
    void api.getChangedFiles(record.workspace.id).then((files) => {
      if (active) {
        setChangedFiles(files.slice(0, 4));
      }
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, record.workspace.id, record.session.updatedAt]);

  const submitReply = () => {
    const text = replyDraft.trim();
    if (!text || submitting) {
      return;
    }
    setSubmitting(true);
    setReplyDraft("");
    void api.submitComposerToSession(
      { workspaceId: record.workspace.id, sessionId: record.session.id },
      text,
      record.session.status === "running" ? { deliverAs: "followUp" } : undefined,
    ).finally(() => setSubmitting(false));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    submitReply();
  };

  return (
    <article className={`display-mode-tile display-mode-tile--${status} ${expanded ? "display-mode-tile--expanded" : "display-mode-tile--compact"}`} data-testid="display-mode-thread-tile">
      <header className="display-mode-tile__header">
        <div className="display-mode-tile__identity">
          <span className={`display-mode-tile__status display-mode-tile__status--${status}`} aria-hidden="true" />
          <div>
            <div className="display-mode-tile__workspace">{record.workspace.name}</div>
            <h2>{record.session.title}</h2>
          </div>
        </div>
        <button className="display-mode-tile__expand" type="button" onClick={onToggleExpanded}>
          {expanded ? "Compact" : "Expand"}
        </button>
      </header>

      <div className="display-mode-tile__meta">
        <span>{statusLabel(record.session)}</span>
        <span>{record.session.status === "running" && record.session.runningSince ? formatRelativeTime(record.session.runningSince) : formatRelativeTime(record.session.updatedAt)}</span>
        <span>{changedFiles.length} changed files</span>
      </div>

      {expanded ? (
        <>
          <section className="display-mode-tile__section">
            <div className="display-mode-tile__section-title">Chat</div>
            <div className="display-mode-tile__timeline">
              {recentTranscript.length > 0 ? recentTranscript.map((item) => (
                <TimelineItem item={item} key={item.id} />
              )) : <div className="display-mode-tile__empty">No transcript yet.</div>}
            </div>
          </section>

          <section className="display-mode-tile__section">
            <div className="display-mode-tile__section-title">Diff</div>
            {changedFiles.length > 0 ? (
              <div className="display-mode-tile__files">
                {changedFiles.map((file) => (
                  <div className="display-mode-tile__file" key={file.path}>
                    <span>{file.path}</span>
                    <span>{file.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="display-mode-tile__empty">No changed files detected.</div>
            )}
          </section>

          {terminalOpen ? (
            <TerminalPanel
              workspace={record.workspace}
              sessionId={record.session.id}
              height={260}
              isTakeover={false}
              onHeightChange={() => undefined}
              onToggleTakeover={() => undefined}
              onHide={onToggleTerminal}
            />
          ) : null}

          <ComposerSurface
            attachments={[]}
            composerDraft={replyDraft}
            composerRef={composerRef}
            editingQueuedMessageId={undefined}
            footer={(
              <div className="display-mode-tile__composer-footer">
                <span>{record.session.status === "running" ? "Enter to queue · Shift+Enter newline" : "Enter to send · Shift+Enter newline"}</span>
                <button
                  aria-label={record.session.status === "running" && !hasReplyInput ? "Stop run" : "Send reply"}
                  className="button button--primary button--cta-icon"
                  type="button"
                  disabled={submitting || !hasReplyInput}
                  onClick={submitReply}
                >
                  {record.session.status === "running" && !hasReplyInput ? <StopSquareIcon /> : <ArrowUpIcon />}
                </button>
              </div>
            )}
            onCancelQueuedEdit={() => undefined}
            onClearSlashCommand={() => undefined}
            onComposerDrop={(event) => event.preventDefault()}
            onComposerKeyDown={handleKeyDown}
            onComposerPaste={() => undefined}
            onEditQueuedMessage={() => undefined}
            onRemoveAttachment={() => undefined}
            onRemoveQueuedMessage={() => undefined}
            onSelectMention={() => undefined}
            onSelectSlashCommand={() => undefined}
            onSelectSlashOption={() => undefined}
            onSteerQueuedMessage={() => undefined}
            queuedMessages={[]}
            selectedMentionIndex={0}
            setComposerDraft={setReplyDraft}
            showMentionMenu={false}
            mentionOptions={[]}
            selectedSlashCommand={undefined}
            selectedSlashOption={undefined}
            showSlashMenu={false}
            showSlashOptionMenu={false}
            slashOptions={[]}
            slashSections={[]}
            textareaLabel={`Reply to ${record.session.title}`}
            textareaPlaceholder="Reply to this thread…"
            textareaTestId={`display-mode-reply-${key}`}
          />
        </>
      ) : (
        <div className="display-mode-tile__compact-summary">
          <span>{record.session.preview || "No preview yet"}</span>
          <span>{changedFiles.length > 0 ? `${changedFiles.length} files changed` : "No changes"}</span>
        </div>
      )}

      <footer className="display-mode-tile__actions">
        <button className="button button--primary display-mode-tile__action-open" type="button" onClick={onOpenThread}>Open thread</button>
        <button className="button" type="button" onClick={onToggleTerminal}><TerminalIcon /> Terminal</button>
        <button className="button" type="button" onClick={onOpenVSCode}>VS Code</button>
        <button className="button" type="button" onClick={onPinPreview}><MaximizeIcon /> Pin preview</button>
      </footer>
    </article>
  );
}

interface ChangedFile {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly staged: boolean;
}

function threadKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

function matchesFilter(session: SessionRecord, filter: DisplayModeFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "running") {
    return session.status === "running";
  }
  if (filter === "error") {
    return session.status === "failed";
  }
  return false;
}

function drawerTabLabel(tab: DrawerTab): string {
  if (tab === "preview") return "Preview";
  if (tab === "logs") return "Logs";
  return "Files";
}

function filterLabel(filter: DisplayModeFilter): string {
  if (filter === "all") return "All";
  if (filter === "running") return "Running";
  if (filter === "waiting") return "Waiting";
  return "Error";
}

function statusTone(session: SessionRecord): "running" | "waiting" | "error" | "idle" {
  if (session.status === "running") return "running";
  if (session.status === "failed") return "error";
  if (session.hasUnseenUpdate) return "waiting";
  return "idle";
}

function statusLabel(session: SessionRecord): string {
  const tone = statusTone(session);
  if (tone === "running") return "Running";
  if (tone === "waiting") return "Waiting for input";
  if (tone === "error") return "Error";
  return "Idle";
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
