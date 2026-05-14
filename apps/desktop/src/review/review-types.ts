export type ReviewLineKind = "added" | "removed" | "context" | "header";

export interface ReviewSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly source: ReviewSnapshotSource;
  readonly files: readonly ReviewFileSnapshot[];
}

export interface ReviewSnapshotSource {
  readonly kind: "working-tree" | "base";
  readonly base?: string;
}

export interface ReviewFileSnapshot {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly diff: string;
  readonly anchors: readonly ReviewAnchor[];
}

export interface ReviewAnchor {
  readonly id: string;
  readonly filePath: string;
  readonly kind: "file" | "line";
  readonly lineKind?: ReviewLineKind;
  readonly oldLineNumber?: number;
  readonly newLineNumber?: number;
}

export interface ReviewDisplayLine {
  readonly anchorId: string;
  readonly kind: ReviewLineKind;
  readonly content: string;
  readonly oldLineNumber?: number;
  readonly newLineNumber?: number;
}

export interface ReviewDraftComment {
  readonly id: string;
  readonly anchorId: string;
  readonly filePath: string;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source?: "user";
}

export interface CreateReviewSnapshotOptions {
  readonly base?: string;
}
