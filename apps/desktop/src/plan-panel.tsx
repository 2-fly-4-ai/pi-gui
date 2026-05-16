import { MessageMarkdown } from "./message-markdown";
import type { DetectedPlan } from "./plan-panel-model";
import { CloseIcon, CopyIcon } from "./icons";

interface PlanPanelProps {
  readonly plan: DetectedPlan;
  readonly onClose: () => void;
  readonly onImplement: () => void;
}

export function PlanPanel({ plan, onClose, onImplement }: PlanPanelProps) {
  const copyPlan = () => {
    void navigator.clipboard.writeText(plan.markdown);
  };

  return (
    <aside className="plan-panel" data-testid="plan-panel" aria-label="Plan panel">
      <div className="plan-panel__header">
        <div>
          <div className="plan-panel__eyebrow">Plan</div>
          <div className="plan-panel__title">
            <MessageMarkdown text={plan.title} />
          </div>
        </div>
        <button className="icon-button" type="button" aria-label="Close plan" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="plan-panel__actions">
        <button className="button button--secondary" type="button" onClick={copyPlan}>
          <CopyIcon />
          Copy plan
        </button>
        <button className="button button--primary" type="button" onClick={onImplement}>
          Ask pi to implement this plan
        </button>
      </div>
      <div className="plan-panel__body">
        <MessageMarkdown text={plan.markdown} />
      </div>
    </aside>
  );
}
