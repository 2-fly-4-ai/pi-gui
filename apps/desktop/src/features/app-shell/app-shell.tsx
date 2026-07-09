import type * as React from "react";
import type { ComponentProps, ReactNode, RefObject } from "react";
import { AddActionDialog } from "../../add-action-dialog";
import { Sidebar } from "../../sidebar";
import { SidebarToggleButton } from "../../sidebar-toggle-button";
import { Topbar } from "../../topbar";
import { PanelOverlays } from "../panels/panel-overlays";

type SidebarProps = ComponentProps<typeof Sidebar>;
type SidebarToggleButtonProps = ComponentProps<typeof SidebarToggleButton>;
type TopbarProps = ComponentProps<typeof Topbar>;
type PanelOverlaysProps = ComponentProps<typeof PanelOverlays>;
type AddActionDialogProps = ComponentProps<typeof AddActionDialog>;

interface AppShellProps {
  readonly addActionDialogOpen: boolean;
  readonly children: ReactNode;
  readonly commandPalette: ReactNode;
  readonly mainClassName: string;
  readonly mainRef: RefObject<HTMLElement | null>;
  readonly mainStyle: React.CSSProperties;
  readonly panelOverlaysProps: PanelOverlaysProps;
  readonly primarySidebarToggleVisible: boolean;
  readonly shellClassName: string;
  readonly showTerminalTakeover: boolean;
  readonly sidebarCollapsed: boolean;
  readonly sidebarProps: SidebarProps;
  readonly sidebarToggleProps: SidebarToggleButtonProps;
  readonly terminalPanel: ReactNode;
  readonly topbarProps: TopbarProps;
  readonly onCloseAddActionDialog: AddActionDialogProps["onClose"];
  readonly onSaveProjectAction: AddActionDialogProps["onSave"];
}

export function AppShell({
  addActionDialogOpen,
  children,
  commandPalette,
  mainClassName,
  mainRef,
  mainStyle,
  panelOverlaysProps,
  primarySidebarToggleVisible,
  shellClassName,
  showTerminalTakeover,
  sidebarCollapsed,
  sidebarProps,
  sidebarToggleProps,
  terminalPanel,
  topbarProps,
  onCloseAddActionDialog,
  onSaveProjectAction,
}: AppShellProps) {
  return (
    <div className={shellClassName}>
      {commandPalette}
      {primarySidebarToggleVisible ? <SidebarToggleButton {...sidebarToggleProps} /> : null}
      {!sidebarCollapsed ? <Sidebar {...sidebarProps} /> : null}

      <main ref={mainRef} className={mainClassName} style={mainStyle}>
        <Topbar {...topbarProps} />
        {showTerminalTakeover ? (
          terminalPanel
        ) : (
          <>
            {children}
            {terminalPanel}
          </>
        )}
        <PanelOverlays {...panelOverlaysProps} />
      </main>

      {addActionDialogOpen ? (
        <AddActionDialog
          onClose={onCloseAddActionDialog}
          onSave={onSaveProjectAction}
        />
      ) : null}
    </div>
  );
}
