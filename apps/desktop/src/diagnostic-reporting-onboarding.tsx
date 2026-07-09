import type { DiagnosticReportingPreferences } from "./desktop-state";

interface DiagnosticReportingOnboardingCardProps {
  readonly preferences: DiagnosticReportingPreferences;
  readonly onSetPreferences: (preferences: Partial<DiagnosticReportingPreferences>) => void;
}

export function DiagnosticReportingOnboardingCard({
  preferences,
  onSetPreferences,
}: DiagnosticReportingOnboardingCardProps) {
  if (preferences.onboardingDismissed) {
    return null;
  }

  const enableDiagnostics = () => {
    onSetPreferences({
      issueDraftsEnabled: true,
      nativeCrashReportsEnabled: true,
      onboardingDismissed: true,
    });
  };

  const dismiss = () => {
    onSetPreferences({
      onboardingDismissed: true,
    });
  };

  return (
    <div className="diagnostic-reporting-onboarding" data-testid="diagnostic-reporting-onboarding">
      <div className="diagnostic-reporting-onboarding__body">
        <span className="diagnostic-reporting-onboarding__title">Help make reports useful</span>
        <span className="diagnostic-reporting-onboarding__description">
          Keep diagnostics private by default. Enable redacted issue drafts and local crash artifacts only when you choose to report a problem. Nothing is sent automatically.
        </span>
      </div>
      <div className="diagnostic-reporting-onboarding__actions">
        <button
          className="diagnostic-reporting-onboarding__action"
          type="button"
          onClick={enableDiagnostics}
        >
          Enable diagnostics
        </button>
        <button
          className="diagnostic-reporting-onboarding__action diagnostic-reporting-onboarding__action--secondary"
          type="button"
          onClick={dismiss}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
