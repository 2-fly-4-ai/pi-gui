import type { ComponentProps } from "react";
import { DisplayModeView } from "../../display-mode-view";
import type { AppView, WorkspaceRecord } from "../../desktop-state";
import { NewThreadSurface } from "../new-thread/new-thread-surface";
import { ThreadSurface } from "../thread/thread-surface";

type DisplayModeViewProps = ComponentProps<typeof DisplayModeView>;
type NewThreadSurfaceProps = ComponentProps<typeof NewThreadSurface>;
type ThreadSurfaceProps = ComponentProps<typeof ThreadSurface>;

interface PrimaryContentSurfaceProps {
  readonly activeView: AppView;
  readonly displayModeProps: DisplayModeViewProps;
  readonly newThreadProps: NewThreadSurfaceProps;
  readonly selectedWorkspace?: WorkspaceRecord;
  readonly threadProps?: ThreadSurfaceProps;
  readonly onOpenNewThread: (workspaceId?: string) => void;
}

export function PrimaryContentSurface({
  activeView,
  displayModeProps,
  newThreadProps,
  selectedWorkspace,
  threadProps,
  onOpenNewThread,
}: PrimaryContentSurfaceProps) {
  if (activeView === "display-mode") {
    return <DisplayModeView {...displayModeProps} />;
  }

  if (activeView === "new-thread") {
    return <NewThreadSurface {...newThreadProps} />;
  }

  if (threadProps) {
    return <ThreadSurface {...threadProps} />;
  }

  if (selectedWorkspace) {
    return (
      <section className="canvas canvas--empty">
        <div className="empty-panel">
          <div className="session-header__eyebrow">Workspace</div>
          <h1>{selectedWorkspace.name}</h1>
          <p>Create a thread for this folder, then jump between sessions from the sidebar.</p>
          <div className="empty-panel__actions">
            <button
              className="button button--primary"
              type="button"
              onClick={() => onOpenNewThread(selectedWorkspace.rootWorkspaceId ?? selectedWorkspace.id)}
            >
              New thread
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="canvas canvas--empty">
      <div className="empty-panel">
        <div className="session-header__eyebrow">Workspace</div>
        <h1>Open a folder to start</h1>
        <p>Add project folders, group sessions under them, and jump between threads from the sidebar.</p>
      </div>
    </section>
  );
}
