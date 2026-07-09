import { useCallback, useState } from "react";
import type { WorkspaceRecord } from "../../desktop-state";

export type GitDialogKind = "commit" | "push" | "pr";

interface ChangedFileSummaryItem {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly staged: boolean;
}

interface UseGitActionsOptions {
  readonly api: typeof window.piApp;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
}

interface CommitChangesInput {
  readonly message: string;
  readonly stageAll: boolean;
}

interface CreatePullRequestInput {
  readonly title: string;
  readonly body: string;
  readonly base: string;
  readonly openInBrowser: boolean;
}

export function useGitActions({ api, selectedWorkspace }: UseGitActionsOptions) {
  const [gitDialog, setGitDialog] = useState<GitDialogKind | null>(null);
  const [gitChangedFiles, setGitChangedFiles] = useState<readonly ChangedFileSummaryItem[]>([]);
  const [gitBranchName, setGitBranchName] = useState<string | undefined>();
  const [gitActionPending, setGitActionPending] = useState(false);
  const [gitActionError, setGitActionError] = useState<string | undefined>();

  const loadGitChangedFiles = useCallback(async () => {
    if (!api || !selectedWorkspace) {
      return [] as const;
    }
    const files = await api.getChangedFiles(selectedWorkspace.id);
    setGitChangedFiles(files);
    return files;
  }, [api, selectedWorkspace]);

  const openGitDialog = useCallback((dialog: GitDialogKind) => {
    setGitActionError(undefined);
    setGitActionPending(false);
    setGitDialog(dialog);
    setGitBranchName(selectedWorkspace?.branchName);
    if (api && selectedWorkspace) {
      void api.getCurrentBranch(selectedWorkspace.id).then((branch) => {
        setGitBranchName(branch ?? selectedWorkspace.branchName);
      }).catch(() => {
        setGitBranchName(selectedWorkspace.branchName);
      });
    }
    if (dialog === "commit") {
      void loadGitChangedFiles().catch((error) => {
        setGitActionError(error instanceof Error ? error.message : String(error));
      });
    }
  }, [api, loadGitChangedFiles, selectedWorkspace]);

  const closeGitDialog = useCallback(() => {
    setGitDialog(null);
    setGitActionError(undefined);
    setGitActionPending(false);
  }, []);

  const handleCommitChanges = useCallback(async (input: CommitChangesInput) => {
    if (!api || !selectedWorkspace) {
      return;
    }
    setGitActionPending(true);
    setGitActionError(undefined);
    try {
      if (input.stageAll) {
        await api.stageAllFiles(selectedWorkspace.id);
      }
      await api.commitChanges(selectedWorkspace.id, input.message.trim());
      await api.syncCurrentWorkspace();
      closeGitDialog();
    } catch (error) {
      setGitActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setGitActionPending(false);
    }
  }, [api, closeGitDialog, selectedWorkspace]);

  const handlePushBranch = useCallback(async (options?: { readonly setUpstream?: boolean }) => {
    if (!api || !selectedWorkspace) {
      return;
    }
    setGitActionPending(true);
    setGitActionError(undefined);
    try {
      await api.pushBranch(selectedWorkspace.id, options);
      closeGitDialog();
    } catch (error) {
      setGitActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setGitActionPending(false);
    }
  }, [api, closeGitDialog, selectedWorkspace]);

  const handleCreatePullRequest = useCallback(async (input: CreatePullRequestInput) => {
    if (!api || !selectedWorkspace) {
      return;
    }
    setGitActionPending(true);
    setGitActionError(undefined);
    try {
      const result = await api.createPullRequest(selectedWorkspace.id, {
        title: input.title,
        body: input.body,
        base: input.base,
      });
      if (input.openInBrowser && result.url) {
        await api.openExternal(result.url);
      }
      closeGitDialog();
    } catch (error) {
      setGitActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setGitActionPending(false);
    }
  }, [api, closeGitDialog, selectedWorkspace]);

  return {
    closeGitDialog,
    gitActionError,
    gitActionPending,
    gitBranchName,
    gitChangedFiles,
    gitDialog,
    handleCommitChanges,
    handleCreatePullRequest,
    handlePushBranch,
    loadGitChangedFiles,
    openGitDialog,
  };
}
