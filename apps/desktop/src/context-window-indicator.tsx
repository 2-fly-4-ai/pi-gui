import { useEffect, useRef, useState } from "react";

interface ContextWindowIndicatorProps {
  readonly percentUsed?: number;
  readonly tokensUsed?: number;
  readonly tokenLimit?: number;
  readonly compactionEnabled: boolean;
}

export function ContextWindowIndicator({
  percentUsed,
  tokensUsed,
  tokenLimit,
  compactionEnabled,
}: ContextWindowIndicatorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hasUsage = percentUsed !== undefined && tokensUsed !== undefined && tokenLimit !== undefined;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div className="context-window-indicator" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-label="Context window"
        className="context-window-indicator__button"
        data-testid="context-window-button"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        i
      </button>
      {open ? (
        <div className="context-window-indicator__popover" data-testid="context-window-popover" role="tooltip">
          <div className="context-window-indicator__title">CONTEXT WINDOW</div>
          <div className="context-window-indicator__usage">
            {hasUsage
              ? `${percentUsed.toFixed(1)}% · ${formatTokenCount(tokensUsed)}/${formatTokenCount(tokenLimit)} context used`
              : "Usage unavailable"}
          </div>
          <div className="context-window-indicator__body">
            {compactionEnabled
              ? "Automatically compacts its context when needed."
              : "Use /compact when the conversation gets long."}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatTokenCount(value: number): string {
  if (value >= 1000) {
    return `${Math.round(value / 1000)}k`;
  }
  return String(value);
}
