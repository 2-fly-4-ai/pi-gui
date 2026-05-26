import { useCallback, useEffect, useMemo, useState } from "react";
import type { ObservabilityCategory, ObservabilityEvent, ObservabilityEventPage, ObservabilitySeverity } from "./observability-types";
import type { PiDesktopApi } from "./ipc";
import type { SessionRecord, WorkspaceRecord } from "./desktop-state";
import { CloseIcon, RefreshIcon } from "./icons";
import { runtimeStatusLabel } from "./runtime-status";

type LogsTab = "runtime" | "task" | "app";

const CATEGORIES: readonly { value: ObservabilityCategory | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "desktop", label: "Desktop" },
  { value: "renderer", label: "Renderer" },
  { value: "agent", label: "Agent" },
  { value: "tool", label: "Tools" },
  { value: "skill", label: "Skills" },
  { value: "subagent", label: "Subagents" },
  { value: "workspace", label: "Workspace" },
  { value: "slash-command", label: "Slash" },
];

const SEVERITIES: readonly { value: ObservabilitySeverity | "all" | "failures"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "failures", label: "Failures" },
  { value: "warning", label: "Warnings" },
  { value: "info", label: "Info" },
];

export function LogsPanel({
  api,
  selectedWorkspace,
  selectedSession,
  onClose,
}: {
  readonly api: PiDesktopApi;
  readonly selectedWorkspace?: WorkspaceRecord;
  readonly selectedSession?: SessionRecord;
  readonly onClose: () => void;
}) {
  const [tab, setTab] = useState<LogsTab>(() => {
    const value = readLocal("logs:tab");
    return value === "runtime" || value === "task" || value === "app" ? value : "runtime";
  });
  const [page, setPage] = useState<ObservabilityEventPage>({ events: [], scannedSources: [], warnings: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [severity, setSeverity] = useState<ObservabilitySeverity | "all" | "failures">(() => {
    const value = readLocal("logs:severity");
    return value === "all" || value === "failures" || value === "warning" || value === "info" || value === "error" ? value : "failures";
  });
  const [category, setCategory] = useState<ObservabilityCategory | "all">(() => {
    const value = readLocal("logs:category");
    return CATEGORIES.some((item) => item.value === value) ? value as ObservabilityCategory | "all" : "all";
  });
  const [query, setQuery] = useState(() => readLocal("logs:query") || "");
  const [includeGlobal, setIncludeGlobal] = useState(() => readLocal("logs:scope") === "global");
  const [selectedId, setSelectedId] = useState<string>("");

  const refresh = useCallback(async () => {
    if (tab === "runtime") {
      setError(undefined);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(undefined);
    try {
      const severityFilter = severity === "all" ? undefined : severity === "failures" ? ["error" as const] : [severity];
      const categoryFilter = buildCategoryFilter(tab, category);
      const next = await api.listObservabilityEvents({
        severity: severityFilter,
        category: categoryFilter,
        query,
        limit: 500,
        includeGlobal,
        workspaceId: selectedWorkspace?.id,
        workspacePath: selectedWorkspace?.path,
        sessionId: tab === "task" ? selectedSession?.id : undefined,
      });
      setPage(next);
      setSelectedId((current) => current && next.events.some((event) => event.id === current) ? current : next.events[0]?.id ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api, category, includeGlobal, query, selectedSession?.id, selectedWorkspace?.id, selectedWorkspace?.path, severity, tab]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { writeLocal("logs:tab", tab); }, [tab]);
  useEffect(() => { writeLocal("logs:severity", severity); }, [severity]);
  useEffect(() => { writeLocal("logs:category", category); }, [category]);
  useEffect(() => { writeLocal("logs:query", query); }, [query]);
  useEffect(() => { writeLocal("logs:scope", includeGlobal ? "global" : "current"); }, [includeGlobal]);

  const selected = useMemo(() => page.events.find((event) => event.id === selectedId), [page.events, selectedId]);
  const failureCount = page.events.filter((event) => event.severity === "error").length;
  const runtimeJobs = selectedSession?.runtimeSummary?.jobs ?? [];
  const runtimeLabel = runtimeStatusLabel(selectedSession);

  return (
    <aside className="logs-panel" data-testid="logs-panel" aria-label="Runtime inspector">
      <header className="logs-panel__header">
        <div>
          <div className="logs-panel__eyebrow">Runtime</div>
          <h2>Inspector</h2>
        </div>
        <span className="logs-panel__failure-count" data-testid="logs-failure-count">
          {tab === "runtime" ? `${runtimeJobs.length} jobs` : `${failureCount} failures`}
        </span>
        <button className="icon-button" type="button" aria-label="Refresh logs" onClick={() => void refresh()} disabled={loading && tab !== "runtime"}><RefreshIcon /></button>
        <button className="icon-button" type="button" aria-label="Close logs" onClick={onClose}><CloseIcon /></button>
      </header>
      <div className="logs-panel__tabs" role="tablist" aria-label="Runtime inspector views">
        <button className={`logs-panel__tab${tab === "runtime" ? " logs-panel__tab--active" : ""}`} role="tab" aria-selected={tab === "runtime"} type="button" onClick={() => setTab("runtime")}>Runtime</button>
        <button className={`logs-panel__tab${tab === "task" ? " logs-panel__tab--active" : ""}`} role="tab" aria-selected={tab === "task"} type="button" onClick={() => setTab("task")}>Task</button>
        <button className={`logs-panel__tab${tab === "app" ? " logs-panel__tab--active" : ""}`} role="tab" aria-selected={tab === "app"} type="button" onClick={() => setTab("app")}>App</button>
      </div>
      {tab === "runtime" ? (
        <RuntimeTab session={selectedSession} runtimeLabel={runtimeLabel} />
      ) : (
        <>
          <div className="logs-panel__filters">
            <input aria-label="Search logs" className="logs-panel__search" placeholder="Search logs" value={query} onChange={(event) => setQuery(event.target.value)} />
            <select aria-label="Log severity" value={severity} onChange={(event) => setSeverity(event.target.value as ObservabilitySeverity | "all" | "failures")}>
              {SEVERITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select aria-label="Log category" value={category} onChange={(event) => setCategory(event.target.value as ObservabilityCategory | "all")}>
              {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select aria-label="Log scope" value={includeGlobal ? "global" : "current"} onChange={(event) => setIncludeGlobal(event.target.value === "global")}>
              <option value="current">Current thread</option>
              <option value="global">Global logs</option>
            </select>
          </div>
          <div className="logs-panel__runtime-note">
            {tab === "task"
              ? "Task logs show session-scoped observability events for the selected thread."
              : "App logs show Electron and renderer diagnostics separately from task execution."}
          </div>
          {error ? <div className="logs-panel__error">{error}</div> : null}
          {page.warnings.length > 0 ? <div className="logs-panel__warning">{page.warnings[0]}</div> : null}
          <EventBrowser
            emptyMessage={tab === "task" ? "No task log events match this filter." : "No app log events match this filter."}
            events={page.events}
            selected={selected}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </>
      )}
    </aside>
  );
}

function RuntimeTab({
  session,
  runtimeLabel,
}: {
  readonly session: SessionRecord | undefined;
  readonly runtimeLabel: string;
}) {
  const jobs = session?.runtimeSummary?.jobs ?? [];

  return (
    <div className="logs-panel__runtime">
      <div className="logs-panel__runtime-status">
        <span className="logs-panel__runtime-label">Status</span>
        <strong>{runtimeLabel}</strong>
      </div>
      {jobs.length === 0 ? (
        <div className="logs-panel__empty">No runtime jobs for the selected session.</div>
      ) : (
        <div className="logs-panel__runtime-jobs" role="list" aria-label="Runtime jobs">
          {jobs.map((job) => (
            <div className="logs-panel__runtime-job" key={job.id} role="listitem">
              <div className="logs-panel__runtime-job-title">{job.title}</div>
              <div className="logs-panel__runtime-job-meta">{job.status} · {job.confidence}</div>
              {job.message ? <div className="logs-panel__runtime-job-message">{job.message}</div> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EventBrowser({
  emptyMessage,
  events,
  selected,
  selectedId,
  onSelect,
}: {
  readonly emptyMessage: string;
  readonly events: readonly ObservabilityEvent[];
  readonly selected: ObservabilityEvent | undefined;
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <div className="logs-panel__body">
      <div className="logs-panel__list" role="list" aria-label="Log events">
        {events.length === 0 ? <div className="logs-panel__empty">{emptyMessage}</div> : events.map((event) => (
          <button
            key={event.id}
            className={`logs-panel__event logs-panel__event--${event.severity}${selectedId === event.id ? " logs-panel__event--selected" : ""}`}
            type="button"
            role="listitem"
            onClick={() => onSelect(event.id)}
          >
            <span className="logs-panel__event-time">{formatTime(event.timestamp)}</span>
            <span className="logs-panel__event-title">{event.title}</span>
            <span className="logs-panel__event-meta">{event.category} · {event.source.kind}</span>
            {event.message ? <span className="logs-panel__event-message">{event.message}</span> : null}
          </button>
        ))}
      </div>
      <EventDetails event={selected} />
    </div>
  );
}

function EventDetails({ event }: { readonly event: ObservabilityEvent | undefined }) {
  if (!event) return <div className="logs-panel__details logs-panel__details--empty">Select an event to inspect raw details.</div>;
  return (
    <section className="logs-panel__details" aria-label="Log event details">
      <h3>{event.title}</h3>
      <dl>
        <dt>Severity</dt><dd>{event.severity}</dd>
        <dt>Category</dt><dd>{event.category}</dd>
        <dt>Source</dt><dd>{event.source.kind}{event.source.line ? `:${event.source.line}` : ""}</dd>
        {event.workspace?.runtimeCwd ? <><dt>cwd</dt><dd>{event.workspace.runtimeCwd}</dd></> : null}
        {event.workspace?.workspaceRoot ? <><dt>workspace</dt><dd>{event.workspace.workspaceRoot}</dd></> : null}
        {event.agent?.type ? <><dt>agent</dt><dd>{event.agent.type}</dd></> : null}
        {event.tool?.name ? <><dt>tool</dt><dd>{event.tool.name}</dd></> : null}
      </dl>
      <pre>{JSON.stringify(event.raw ?? event, null, 2)}</pre>
    </section>
  );
}

function buildCategoryFilter(tab: LogsTab, category: ObservabilityCategory | "all"): readonly ObservabilityCategory[] | undefined {
  if (category !== "all") {
    return [category];
  }

  if (tab === "app") {
    return ["desktop", "renderer"];
  }

  return undefined;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function readLocal(key: string): string | undefined {
  try { return localStorage.getItem(key) ?? undefined; } catch { return undefined; }
}

function writeLocal(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch {}
}
