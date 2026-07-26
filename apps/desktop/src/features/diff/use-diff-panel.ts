import { useCallback, useEffect, useState, type RefObject } from "react";
import { readWorkspacePanelLayout, updateWorkspacePanelLayout } from "../../product-experience/workspace-layout";

interface DiffPanelFileRequest {
  readonly path: string;
  readonly nonce: number;
}

interface UseDiffPanelOptions {
  readonly preserveTimelineBottomForLayoutChangeRef: RefObject<(delayFrames?: number) => void>;
  readonly workspaceId: string;
}

export function useDiffPanel({ preserveTimelineBottomForLayoutChangeRef, workspaceId }: UseDiffPanelOptions) {
  const [showDiffPanel, setShowDiffPanel] = useState(() => readWorkspacePanelLayout(workspaceId).changesOpen);
  const [diffFileRequest, setDiffFileRequest] = useState<DiffPanelFileRequest | null>(null);

  useEffect(() => {
    setShowDiffPanel(readWorkspacePanelLayout(workspaceId).changesOpen);
  }, [workspaceId]);

  const handleViewFileInDiff = useCallback((path: string) => {
    setShowDiffPanel(true);
    updateWorkspacePanelLayout(workspaceId, { changesOpen: true });
    setDiffFileRequest({ path, nonce: Date.now() });
  }, [workspaceId]);

  const toggleDiffPanel = useCallback(() => {
    preserveTimelineBottomForLayoutChangeRef.current(3);
    setShowDiffPanel((prev) => {
      const next = !prev;
      updateWorkspacePanelLayout(workspaceId, { changesOpen: next });
      return next;
    });
  }, [preserveTimelineBottomForLayoutChangeRef, workspaceId]);
  const resetDiffPanel = useCallback(() => {
    setShowDiffPanel(false);
    updateWorkspacePanelLayout(workspaceId, { changesOpen: false });
  }, [workspaceId]);

  return {
    diffFileRequest,
    handleViewFileInDiff,
    showDiffPanel,
    resetDiffPanel,
    toggleDiffPanel,
  };
}
