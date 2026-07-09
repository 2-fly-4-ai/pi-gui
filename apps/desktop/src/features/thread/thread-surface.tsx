import type { ComponentProps } from "react";
import { ComposerPanel } from "../../composer-panel";
import { ConversationTimeline } from "../../conversation-timeline";
import { CommitDialog, CreatePrDialog, PushDialog, isSetUpstreamError } from "../../git-action-dialogs";
import { ExtensionDialog } from "../../extension-session-ui";
import { PlanPanel } from "../../plan-panel";
import { TreeModal } from "../../tree-modal";

type ComposerPanelProps = ComponentProps<typeof ComposerPanel>;
type ConversationTimelineProps = ComponentProps<typeof ConversationTimeline>;
type CommitDialogProps = ComponentProps<typeof CommitDialog>;
type CreatePrDialogProps = ComponentProps<typeof CreatePrDialog>;
type PushDialogProps = ComponentProps<typeof PushDialog>;
type ExtensionDialogProps = ComponentProps<typeof ExtensionDialog>;
type TreeModalProps = ComponentProps<typeof TreeModal>;
type PlanPanelProps = ComponentProps<typeof PlanPanel>;

interface ThreadGitDialogs {
  readonly kind?: "commit" | "push" | "pr";
  readonly commitProps: Omit<CommitDialogProps, "onClose" | "onSubmit">;
  readonly pushProps: Omit<PushDialogProps, "allowSetUpstream" | "onClose" | "onSubmit">;
  readonly prProps: Omit<CreatePrDialogProps, "onClose" | "onSubmit">;
  readonly setUpstreamError?: string;
  readonly onClose: () => void;
  readonly onCommit: CommitDialogProps["onSubmit"];
  readonly onPush: PushDialogProps["onSubmit"];
  readonly onCreatePr: CreatePrDialogProps["onSubmit"];
}

export interface ThreadSurfaceProps {
  readonly timelineProps: ConversationTimelineProps;
  readonly composerKey: string;
  readonly composerProps: ComposerPanelProps;
  readonly extensionDialog?: ExtensionDialogProps["dialog"];
  readonly onRespondToExtensionDialog: ExtensionDialogProps["onRespond"];
  readonly gitDialogs: ThreadGitDialogs;
  readonly treeModal?: TreeModalProps;
  readonly planPanel?: PlanPanelProps;
}

export function ThreadSurface({
  timelineProps,
  composerKey,
  composerProps,
  extensionDialog,
  onRespondToExtensionDialog,
  gitDialogs,
  treeModal,
  planPanel,
}: ThreadSurfaceProps) {
  return (
    <>
      <section className="canvas canvas--thread">
        <div className="conversation conversation--thread">
          <ConversationTimeline {...timelineProps} />
        </div>
      </section>
      <ComposerPanel key={composerKey} {...composerProps} />
      {extensionDialog ? (
        <ExtensionDialog dialog={extensionDialog} onRespond={onRespondToExtensionDialog} />
      ) : null}
      {gitDialogs.kind === "commit" ? (
        <CommitDialog
          {...gitDialogs.commitProps}
          onClose={gitDialogs.onClose}
          onSubmit={gitDialogs.onCommit}
        />
      ) : null}
      {gitDialogs.kind === "push" ? (
        <PushDialog
          {...gitDialogs.pushProps}
          allowSetUpstream={isSetUpstreamError(gitDialogs.setUpstreamError)}
          onClose={gitDialogs.onClose}
          onSubmit={gitDialogs.onPush}
        />
      ) : null}
      {gitDialogs.kind === "pr" ? (
        <CreatePrDialog
          {...gitDialogs.prProps}
          onClose={gitDialogs.onClose}
          onSubmit={gitDialogs.onCreatePr}
        />
      ) : null}
      {treeModal ? <TreeModal {...treeModal} /> : null}
      {planPanel ? <PlanPanel {...planPanel} /> : null}
    </>
  );
}
