import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SessionRecord, WorkspaceRecord } from "../../desktop-state";
import type { UsageBucket, UsageDashboardSnapshot, UsageQuery, UsageWindow } from "../../usage-types";
import { LoadingState } from "../../loading-state";
import { SecondarySurface } from "../../secondary-surface";

interface UsageViewProps {
  readonly api: NonNullable<typeof window.piApp>;
  readonly commandPalette: ReactNode;
  readonly workspaces: readonly WorkspaceRecord[];
  readonly selectedWorkspace?: WorkspaceRecord;
  readonly selectedSession?: SessionRecord;
  readonly onBack: () => void;
}

export function UsageView({ api, commandPalette, workspaces, selectedWorkspace, selectedSession, onBack }: UsageViewProps) {
  const [window, setWindow] = useState<UsageWindow>("7d");
  const [workspaceId, setWorkspaceId] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [metric, setMetric] = useState<"tokens" | "cost">("tokens");
  const [snapshot, setSnapshot] = useState<UsageDashboardSnapshot>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const sessionId = window === "task" ? selectedSession?.id : undefined;
  const effectiveWorkspaceId = window === "task" ? selectedWorkspace?.id : workspaceId || undefined;
  const query = useMemo<UsageQuery>(() => ({
    window,
    workspaceId: effectiveWorkspaceId,
    sessionId,
    provider: provider || undefined,
    model: model || undefined,
  }), [effectiveWorkspaceId, model, provider, sessionId, window]);

  const load = useCallback((force = false) => {
    setLoading(true);
    setError(undefined);
    void api.getUsageDashboard(query, force).then(setSnapshot).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => setLoading(false));
  }, [api, query]);

  useEffect(() => { load(false); }, [load]);

  const providerOptions = snapshot?.providers.map((bucket) => bucket.key) ?? [];
  const modelOptions = snapshot?.models.map((bucket) => bucket.key) ?? [];
  const labels = useMemo(() => buildUsageLabels(workspaces), [workspaces]);

  return (
    <>
      {commandPalette}
      <SecondarySurface onBack={onBack} testId="usage-surface" title="Usage">
        <div className="usage-dashboard" data-testid="usage-dashboard">
          <header className="usage-dashboard__toolbar">
            <div className="usage-dashboard__windows" aria-label="Usage period">
              {(["task", "24h", "7d", "30d", "90d"] as const).map((value) => <button aria-pressed={window === value} key={value} type="button" onClick={() => setWindow(value)}>{value === "task" ? "Current task" : value}</button>)}
            </div>
            <div className="usage-dashboard__filters">
              <label>Workspace<select disabled={window === "task"} value={window === "task" ? selectedWorkspace?.id ?? "" : workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}><option value="">All workspaces</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
              <label>Provider<select value={provider} onChange={(event) => { setProvider(event.target.value); setModel(""); }}><option value="">All providers</option>{providerOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label>Model<select value={model} onChange={(event) => setModel(event.target.value)}><option value="">All models</option>{modelOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <button disabled={loading} type="button" onClick={() => load(true)}>Refresh</button>
            </div>
          </header>

          {error ? <div className="usage-dashboard__error" role="alert">{error}</div> : null}
          {!snapshot && loading ? <LoadingState label="Indexing usage" detail="Reading only changed Pi session records…" /> : null}
          {snapshot ? (
            <>
              <section className="usage-dashboard__cards" aria-label="Usage totals">
                <UsageCard label="Total tokens" value={formatTokens(snapshot.totals.totalTokens)} detail={`${snapshot.totals.turns} assistant turn${snapshot.totals.turns === 1 ? "" : "s"}`} />
                <UsageCard label="Input / output" value={`${formatTokens(snapshot.totals.inputTokens)} / ${formatTokens(snapshot.totals.outputTokens)}`} detail={snapshot.totals.reasoningTokens ? `${formatTokens(snapshot.totals.reasoningTokens)} reasoning tokens (included in output)` : "Reasoning breakdown unavailable or zero"} />
                <UsageCard label="Cache read" value={formatTokens(snapshot.totals.cacheReadTokens)} detail={`${formatPercent(snapshot.totals.cacheReadTokens, snapshot.totals.totalTokens)} of reported tokens`} />
                <UsageCard label="Reported cost" value={formatUsd(snapshot.totals.costUsd)} detail={`${snapshot.totals.unpricedRecords} subscription/unpriced records excluded`} />
              </section>

              <section className="usage-dashboard__panel">
                <header><div><h2>Trend</h2><p>Exact values remain available in the table below.</p></div><div className="usage-dashboard__metric"><button aria-pressed={metric === "tokens"} type="button" onClick={() => setMetric("tokens")}>Tokens</button><button aria-pressed={metric === "cost"} type="button" onClick={() => setMetric("cost")}>Reported cost</button></div></header>
                <UsageBars buckets={snapshot.trend} metric={metric} labelFor={(key) => key} />
                <UsageTable caption="Daily usage" buckets={snapshot.trend} labelFor={(key) => key} />
              </section>

              <div className="usage-dashboard__columns">
                <UsageBreakdown title="Providers" buckets={snapshot.providers} labels={labels} />
                <UsageBreakdown title="Models" buckets={snapshot.models} labels={labels} />
                <UsageBreakdown title="Workspaces" buckets={snapshot.workspaces} labels={labels} />
                <UsageBreakdown title="Tasks" buckets={snapshot.tasks} labels={labels} />
              </div>

              <details className="usage-dashboard__methodology">
                <summary>Data source and billing limitations</summary>
                {snapshot.notes.map((note) => <p key={note}>{note}</p>)}
                <dl><div><dt>Last indexed</dt><dd>{new Date(snapshot.indexedAt).toLocaleString()}</dd></div><div><dt>Index activity</dt><dd>{snapshot.scannedFileCount} changed · {snapshot.unchangedFileCount} unchanged files</dd></div><div><dt>Bound</dt><dd>{formatBytes(snapshot.indexBytes)} / {formatBytes(snapshot.indexByteLimit)} · {snapshot.retentionDays} days</dd></div><div><dt>Cost sources</dt><dd>{snapshot.costKinds["provider-reported"]} provider-reported · {snapshot.costKinds.subscription} subscription · {snapshot.costKinds.unpriced} unpriced · {snapshot.costKinds.estimated} estimated</dd></div></dl>
              </details>
            </>
          ) : null}
        </div>
      </SecondarySurface>
    </>
  );
}

function UsageCard({ label, value, detail }: { readonly label: string; readonly value: string; readonly detail: string }) {
  return <article className="usage-dashboard__card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function UsageBars({ buckets, metric, labelFor }: { readonly buckets: readonly UsageBucket[]; readonly metric: "tokens" | "cost"; readonly labelFor: (key: string) => string }) {
  const max = Math.max(1, ...buckets.map((bucket) => metric === "tokens" ? bucket.totalTokens : bucket.costUsd));
  return <div aria-hidden="true" className="usage-dashboard__bars">{buckets.slice(-31).map((bucket) => { const value = metric === "tokens" ? bucket.totalTokens : bucket.costUsd; return <div className="usage-dashboard__bar-column" key={bucket.key} title={`${labelFor(bucket.key)}: ${metric === "tokens" ? formatTokens(value) : formatUsd(value)}`}><span style={{ height: `${Math.max(value ? 3 : 0, value / max * 100)}%` }} /><small>{labelFor(bucket.key).slice(5)}</small></div>; })}</div>;
}

function UsageBreakdown({ title, buckets, labels }: { readonly title: string; readonly buckets: readonly UsageBucket[]; readonly labels: ReadonlyMap<string, string> }) {
  return <section className="usage-dashboard__panel"><h2>{title}</h2><UsageBars buckets={buckets.slice(0, 12)} metric="tokens" labelFor={(key) => labels.get(key) ?? key} /><UsageTable caption={`${title} usage`} buckets={buckets} labelFor={(key) => labels.get(key) ?? key} /></section>;
}

function UsageTable({ caption, buckets, labelFor }: { readonly caption: string; readonly buckets: readonly UsageBucket[]; readonly labelFor: (key: string) => string }) {
  return <div className="usage-dashboard__table-wrap"><table><caption>{caption}</caption><thead><tr><th scope="col">Name</th><th scope="col">Assistant turns</th><th scope="col">Input</th><th scope="col">Output</th><th scope="col">Cache read</th><th scope="col">Total</th><th scope="col">Reported cost</th><th scope="col">Unpriced</th></tr></thead><tbody>{buckets.length ? buckets.map((bucket) => <tr key={bucket.key}><th scope="row">{labelFor(bucket.key)}</th><td>{bucket.turns}</td><td>{bucket.inputTokens.toLocaleString()}</td><td>{bucket.outputTokens.toLocaleString()}</td><td>{bucket.cacheReadTokens.toLocaleString()}</td><td>{bucket.totalTokens.toLocaleString()}</td><td>{formatUsd(bucket.costUsd)}</td><td>{bucket.unpricedRecords}</td></tr>) : <tr><td colSpan={8}>No usage records in this period.</td></tr>}</tbody></table></div>;
}

function buildUsageLabels(workspaces: readonly WorkspaceRecord[]): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const workspace of workspaces) {
    labels.set(workspace.id, workspace.name);
    for (const session of workspace.sessions) labels.set(`${workspace.id}:${session.id}`, `${workspace.name} · ${session.title}`);
  }
  return labels;
}

function formatTokens(value: number): string { return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : value.toLocaleString(); }
function formatUsd(value: number): string { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: value < 1 ? 4 : 2, maximumFractionDigits: value < 1 ? 4 : 2 }).format(value); }
function formatPercent(part: number, total: number): string { return total > 0 ? `${(part / total * 100).toFixed(1)}%` : "0%"; }
function formatBytes(value: number): string { return value >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MiB` : `${Math.ceil(value / 1024)} KiB`; }
