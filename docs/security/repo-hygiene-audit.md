# Repo Hygiene Audit

Collected on 2026-07-08. This is an approval-prep document only; no worktrees, branches, history, logs, or secrets were removed while collecting it.

## Local Worktrees

| Worktree | Branch | Size | Merge status vs `main` |
| --- | --- | ---: | --- |
| `.worktrees/agent-observability-panel` | `feature/agent-observability-panel` | 1.8G | unmerged, 72 branch-only commits |
| `.worktrees/chat-performance-foundation` | `perf/chat-performance-foundation` | 1.8G | unmerged, 54 branch-only commits |
| `.worktrees/desktop-custom-instructions` | `feature/desktop-custom-instructions` | 1.8G | unmerged, 49 branch-only commits |
| `.worktrees/layout-perf-diagnostics` | `feature/layout-perf-diagnostics` | 1.9G | unmerged, 52 branch-only commits |
| `.worktrees/log-scope-and-thread-cwd` | `fix/log-scope-and-thread-cwd` | 1.8G | unmerged, 75 branch-only commits |
| `.worktrees/native-scrollbar-intent` | `fix/native-scrollbar-intent` | 1.8G | unmerged, 73 branch-only commits |
| `.worktrees/nico-lite-subagents` | `feature/nico-lite-subagents` | 1.9G | unmerged, 41 branch-only commits |
| `.worktrees/runtime-job-visibility` | `feature/runtime-job-visibility` | 1.8G | merged into `main` |
| `.worktrees/side-browser-panel` | `feature/side-browser-panel` | 1.4G | merged into `main` |
| `.worktrees/skill-catalog-cleanup` | `feature/skill-catalog-cleanup` | 1.9G | unmerged, 43 branch-only commits |

## Local Branches Containing Secret Commit `cf7bb03`

These need history cleanup or deletion before they are ever pushed:

- `feature/agent-observability-panel`
- `fix/log-scope-and-thread-cwd`
- `fix/native-scrollbar-intent`

## Local Branches Already Merged Into `main`

These are cleanup candidates after explicit approval because they are attached to worktrees:

- `feature/runtime-job-visibility`
- `feature/side-browser-panel`

## Remote Branches With No Commits Ahead Of `main`

These remote refs appear to be ancestors of `main` and are deletion candidates after explicit approval:

- `origin/chore/code-audit-cleanup`
- `origin/feature/new-thread-model-selector`
- `origin/fix/new-thread-model-picker-empty-state`
- `origin/fix/replay-local-after-main-sync`
- `origin/fix/sidebar-worktree-icon`
- `origin/fix/skill-slash-search`
- `origin/fix/thread-switch-latency`
- `origin/minghinmatthewlam/audit-codex-parity`

## Remote Branches With Branch-Only Commits

These require review before deletion:

- `origin/chore/pre-sync-main-20260324` - 3 branch-only commits
- `origin/claude/nostalgic-wu-1fd4d8` - 9 branch-only commits
- `origin/codex/refactor-sessions` - 2 branch-only commits
- `origin/cursor/setup-dev-environment-862e` - 1 branch-only commit
- `origin/feature/beta-release` - 1 branch-only commit
- `origin/fix/tests` - 1 branch-only commit
