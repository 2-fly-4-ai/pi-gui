import type { SessionRecord, WorkspaceRecord } from "../../desktop-state";
import { TerminalPanel } from "../../terminal-panel";

export interface TerminalStackTarget {
  readonly key: string;
  readonly workspace: WorkspaceRecord;
  readonly session: SessionRecord;
}

interface TerminalStackProps {
  readonly targets: readonly TerminalStackTarget[];
  readonly visibleTarget: TerminalStackTarget;
  readonly visibleKey: string;
  readonly height: number;
  readonly isTakeover: boolean;
  readonly onSelectTarget: (key: string) => void;
  readonly onHeightChange: (height: number) => void;
  readonly onExitTakeover: (key: string) => void;
  readonly onToggleTakeover: (key: string) => void;
  readonly onClose: (key: string) => void;
  readonly onAddSelectionToComposer: (context: string) => void;
  readonly onOpenUrl: (url: string) => void;
}

export function TerminalStack({
  targets,
  visibleTarget,
  visibleKey,
  height,
  isTakeover,
  onSelectTarget,
  onHeightChange,
  onExitTakeover,
  onToggleTakeover,
  onClose,
  onAddSelectionToComposer,
  onOpenUrl,
}: TerminalStackProps) {
  return (
    <div className="terminal-stack">
      {targets.length > 1 ? (
        <div className="terminal-stack__tabs" role="tablist" aria-label="Open card terminals">
          {targets.map((target) => (
            <button
              className={`terminal-stack__tab${target.key === visibleKey ? " terminal-stack__tab--active" : ""}`}
              key={target.key}
              type="button"
              role="tab"
              aria-selected={target.key === visibleKey}
              data-testid="open-terminal-tab"
              onClick={() => onSelectTarget(target.key)}
            >
              {target.workspace.name} / {target.session.title}
            </button>
          ))}
        </div>
      ) : null}
      <TerminalPanel
        key={visibleTarget.key}
        workspace={visibleTarget.workspace}
        sessionId={visibleTarget.session.id}
        height={height}
        isTakeover={isTakeover}
        onAddSelectionToComposer={onAddSelectionToComposer}
        onOpenUrl={onOpenUrl}
        onHeightChange={(nextHeight) => {
          onHeightChange(nextHeight);
          onExitTakeover(visibleTarget.key);
        }}
        onToggleTakeover={() => onToggleTakeover(visibleTarget.key)}
        onHide={() => onClose(visibleTarget.key)}
      />
    </div>
  );
}
