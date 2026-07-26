import { useCallback, useEffect, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { TranscriptMessage } from "../../desktop-state";
import { buildImplementPlanPrompt, detectLatestPlan } from "../../plan-panel-model";
import { readWorkspacePanelLayout, updateWorkspacePanelLayout } from "../../product-experience/workspace-layout";

interface UsePlanPanelOptions {
  readonly activeView: string | undefined;
  readonly hasSelectedThread: boolean;
  readonly rawTranscript: readonly TranscriptMessage[];
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly setComposerDraft: Dispatch<SetStateAction<string>>;
  readonly workspaceId: string;
}

export function usePlanPanel({
  activeView,
  hasSelectedThread,
  rawTranscript,
  composerRef,
  setComposerDraft,
  workspaceId,
}: UsePlanPanelOptions) {
  const [planPanelOpen, setPlanPanelOpen] = useState(() => readWorkspacePanelLayout(workspaceId).planOpen);
  const latestPlan = useMemo(() => detectLatestPlan(rawTranscript), [rawTranscript]);
  const planSurfaceAvailable = activeView === "threads" && hasSelectedThread && Boolean(latestPlan);

  useEffect(() => {
    setPlanPanelOpen(planSurfaceAvailable && readWorkspacePanelLayout(workspaceId).planOpen);
  }, [planSurfaceAvailable, workspaceId]);

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
    updateWorkspacePanelLayout(workspaceId, { planOpen: false });
  }, [workspaceId]);

  const togglePlanPanel = useCallback(() => {
    setPlanPanelOpen((open) => {
      const next = !open;
      updateWorkspacePanelLayout(workspaceId, { planOpen: next });
      return next;
    });
  }, [workspaceId]);
  const resetPlanPanel = useCallback(() => {
    setPlanPanelOpen(false);
    updateWorkspacePanelLayout(workspaceId, { planOpen: false });
  }, [workspaceId]);

  return {
    askPiToImplementLatestPlan,
    closePlanPanel,
    latestPlan,
    planPanelOpen,
    planSurfaceAvailable,
    resetPlanPanel,
    togglePlanPanel,
  };
}
