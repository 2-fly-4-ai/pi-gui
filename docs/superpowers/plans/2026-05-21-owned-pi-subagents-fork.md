# Owned Pi Subagents Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the customized local `pi-subagents` package in an owned GitHub fork and keep the current pi installation working.

**Architecture:** Keep the existing local checkout as the working package path so custom agents and pi settings do not move. Change Git remotes so `origin` points to the owned fork and `upstream` points to `tintinweb/pi-subagents`, then push the local commits.

**Tech Stack:** Git, GitHub CLI, npm, TypeScript/Vitest.

---

## Success Criteria

- `github.com/2-fly-4-ai/pi-subagents` exists.
- Local checkout `/Users/brianfarley/.pi/agent/git/github.com/tintinweb/pi-subagents` has `origin` set to `https://github.com/2-fly-4-ai/pi-subagents.git`.
- Local checkout has `upstream` set to `https://github.com/tintinweb/pi-subagents`.
- Local `master` is pushed to `origin/master` and contains the four local customization commits.
- `~/.pi/agent/settings.json` still points to the existing local checkout, so custom agents are untouched.
- `package-lock.json` remains dirty and uncommitted unless separately approved.
- `npm test`, `npm run typecheck`, and `npm run build` pass in the subagents checkout.

## Tasks

### Task 1: Create the owned fork

**Files:** none

- [x] Run `gh repo fork tintinweb/pi-subagents --clone=false --remote=false`.
  - Actual command used: `gh repo fork tintinweb/pi-subagents --clone=false` because this `gh` version rejects `--remote=false` with an explicit repository argument.
- [x] Verify it with `gh repo view 2-fly-4-ai/pi-subagents --json nameWithOwner,url`.

### Task 2: Repoint Git remotes

**Files:** none

- [x] In `/Users/brianfarley/.pi/agent/git/github.com/tintinweb/pi-subagents`, rename `origin` to `upstream` if `upstream` does not already exist.
- [x] Add `origin` as `https://github.com/2-fly-4-ai/pi-subagents.git`.
- [x] Verify `git remote -v` shows owned fork as `origin` and tintinweb as `upstream`.

### Task 3: Push custom commits

**Files:** none

- [x] Run `git push -u origin master`.
- [x] Verify `git status -sb` shows the branch tracking `origin/master` and only the pre-existing dirty `package-lock.json` remains.
- [x] Verify `git log --oneline --decorate -6` shows the local cwd-guard commits on `origin/master`.

### Task 4: Verify package health

**Files:** none

- [x] Run `npm test`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run build`.

### Task 5: Verify pi settings and custom-agent safety

**Files:**
- Read: `/Users/brianfarley/.pi/agent/settings.json`

- [x] Confirm the package path still points to `/Users/brianfarley/.pi/agent/git/github.com/tintinweb/pi-subagents`.
- [x] Confirm no `.pi/agents/*.md` or global custom-agent files were modified. No custom-agent paths were edited; only GitHub remotes in the package checkout changed.
