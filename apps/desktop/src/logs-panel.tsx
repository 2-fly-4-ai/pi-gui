import { useCallback, useEffect, useMemo, useState } from "react";
import type { ObservabilityCategory, ObservabilityEvent, ObservabilityEventPage, ObservabilitySeverity } from "./observability-types";
import type { PiDesktopApi } from "./ipc";
import type { DiagnosticReportingPreferences, SessionRecord, WorkspaceRecord } from "./desktop-state";
import { CloseIcon, RefreshIcon } from "./icons";
import { buildDiagnosticIssueDraft } from "./diagnostic-issue-draft";
import { logIgnoredError } from "./renderer-diagnostics";
import { canStopRuntimeJob } from "./runtime-jobs";
import { runtimeStatusLabel } from "./runtime-status";
import type { DiagnosticBundle, ResourceInspectorSnapshot, ResourceOwnerKind, ResourceOwnerSummary } from "./resource-inspector-types";
import type { LoopbackRemoteProbe, LoopbackRemoteSnapshot } from "./execution-environment-types";

type LogsTab = "resources" | "runtime" | "remote" | "task" | "app";

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
  diagnosticReporting,
  selectedWorkspace,
  selectedSession,
  onClose,
}: {
  readonly api: PiDesktopApi;
  readonly diagnosticReporting: DiagnosticReportingPreferences;
  readonly selectedWorkspace?: WorkspaceRecord;
  readonly selectedSession?: SessionRecord;
  readonly onClose: () => void;
}) {
  const [tab, setTab] = useState<LogsTab>(() => {
    const saved = readLocal("logs:tab");
    return saved === "resources" || saved === "runtime" || saved === "remote" || saved === "task" || saved === "app" ? saved : "runtime";
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
  const [runId, setRunId] = useState("");
  const [role, setRole] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [issueDraftStatus, setIssueDraftStatus] = useState<"idle" | "opening" | "opened" | "failed">("idle");
  const [resourceSnapshot, setResourceSnapshot] = useState<ResourceInspectorSnapshot>();
  const [remoteSnapshot, setRemoteSnapshot] = useState<LoopbackRemoteSnapshot>();
  const [diagnosticBundle, setDiagnosticBundle] = useState<DiagnosticBundle>();
  const [diagnoseStatus, setDiagnoseStatus] = useState<"idle" | "copying" | "copied" | "starting" | "started" | "failed">("idle");
  const selectedWorkspaceId = selectedWorkspace?.id;
  const selectedRootWorkspaceId = selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id;
  const selectedWorkspacePath = selectedWorkspace?.path;
  const selectedSessionId = selectedSession?.id;

  const refresh = useCallback(async () => {
    if (tab === "resources") {
      setLoading(true);
      setError(undefined);
      try {
        await api.setResourceInspectorVisible(true);
        setResourceSnapshot(await api.getResourceInspectorSnapshot());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
      return;
    }
    if (tab === "remote") {
      setLoading(true);
      setError(undefined);
      try { setRemoteSnapshot(await api.getLoopbackRemoteSnapshot()); }
      catch (err) { setError(err instanceof Error ? err.message : String(err)); }
      finally { setLoading(false); }
      return;
    }
    if (tab === "runtime") {
      setLoading(true);
      setError(undefined);
      try {
        if (selectedWorkspaceId && selectedSessionId) {
          await api.refreshRuntimeJobs({
            workspaceId: selectedWorkspaceId,
            sessionId: selectedSessionId,
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
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
        workspaceId: selectedWorkspaceId,
        workspacePath: selectedWorkspacePath,
        sessionId: tab === "app" ? undefined : selectedSessionId,
        runId: tab === "task" ? runId : undefined,
        role: tab === "task" ? role : undefined,
      });
      setPage(next);
      setSelectedId((current) => current && next.events.some((event) => event.id === current) ? current : next.events[0]?.id ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api, category, includeGlobal, query, role, runId, selectedSessionId, selectedWorkspaceId, selectedWorkspacePath, severity, tab]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (tab !== "resources") return;
    void api.setResourceInspectorVisible(true);
    const interval = window.setInterval(() => { void refresh(); }, 1_000);
    return () => {
      window.clearInterval(interval);
      void api.setResourceInspectorVisible(false);
    };
  }, [api, refresh, tab]);
  useEffect(() => api.onSubagentRunsChanged((workspaceId) => {
    if (tab === "task" && (!selectedWorkspaceId || workspaceId === selectedWorkspaceId)) void refresh();
  }), [api, refresh, selectedWorkspaceId, tab]);
  useEffect(() => { writeLocal("logs:severity", severity); }, [severity]);
  useEffect(() => { writeLocal("logs:category", category); }, [category]);
  useEffect(() => { writeLocal("logs:query", query); }, [query]);
  useEffect(() => { writeLocal("logs:scope", includeGlobal ? "global" : "current"); }, [includeGlobal]);
  useEffect(() => { writeLocal("logs:tab", tab); }, [tab]);
  useEffect(() => {
    const openResources = () => setTab("resources");
    window.addEventListener("pi-gui:open-resource-inspector", openResources);
    return () => window.removeEventListener("pi-gui:open-resource-inspector", openResources);
  }, []);

  const selected = useMemo(() => page.events.find((event) => event.id === selectedId), [page.events, selectedId]);
  const failureCount = page.events.filter((event) => event.severity === "error").length;
  const runtimeJobs = selectedSession?.runtimeSummary?.jobs ?? [];
  const runtimeLabel = runtimeStatusLabel(selectedSession);
  const issueDraftsEnabled = diagnosticReporting.issueDraftsEnabled;

  const loadDiagnosticBundle = useCallback(async (): Promise<DiagnosticBundle> => {
    if (diagnosticBundle) return diagnosticBundle;
    const bundle = await api.getDiagnosticBundle();
    setDiagnosticBundle(bundle);
    return bundle;
  }, [api, diagnosticBundle]);

  const copyDiagnosticBundle = useCallback(async () => {
    if (diagnoseStatus === "copying") return;
    setDiagnoseStatus("copying");
    try {
      const bundle = await loadDiagnosticBundle();
      await api.copyText(bundle.markdown);
      setDiagnoseStatus("copied");
    } catch (err) {
      logIgnoredError("logs-panel.copyDiagnosticBundle", err);
      setDiagnoseStatus("failed");
    }
  }, [api, diagnoseStatus, loadDiagnosticBundle]);

  const startDiagnosticTask = useCallback(async () => {
    if (diagnoseStatus === "starting" || diagnoseStatus === "started" || !selectedRootWorkspaceId) return;
    setDiagnoseStatus("starting");
    try {
      const bundle = await loadDiagnosticBundle();
      await api.startThread({
        requestId: `diagnose-pi:${bundle.generatedAt}`,
        rootWorkspaceId: selectedRootWorkspaceId,
        environment: "local",
        prompt: `Diagnose Pi using this redacted local snapshot. Identify the likely cause, inspect relevant local logs and code read-only first, and propose the safest verified fix. Ask before any external issue search or post. Do not expose secrets or private paths.\n\n${bundle.markdown}`,
      });
      setDiagnoseStatus("started");
    } catch (err) {
      logIgnoredError("logs-panel.startDiagnosticTask", err);
      setDiagnoseStatus("failed");
    }
  }, [api, diagnoseStatus, loadDiagnosticBundle, selectedRootWorkspaceId]);

  const openDiagnosticIssueDraft = useCallback(async () => {
    setIssueDraftStatus("opening");
    try {
      const draft = buildDiagnosticIssueDraft({
        events: page.events,
        selectedEvent: selected,
        versions: api.versions,
        platform: api.platform,
      });
      await api.openExternal(draft.url);
      setIssueDraftStatus("opened");
    } catch (err) {
      logIgnoredError("logs-panel.openDiagnosticIssueDraft", err);
      setIssueDraftStatus("failed");
    }
  }, [api, page.events, selected]);

  useEffect(() => {
    if (issueDraftStatus === "idle" || issueDraftStatus === "opening") {
      return;
    }
    const timer = window.setTimeout(() => setIssueDraftStatus("idle"), 4_000);
    return () => window.clearTimeout(timer);
  }, [issueDraftStatus]);

  return (
    <aside className="logs-panel" data-testid="logs-panel" aria-label="Runtime inspector">
      <header className="logs-panel__header">
        <div>
          <div className="logs-panel__eyebrow">Runtime</div>
          <h2>Inspector</h2>
        </div>
        <span className={`logs-panel__failure-count${tab === "resources" && resourceSnapshot ? ` resource-health-label--${resourceSnapshot.health}` : ""}`} data-testid="logs-failure-count">
          {tab === "resources"
            ? resourceSnapshot ? resourceSnapshot.health : "sampling"
            : tab === "remote" ? remoteSnapshot?.status ?? "checking"
            : tab === "runtime" ? `${runtimeJobs.length} jobs` : `${failureCount} failures`}
        </span>
        {tab === "resources" ? (
          <button className="secondary-button logs-panel__issue-button" type="button" disabled={diagnoseStatus === "copying"} onClick={() => void copyDiagnosticBundle()}>
            {diagnoseStatus === "copied" ? "Copied" : "Copy diagnostics"}
          </button>
        ) : null}
        {tab === "app" ? (
          <button
            className="secondary-button logs-panel__issue-button"
            type="button"
            disabled={!issueDraftsEnabled || page.events.length === 0 || issueDraftStatus === "opening"}
            onClick={() => void openDiagnosticIssueDraft()}
          >
            Draft issue
          </button>
        ) : null}
        <button className="icon-button" type="button" aria-label="Refresh logs" onClick={() => void refresh()} disabled={loading}><RefreshIcon /></button>
        <button className="icon-button" type="button" aria-label="Close logs" onClick={onClose}><CloseIcon /></button>
      </header>
      <div className="logs-panel__tabs" role="tablist" aria-label="Runtime inspector views">
        <button className={`logs-panel__tab${tab === "resources" ? " logs-panel__tab--active" : ""}`} role="tab" aria-selected={tab === "resources"} type="button" onClick={() => setTab("resources")}>Resources</button>
        <button className={`logs-panel__tab${tab === "runtime" ? " logs-panel__tab--active" : ""}`} role="tab" aria-selected={tab === "runtime"} type="button" onClick={() => setTab("runtime")}>Runtime</button>
        <button className={`logs-panel__tab${tab === "remote" ? " logs-panel__tab--active" : ""}`} role="tab" aria-selected={tab === "remote"} type="button" onClick={() => setTab("remote")}>Remote spike</button>
        <button className={`logs-panel__tab${tab === "task" ? " logs-panel__tab--active" : ""}`} role="tab" aria-selected={tab === "task"} type="button" onClick={() => setTab("task")}>Task logs</button>
        <button className={`logs-panel__tab${tab === "app" ? " logs-panel__tab--active" : ""}`} role="tab" aria-selected={tab === "app"} type="button" onClick={() => setTab("app")}>App logs</button>
      </div>
      {tab === "resources" ? (
        <ResourceTab
          loading={loading}
          error={error}
          snapshot={resourceSnapshot}
          canStartDiagnosticTask={Boolean(selectedRootWorkspaceId)}
          diagnoseStatus={diagnoseStatus}
          onStartDiagnosticTask={() => void startDiagnosticTask()}
          onOpenLogs={() => setTab("task")}
          onOpenLogsFolder={() => void api.openDiagnosticLogsFolder()}
          onOpenTask={(owner) => {
            if (!owner.workspaceId || !owner.sessionId) return;
            void api.selectSession({ workspaceId: owner.workspaceId, sessionId: owner.sessionId });
          }}
          onStopOwner={(owner) => {
            if (owner.ownerKind === "terminal" && owner.stoppable) {
              void api.closeTerminalSession(owner.ownerId).then(refresh);
              return;
            }
            if (!owner.workspaceId || !owner.sessionId || !owner.runtimeJobId || !owner.stoppable) return;
            void api.stopRuntimeJob(
              { workspaceId: owner.workspaceId, sessionId: owner.sessionId },
              owner.runtimeJobId,
            ).then(refresh);
          }}
        />
      ) : tab === "runtime" ? (
        <RuntimeTab api={api} loading={loading} session={selectedSession} runtimeLabel={runtimeLabel} />
      ) : tab === "remote" ? (
        <RemoteExecutionTab api={api} error={error} loading={loading} snapshot={remoteSnapshot} workspaceId={selectedWorkspaceId} onSnapshot={setRemoteSnapshot} />
      ) : (
        <>
          <div className="logs-panel__filters">
            <input aria-label="Search logs" className="logs-panel__search" placeholder="Search logs" value={query} onChange={(event) => setQuery(event.target.value)} />
            <select aria-label="Log severity" value={severity} onChange={(event) => setSeverity(event.target.value as ObservabilitySeverity | "all" | "failures")}>
              {SEVERITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            {tab === "task" ? (
              <>
                <input aria-label="Filter by run" className="logs-panel__search" placeholder="Run ID" value={runId} onChange={(event) => setRunId(event.target.value)} />
                <input aria-label="Filter by role" className="logs-panel__search" placeholder="Role" value={role} onChange={(event) => setRole(event.target.value)} />
              </>
            ) : tab === "app" ? (
              <div className="logs-panel__fixed-filter" aria-label="Log category">
                <span className="logs-panel__fixed-filter-label">Log category</span>
                <strong>Desktop + Renderer</strong>
              </div>
            ) : (
              <select aria-label="Log category" value={category} onChange={(event) => setCategory(event.target.value as ObservabilityCategory | "all")}>
                {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            )}
            <select aria-label="Log scope" value={includeGlobal ? "global" : "current"} onChange={(event) => setIncludeGlobal(event.target.value === "global")}>
              <option value="current">Current thread</option>
              <option value="global">Global logs</option>
            </select>
          </div>
          <div className="logs-panel__runtime-note">
            {tab === "task"
              ? "Task logs are filtered to tools only."
              : tab === "app"
                ? issueDraftStatus === "opened"
                  ? "Draft opened in the browser."
                  : issueDraftStatus === "failed"
                    ? "Unable to open the draft."
                    : issueDraftsEnabled
                      ? "App logs show Electron and renderer diagnostics only."
                      : "Enable diagnostic issue drafts in Settings > General to prefill a report."
                : ""}
          </div>
          {error ? <div className="logs-panel__error">{error}</div> : null}
          {page.warnings.length > 0 ? <div className="logs-panel__warning">{page.warnings[0]}</div> : null}
          <EventBrowser
            emptyMessage={tab === "task" ? "No task log events match this filter." : "No app log events match this filter."}
            events={page.events}
            selected={selected}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onJumpToTimeline={jumpToTimeline}
          />
        </>
      )}
    </aside>
  );
}

function RemoteExecutionTab({ api, error, loading, snapshot, workspaceId, onSnapshot }: {
  readonly api: PiDesktopApi;
  readonly error: string | undefined;
  readonly loading: boolean;
  readonly snapshot: LoopbackRemoteSnapshot | undefined;
  readonly workspaceId: string | undefined;
  readonly onSnapshot: (snapshot: LoopbackRemoteSnapshot) => void;
}) {
  const [probe, setProbe] = useState<LoopbackRemoteProbe>();
  const [path, setPath] = useState(".");
  const [operation, setOperation] = useState<"idle" | "launch" | "probe" | "shutdown">("idle");
  const [localError, setLocalError] = useState<string>();
  const run = async (kind: typeof operation, action: () => Promise<void>) => {
    setOperation(kind);
    setLocalError(undefined);
    try { await action(); } catch (cause) { setLocalError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setOperation("idle"); }
  };
  if (!snapshot) return <div className="logs-panel__empty">{error ?? (loading ? "Checking the development-only loopback prototype…" : "Remote prototype state unavailable.")}</div>;
  return <div className="logs-panel__remote" data-testid="loopback-remote-diagnostics">
    <div className="remote-spike-intro">
      <div><strong>Loopback execution boundary</strong><span>Development architecture spike. Read-only, local-machine loopback only; this is not a production remote workspace.</span></div>
      <span className={`remote-spike-status remote-spike-status--${snapshot.status}`}>{snapshot.status}</span>
    </div>
    {!snapshot.enabled ? <div className="logs-panel__warning"><strong>Disabled by default</strong><span>Launch Pi with <code>PI_APP_EXPERIMENTAL_REMOTE_EXECUTION=1</code> only when deliberately testing this prototype.</span></div> : null}
    {localError || error || snapshot.lastError ? <div className="logs-panel__error">{localError ?? error ?? snapshot.lastError}</div> : null}
    <div className="remote-spike-actions">
      <button className="primary-button" disabled={!snapshot.enabled || !workspaceId || operation !== "idle"} type="button" onClick={() => void run("launch", async () => { const next = await api.launchLoopbackRemote(workspaceId!); onSnapshot(next); setProbe(undefined); })}>{snapshot.status === "connected" ? "Reconnect" : "Launch prototype"}</button>
      <label><span>Relative probe path</span><input aria-label="Relative probe path" value={path} onChange={(event) => setPath(event.target.value)} /></label>
      <button className="secondary-button" disabled={snapshot.status !== "connected" || operation !== "idle"} type="button" onClick={() => void run("probe", async () => setProbe(await api.probeLoopbackRemote(path)))}>Run read-only probe</button>
      <button className="secondary-button" disabled={snapshot.status === "stopped" || snapshot.status === "disabled" || operation !== "idle"} type="button" onClick={() => void run("shutdown", async () => { onSnapshot(await api.shutdownLoopbackRemote()); setProbe(undefined); })}>Shut down</button>
    </div>
    <dl className="remote-spike-facts">
      <div><dt>Protocol</dt><dd>v{snapshot.protocolVersion}</dd></div><div><dt>Generation</dt><dd>{snapshot.generation}</dd></div><div><dt>Helper</dt><dd>{snapshot.pid ? `PID ${snapshot.pid}` : "not running"}</dd></div><div><dt>Root</dt><dd>{snapshot.root ?? "not negotiated"}</dd></div>
    </dl>
    {snapshot.capabilities ? <div className="remote-spike-capabilities" aria-label="Negotiated capabilities">{Object.entries(snapshot.capabilities).map(([name, value]) => <span key={name}>{name}: {String(value)}</span>)}</div> : null}
    {probe ? <div className="remote-spike-probe" role="status"><strong>Probe healthy · {probe.entries.length} entries · {probe.git.length} Git changes</strong><span>Helper uptime {Math.round(probe.health.uptimeMs / 1_000)}s</span><details><summary>Directory entries</summary><ul>{probe.entries.map((entry) => <li key={`${entry.kind}:${entry.name}`}>{entry.kind} · {entry.name}</li>)}</ul></details><details><summary>Git status</summary><ul>{probe.git.map((entry) => <li key={`${entry.status}:${entry.path}`}>{entry.status}{entry.staged ? " · staged" : ""} · {entry.path}</li>)}</ul></details></div> : null}
  </div>;
}

function ResourceTab({
  loading,
  error,
  snapshot,
  canStartDiagnosticTask,
  diagnoseStatus,
  onStartDiagnosticTask,
  onOpenLogs,
  onOpenLogsFolder,
  onOpenTask,
  onStopOwner,
}: {
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly snapshot: ResourceInspectorSnapshot | undefined;
  readonly canStartDiagnosticTask: boolean;
  readonly diagnoseStatus: "idle" | "copying" | "copied" | "starting" | "started" | "failed";
  readonly onStartDiagnosticTask: () => void;
  readonly onOpenLogs: () => void;
  readonly onOpenLogsFolder: () => void;
  readonly onOpenTask: (owner: ResourceOwnerSummary) => void;
  readonly onStopOwner: (owner: ResourceOwnerSummary) => void;
}) {
  const [ownerFilter, setOwnerFilter] = useState<ResourceOwnerKind | "all">("all");
  if (!snapshot) {
    return <div className="logs-panel__empty">{error ?? (loading ? "Sampling Pi-owned processes…" : "Resource sample unavailable.")}</div>;
  }
  const maxMemory = Math.max(...snapshot.history.map((point) => point.residentBytes), 1);
  const sparklinePoints = snapshot.history.map((point, index) => {
    const x = snapshot.history.length <= 1 ? 100 : index * (100 / (snapshot.history.length - 1));
    const y = 28 - (point.residentBytes / maxMemory) * 24;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const sparkline = sparklinePoints.length === 1 ? `0,${sparklinePoints[0]?.split(",")[1] ?? "28"} ${sparklinePoints[0]}` : sparklinePoints.join(" ");
  const visibleOwners = ownerFilter === "all" ? snapshot.owners : snapshot.owners.filter((owner) => owner.ownerKind === ownerFilter);
  return (
    <div className="logs-panel__resources" data-testid="resource-inspector">
      {error ? <div className="logs-panel__error">{error}</div> : null}
      <div className={`resource-health resource-health--${snapshot.health}`}>
        <div><span>Health</span><strong>{snapshot.health}</strong></div>
        <div><span>CPU</span><strong>{snapshot.cpuPercent.toFixed(1)}%</strong></div>
        <div><span>Memory</span><strong>{formatBytes(snapshot.residentBytes)}</strong></div>
        <div><span>Processes</span><strong>{snapshot.processCount}</strong></div>
        <div><span>Main heap</span><strong>{formatPercent(snapshot.mainHeapRatio)}</strong></div>
        <div><span>Renderer heap</span><strong>{formatPercent(snapshot.rendererHeapRatio)}</strong></div>
      </div>
      <svg className="resource-sparkline" viewBox="0 0 100 32" role="img" aria-label={`Resident memory trend, latest ${formatBytes(snapshot.residentBytes)}`} preserveAspectRatio="none">
        <polyline points={sparkline} vectorEffect="non-scaling-stroke" />
      </svg>
      {snapshot.warnings.map((warning) => (
        <div className={`logs-panel__warning resource-warning--${warning.level}`} key={warning.id}>
          <strong>{warning.title}</strong><span>{warning.message}</span>
        </div>
      ))}
      <div className="resource-owner-toolbar">
        <label htmlFor="resource-owner-filter">Show</label>
        <select id="resource-owner-filter" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value as ResourceOwnerKind | "all")}>
          <option value="all">All owned processes</option>
          <option value="electron">Electron</option>
          <option value="runtime">Provider + subagent runtime</option>
          <option value="terminal">Terminal</option>
          <option value="vscode">VS Code</option>
        </select>
        <button className="secondary-button" type="button" onClick={onOpenLogs}>Open task logs</button>
      </div>
      <div className="resource-owner-list" role="list" aria-label="Pi resource owners">
        {visibleOwners.length === 0 ? <div className="logs-panel__empty">No matching Pi-owned processes are active.</div> : visibleOwners.map((owner) => (
          <div className="resource-owner" key={`${owner.ownerKind}:${owner.ownerId}`} role="listitem">
            <div className="resource-owner__title"><strong>{owner.label}</strong><span>{owner.ownerKind} · {owner.confidence}</span></div>
            <div className="resource-owner__metrics"><span>{owner.cpuPercent.toFixed(1)}% CPU</span><span>{formatBytes(owner.residentBytes)}</span><span>{owner.processCount} proc</span></div>
            {owner.workspaceId && owner.sessionId ? (
              <div className="resource-owner__actions">
                <button className="secondary-button" type="button" onClick={() => onOpenTask(owner)}>Open task</button>
                {owner.stoppable ? <button className="secondary-button" type="button" onClick={() => onStopOwner(owner)}>Stop owned job</button> : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="resource-diagnose">
        <div><strong>Diagnose Pi</strong><span>Creates a redacted, bounded snapshot. Nothing is sent automatically.</span></div>
        <button className="primary-button" type="button" disabled={!canStartDiagnosticTask || diagnoseStatus === "starting" || diagnoseStatus === "started"} onClick={onStartDiagnosticTask}>
          {diagnoseStatus === "starting" ? "Starting…" : diagnoseStatus === "started" ? "Task started" : "Start diagnostic task"}
        </button>
        <button className="secondary-button" type="button" onClick={onOpenLogsFolder}>Open logs folder</button>
      </div>
      <details className="resource-history-table">
        <summary>History table ({snapshot.history.length} samples)</summary>
        <table>
          <thead><tr><th>Time</th><th>CPU</th><th>Memory</th><th>Processes</th><th>Health</th></tr></thead>
          <tbody>{snapshot.history.slice(-30).reverse().map((point) => (
            <tr key={point.timestamp}><td>{formatTime(point.timestamp)}</td><td>{point.cpuPercent.toFixed(1)}%</td><td>{formatBytes(point.residentBytes)}</td><td>{point.processCount}</td><td>{point.health}</td></tr>
          ))}</tbody>
        </table>
      </details>
      <div className="logs-panel__runtime-note">Updates every {snapshot.sampling.intervalMs / 1_000}s while visible. History is capped at 15 minutes and {formatBytes(snapshot.sampling.historyBytes)}.</div>
    </div>
  );
}

function RuntimeTab({
  api,
  loading,
  session,
  runtimeLabel,
}: {
  readonly api: PiDesktopApi;
  readonly loading: boolean;
  readonly session: SessionRecord | undefined;
  readonly runtimeLabel: string;
}) {
  const jobs = session?.runtimeSummary?.jobs ?? [];

  return (
    <div className="logs-panel__runtime" data-testid="runtime-panel">
      <div className="logs-panel__runtime-status">
        <span className="logs-panel__runtime-label">Status</span>
        <strong>{runtimeLabel}</strong>
      </div>
      {jobs.length === 0 ? (
        <div className="logs-panel__empty">No runtime jobs for the selected session.</div>
      ) : (
        <div className="logs-panel__runtime-jobs" role="list" aria-label="Runtime jobs">
          {jobs.map((job) => {
            const canStop = canStopRuntimeJob(job);
            const target = { workspaceId: job.sessionRef.workspaceId, sessionId: job.sessionRef.sessionId };
            return (
              <div className="logs-panel__runtime-job" key={job.id} role="listitem">
                <div className="logs-panel__runtime-job-title">{job.title}</div>
                <div className="logs-panel__runtime-job-meta">{job.status} · {job.confidence}</div>
                {job.message ? <div className="logs-panel__runtime-job-message">{job.message}</div> : null}
                <div className="runtime-job-card__actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={loading}
                    onClick={() => void api.refreshRuntimeJobs(target)}
                  >
                    Refresh status
                  </button>
                  {canStop ? (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={loading}
                      onClick={() => void api.stopRuntimeJob(target, job.id)}
                    >
                      Stop
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
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
  onJumpToTimeline,
}: {
  readonly emptyMessage: string;
  readonly events: readonly ObservabilityEvent[];
  readonly selected: ObservabilityEvent | undefined;
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  readonly onJumpToTimeline: (event: ObservabilityEvent) => void;
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
      <EventDetails event={selected} onJumpToTimeline={onJumpToTimeline} />
    </div>
  );
}

function EventDetails({ event, onJumpToTimeline }: { readonly event: ObservabilityEvent | undefined; readonly onJumpToTimeline: (event: ObservabilityEvent) => void }) {
  if (!event) return <div className="logs-panel__details logs-panel__details--empty">Select an event to inspect raw details.</div>;
  return (
    <section className="logs-panel__details" aria-label="Log event details">
      <h3>{event.title}</h3>
      {event.correlation?.parentToolCallId || event.correlation?.toolCallId ? (
        <button className="secondary-button" type="button" onClick={() => onJumpToTimeline(event)}>Jump to timeline</button>
      ) : null}
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

function jumpToTimeline(event: ObservabilityEvent): void {
  const callId = event.correlation?.parentToolCallId ?? event.correlation?.toolCallId;
  if (!callId) return;
  const target = document.querySelector<HTMLElement>(`[data-tool-call-id="${CSS.escape(callId)}"]`);
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
  target?.querySelector<HTMLButtonElement>(".timeline-tool__header")?.click();
}

function buildCategoryFilter(tab: LogsTab, category: ObservabilityCategory | "all"): readonly ObservabilityCategory[] | undefined {
  if (tab === "task") {
    return ["agent", "tool", "skill", "subagent", "workspace", "slash-command"];
  }

  if (tab === "app") {
    return ["desktop", "renderer"];
  }

  if (category !== "all") {
    return [category];
  }

  return undefined;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function formatPercent(ratio: number): string {
  return `${Math.round(Math.max(0, ratio) * 100)}%`;
}

function readLocal(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch (error) {
    logIgnoredError("logs-panel.readLocalStorage", error);
    return undefined;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    logIgnoredError("logs-panel.writeLocalStorage", error);
  }
}
