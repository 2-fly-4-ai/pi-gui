import { execFile } from "node:child_process";
import type {
  PullRequestAuthor,
  PullRequestCheck,
  PullRequestCheckState,
  PullRequestComment,
  PullRequestCommit,
  PullRequestDetail,
  PullRequestFile,
  PullRequestReview,
  PullRequestReviewState,
  PullRequestState,
  PullRequestSummary,
  SourceControlMutation,
  SourceControlMutationPreview,
  SourceControlMutationResult,
  SourceControlRepository,
  SourceControlSnapshot,
  TaskPullRequestLink,
} from "../src/source-control-types";
import { JsonFileStore } from "./json-file-store";

const COMMAND_TIMEOUT_MS = 20_000;
const MAX_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;
const CACHE_TTL_MS = 30_000;
const MAX_OPEN_PULL_REQUESTS = 50;
const MAX_DETAIL_ITEMS = 250;

const SUMMARY_FIELDS = [
  "number",
  "title",
  "url",
  "state",
  "isDraft",
  "headRefName",
  "baseRefName",
  "updatedAt",
  "author",
  "additions",
  "deletions",
  "changedFiles",
  "reviewDecision",
  "statusCheckRollup",
].join(",");

const DETAIL_FIELDS = [
  SUMMARY_FIELDS,
  "body",
  "createdAt",
  "mergeable",
  "reviews",
  "comments",
  "files",
  "commits",
].join(",");

interface CachedSnapshot {
  readonly expiresAt: number;
  readonly snapshot: SourceControlSnapshot;
}

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface SourceControlProvider {
  getSnapshot(workspaceId: string, forceRefresh?: boolean): Promise<SourceControlSnapshot>;
  getPullRequestDetail(workspaceId: string, pullRequestNumber: number): Promise<PullRequestDetail>;
  previewMutation(mutation: SourceControlMutation): SourceControlMutationPreview;
  runMutation(workspaceId: string, mutation: SourceControlMutation): Promise<SourceControlMutationResult>;
  invalidate(workspaceId: string): void;
  dispose(): void;
}

export class SourceControlService implements SourceControlProvider {
  private readonly cache = new Map<string, CachedSnapshot>();
  private readonly activeRefreshes = new Map<string, { readonly controller: AbortController; readonly promise: Promise<SourceControlSnapshot> }>();
  private readonly linkStore: JsonFileStore<TaskPullRequestLink>;

  constructor(
    userDataDir: string,
    private readonly workspacePath: (workspaceId: string) => string | undefined,
  ) {
    this.linkStore = new JsonFileStore<TaskPullRequestLink>(userDataDir, "task-pull-request-links");
  }

  async getSnapshot(workspaceId: string, forceRefresh = false): Promise<SourceControlSnapshot> {
    const cached = this.cache.get(workspaceId);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return { ...cached.snapshot, fromCache: true };
    }

