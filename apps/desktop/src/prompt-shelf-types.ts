import type { ComposerAttachment, WorkspaceSessionTarget } from "./desktop-state";

export interface PromptShelfEntrySummary {
  readonly id: string;
  readonly label?: string;
  readonly preview: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly textBytes: number;
  readonly attachmentCount: number;
  readonly source?: WorkspaceSessionTarget;
}

export interface StashPromptInput {
  readonly text: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly label?: string;
  readonly source?: WorkspaceSessionTarget;
}

export interface PromptShelfRestorePreview {
  readonly entry: PromptShelfEntrySummary;
  readonly text: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly missingAttachments: readonly string[];
}
