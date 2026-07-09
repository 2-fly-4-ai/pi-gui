import { useCallback, useEffect, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { TranscriptMessage } from "../../desktop-state";
import { buildImplementPlanPrompt, detectLatestPlan } from "../../plan-panel-model";

interface UsePlanPanelOptions {
  readonly activeView: string | undefined;
  readonly hasSelectedThread: boolean;
  readonly rawTranscript: readonly TranscriptMessage[];
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly setComposerDraft: Dispatch<SetStateAction<string>>;
}

export function usePlanPanel({
  activeView,
  hasSelectedThread,
  rawTranscript,
  composerRef,
  setComposerDraft,
}: UsePlanPanelOptions) {
  const [planPanelOpen, setPlanPanelOpen] = useState(false);
  const latestPlan = useMemo(() => detectLatestPlan(rawTranscript), [rawTranscript]);
  const planSurfaceAvailable = activeView === "threads" && hasSelectedThread && Boolean(latestPlan);

  useEffect(() => {
    if (!planSurfaceAvailable) {
      setPlanPanelOpen(false);
    }
  }, [planSurfaceAvailable]);

  const askPiToImplementLatestPlan = useCallback(() => {
    if (!latestPlan) return;
    setComposerDraft((current) => {
      const prompt = buildImplementPlanPrompt(latestPlan);
      return current.trim() ? `${current.trimEnd()}\n\n${prompt}` : prompt;
    });
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  }, [composerRef, latestPlan, setComposerDraft]);

  const closePlanPanel = useCallback(() => {
    setPlanPanelOpen(false);
  }, []);

  const togglePlanPanel = useCallback(() => {
    setPlanPanelOpen((open) => !open);
  }, []);

  return {
    askPiToImplementLatestPlan,
    closePlanPanel,
    latestPlan,
    planPanelOpen,
    planSurfaceAvailable,
    togglePlanPanel,
  };
}
