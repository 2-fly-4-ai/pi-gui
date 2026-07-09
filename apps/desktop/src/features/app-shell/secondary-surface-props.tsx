import type { ReactNode } from "react";
import type { AppView } from "../../desktop-state";
import type { ActiveSecondarySurfaceProps } from "../secondary-surfaces/secondary-surfaces";

interface CreateSecondarySurfacePropsOptions {
  readonly activeView: AppView;
  readonly commandPalette: ReactNode;
  readonly settings: ActiveSecondarySurfaceProps["settings"];
  readonly review: ActiveSecondarySurfaceProps["review"];
  readonly skills: ActiveSecondarySurfaceProps["skills"];
  readonly extensions: ActiveSecondarySurfaceProps["extensions"];
}

export function createSecondarySurfaceProps({
  activeView,
  commandPalette,
  settings,
  review,
  skills,
  extensions,
}: CreateSecondarySurfacePropsOptions): ActiveSecondarySurfaceProps {
  return {
    activeView,
    commandPalette,
    settings,
    review,
    skills,
    extensions,
  };
}

export function isSecondarySurfaceActive(activeView: AppView): boolean {
  return activeView === "settings" || activeView === "review" || activeView === "skills" || activeView === "extensions";
}
