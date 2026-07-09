import type { FirstRunOnboardingGuide, ModelOnboardingNotice } from "./model-onboarding";

interface ModelOnboardingNoticeBannerProps {
  readonly notice: ModelOnboardingNotice | undefined;
  readonly onOpenSettings: (section: ModelOnboardingNotice["actionSection"]) => void;
}

export function ModelOnboardingNoticeBanner({
  notice,
  onOpenSettings,
}: ModelOnboardingNoticeBannerProps) {
  if (!notice) {
    return null;
  }

  return (
    <div className="model-onboarding-notice" data-testid="model-onboarding-notice">
      <div className="model-onboarding-notice__body">
        <span className="model-onboarding-notice__title">{notice.title}</span>
        <span className="model-onboarding-notice__description">{notice.description}</span>
      </div>
      <button
        className="model-onboarding-notice__action"
        type="button"
        onClick={() => onOpenSettings(notice.actionSection)}
      >
        {notice.actionLabel}
      </button>
    </div>
  );
}

interface FirstRunOnboardingCardProps {
  readonly guide: FirstRunOnboardingGuide | undefined;
  readonly onOpenSettings: (section: FirstRunOnboardingGuide["actionSection"]) => void;
  readonly onUsePrompt: (prompt: string) => void;
}

export function FirstRunOnboardingCard({
  guide,
  onOpenSettings,
  onUsePrompt,
}: FirstRunOnboardingCardProps) {
  if (!guide) {
    return null;
  }

  return (
    <div className="first-run-onboarding" data-testid="first-run-onboarding">
      <div className="first-run-onboarding__body">
        <span className="first-run-onboarding__title">{guide.title}</span>
        <span className="first-run-onboarding__description">{guide.description}</span>
      </div>
      <div className="first-run-onboarding__actions">
        <button
          className="first-run-onboarding__action"
          type="button"
          onClick={() => onOpenSettings(guide.actionSection)}
        >
          {guide.actionLabel}
        </button>
        <button
          className="first-run-onboarding__action first-run-onboarding__action--secondary"
          type="button"
          onClick={() => onUsePrompt(guide.prompt)}
        >
          {guide.promptLabel}
        </button>
      </div>
    </div>
  );
}
