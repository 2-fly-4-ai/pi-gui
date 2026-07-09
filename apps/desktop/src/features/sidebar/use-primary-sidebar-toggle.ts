import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppView, DesktopAppState } from "../../desktop-state";

function canTogglePrimarySidebar(view: AppView | undefined): boolean {
  return view === "threads" || view === "new-thread" || view === "display-mode";
}

interface UsePrimarySidebarToggleOptions {
  readonly api: typeof window.piApp;
  readonly activeView: AppView | undefined;
  readonly sidebarCollapsed: boolean;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
}

export function usePrimarySidebarToggle({
  api,
  activeView,
  sidebarCollapsed,
  setSnapshot,
}: UsePrimarySidebarToggleOptions) {
  const primarySidebarToggleVisible = canTogglePrimarySidebar(activeView);
  const handleTogglePrimarySidebar = useCallback(() => {
    if (!api || !canTogglePrimarySidebar(activeView)) {
      return false;
    }

    const nextCollapsed = !sidebarCollapsed;
    setSnapshot((current) => current ? { ...current, sidebarCollapsed: nextCollapsed } : current);
    void api.setSidebarCollapsed(nextCollapsed);
    return true;
  }, [activeView, api, setSnapshot, sidebarCollapsed]);

  return {
    handleTogglePrimarySidebar,
    primarySidebarToggleVisible,
  };
}
