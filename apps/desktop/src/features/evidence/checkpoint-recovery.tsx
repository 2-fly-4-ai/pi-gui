import { useEffect, useMemo, useState } from "react";
import type { PiDesktopApi } from "../../ipc";
import type {
  CheckpointManifest,
  CheckpointRestorePreview,
  CheckpointRestoreResult,
  CheckpointRetentionPolicy,
} from "../../product-experience/checkpoint-contract";
import { formatExactLocalTime } from "../../string-utils";

interface CheckpointRecoveryProps {
  readonly api: PiDesktopApi;
  readonly workspaceId: string;
}

export function CheckpointRecovery({ api, workspaceId }: CheckpointRecoveryProps) {
  const [manifests, setManifests] = useState<readonly CheckpointManifest[]>([]);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState<string>();
  const [preview, setPreview] = useState<CheckpointRestorePreview>();
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<CheckpointRestoreResult>();
  const [retention, setRetention] = useState<CheckpointRetentionPolicy>();
  const [retentionLimit, setRetentionLimit] = useState(100);

  const loadManifests = async () => {
    const next = await api.listCheckpoints(workspaceId);
    setManifests(next);
    setSelectedCheckpointId((current) => (
      current && next.some((manifest) => manifest.id === current)
        ? current
        : next[0]?.id
    ));
  };

  useEffect(() => {
    let active = true;
    setError(undefined);
    void Promise.all([
      api.listCheckpoints(workspaceId),
      api.getCheckpointRetention(),
    ]).then(([next, nextRetention]) => {
      if (!active) return;
      setManifests(next);
      setSelectedCheckpointId(next[0]?.id);
      setRetention(nextRetention);
      setRetentionLimit(nextRetention.maxCheckpoints);
    }).catch((cause: unknown) => {
      if (active) setError(messageForError(cause));
    });
    return () => {
      active = false;
    };
  }, [api, workspaceId]);

  useEffect(() => {
    let active = true;
    setPreview(undefined);
    setConfirming(false);
    setResult(undefined);
    if (!selectedCheckpointId) return () => {
      active = false;
    };
    void api.previewCheckpointRestore(selectedCheckpointId, workspaceId).then((next) => {
      if (!active) return;
      setPreview(next);
      setSelectedPaths(new Set(
        next.entries.filter((entry) => entry.defaultSelected).map((entry) => entry.path),
      ));
    }).catch((cause: unknown) => {
      if (active) setError(messageForError(cause));
    });
    return () => {
      active = false;
      if (selectedCheckpointId) void api.releaseCheckpointRestorePreview(selectedCheckpointId);
    };
  }, [api, selectedCheckpointId, workspaceId]);

  const selectedEntries = useMemo(() => (
    preview?.entries.filter((entry) => selectedPaths.has(entry.path)) ?? []
  ), [preview, selectedPaths]);
  const confirmationPaths = selectedEntries
    .filter((entry) => entry.requiresConfirmation || entry.status === "conflict")
    .map((entry) => entry.path);

  const restore = async (confirmed: boolean) => {
    if (!selectedCheckpointId || selectedEntries.length === 0) return;
    if (confirmationPaths.length > 0 && !confirmed) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const next = await api.restoreCheckpoint({
        checkpointId: selectedCheckpointId,
        workspaceId,
        selectedPaths: selectedEntries.map((entry) => entry.path),
        ...(confirmed && confirmationPaths.length > 0 ? {
          confirmedPaths: confirmationPaths,
        } : {}),
      });
      setResult(next);
      setConfirming(false);
      await loadManifests();
      setPreview(await api.previewCheckpointRestore(selectedCheckpointId, workspaceId));
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setBusy(false);
    }
  };

  if (manifests.length === 0 && !error) {
    return <p className="checkpoint-recovery__empty">No restorable checkpoints were observed for this workspace.</p>;
  }

  return (
    <section className="checkpoint-recovery" data-testid="checkpoint-recovery">
      <div className="checkpoint-recovery__header">
        <div>
          <strong>Recovery checkpoints</strong>
          <span>Stored outside the repository · restore always creates a rollback checkpoint first</span>
        </div>
        <select
          aria-label="Checkpoint"
          value={selectedCheckpointId ?? ""}
          onChange={(event) => setSelectedCheckpointId(event.target.value)}
        >
          {manifests.map((manifest) => (
            <option key={manifest.id} value={manifest.id}>
              {reasonLabel(manifest.reason)} · {formatExactLocalTime(manifest.createdAt)}
            </option>
          ))}
        </select>
      </div>
      {retention ? (
        <details className="checkpoint-recovery__retention">
          <summary>Retention · keep up to {retention.maxCheckpoints}</summary>
          <div>
            <label>
              <span>Maximum checkpoints</span>
              <input
                aria-label="Maximum checkpoints"
                min={1}
                max={1_000}
                type="number"
                value={retentionLimit}
                onChange={(event) => setRetentionLimit(Number(event.target.value))}
              />
            </label>
            <label>
              <input
                aria-label="Protect selected checkpoint"
                checked={Boolean(
                  selectedCheckpointId
                  && retention.protectedCheckpointIds.includes(selectedCheckpointId),
                )}
                type="checkbox"
                onChange={(event) => {
                  if (!selectedCheckpointId) return;
                  const protectedCheckpointIds = event.target.checked
                    ? [...retention.protectedCheckpointIds, selectedCheckpointId]
                    : retention.protectedCheckpointIds.filter((id) => id !== selectedCheckpointId);
                  setRetention({
                    ...retention,
                    maxCheckpoints: retentionLimit,
                    protectedCheckpointIds,
                  });
                  void api.setCheckpointRetention({
                    maxCheckpoints: retentionLimit,
                    protectedCheckpointIds,
                  }).then(setRetention).catch((cause: unknown) => setError(messageForError(cause)));
                }}
              />
              <span>Protect selected checkpoint</span>
            </label>
            <button
              type="button"
              onClick={() => void api.setCheckpointRetention({
                maxCheckpoints: retentionLimit,
                protectedCheckpointIds: retention.protectedCheckpointIds,
              }).then(setRetention).then(loadManifests).catch((cause: unknown) => setError(messageForError(cause)))}
            >
              Apply retention
            </button>
          </div>
          <small>
            The checkpoint currently open for restore is leased and cannot be removed by retention.
          </small>
        </details>
      ) : null}
      {preview ? (
        <div className="checkpoint-recovery__files">
          {preview.entries.map((entry) => {
            const selectable = entry.status === "safe" || entry.status === "conflict";
            return (
              <label className={`checkpoint-recovery__file checkpoint-recovery__file--${entry.status}`} key={entry.path}>
                <input
                  type="checkbox"
                  checked={selectedPaths.has(entry.path)}
                  disabled={!selectable || busy}
                  onChange={(event) => setSelectedPaths((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(entry.path);
                    else next.delete(entry.path);
                    return next;
                  })}
                />
                <span>
                  <strong>{entry.path}</strong>
                  <small>{entry.status} · {entry.ownership} · {entry.reason}</small>
                </span>
              </label>
            );
          })}
        </div>
      ) : null}
      {confirming ? (
        <div className="checkpoint-recovery__confirmation" role="alert">
          <strong>Confirm sensitive restore</strong>
          <span>
            This will overwrite, remove, or restore ownership-ambiguous paths: {confirmationPaths.join(", ")}.
            A rollback checkpoint has not been created yet; it will be created immediately before changes are applied.
          </span>
          <div>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" disabled={busy} onClick={() => void restore(true)}>Confirm restore</button>
          </div>
        </div>
      ) : (
        <button
          className="checkpoint-recovery__restore"
          type="button"
          disabled={busy || selectedEntries.length === 0}
          onClick={() => void restore(false)}
        >
          {busy ? "Restoring…" : `Restore ${selectedEntries.length || ""} selected`.trim()}
        </button>
      )}
      {result ? (
        <p role="status">
          {result.partial ? "Restore partially completed." : "Restore completed."}
          {" "}
          Rollback checkpoint {result.rollbackCheckpointId} is available.
        </p>
      ) : null}
      {error ? <p className="checkpoint-recovery__error" role="alert">{error}</p> : null}
    </section>
  );
}

function reasonLabel(reason: CheckpointManifest["reason"]): string {
  switch (reason) {
    case "before-run-mutation": return "Before Pi edit";
    case "before-restore": return "Before restore";
    case "before-hunk-reject": return "Before hunk rejection";
    default: return "Manual";
  }
}

function messageForError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
