import type { ReactNode } from "react";
import { ArrowUpIcon, PlusIcon, StopSquareIcon } from "./icons";

interface ComposerControlBarProps {
  readonly modelControl: ReactNode;
  readonly reasoningControl: ReactNode;
  readonly modeControl: ReactNode;
  readonly supervisionControl: ReactNode;
  readonly contextControl: ReactNode;
  readonly sendLabel: string;
  readonly sendDisabled: boolean;
  readonly stopMode: boolean;
  readonly onAttach: () => void;
  readonly onSubmit: () => void;
}

export function ComposerControlBar({
  modelControl,
  reasoningControl,
  modeControl,
  supervisionControl,
  contextControl,
  sendLabel,
  sendDisabled,
  stopMode,
  onAttach,
  onSubmit,
}: ComposerControlBarProps) {
  return (
    <div className="composer-control-bar">
      <div className="composer-control-bar__context">
        {contextControl}
      </div>
      <div className="composer-control-bar__left">
        {modelControl}
        <span aria-hidden="true" className="composer-control-bar__separator" />
        {reasoningControl}
        <span aria-hidden="true" className="composer-control-bar__separator" />
        {modeControl}
        <span aria-hidden="true" className="composer-control-bar__separator" />
        {supervisionControl}
      </div>
      <div className="composer-control-bar__right">
        <button aria-label="Attach files" className="icon-button composer__attach" type="button" onClick={onAttach}>
          <PlusIcon />
        </button>
        <button
          aria-label={sendLabel}
          className="button button--primary button--cta-icon"
          data-testid="send"
          type="button"
          disabled={sendDisabled}
          onClick={onSubmit}
        >
          {stopMode ? <StopSquareIcon /> : <ArrowUpIcon />}
        </button>
      </div>
    </div>
  );
}
