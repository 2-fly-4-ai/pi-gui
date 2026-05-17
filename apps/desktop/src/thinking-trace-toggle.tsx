import ninjaStarUrl from "./assets/ninja-star.svg";

interface ThinkingTraceToggleProps {
  readonly showThinking: boolean;
  readonly active?: boolean;
  readonly onToggle: () => void;
}

export function ThinkingTraceToggle({ showThinking, active = false, onToggle }: ThinkingTraceToggleProps) {
  return (
    <button
      aria-label={showThinking ? "Hide thinking" : "Show thinking"}
      aria-pressed={showThinking}
      className={`icon-button thinking-trace-toggle${showThinking ? " icon-button--active thinking-trace-toggle--active" : ""}${active ? " thinking-trace-toggle--spinning" : ""}`}
      data-testid="thinking-trace-toggle"
      title={showThinking ? "Hide thinking" : "Show thinking"}
      type="button"
      onClick={onToggle}
    >
      <img src={ninjaStarUrl} alt="" aria-hidden="true" />
    </button>
  );
}
