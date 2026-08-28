import { useCallback, useEffect, useState } from "react";
import type {
  PullRequestDetail,
  SourceControlMutation,
  SourceControlMutationPreview,
  SourceControlSnapshot,
  TaskPullRequestLink,
} from "../../source-control-types";

interface UsePullRequestsOptions {
  readonly api: NonNullable<typeof window.piApp>;
  readonly workspaceId?: string;
  readonly sessionId?: string;
}

export function usePullRequests({ api, workspaceId, sessionId }: UsePullRequestsOptions) {
  const [snapshot, setSnapshot] = useState<SourceControlSnapshot>();
  const [detail, setDetail] = useState<PullRequestDetail>();
  const [link, setLink] = useState<TaskPullRequestLink>();
  const [selectedNumber, setSelectedNumber] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<{ mutation: SourceControlMutation; details: SourceControlMutationPreview }>();

  const refresh = useCallback(async (force = false) => {
    if (!workspaceId) return;
    setLoading(true);
    setError(undefined);
    try {
      const next = await api.getSourceControlSnapshot(workspaceId, force);
      setSnapshot(next);
      setSelectedNumber((current) => current ?? next.currentPullRequest?.number ?? next.openPullRequests[0]?.number);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [api, workspaceId]);

  useEffect(() => {
    setSnapshot(undefined);
    setDetail(undefined);
    setSelectedNumber(undefined);
    setError(undefined);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let active = true;
    if (!workspaceId || !sessionId) {
      setLink(undefined);
      return () => { active = false; };
    }
    void api.getTaskPullRequestLink(workspaceId, sessionId).then((next) => {
      if (active) {
        setLink(next);
        if (next?.pullRequestNumber) setSelectedNumber(next.pullRequestNumber);
      }
    }).catch(() => {
      if (active) setLink(undefined);
    });
    return () => { active = false; };
  }, [api, sessionId, workspaceId]);

  useEffect(() => {
    let active = true;
    setDetail(undefined);
    if (!workspaceId || !selectedNumber || snapshot?.auth.state !== "ready") return () => { active = false; };
    setDetailLoading(true);
    void api.getPullRequestDetail(workspaceId, selectedNumber).then((next) => {
      if (active) setDetail(next);
    }).catch((cause) => {
      if (active) setError(errorMessage(cause));
    }).finally(() => {
      if (active) setDetailLoading(false);
    });
    return () => { active = false; };
  }, [api, selectedNumber, snapshot?.auth.state, workspaceId]);

  const requestMutation = useCallback(async (mutation: SourceControlMutation) => {
    setError(undefined);
    try {
      setPreview({ mutation, details: await api.previewSourceControlMutation(mutation) });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [api]);

  const confirmMutation = useCallback(async () => {
    if (!workspaceId || !preview) return;
    setPending(true);
    setError(undefined);
    try {
      const result = await api.runSourceControlMutation(workspaceId, preview.mutation);
      setPreview(undefined);
      if (result.pullRequestNumber) setSelectedNumber(result.pullRequestNumber);
      await refresh(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }, [api, preview, refresh, workspaceId]);

  const toggleLink = useCallback(async () => {
    if (!workspaceId || !sessionId || !selectedNumber) return;
    setPending(true);
    setError(undefined);
    try {
      if (link?.pullRequestNumber === selectedNumber) {
        await api.unlinkTaskPullRequest(workspaceId, sessionId);
        setLink(undefined);
      } else {
        setLink(await api.linkTaskPullRequest(workspaceId, sessionId, selectedNumber));
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }, [api, link?.pullRequestNumber, selectedNumber, sessionId, workspaceId]);

  return {
    confirmMutation,
    detail,
    detailLoading,
    error,
    link,
    loading,
    pending,
    preview,
    refresh,
    requestMutation,
    selectedNumber,
    setPreview,
    setSelectedNumber,
    snapshot,
    toggleLink,
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
