export type SourceControlAuthState =
  | "ready"
  | "missing-cli"
  | "unauthenticated"
  | "not-repository"
  | "unsupported-remote"
  | "error";

export type PullRequestState = "OPEN" | "CLOSED" | "MERGED";
export type PullRequestReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
export type PullRequestCheckState = "SUCCESS" | "FAILURE" | "PENDING" | "NEUTRAL" | "SKIPPED" | "CANCELLED" | "UNKNOWN";

export interface SourceControlRepository {
  readonly provider: "github";
  readonly host: string;
  readonly owner: string;
  readonly name: string;
  readonly webUrl: string;
}

export interface PullRequestAuthor {
  readonly login: string;
  readonly name?: string;
  readonly avatarUrl?: string;
}

export interface PullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly updatedAt: string;
  readonly author?: PullRequestAuthor;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly reviewDecision?: string;
  readonly checksSummary: {
    readonly total: number;
    readonly success: number;
    readonly failure: number;
    readonly pending: number;
  };
}

export interface PullRequestCheck {
  readonly id: string;
  readonly name: string;
  readonly state: PullRequestCheckState;
  readonly workflow?: string;
  readonly url?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface PullRequestReview {
  readonly id: string;
  readonly author?: PullRequestAuthor;
  readonly state: PullRequestReviewState;
  readonly body: string;
  readonly submittedAt?: string;
}

export interface PullRequestComment {
  readonly id: string;
  readonly author?: PullRequestAuthor;
  readonly body: string;
  readonly createdAt: string;
  readonly url?: string;
}

export interface PullRequestFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface PullRequestCommit {
  readonly oid: string;
  readonly messageHeadline: string;
  readonly authoredDate: string;
  readonly authors: readonly PullRequestAuthor[];
}

export interface PullRequestDetail extends PullRequestSummary {
  readonly body: string;
  readonly createdAt: string;
  readonly mergeable: string;
  readonly checks: readonly PullRequestCheck[];
  readonly reviews: readonly PullRequestReview[];
  readonly comments: readonly PullRequestComment[];
  readonly files: readonly PullRequestFile[];
  readonly commits: readonly PullRequestCommit[];
}

export interface SourceControlSnapshot {
  readonly workspaceId: string;
  readonly auth: {
    readonly state: SourceControlAuthState;
    readonly message: string;
  };
  readonly repository?: SourceControlRepository;
  readonly currentBranch?: string;
  readonly defaultBranch?: string;
  readonly viewerLogin?: string;
  readonly currentPullRequest?: PullRequestSummary;
  readonly openPullRequests: readonly PullRequestSummary[];
  readonly refreshedAt: string;
  readonly fromCache: boolean;
}

export type SourceControlMutation =
  | { readonly kind: "checkout"; readonly pullRequestNumber: number }
  | { readonly kind: "update-branch"; readonly pullRequestNumber: number }
  | { readonly kind: "comment"; readonly pullRequestNumber: number; readonly body: string }
  | { readonly kind: "edit-comment"; readonly pullRequestNumber: number; readonly commentId: string; readonly body: string }
  | { readonly kind: "edit"; readonly pullRequestNumber: number; readonly title: string; readonly body: string; readonly base: string }
  | { readonly kind: "create"; readonly title: string; readonly body: string; readonly base: string };

export interface SourceControlMutationPreview {
  readonly title: string;
  readonly summary: string;
  readonly commandDescription: string;
  readonly consequences: readonly string[];
  readonly requiresConfirmation: true;
}

export interface SourceControlMutationResult {
  readonly message: string;
  readonly url?: string;
  readonly pullRequestNumber?: number;
}

export interface TaskPullRequestLink {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly repository: Pick<SourceControlRepository, "host" | "owner" | "name">;
  readonly pullRequestNumber: number;
  readonly pullRequestUrl: string;
  readonly linkedAt: string;
  readonly lastObservedState: PullRequestState;
  readonly lastObservedAt: string;
}
