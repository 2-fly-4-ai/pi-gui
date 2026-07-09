import { useCallback, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import {
  findSubmittedSkillPath,
  loadSkillUsage,
  recordSkillUse,
  saveSkillUsage,
  type SkillUsageByPath,
} from "../../skill-usage";

export function useSkillUsageTracking() {
  const [skillUsageByPath, setSkillUsageByPath] = useState<SkillUsageByPath>(() => loadSkillUsage());

  const recordSubmittedSkillUsage = useCallback((text: string, runtime: RuntimeSnapshot | undefined) => {
    const skillPath = findSubmittedSkillPath(text, runtime);
    if (!skillPath) {
      return;
    }

    setSkillUsageByPath((current) => {
      const next = recordSkillUse(current, skillPath);
      saveSkillUsage(next);
      return next;
    });
  }, []);

  return {
    recordSubmittedSkillUsage,
    skillUsageByPath,
  };
}
