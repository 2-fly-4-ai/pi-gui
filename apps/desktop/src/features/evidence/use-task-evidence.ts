import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { PiDesktopApi } from "../../ipc";
import type { TaskEvidenceDelta, TaskEvidenceRecord } from "../../product-experience/task-evidence";

interface EvidenceSnapshot {
  readonly records: readonly TaskEvidenceRecord[];
  readonly loading: boolean;
}

interface EvidenceEntry {
  snapshot: EvidenceSnapshot;
  readonly listeners: Set<() => void>;
  subscribers: number;
  requestVersion: number;
}

const EMPTY_SNAPSHOT: EvidenceSnapshot = { records: [], loading: false };
const stores = new WeakMap<PiDesktopApi, TaskEvidenceClientStore>();

export function useTaskEvidence(
  api: PiDesktopApi,
  workspaceId: string | undefined,
  sessionId: string | undefined,
): EvidenceSnapshot & {
  readonly refresh: () => void;
} {
  const store = useMemo(() => evidenceStoreFor(api), [api]);
  const key = evidenceKey(workspaceId, sessionId);
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(key, workspaceId, sessionId, listener),
    [key, sessionId, store, workspaceId],
  );
  const getSnapshot = useCallback(
    () => store.getSnapshot(key),
    [key, store],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const refresh = useCallback(() => {
    if (workspaceId && sessionId) {
      void store.refresh(key, workspaceId, sessionId);
    }
  }, [key, sessionId, store, workspaceId]);

  return { ...snapshot, refresh };
}

class TaskEvidenceClientStore {
  private readonly entries = new Map<string, EvidenceEntry>();
  private unsubscribeDelta: (() => void) | undefined;

  constructor(private readonly api: PiDesktopApi) {}

  getSnapshot(key: string): EvidenceSnapshot {
    return key ? this.entryFor(key).snapshot : EMPTY_SNAPSHOT;
  }

  subscribe(
    key: string,
    workspaceId: string | undefined,
    sessionId: string | undefined,
    listener: () => void,
  ): () => void {
    if (!workspaceId || !sessionId) {
      return () => undefined;
    }

    const entry = this.entryFor(key);
    entry.listeners.add(listener);
    entry.subscribers += 1;
    this.ensureDeltaSubscription();
    if (entry.subscribers === 1) {
      void this.refresh(key, workspaceId, sessionId);
    }

    return () => {
      const current = this.entries.get(key);
      if (!current) return;
      current.listeners.delete(listener);
      current.subscribers = Math.max(0, current.subscribers - 1);
      if (current.subscribers === 0) {
        current.requestVersion += 1;
        this.entries.delete(key);
      }
      if (this.entries.size === 0) {
        this.unsubscribeDelta?.();
        this.unsubscribeDelta = undefined;
      }
    };
  }

  async refresh(key: string, workspaceId: string, sessionId: string): Promise<void> {
    const entry = this.entryFor(key);
    const requestVersion = ++entry.requestVersion;
    this.update(entry, {
      records: entry.snapshot.records,
      loading: true,
    });
    try {
      const page = await this.api.listTaskEvidence({
        workspaceId,
        sessionId,
        limit: 1_000,
      });
      if (this.entries.get(key) !== entry || entry.requestVersion !== requestVersion) {
        return;
      }
      this.update(entry, {
        records: mergeEvidence(entry.snapshot.records, page.records),
        loading: false,
      });
    } catch {
      if (this.entries.get(key) === entry && entry.requestVersion === requestVersion) {
        this.update(entry, {
          records: entry.snapshot.records,
          loading: false,
        });
      }
    }
  }

  private entryFor(key: string): EvidenceEntry {
    const existing = this.entries.get(key);
    if (existing) return existing;
    const created: EvidenceEntry = {
      snapshot: { records: [], loading: true },
      listeners: new Set(),
      subscribers: 0,
      requestVersion: 0,
    };
    this.entries.set(key, created);
    return created;
  }

  private ensureDeltaSubscription(): void {
    if (this.unsubscribeDelta) return;
    this.unsubscribeDelta = this.api.onTaskEvidenceDelta((delta) => {
      this.applyDelta(delta);
    });
  }

  private applyDelta(delta: TaskEvidenceDelta): void {
    const key = evidenceKey(delta.workspaceId, delta.sessionId);
    const entry = this.entries.get(key);
    if (!entry) return;
    this.update(entry, {
      records: mergeEvidence(entry.snapshot.records, delta.records),
      loading: entry.snapshot.loading,
    });
  }

  private update(entry: EvidenceEntry, snapshot: EvidenceSnapshot): void {
    entry.snapshot = snapshot;
    for (const listener of entry.listeners) {
      listener();
    }
  }
}

function evidenceStoreFor(api: PiDesktopApi): TaskEvidenceClientStore {
  const existing = stores.get(api);
  if (existing) return existing;
  const created = new TaskEvidenceClientStore(api);
  stores.set(api, created);
  return created;
}

function evidenceKey(workspaceId: string | undefined, sessionId: string | undefined): string {
  return workspaceId && sessionId ? `${workspaceId}\u0000${sessionId}` : "";
}

export function mergeEvidence(
  current: readonly TaskEvidenceRecord[],
  incoming: readonly TaskEvidenceRecord[],
): TaskEvidenceRecord[] {
  const byId = new Map(current.map((record) => [record.id, record]));
  for (const record of incoming) byId.set(record.id, record);
  return [...byId.values()].sort((left, right) => (
    Date.parse(right.timestamp) - Date.parse(left.timestamp) || right.id.localeCompare(left.id)
  ));
}
