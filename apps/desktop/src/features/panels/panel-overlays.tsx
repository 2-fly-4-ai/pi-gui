import type * as React from "react";
import { BrowserPanel } from "../../browser-panel";
import { DiffPanel } from "../../diff-panel";
import type { DiagnosticReportingPreferences, SessionRecord, WorkspaceRecord } from "../../desktop-state";
import { LogsPanel } from "../../logs-panel";
import { VSCodePanel } from "../../vscode-panel";
import type { PiDesktopApi } from "../../ipc";

interface PanelOverlaysProps {
  readonly api: NonNullable<PiDesktopApi>;
  readonly browserPanelWidth: number;
  readonly browserUrl?: string;
  readonly diagnosticReporting: DiagnosticReportingPreferences;
  readonly diffFileRequest: React.ComponentProps<typeof DiffPanel>["fileRequest"];
  readonly persistentVsCodeTarget: { readonly workspaceId: string; readonly folderPath: string } | null;
  readonly selectedSession?: SessionRecord;
  readonly selectedWorkspace?: WorkspaceRecord;
  readonly showDiffPanel: boolean;
  readonly showLogsPanel: boolean;
  readonly showPersistentVsCodePanel: boolean;
  readonly showThreadBrowserPanel: boolean;
  readonly showThreadVsCodePanel: boolean;
  readonly threadBrowserMaxWidth: number;
  readonly threadBrowserMinWidth: number;
  readonly threadVsCodeMaxWidth: number;
  readonly threadVsCodeMinWidth: number;
  readonly threadVsCodeTarget: { readonly workspaceId: string; readonly folderPath: string } | null;
  readonly threadVsCodeWidth: number;
  readonly vsCodePanelStyle: React.CSSProperties;
  readonly activeView: "threads" | "new-thread" | "display-mode" | "skills" | "extensions" | "settings" | "review";
  readonly onBrowserNavigate: (url: string) => void;
  readonly onBrowserClose: () => void;
  readonly onBrowserOpenExternal: (url: string) => void;
  readonly onLogsClose: () => void;
  readonly onThreadBrowserResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  readonly onThreadBrowserResizePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly onThreadVsCodeResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  readonly onThreadVsCodeResizePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly setVsCodeSlotElement: React.Dispatch<React.SetStateAction<HTMLElement | null>>;
}

export function PanelOverlays({
  api,
  browserPanelWidth,
  browserUrl,
  diagnosticReporting,
  diffFileRequest,
  persistentVsCodeTarget,
  selectedSession,
  selectedWorkspace,
  showDiffPanel,
  showLogsPanel,
  showPersistentVsCodePanel,
  showThreadBrowserPanel,
  showThreadVsCodePanel,
  threadBrowserMaxWidth,
  threadBrowserMinWidth,
  threadVsCodeMaxWidth,
  threadVsCodeMinWidth,
  threadVsCodeTarget,
  threadVsCodeWidth,
  vsCodePanelStyle,
  activeView,
  onBrowserNavigate,
  onBrowserClose,
  onBrowserOpenExternal,
  onLogsClose,
  onThreadBrowserResizeKeyDown,
  onThreadBrowserResizePointerDown,
  onThreadVsCodeResizeKeyDown,
  onThreadVsCodeResizePointerDown,
  setVsCodeSlotElement,
}: PanelOverlaysProps) {
  return (
    <>
      {showThreadVsCodePanel && threadVsCodeTarget ? (
        <>
          <div
            className="thread-vscode-resize-handle"
            role="separator"
            tabIndex={0}
            aria-label="Resize VS Code panel"
            aria-orientation="vertical"
            aria-valuemin={threadVsCodeMinWidth}
            aria-valuemax={threadVsCodeMaxWidth}
            aria-valuenow={threadVsCodeWidth}
            onKeyDown={onThreadVsCodeResizeKeyDown}
            onPointerDown={onThreadVsCodeResizePointerDown}
          />
          <div
            ref={setVsCodeSlotElement}
            className="thread-vscode-panel thread-vscode-panel--slot"
            aria-hidden="true"
          />
        </>
      ) : null}
      {showThreadBrowserPanel ? (
        <>
          <div
            className="thread-browser-resize-handle"
            role="separator"
            tabIndex={0}
            aria-label="Resize browser panel"
            aria-orientation="vertical"
            aria-valuemin={threadBrowserMinWidth}
            aria-valuemax={threadBrowserMaxWidth}
            aria-valuenow={browserPanelWidth}
            onKeyDown={onThreadBrowserResizeKeyDown}
            onPointerDown={onThreadBrowserResizePointerDown}
          />
          <BrowserPanel
            url={browserUrl}
            onNavigate={onBrowserNavigate}
            onClose={onBrowserClose}
            onOpenExternal={onBrowserOpenExternal}
            className="thread-browser-panel"
            testId="thread-browser-panel"
            style={{ "--thread-browser-width": `${browserPanelWidth}px` } as React.CSSProperties}
          />
        </>
      ) : null}
      {showPersistentVsCodePanel && !showThreadBrowserPanel && persistentVsCodeTarget ? (
        <VSCodePanel
          api={api}
          workspaceId={persistentVsCodeTarget.workspaceId}
          folderPath={persistentVsCodeTarget.folderPath}
          className="persistent-vscode-panel"
          testId={activeView === "display-mode" ? "display-mode-vscode-panel" : "thread-vscode-panel"}
          style={vsCodePanelStyle}
        />
      ) : null}
      {showDiffPanel && selectedWorkspace && selectedSession ? (
        <DiffPanel
          workspaceId={selectedWorkspace.id}
          sessionId={selectedSession.id}
          api={api}
          sessionStatus={selectedSession.status}
          fileRequest={diffFileRequest}
        />
      ) : null}
      {showLogsPanel ? (
        <LogsPanel
          api={api}
          diagnosticReporting={diagnosticReporting}
          selectedWorkspace={selectedWorkspace}
          selectedSession={selectedSession}
          onClose={onLogsClose}
        />
      ) : null}
    </>
  );
}
