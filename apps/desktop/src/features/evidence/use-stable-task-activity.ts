import { useEffect, useState } from "react";
import type { SessionRecord } from "../../desktop-state";
import type { TaskEvidencePresentation } from "./task-evidence-presentation";

const ACTIVITY_CHANGE_DEBOUNCE_MS = 140;

export function useStableTaskActivity(
  activity: TaskEvidencePresentation["activity"],
  sessionStatus: SessionRecord["status"],
): TaskEvidencePresentation["activity"] {
  const [stable, setStable] = useState(activity);

  useEffect(() => {
    if (sessionStatus !== "running" || activity?.tone === "blocked") {
      if (!sameActivity(stable, activity)) setStable(activity);
      return;
    }
    if (!stable || !activity) {
      setStable(activity);
      return;
    }
    if (sameActivity(stable, activity)) return;
    const timer = window.setTimeout(() => setStable(activity), ACTIVITY_CHANGE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [activity, sessionStatus, stable]);

  return stable;
}

function sameActivity(
  left: TaskEvidencePresentation["activity"],
  right: TaskEvidencePresentation["activity"],
): boolean {
  return (
    left?.label === right?.label
    && left?.detail === right?.detail
    && left?.tone === right?.tone
    && left?.evidenceId === right?.evidenceId
    && left?.toolCallId === right?.toolCallId
  );
}