    const activeRefresh = this.activeRefreshes.get(workspaceId);
    if (activeRefresh && !forceRefresh) return activeRefresh.promise;
    activeRefresh?.controller.abort();
    const controller = new AbortController();
    const promise = (async () => {
      const snapshot = await this.loadSnapshot(workspaceId, controller.signal);
      this.cache.set(workspaceId, { snapshot, expiresAt: Date.now() + CACHE_TTL_MS });
      return snapshot;
    })().finally(() => {
      if (this.activeRefreshes.get(workspaceId)?.controller === controller) {
        this.activeRefreshes.delete(workspaceId);
      }
    });
    this.activeRefreshes.set(workspaceId, { controller, promise });
    return promise;
  }

  async getPullRequestDetail(workspaceId: string, pullRequestNumber: number): Promise<PullRequestDetail> {
    const { cwd, repository } = await this.resolveReadyRepository(workspaceId);
    assertPullRequestNumber(pullRequestNumber);
    const result = await runBounded("gh", [
      "pr", "view", String(pullRequestNumber), "--repo", repositorySlug(repository), "--json", DETAIL_FIELDS,
    ], cwd);
    return parsePullRequestDetail(parseJsonRecord(result.stdout));
  }

  previewMutation(mutation: SourceControlMutation): SourceControlMutationPreview {
    switch (mutation.kind) {
      case "checkout":
        assertPullRequestNumber(mutation.pullRequestNumber);
        return {
          title: `Check out pull request #${mutation.pullRequestNumber}?`,
          summary: "Switch this workspace to the pull request branch.",
          commandDescription: `GitHub CLI checkout for pull request #${mutation.pullRequestNumber}`,
          consequences: ["The active branch and working-tree files can change.", "Uncommitted work may prevent checkout."],
          requiresConfirmation: true,
        };
      case "update-branch":
        assertPullRequestNumber(mutation.pullRequestNumber);
        return {
          title: `Update pull request #${mutation.pullRequestNumber}?`,
          summary: "Ask GitHub to merge the base branch into this pull request branch.",
          commandDescription: `GitHub pull request branch update for #${mutation.pullRequestNumber}`,
          consequences: ["This writes to the remote pull request branch.", "Checks may run again."],
          requiresConfirmation: true,
        };
      case "comment":
        validateText(mutation.body, "Comment", 65_536);
        return {
          title: `Post comment on #${mutation.pullRequestNumber}?`,
          summary: "Publish this comment to GitHub.",
          commandDescription: `GitHub comment on pull request #${mutation.pullRequestNumber}`,
          consequences: ["The comment becomes visible to repository collaborators."],
          requiresConfirmation: true,
        };
      case "edit-comment":
        assertPullRequestNumber(mutation.pullRequestNumber);
        validateIdentity(mutation.commentId, "Comment ID");
        validateText(mutation.body, "Comment", 65_536);
        return {
          title: `Edit your comment on #${mutation.pullRequestNumber}?`,
          summary: "Replace the selected GitHub comment with this text.",
          commandDescription: `Edit your GitHub comment on pull request #${mutation.pullRequestNumber}`,
          consequences: ["The existing public comment changes immediately on GitHub."],
          requiresConfirmation: true,
        };
      case "edit":
        validatePullRequestInput(mutation);
        return {
          title: `Update pull request #${mutation.pullRequestNumber}?`,
          summary: "Replace the pull request title, description, and base branch.",
          commandDescription: `GitHub pull request metadata update for #${mutation.pullRequestNumber}`,
          consequences: ["Existing pull request metadata changes immediately on GitHub."],
          requiresConfirmation: true,
        };
      case "create":
        validatePullRequestInput(mutation);
        return {
          title: "Create pull request?",
          summary: `Open a pull request into ${mutation.base.trim()}.`,
          commandDescription: "GitHub pull request creation",
          consequences: ["A new pull request becomes visible on GitHub.", "The current branch must already exist on the remote."],
          requiresConfirmation: true,
        };
    }
  }

  async runMutation(workspaceId: string, mutation: SourceControlMutation): Promise<SourceControlMutationResult> {
    this.previewMutation(mutation);
    const { cwd, repository, viewerLogin } = await this.resolveReadyRepository(workspaceId);
    const repo = repositorySlug(repository);
    let result: CommandResult;
    switch (mutation.kind) {
      case "checkout":
        result = await runBounded("gh", ["pr", "checkout", String(mutation.pullRequestNumber), "--repo", repo], cwd, 60_000);
        this.invalidate(workspaceId);
        return { message: commandMessage(result, `Checked out pull request #${mutation.pullRequestNumber}.`), pullRequestNumber: mutation.pullRequestNumber };
      case "update-branch":
        result = await runBounded("gh", ["pr", "update-branch", String(mutation.pullRequestNumber), "--repo", repo], cwd, 60_000);
        this.invalidate(workspaceId);
        return { message: commandMessage(result, `Updated pull request #${mutation.pullRequestNumber}.`), pullRequestNumber: mutation.pullRequestNumber };
      case "comment":
        result = await runBounded("gh", ["pr", "comment", String(mutation.pullRequestNumber), "--repo", repo, "--body", mutation.body.trim()], cwd);
        this.invalidate(workspaceId);
        return { message: commandMessage(result, `Commented on pull request #${mutation.pullRequestNumber}.`), pullRequestNumber: mutation.pullRequestNumber };
      case "edit-comment": {
        const detail = await this.getPullRequestDetail(workspaceId, mutation.pullRequestNumber);
        const existing = detail.comments.find((comment) => comment.id === mutation.commentId);
        if (!existing || !viewerLogin || existing.author?.login.toLowerCase() !== viewerLogin.toLowerCase()) throw new Error("Only a comment owned by the authenticated GitHub user can be edited.");
        result = await runBounded("gh", ["api", "graphql", "--hostname", repository.host, "-f", "query=mutation($id:ID!,$body:String!){updateIssueComment(input:{id:$id,body:$body}){issueComment{id}}}", "-F", `id=${mutation.commentId}`, "-f", `body=${mutation.body.trim()}`], cwd);
        this.invalidate(workspaceId);
        return { message: commandMessage(result, `Updated your comment on pull request #${mutation.pullRequestNumber}.`), pullRequestNumber: mutation.pullRequestNumber };
      }
      case "edit":
        {
          const detail = await this.getPullRequestDetail(workspaceId, mutation.pullRequestNumber);
          if (!viewerLogin || detail.author?.login.toLowerCase() !== viewerLogin.toLowerCase()) throw new Error("Only a pull request owned by the authenticated GitHub user can be edited.");
        }
        result = await runBounded("gh", [
          "pr", "edit", String(mutation.pullRequestNumber), "--repo", repo,
          "--title", mutation.title.trim(), "--body", mutation.body, "--base", mutation.base.trim(),
        ], cwd);
        this.invalidate(workspaceId);
        return { message: commandMessage(result, `Updated pull request #${mutation.pullRequestNumber}.`), pullRequestNumber: mutation.pullRequestNumber };
      case "create": {
        result = await runBounded("gh", [
          "pr", "create", "--repo", repo, "--title", mutation.title.trim(), "--body", mutation.body, "--base", mutation.base.trim(),
        ], cwd, 60_000);
        this.invalidate(workspaceId);
        const url = extractHttpsUrl(result.stdout);
        const pullRequestNumber = url ? Number.parseInt(url.split("/").at(-1) ?? "", 10) : undefined;
        return {
          message: commandMessage(result, "Created pull request."),
          url,
          pullRequestNumber: Number.isSafeInteger(pullRequestNumber) ? pullRequestNumber : undefined,
        };
      }
    }
  }

  async getTaskPullRequestLink(workspaceId: string, sessionId: string): Promise<TaskPullRequestLink | undefined> {
    const link = await this.linkStore.read(linkKey(workspaceId, sessionId));
    return link && link.pullRequestNumber > 0 ? link : undefined;
  }

  async linkTaskPullRequest(workspaceId: string, sessionId: string, pullRequestNumber: number): Promise<TaskPullRequestLink> {
    validateIdentity(sessionId, "Session ID");
    const detail = await this.getPullRequestDetail(workspaceId, pullRequestNumber);
    const snapshot = await this.getSnapshot(workspaceId);
    if (!snapshot.repository) throw new Error("GitHub repository is unavailable.");
    const link: TaskPullRequestLink = {
      workspaceId,
      sessionId,
      repository: {
        host: snapshot.repository.host,
        owner: snapshot.repository.owner,
        name: snapshot.repository.name,
      },
      pullRequestNumber,
      pullRequestUrl: detail.url,
      linkedAt: new Date().toISOString(),
      lastObservedState: detail.state,
      lastObservedAt: new Date().toISOString(),
    };
    await this.linkStore.write(linkKey(workspaceId, sessionId), link);
    return link;
  }

  async unlinkTaskPullRequest(workspaceId: string, sessionId: string): Promise<void> {
    validateIdentity(sessionId, "Session ID");
    // JsonFileStore intentionally has no delete primitive; persisting a zero-number
    // sentinel would complicate the renderer contract, so unlink stores an expired
    // shape and read filters it out through this narrow tombstone convention.
    await this.linkStore.write(linkKey(workspaceId, sessionId), {
      workspaceId,
      sessionId,
      repository: { host: "", owner: "", name: "" },
      pullRequestNumber: 0,
      pullRequestUrl: "",
      linkedAt: new Date(0).toISOString(),
      lastObservedState: "CLOSED",
      lastObservedAt: new Date(0).toISOString(),
    });
  }

  invalidate(workspaceId: string): void {
    this.cache.delete(workspaceId);
  }

  dispose(): void {
    for (const { controller } of this.activeRefreshes.values()) controller.abort();
    this.activeRefreshes.clear();
    this.cache.clear();
  }

  private async loadSnapshot(workspaceId: string, signal: AbortSignal): Promise<SourceControlSnapshot> {
    const cwd = this.workspacePath(workspaceId);
    const refreshedAt = new Date().toISOString();
    if (!cwd) return unavailableSnapshot(workspaceId, refreshedAt, "not-repository", "Workspace is unavailable.");

    let remote: string;
    try {
      remote = (await runBounded("git", ["remote", "get-url", "origin"], cwd, COMMAND_TIMEOUT_MS, signal)).stdout.trim();
    } catch (error) {
      return unavailableSnapshot(workspaceId, refreshedAt, "not-repository", friendlyError(error));
    }
    const repository = parseGitHubRemote(remote);
    if (!repository) {
      return unavailableSnapshot(workspaceId, refreshedAt, "unsupported-remote", "The origin remote is not a supported GitHub URL.");
    }

    try {
      await runBounded("gh", ["--version"], cwd, COMMAND_TIMEOUT_MS, signal);
    } catch (error) {
      if (isMissingCommandError(error)) {
        return { ...unavailableSnapshot(workspaceId, refreshedAt, "missing-cli", "GitHub CLI is not installed. Install `gh`, then choose Check again."), repository };
      }
      return { ...unavailableSnapshot(workspaceId, refreshedAt, "error", friendlyError(error)), repository };
    }
    try {
      await runBounded("gh", ["auth", "status", "--hostname", repository.host], cwd, COMMAND_TIMEOUT_MS, signal);
    } catch {
      return { ...unavailableSnapshot(workspaceId, refreshedAt, "unauthenticated", `Run \`gh auth login --hostname ${repository.host}\` in Terminal, then choose Check again.`), repository };
    }

    try {
      const repo = repositorySlug(repository);
      const [branchResult, repoResult, listResult, currentResult, viewerResult] = await Promise.all([
        runBounded("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd, COMMAND_TIMEOUT_MS, signal).catch(() => undefined),
        runBounded("gh", ["repo", "view", repo, "--json", "defaultBranchRef"], cwd, COMMAND_TIMEOUT_MS, signal),
        runBounded("gh", ["pr", "list", "--repo", repo, "--state", "open", "--limit", String(MAX_OPEN_PULL_REQUESTS), "--json", SUMMARY_FIELDS], cwd, COMMAND_TIMEOUT_MS, signal),
        runBounded("gh", ["pr", "view", "--repo", repo, "--json", SUMMARY_FIELDS], cwd, COMMAND_TIMEOUT_MS, signal).catch(() => undefined),
        runBounded("gh", ["api", "user", "--hostname", repository.host, "--jq", ".login"], cwd, COMMAND_TIMEOUT_MS, signal),
      ]);
      const repoMetadata = parseJsonRecord(repoResult.stdout);
      const openPullRequests = parseJsonArray(listResult.stdout).slice(0, MAX_OPEN_PULL_REQUESTS).map(parsePullRequestSummary);
      return {
        workspaceId,
        auth: { state: "ready", message: `Connected to ${repository.host}.` },
        repository,
        currentBranch: branchResult?.stdout.trim() && branchResult.stdout.trim() !== "HEAD" ? branchResult.stdout.trim() : undefined,
        defaultBranch: asRecord(repoMetadata.defaultBranchRef)?.name ? asString(asRecord(repoMetadata.defaultBranchRef)?.name) : undefined,
        viewerLogin: viewerResult.stdout.trim().slice(0, 200) || undefined,
        currentPullRequest: currentResult ? parsePullRequestSummary(parseJsonRecord(currentResult.stdout)) : undefined,
        openPullRequests,
        refreshedAt,
        fromCache: false,
      };
    } catch (error) {
      return {
        workspaceId,
        auth: { state: "error", message: friendlyError(error) },
        repository,
        openPullRequests: [],
        refreshedAt,
        fromCache: false,
      };
    }
  }

  private async resolveReadyRepository(workspaceId: string): Promise<{ cwd: string; repository: SourceControlRepository; viewerLogin?: string }> {
    const cwd = this.workspacePath(workspaceId);
    if (!cwd) throw new Error("Workspace is unavailable.");
    const snapshot = await this.getSnapshot(workspaceId);
    if (snapshot.auth.state !== "ready" || !snapshot.repository) throw new Error(snapshot.auth.message);
    return { cwd, repository: snapshot.repository, viewerLogin: snapshot.viewerLogin };
  }
}

