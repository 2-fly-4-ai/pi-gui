import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

interface ContextWindowIndicatorProps {
  readonly percentUsed?: number;
  readonly tokensUsed?: number;
  readonly tokenLimit?: number;
  readonly codexUsageStatus?: string;
  readonly compactionEnabled: boolean;
}

export function ContextWindowIndicator({
  percentUsed,
  tokensUsed,
  tokenLimit,
  codexUsageStatus,
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
        aria-label={codexUsageStatus ? "Context window and Codex usage" : "Context window"}
        className={`context-window-indicator__button${codexUsageStatus ? " context-window-indicator__button--usage-available" : ""}`}
        data-testid="context-window-button"
        title="Context window"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <Info aria-hidden="true" strokeWidth={1.8} />
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
          {codexUsageStatus ? (
            <div className="context-window-indicator__quota" data-testid="codex-usage-status">
              <div className="context-window-indicator__title">CODEX PLAN LIMITS</div>
              <div className="context-window-indicator__quota-value">{codexUsageStatus}</div>
              <div className="context-window-indicator__body">
                ChatGPT subscription quota · refreshes every 30 seconds.
              </div>
            </div>
          ) : null}
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
