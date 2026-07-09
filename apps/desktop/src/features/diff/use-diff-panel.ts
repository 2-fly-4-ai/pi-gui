import { useCallback, useState, type RefObject } from "react";

interface DiffPanelFileRequest {
  readonly path: string;
  readonly nonce: number;
}

interface UseDiffPanelOptions {
  readonly preserveTimelineBottomForLayoutChangeRef: RefObject<(delayFrames?: number) => void>;
}

export function useDiffPanel({ preserveTimelineBottomForLayoutChangeRef }: UseDiffPanelOptions) {
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const [diffFileRequest, setDiffFileRequest] = useState<DiffPanelFileRequest | null>(null);

  const handleViewFileInDiff = useCallback((path: string) => {
    setShowDiffPanel(true);
    setDiffFileRequest({ path, nonce: Date.now() });
  }, []);

  const toggleDiffPanel = useCallback(() => {
    preserveTimelineBottomForLayoutChangeRef.current(3);
    setShowDiffPanel((prev) => !prev);
  }, [preserveTimelineBottomForLayoutChangeRef]);

  return {
    diffFileRequest,
    handleViewFileInDiff,
    showDiffPanel,
    toggleDiffPanel,
  };
}
