import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ToolAccessSelection } from "@pi-gui/session-driver";
import type { PiDesktopApi } from "../../ipc";
import {
  countActiveBoundaryRules,
  type BoundaryRuleMode,
  type ExecutionBoundary,
  type ExecutionBoundaryInput,
} from "../../product-experience/execution-boundary";

interface ExecutionBoundaryControlProps {
  readonly api: PiDesktopApi;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly toolAccess: ToolAccessSelection;
  readonly onSetToolAccess: (selection: ToolAccessSelection) => void;
}

export function ExecutionBoundaryControl({
  api,
  workspaceId,
  sessionId,
  toolAccess,
  onSetToolAccess,
}: ExecutionBoundaryControlProps) {
  const [open, setOpen] = useState(false);
  const [boundary, setBoundary] = useState<ExecutionBoundary>();
  const [draft, setDraft] = useState<ExecutionBoundaryInput>({ enabled: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    setBoundary(undefined);
    setError(undefined);
    void api.getExecutionBoundary(workspaceId, sessionId).then((next) => {
      if (!active) return;
      setBoundary(next);
      setDraft(boundaryToInput(next, toolAccess));
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      active = false;
    };
  }, [api, sessionId, toolAccess, workspaceId]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
    window.addEventListener("keydown", handleEscape);
    window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open]);

  const close = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const save = async (nextInput = draft) => {
    setSaving(true);
    setError(undefined);
    try {
      const next = await api.setExecutionBoundary(workspaceId, sessionId, {
        ...nextInput,
        toolAccess: nextInput.enabled ? nextInput.toolAccess ?? toolAccess : { mode: "full", tools: [] },
      });
      setBoundary(next);
      setDraft(boundaryToInput(next, next.toolAccess));
      onSetToolAccess(next.enabled ? next.toolAccess : { mode: "full", tools: [] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const activeRules = boundary ? countActiveBoundaryRules(boundary) : 0;
  const label = boundary?.enabled
    ? `Boundary · ${activeRules} active`
    : "Boundary · off";

  return (
    <div className="execution-boundary-control">
      <button
        aria-expanded={open}
        className={`execution-boundary-control__trigger${boundary?.enabled ? " execution-boundary-control__trigger--active" : ""}`}
        data-testid="execution-boundary-trigger"
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        {label}
      </button>
      {open ? createPortal(
        <div
          className="execution-boundary-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section
            aria-label="Execution boundary"
            aria-modal="true"
            className="execution-boundary"
            data-testid="execution-boundary"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header>
              <div>
                <strong>Execution boundary</strong>
                <span>Thread-scoped limits for the next and later runs</span>
              </div>
              <button aria-label="Close execution boundary" type="button" onClick={close}>×</button>
            </header>
            <label className="execution-boundary__enabled">
              <input
                checked={Boolean(draft.enabled)}
                type="checkbox"
                onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
              />
              <span>Enable boundary for this thread</span>
            </label>
            <div className="execution-boundary__grid" aria-disabled={!draft.enabled}>
              <BoundaryNumber
                label="Maximum files"
                value={draft.maxFiles}
                onChange={(maxFiles) => setDraft((current) => ({ ...current, maxFiles }))}
              />
              <BoundaryNumber
                advisory
                label="Maximum elapsed minutes"
                value={draft.maxElapsedMinutes}
                onChange={(maxElapsedMinutes) => setDraft((current) => ({ ...current, maxElapsedMinutes }))}
              />
              <BoundaryText
                label="Allowed paths"
                placeholder="src/**, tests/**"
                value={draft.allowPaths ?? []}
                onChange={(allowPaths) => setDraft((current) => ({ ...current, allowPaths }))}
              />
              <BoundaryText
                label="Denied paths"
                placeholder=".env, secrets/**"
                value={draft.denyPaths ?? []}
                onChange={(denyPaths) => setDraft((current) => ({ ...current, denyPaths }))}
              />
              <BoundaryMode
                label="Dependency changes"
                value={draft.dependencyChanges ?? "approval"}
                onChange={(dependencyChanges) => setDraft((current) => ({ ...current, dependencyChanges }))}
              />
              <label>
                <span>Tool access <em>enforced</em></span>
                <select
                  value={draft.toolAccess?.mode ?? toolAccess.mode}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    toolAccess: toolSelectionForMode(event.target.value as ToolAccessSelection["mode"], toolAccess),
                  }))}
                >
                  <option value="full">Full access</option>
                  <option value="read-only">Read only</option>
                  <option value="no-tools">No tools</option>
                  <option value="custom">Current custom selection</option>
                </select>
              </label>
              <label className="execution-boundary__check">
                <input
                  checked={Boolean(draft.testOnly)}
                  type="checkbox"
                  onChange={(event) => setDraft((current) => ({ ...current, testOnly: event.target.checked }))}
                />
                <span>Test-only mode</span>
              </label>
            </div>
            <details className="execution-boundary__commands">
              <summary>Command categories</summary>
              {(["test", "build", "package", "network", "version-control"] as const).map((category) => (
                <BoundaryMode
                  key={category}
                  label={category === "version-control" ? "Version control" : `${category.charAt(0).toUpperCase()}${category.slice(1)}`}
                  value={draft.commandCategories?.[category] ?? "allow"}
                  onChange={(mode) => setDraft((current) => ({
                    ...current,
                    commandCategories: { ...current.commandCategories, [category]: mode },
                  }))}
                />
              ))}
            </details>
            <p className="execution-boundary__notice">
              Tool access is enforced by the runtime. File, path, dependency, and command limits are checked
              before submission when explicit in your request. Elapsed time and unannounced runtime behavior
              remain advisory where the provider exposes no enforcement hook.
            </p>
            {error ? <p className="execution-boundary__error" role="alert">{error}</p> : null}
            <footer>
              {boundary?.enabled ? (
                <button
                  disabled={saving}
                  type="button"
                  onClick={() => void save({ ...draft, enabled: false })}
                >
                  Disable boundary
                </button>
              ) : <span />}
              <button disabled={saving} type="button" onClick={() => void save()}>
                {saving ? "Saving…" : "Apply boundary"}
              </button>
            </footer>
          </section>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function boundaryToInput(
  boundary: ExecutionBoundary,
  fallbackToolAccess: ToolAccessSelection,
): ExecutionBoundaryInput {
  return {
    enabled: boundary.enabled,
    ...(boundary.maxFiles ? { maxFiles: boundary.maxFiles } : {}),
    allowPaths: boundary.allowPaths,
    denyPaths: boundary.denyPaths,
    dependencyChanges: boundary.dependencyChanges,
    commandCategories: boundary.commandCategories,
    testOnly: boundary.testOnly,
    ...(boundary.maxElapsedMinutes ? { maxElapsedMinutes: boundary.maxElapsedMinutes } : {}),
    toolAccess: boundary.toolAccess ?? fallbackToolAccess,
  };
}

function BoundaryNumber({
  advisory = false,
  label,
  value,
  onChange,
}: {
  readonly advisory?: boolean;
  readonly label: string;
  readonly value?: number;
  readonly onChange: (value: number | undefined) => void;
}) {
  return (
    <label>
      <span>{label} {advisory ? <em>advisory</em> : null}</span>
      <input
        min={1}
        placeholder="No limit"
        type="number"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : undefined)}
      />
    </label>
  );
}

function BoundaryText({
  label,
  placeholder,
  value,
  onChange,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
}) {
  return (
    <label>
      <span>{label} <em>preflight</em></span>
      <input
        placeholder={placeholder}
        type="text"
        value={value.join(", ")}
        onChange={(event) => onChange(event.target.value.split(",").map((entry) => entry.trim()).filter(Boolean))}
      />
    </label>
  );
}

function BoundaryMode({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: BoundaryRuleMode;
  readonly onChange: (value: BoundaryRuleMode) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as BoundaryRuleMode)}>
        <option value="allow">Allow</option>
        <option value="approval">Ask once</option>
        <option value="deny">Deny</option>
      </select>
    </label>
  );
}

function toolSelectionForMode(
  mode: ToolAccessSelection["mode"],
  current: ToolAccessSelection,
): ToolAccessSelection {
  if (mode === "full") return { mode: "full", tools: [] };
  if (mode === "read-only") return { mode: "read-only", tools: ["read", "grep", "find", "ls"] };
  if (mode === "no-tools") return { mode: "no-tools", tools: [] };
  return current.mode === "custom" ? current : { mode: "custom", tools: [] };
}
