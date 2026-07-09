# Repo Hygiene Audit

Collected on 2026-07-08. Cleanup executed on 2026-07-09 after explicit user approval.

## Cleanup Result

- Removed repo-local `.env`; `.env.backup` was absent.
- Removed root `agentlog.txt`.
- Removed all stale `.worktrees/*` checkouts; `.worktrees` is now empty (`0B`).
- Deleted all stale local branches listed below, including the three branches that contained `cf7bb03`.
- Pruned stale remote-tracking refs; `git remote show origin` now reports only `main`.
- Expired reflogs and ran `git gc --prune=now`; `git cat-file -e cf7bb03^{commit}` now fails.
- Installed `gitleaks` locally and verified full history with `gitleaks detect --source . --log-opts="--all" --redact`; 602 commits scanned, no leaks found.

## Local Worktrees

All entries below were removed on 2026-07-09.

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

These were deleted locally on 2026-07-09, then reflogs were expired and local GC was run:

- `feature/agent-observability-panel`
- `fix/log-scope-and-thread-cwd`
- `fix/native-scrollbar-intent`

## Local Branches Already Merged Into `main`

These were deleted locally on 2026-07-09 after their attached worktrees were removed:

- `feature/runtime-job-visibility`
- `feature/side-browser-panel`

## Remote Branches With No Commits Ahead Of `main`

These remote-tracking refs were stale and were pruned by `git fetch --prune origin` on 2026-07-09:

- `origin/chore/code-audit-cleanup`
- `origin/feature/new-thread-model-selector`
- `origin/fix/new-thread-model-picker-empty-state`
- `origin/fix/replay-local-after-main-sync`
- `origin/fix/sidebar-worktree-icon`
- `origin/fix/skill-slash-search`
- `origin/fix/thread-switch-latency`
- `origin/minghinmatthewlam/audit-codex-parity`

## Remote Branches With Branch-Only Commits

These were also stale remote-tracking refs by the time cleanup ran and were pruned by `git fetch --prune origin` on 2026-07-09:

- `origin/chore/pre-sync-main-20260324` - 3 branch-only commits
- `origin/claude/nostalgic-wu-1fd4d8` - 9 branch-only commits
- `origin/codex/refactor-sessions` - 2 branch-only commits
- `origin/cursor/setup-dev-environment-862e` - 1 branch-only commit
- `origin/feature/beta-release` - 1 branch-only commit
- `origin/fix/tests` - 1 branch-only commit
