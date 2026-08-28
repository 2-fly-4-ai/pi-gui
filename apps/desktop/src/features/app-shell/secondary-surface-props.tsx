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
  readonly pullRequests: ActiveSecondarySurfaceProps["pullRequests"];
  readonly usage: ActiveSecondarySurfaceProps["usage"];
  readonly projectActions: ActiveSecondarySurfaceProps["projectActions"];
  readonly promptShelf: ActiveSecondarySurfaceProps["promptShelf"];
}

export function createSecondarySurfaceProps({
  activeView,
  commandPalette,
  settings,
  review,
  skills,
  extensions,
  pullRequests,
  usage,
  projectActions,
  promptShelf,
}: CreateSecondarySurfacePropsOptions): ActiveSecondarySurfaceProps {
  return {
    activeView,
    commandPalette,
    settings,
    review,
    skills,
    extensions,
    pullRequests,
    usage,
    projectActions,
    promptShelf,
  };
}

export function isSecondarySurfaceActive(activeView: AppView): boolean {
  return activeView === "settings" || activeView === "review" || activeView === "skills" || activeView === "extensions" || activeView === "pull-requests" || activeView === "usage" || activeView === "project-actions" || activeView === "prompt-shelf";
}