export function parseGitHubRemote(remote: string): SourceControlRepository | undefined {
  const trimmed = remote.trim();
  let host = "";
  let pathname = "";
  const scp = /^(?:[^@\s]+@)?([^:/\s]+):([^\s]+)$/.exec(trimmed);
  if (scp && !trimmed.includes("://")) {
    host = scp[1] ?? "";
    pathname = scp[2] ?? "";
  } else {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:" && parsed.protocol !== "ssh:" && parsed.protocol !== "git:") return undefined;
      host = parsed.hostname;
      pathname = parsed.pathname.replace(/^\//, "");
    } catch {
      return undefined;
    }
  }
  const segments = pathname.replace(/\.git$/i, "").split("/").filter(Boolean);
  if (!host || segments.length !== 2 || !segments.every(isSafeRepoSegment)) return undefined;
  const [owner, name] = segments;
  if (!owner || !name) return undefined;
  return {
    provider: "github",
    host: host.toLowerCase(),
    owner,
    name,
    webUrl: `https://${host.toLowerCase()}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
  };
}

export function redactSourceControlOutput(value: string): string {
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/([?&#](?:access_token|token|key|secret|signature)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/\b(?:gh[opsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._~-]{16,})\b/gi, "[redacted]")
    .replace(/\b[A-Fa-f0-9]{40,}\b/g, "[redacted]")
    .slice(0, 16_384);
}

function parsePullRequestSummary(record: Record<string, unknown>): PullRequestSummary {
  const checks = asArray(record.statusCheckRollup).slice(0, MAX_DETAIL_ITEMS).map(parseCheck);
  return {
    number: positiveInteger(record.number),
    title: asString(record.title).slice(0, 500),
    url: safeHttpsUrl(record.url),
    state: normalizeState(record.state),
    isDraft: record.isDraft === true,
    headRefName: asString(record.headRefName).slice(0, 300),
    baseRefName: asString(record.baseRefName).slice(0, 300),
    updatedAt: safeIso(record.updatedAt),
    author: parseAuthor(record.author),
    additions: nonNegativeInteger(record.additions),
    deletions: nonNegativeInteger(record.deletions),
    changedFiles: nonNegativeInteger(record.changedFiles),
    reviewDecision: optionalString(record.reviewDecision),
    checksSummary: {
      total: checks.length,
      success: checks.filter((check) => check.state === "SUCCESS").length,
      failure: checks.filter((check) => check.state === "FAILURE" || check.state === "CANCELLED").length,
      pending: checks.filter((check) => check.state === "PENDING" || check.state === "UNKNOWN").length,
    },
  };
}

function parsePullRequestDetail(record: Record<string, unknown>): PullRequestDetail {
  return {
    ...parsePullRequestSummary(record),
    body: asString(record.body).slice(0, 250_000),
    createdAt: safeIso(record.createdAt),
    mergeable: asString(record.mergeable).slice(0, 100),
    checks: asArray(record.statusCheckRollup).slice(0, MAX_DETAIL_ITEMS).map(parseCheck),
    reviews: asArray(record.reviews).slice(0, MAX_DETAIL_ITEMS).map(parseReview),
    comments: asArray(record.comments).slice(0, MAX_DETAIL_ITEMS).map(parseComment),
    files: asArray(record.files).slice(0, MAX_DETAIL_ITEMS).map(parseFile),
    commits: asArray(record.commits).slice(0, MAX_DETAIL_ITEMS).map(parseCommit),
  };
}

function parseCheck(value: unknown): PullRequestCheck {
  const record = asRecord(value) ?? {};
  const name = asString(record.name || record.context).slice(0, 500) || "Unnamed check";
  return {
    id: asString(record.databaseId || record.id || `${name}:${asString(record.startedAt)}`).slice(0, 500),
    name,
    state: normalizeCheckState(record.conclusion ?? record.state ?? record.status),
    workflow: optionalString(record.workflowName)?.slice(0, 500),
    url: optionalSafeHttpsUrl(record.detailsUrl ?? record.targetUrl),
    startedAt: optionalIso(record.startedAt),
    completedAt: optionalIso(record.completedAt),
  };
}

function parseReview(value: unknown): PullRequestReview {
  const record = asRecord(value) ?? {};
  return {
    id: asString(record.id || `${asString(asRecord(record.author)?.login)}:${asString(record.submittedAt)}`).slice(0, 500),
    author: parseAuthor(record.author),
    state: normalizeReviewState(record.state),
    body: asString(record.body).slice(0, 100_000),
    submittedAt: optionalIso(record.submittedAt),
  };
}

function parseComment(value: unknown): PullRequestComment {
  const record = asRecord(value) ?? {};
  return {
    id: asString(record.id || `${asString(asRecord(record.author)?.login)}:${asString(record.createdAt)}`).slice(0, 500),
    author: parseAuthor(record.author),
    body: asString(record.body).slice(0, 100_000),
    createdAt: safeIso(record.createdAt),
    url: optionalSafeHttpsUrl(record.url),
  };
}

function parseFile(value: unknown): PullRequestFile {
  const record = asRecord(value) ?? {};
  return { path: asString(record.path).slice(0, 4_096), additions: nonNegativeInteger(record.additions), deletions: nonNegativeInteger(record.deletions) };
}

function parseCommit(value: unknown): PullRequestCommit {
  const record = asRecord(value) ?? {};
  return {
    oid: asString(record.oid).slice(0, 128),
    messageHeadline: asString(record.messageHeadline).slice(0, 2_000),
    authoredDate: safeIso(record.authoredDate),
    authors: asArray(record.authors).slice(0, 25).map(parseAuthor).filter((author): author is PullRequestAuthor => Boolean(author)),
  };
}

function parseAuthor(value: unknown): PullRequestAuthor | undefined {
  const record = asRecord(value);
  const login = asString(record?.login).slice(0, 200);
  if (!login) return undefined;
  return { login, name: optionalString(record?.name)?.slice(0, 500), avatarUrl: optionalSafeHttpsUrl(record?.avatarUrl) };
}

function normalizeCheckState(value: unknown): PullRequestCheckState {
  const state = asString(value).toUpperCase();
  if (["SUCCESS", "FAILURE", "NEUTRAL", "SKIPPED", "CANCELLED"].includes(state)) return state as PullRequestCheckState;
  if (["PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "WAITING", "REQUESTED"].includes(state)) return "PENDING";
  return "UNKNOWN";
}

function normalizeReviewState(value: unknown): PullRequestReviewState {
  const state = asString(value).toUpperCase();
  return ["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"].includes(state)
    ? state as PullRequestReviewState
    : "COMMENTED";
}

function normalizeState(value: unknown): PullRequestState {
  const state = asString(value).toUpperCase();
  return state === "MERGED" || state === "CLOSED" ? state : "OPEN";
}

function runBounded(command: string, args: readonly string[], cwd: string, timeout = COMMAND_TIMEOUT_MS, signal?: AbortSignal): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { cwd, encoding: "utf8", maxBuffer: MAX_COMMAND_OUTPUT_BYTES, timeout, killSignal: "SIGTERM", signal }, (error, stdout, stderr) => {
      if (error) {
        const wrapped = new Error(redactSourceControlOutput(String(stderr).trim() || String(stdout).trim() || error.message));
        Object.assign(wrapped, { code: (error as NodeJS.ErrnoException).code });
        reject(wrapped);
        return;
      }
      resolve({ stdout: String(stdout).slice(0, MAX_COMMAND_OUTPUT_BYTES), stderr: String(stderr).slice(0, MAX_COMMAND_OUTPUT_BYTES) });
    });
  });
}

function unavailableSnapshot(workspaceId: string, refreshedAt: string, state: SourceControlSnapshot["auth"]["state"], message: string): SourceControlSnapshot {
  return { workspaceId, auth: { state, message: redactSourceControlOutput(message) }, openPullRequests: [], refreshedAt, fromCache: false };
}

function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!asRecord(parsed)) throw new Error("GitHub returned an invalid object response.");
  return parsed as Record<string, unknown>;
}

function parseJsonArray(value: string): readonly Record<string, unknown>[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("GitHub returned an invalid list response.");
  return parsed.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asArray(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : []; }
function asString(value: unknown): string { return typeof value === "string" ? value : value == null ? "" : String(value); }
function optionalString(value: unknown): string | undefined { const text = asString(value).trim(); return text || undefined; }
function nonNegativeInteger(value: unknown): number { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : 0; }
function positiveInteger(value: unknown): number { const number = Number(value); if (!Number.isSafeInteger(number) || number <= 0) throw new Error("GitHub returned an invalid pull request number."); return number; }
function safeIso(value: unknown): string { const text = asString(value); return Number.isNaN(Date.parse(text)) ? new Date(0).toISOString() : new Date(text).toISOString(); }
function optionalIso(value: unknown): string | undefined { const text = optionalString(value); return text && !Number.isNaN(Date.parse(text)) ? new Date(text).toISOString() : undefined; }
function safeHttpsUrl(value: unknown): string { const result = optionalSafeHttpsUrl(value); if (!result) throw new Error("GitHub returned an invalid URL."); return result; }
function optionalSafeHttpsUrl(value: unknown): string | undefined { try { const url = new URL(asString(value)); return url.protocol === "https:" ? url.toString() : undefined; } catch { return undefined; } }
function extractHttpsUrl(value: string): string | undefined { return value.split(/\s+/).map(optionalSafeHttpsUrl).find(Boolean); }
function isSafeRepoSegment(value: string): boolean { return /^[A-Za-z0-9_.-]+$/.test(value) && value !== "." && value !== ".."; }
function repositorySlug(repository: SourceControlRepository): string { return `${repository.host}/${repository.owner}/${repository.name}`; }
function isMissingCommandError(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT"); }
function friendlyError(error: unknown): string { return redactSourceControlOutput(error instanceof Error ? error.message : String(error)); }
function commandMessage(result: CommandResult, fallback: string): string { return redactSourceControlOutput(result.stdout.trim() || result.stderr.trim() || fallback).slice(0, 2_000); }
function assertPullRequestNumber(value: number): void { if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Pull request number must be a positive integer."); }
function validateText(value: string, label: string, maxBytes: number): void { if (!value.trim()) throw new Error(`${label} is required.`); if (Buffer.byteLength(value, "utf8") > maxBytes) throw new Error(`${label} is too large.`); }
function validatePullRequestInput(input: { readonly title: string; readonly body: string; readonly base: string; readonly pullRequestNumber?: number }): void { if (input.pullRequestNumber !== undefined) assertPullRequestNumber(input.pullRequestNumber); validateText(input.title, "Pull request title", 2_000); validateText(input.base, "Base branch", 1_000); if (Buffer.byteLength(input.body, "utf8") > 250_000) throw new Error("Pull request description is too large."); }
function validateIdentity(value: string, label: string): void { if (!value.trim() || value.length > 1_000) throw new Error(`${label} is invalid.`); }
function linkKey(workspaceId: string, sessionId: string): string { validateIdentity(workspaceId, "Workspace ID"); validateIdentity(sessionId, "Session ID"); return `${workspaceId}::${sessionId}`; }
