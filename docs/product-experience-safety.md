# Product Experience Safety Contracts

This document is the durable operational contract for the evidence, checkpoint, context, memory, review, and handoff features introduced by the PX0–PX8 product-experience program. Code and tests remain executable sources of truth; this document records the boundaries that future changes must preserve.

## Evidence Authority And Verification

Task evidence is structured metadata owned by Electron main and persisted per workspace. Records carry schema version, workspace/session/run correlation, kind, source, authority, status, summary, and optional tool, command, file, checkpoint, test, or subagent correlation.

Authority is intentionally conservative:

- Desktop observations and matching runtime/tool events may support trusted verification.
- User declarations and assistant narrative may be displayed, but never create trusted verification, provenance, completion, or success state by themselves.
- A passing command is related to a file only when structured evidence explicitly links the command and path. Temporal proximity and unrelated green tests are not coverage.
- Missing correlation remains `unknown`; the UI must not infer ownership, changed paths, test coverage, or completion.
- Compaction may summarize repetitive records, but it must retain stable record IDs and raw drill-down evidence.

Completion and success presentation require an observed terminal outcome. When required verification is declared, every required record must be trusted and green. Partial, failed, blocked, cancelled, interrupted, externally blocked, or narrative-only outcomes cannot produce verified-success treatment.

The owning contracts are:

- `apps/desktop/src/product-experience/task-evidence.ts`
- `apps/desktop/electron/task-evidence-ledger.ts`
- `apps/desktop/electron/task-evidence-session-observer.ts`
- `apps/desktop/src/product-experience/product-delight.ts`

## Automatic Checkpoints

Electron main creates a checkpoint before the first observed mutating tool action in a logical run. Explicit restore and hunk-rejection operations create a rollback checkpoint before modifying files. Checkpoints are stored under Electron user data, never in the workspace or repository.

Each manifest records:

- schema version and manifest hash;
- workspace ID, root path, checkout path, and optional branch;
- session/run correlation and creation reason;
- relative paths, ownership classification, operation, before snapshot, expected-after identity, executable bit, and content/blob identity.

The default per-file capture limit is 8 MiB. Unsupported or oversized entries remain visible but are not silently restorable.

## Restore Safety

A restore is preview-first and workspace-bound:

1. Main re-resolves the requested checkpoint and current workspace identity.
2. Workspace ID, root path, and checkout path must all match.
3. Every entry is classified as safe, no-op, conflict, unsupported, or wrong-workspace.
4. Only safe Pi-attributed paths are selected by default.
5. User, pre-existing, external, unknown, later-edited, renamed, symlink, oversized, non-regular, and ambiguous paths require explicit handling and are never silently selected. A bounded binary snapshot may be restored only when the same Pi ownership and exact current-state checks succeed.
6. Main creates a rollback checkpoint before applying any selected path.
7. Current content is rechecked immediately before an atomic write or removal.
8. The result reports applied, skipped, and failed outcomes per path. Partial failure never becomes a success claim.

Pi-created file removal and any conflict requiring confirmation must remain explicit. A checkpoint must never restore into a different workspace or worktree, follow a symlink escape, overwrite a concurrent edit, or convert an unsupported entry into a best-effort mutation.

Retention is bounded and persisted. Protected checkpoints and checkpoints with an active restore lease are excluded from retention pruning. Cleanup must never silently remove rollback state while a restore is pending.

The owning contracts are:

- `apps/desktop/src/product-experience/checkpoint-contract.ts`
- `apps/desktop/electron/checkpoint-store.ts`
- `apps/desktop/electron/checkpoint-session-observer.ts`
- `apps/desktop/src/product-experience/hunk-restoration.ts`

## Hunk Rejection

Selective hunk rejection is available only for Pi-attributed text checkpoints with known before and expected-after content. The current file and hunk context must still match. Binary files, renames, creations/deletions, overlapping later edits, and ambiguous ownership do not receive one-click rejection.

The renderer previews the reversal and requests explicit confirmation. Main creates a rollback checkpoint, revalidates the file, and applies the selected safe hunks atomically. “Accept as reviewed” is review metadata only and never mutates the filesystem.

## Context And Memory

The context manifest describes only context Pi GUI can observe. Each entry records source, scope, reason, removability, provider visibility, persistence, content access, and availability.

Scopes and precedence are:

- message: attachments and file mentions for the next submission;
- thread: confirmed memory limited to the selected thread;
- workspace: workspace memory, decisions, instructions, and selected skills;
- global: global memory and desktop instructions;
- runtime: opaque upstream/runtime-managed context.

For the same memory key, thread overrides workspace and workspace overrides global. Disabled, temporarily excluded, stale, out-of-scope, or unconfirmed assistant-proposed memory is not injected. User-authored memory is active when enabled; assistant proposals require explicit confirmation. The UI discloses when memory or decisions affect the provider request.

Renderer controls may remove only entries Pi GUI owns. Runtime-managed or provider-hidden context remains visible as read-only/opaque and must not be guessed.

Secret-shaped memory and decision input is rejected. Persisted malformed or secret-like records are ignored. Display labels redact known credential shapes and shorten the user home path where appropriate.

The owning contracts are:

- `apps/desktop/src/product-experience/context-manifest.ts`
- `apps/desktop/electron/context-manifest-store.ts`
- `apps/desktop/src/product-experience/project-knowledge.ts`

## Artifact And Handoff Export

The artifact shelf indexes references; it does not automatically copy, commit, upload, delete, or preview content. Missing, private, log, moved, and export-excluded states remain explicit.

Handoff generation is local and previewable. It includes only user-selected decisions, export-safe changed paths, observed verification/blockers, and explicitly included normal/available artifacts. It excludes by default:

- transcript and log bodies;
- environment values and credentials;
- secret-shaped text;
- binary contents;
- private, missing, log, or export-excluded artifacts;
- absolute paths when a workspace-relative path is sufficient.

Copy, Save, and Attach are explicit user actions. Attachment snapshots live under Electron user data, preserve the observed version, and reject workspace-escaping symlinks so a queued message cannot silently attach later content.

The owning contracts are:

- `apps/desktop/src/product-experience/workspace-productivity.ts`
- `apps/desktop/src/workspace-productivity-hub.tsx`
- narrow artifact/handoff IPC in `apps/desktop/electron/main.ts` and `apps/desktop/electron/preload.ts`

## Required Regression Coverage

Changes to these boundaries require proportional proof:

- pure unit fixtures for authority, correlation, redaction, conflict classification, retention, and failure injection;
- isolated temporary workspaces for checkpoint, restore, rejection, and destructive-adjacent tests;
- core Electron proof for visible previews, confirmation, persistence, degraded states, and relaunch;
- real-provider proof when runtime/tool authority or provider submission changes;
- native/production proof only when the workflow invokes a real OS surface or packaged boundary.

Never use a real user workspace for restore or rejection tests, and never weaken a safety classification merely to make a test pass.
