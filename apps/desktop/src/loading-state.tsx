interface LoadingStateProps {
  readonly label: string;
  readonly detail?: string;
  readonly compact?: boolean;
  readonly className?: string;
  readonly testId?: string;
}

export function LoadingState({
  label,
  detail,
  compact = false,
  className,
  testId,
}: LoadingStateProps) {
  return (
    <div
      aria-live="polite"
      className={[
        "loading-state",
        compact ? "loading-state--compact" : "",
        className ?? "",
      ].filter(Boolean).join(" ")}
      data-testid={testId}
      role="status"
    >
      <span className="loading-state__mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="loading-state__copy">
        <strong>{label}</strong>
        {detail ? <span>{detail}</span> : null}
      </span>
    </div>
  );
}
