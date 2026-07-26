import { useCallback, useEffect, useState } from "react";
import type { PiDesktopApi } from "../../ipc";
import type { TaskEvidenceRecord } from "../../product-experience/task-evidence";

export function useTaskEvidence(
  api: PiDesktopApi,
  workspaceId: string | undefined,
  sessionId: string | undefined,
): {
  readonly records: readonly TaskEvidenceRecord[];
  readonly loading: boolean;
  readonly refresh: () => void;
} {
  const [records, setRecords] = useState<readonly TaskEvidenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const refresh = useCallback(() => setRefreshNonce((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setRecords([]);
    setLoading(Boolean(workspaceId && sessionId));
    if (!workspaceId || !sessionId) {
      return () => {
        active = false;
      };
    }
    const unsubscribe = api.onTaskEvidenceDelta((delta) => {
      if (!active || delta.workspaceId !== workspaceId || delta.sessionId !== sessionId) return;
      setRecords((current) => mergeEvidence(current, delta.records));
    });
    void api.listTaskEvidence({
      workspaceId,
      sessionId,
      limit: 1_000,
    }).then((page) => {
      if (!active) return;
      setRecords((current) => mergeEvidence(current, page.records));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api, refreshNonce, sessionId, workspaceId]);

  return { records, loading, refresh };
}

function mergeEvidence(
  current: readonly TaskEvidenceRecord[],
  incoming: readonly TaskEvidenceRecord[],
): TaskEvidenceRecord[] {
  const byId = new Map(current.map((record) => [record.id, record]));
  for (const record of incoming) byId.set(record.id, record);
  return [...byId.values()].sort((left, right) => (
    Date.parse(right.timestamp) - Date.parse(left.timestamp) || right.id.localeCompare(left.id)
  ));
}
