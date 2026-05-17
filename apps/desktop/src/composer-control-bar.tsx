import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpIcon, EllipsisIcon, PlusIcon, StopSquareIcon } from "./icons";

const COMPACT_CONTROL_BAR_WIDTH = 640;

interface ComposerControlBarProps {
  readonly modelControl: ReactNode;
  readonly reasoningControl: ReactNode;
  readonly fastModeControl?: ReactNode;
  readonly skillProfileControl?: ReactNode;
  readonly modeControl: ReactNode;
  readonly supervisionControl: ReactNode;
  readonly contextControl: ReactNode;
  readonly thinkingTraceControl?: ReactNode;
  readonly sendLabel: string;
  readonly sendDisabled: boolean;
  readonly stopMode: boolean;
  readonly onAttach: () => void;
  readonly onSubmit: () => void;
}

export function ComposerControlBar({
  modelControl,
  reasoningControl,
  fastModeControl,
  skillProfileControl,
  modeControl,
  supervisionControl,
  contextControl,
  thinkingTraceControl,
  sendLabel,
  sendDisabled,
  stopMode,
  onAttach,
  onSubmit,
}: ComposerControlBarProps) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  const [isCompact, setIsCompact] = useState(false);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) {
      return undefined;
    }

    const updateLayout = () => {
      setIsCompact(bar.getBoundingClientRect().width < COMPACT_CONTROL_BAR_WIDTH);
    };

    updateLayout();

    const observer = new ResizeObserver(updateLayout);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isCompact) {
      setIsOverflowOpen(false);
    }
  }, [isCompact]);

  useEffect(() => {
    if (!isOverflowOpen) {
      return undefined;
    }

    const closeWhenClickingOutside = (event: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(event.target as Node)) {
        setIsOverflowOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOverflowOpen(false);
      }
    };

    document.addEventListener("mousedown", closeWhenClickingOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeWhenClickingOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOverflowOpen]);

  const sendButton = (
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
  );

  if (isCompact) {
    return (
      <div className="composer-control-bar composer-control-bar--compact" ref={barRef}>
        <div className="composer-control-bar__left composer-control-bar__left--compact">
          {modelControl}
        </div>
        <div className="composer-control-bar__right">
          <div className="composer-control-bar__overflow" ref={overflowRef}>
            <button
              aria-label="More composer controls"
              aria-expanded={isOverflowOpen}
              className="icon-button composer-control-bar__more"
              data-testid="composer-more-controls"
              type="button"
              onClick={() => setIsOverflowOpen((open) => !open)}
            >
              <EllipsisIcon />
            </button>
            {isOverflowOpen ? (
              <div className="composer-control-bar__overflow-menu" data-testid="composer-control-menu">
                <ComposerOverflowRow label="Reasoning">{reasoningControl}</ComposerOverflowRow>
                {fastModeControl ? <ComposerOverflowRow label="Fast Mode">{fastModeControl}</ComposerOverflowRow> : null}
                {skillProfileControl ? <ComposerOverflowRow label="Skills">{skillProfileControl}</ComposerOverflowRow> : null}
                <ComposerOverflowRow label="Mode">{modeControl}</ComposerOverflowRow>
                <ComposerOverflowRow label="Access">{supervisionControl}</ComposerOverflowRow>
                <div className="composer-control-bar__overflow-divider" />
                {thinkingTraceControl ? <ComposerOverflowRow label="Thinking">{thinkingTraceControl}</ComposerOverflowRow> : null}
                <ComposerOverflowRow label="Context">{contextControl}</ComposerOverflowRow>
                <button className="composer-control-bar__attach-row" type="button" onClick={onAttach}>
                  <span aria-hidden="true"><PlusIcon /></span>
                  <span>Attach files</span>
                </button>
              </div>
            ) : null}
          </div>
          {sendButton}
        </div>
      </div>
    );
  }

  return (
    <div className="composer-control-bar" ref={barRef}>
      <div className="composer-control-bar__left">
        {modelControl}
        <span aria-hidden="true" className="composer-control-bar__separator" />
        {reasoningControl}
        {fastModeControl ? (
          <>
            <span aria-hidden="true" className="composer-control-bar__separator" />
            {fastModeControl}
          </>
        ) : null}
        {skillProfileControl ? (
          <>
            <span aria-hidden="true" className="composer-control-bar__separator" />
            {skillProfileControl}
          </>
        ) : null}
        <span aria-hidden="true" className="composer-control-bar__separator" />
        {modeControl}
        <span aria-hidden="true" className="composer-control-bar__separator" />
        {supervisionControl}
      </div>
      <div className="composer-control-bar__right">
        {thinkingTraceControl}
        {contextControl}
        <button aria-label="Attach files" className="icon-button composer__attach" type="button" onClick={onAttach}>
          <PlusIcon />
        </button>
        {sendButton}
      </div>
    </div>
  );
}

function ComposerOverflowRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="composer-control-bar__overflow-row">
      <span className="composer-control-bar__overflow-label">{label}</span>
      <div className="composer-control-bar__overflow-control">{children}</div>
    </div>
  );
}
