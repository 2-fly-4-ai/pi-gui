import { useCallback, useEffect, useState } from "react";
import type { AppView, DesktopAppState } from "../../desktop-state";
import type { ReviewSnapshot } from "../../review/review-types";

interface UseReviewSurfaceOptions {
  readonly api: typeof window.piApp;
  readonly activeView: AppView | undefined;
  readonly reviewRequest: DesktopAppState["reviewRequest"] | undefined;
  readonly selectedWorkspaceId: string | undefined;
  readonly selectedSessionId: string | undefined;
}

export function useReviewSurface({
  api,
  activeView,
  reviewRequest,
  selectedWorkspaceId,
  selectedSessionId,
}: UseReviewSurfaceOptions) {
  const [reviewSnapshot, setReviewSnapshot] = useState<ReviewSnapshot | undefined>();
  const [reviewLoading, setReviewLoading] = useState(false);

  const resetReviewSurface = useCallback(() => {
    setReviewSnapshot(undefined);
  }, []);

  useEffect(() => {
    if (!api || activeView !== "review" || !selectedWorkspaceId) {
      return;
    }

    let cancelled = false;
    setReviewLoading(true);
    setReviewSnapshot(undefined);
    void api.createReviewSnapshot(selectedWorkspaceId, reviewRequest)
      .then((next) => {
        if (cancelled) {
          return;
        }

        setReviewSnapshot(next);
        setReviewLoading(false);

        if (!reviewRequest?.agent || !selectedSessionId) {
          return;
        }

        void api.runReviewAgentPreReview(selectedWorkspaceId, selectedSessionId, next)
          .then((agentComments) => {
            if (!cancelled) {
              setReviewSnapshot((current) => current?.id === next.id ? { ...current, agentComments } : current);
            }
          });
      })
      .finally(() => {
        if (!cancelled) {
          setReviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeView, api, reviewRequest, selectedSessionId, selectedWorkspaceId]);

  return {
    resetReviewSurface,
    reviewLoading,
    reviewSnapshot,
  };
}
