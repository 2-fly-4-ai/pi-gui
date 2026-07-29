# Architecture

This repo is a Codex-style desktop shell for `pi`. The desktop app is the product center; packages under `packages/` keep runtime compatibility thin and reusable.

## Desktop Boundaries

- Electron main (`apps/desktop/electron/`) owns local filesystem access, process control, runtime drivers, persistence, OS integration, webview security policy, permissions, and IPC handlers.
- Preload (`apps/desktop/electron/preload.ts`) exposes a narrow typed bridge. Renderer code should not receive broad Node, filesystem, shell, process, or environment access.
- Renderer (`apps/desktop/src/`) owns presentation and local interaction state. It displays snapshots/events from main and sends explicit commands back through preload.
- Tests under `apps/desktop/tests/` verify the real Electron surface. Core tests are background-safe in-window flows; native tests use foreground macOS OS surfaces; production tests cover packaged or installed app behavior.

## State Flow

The current app-state source of truth is `DesktopAppStore` in Electron main. Main mutates workspace/session/composer/runtime state, persists it, and publishes `desktopIpc.stateChanged` snapshots to the renderer through a coalesced publisher.

Selected transcript hydration is separate: main loads the selected session transcript, caches it by session key, and publishes `desktopIpc.selectedTranscriptChanged`. Renderer materializes the active transcript and timeline, while persistence stays in main.

Display Mode never bulk-loads those full transcripts. Its shells, counts, filters, and ordering come from the existing
workspace/session summaries. A render-resident detailed card requests a per-session `DisplayModeThreadProjection`
through narrow IPC; each projection is limited to eight dashboard-safe rows and 96 KiB, persisted as a user-data
sidecar, and updated through per-thread revision events. Missing legacy sidecars are built lazily with at most two
concurrent transcript reads, without adding the transcript to the full-transcript cache. Both main and renderer
projection caches are byte-bounded.

Display Mode uses fixed-height row virtualization with two rows of overscan. Runtime liveness and session metadata are
independent of viewport residency. Compact cards mount only the card shell; detailed excerpts, composers, and terminals
exist only for visible/overscan rows or interaction-pinned cards. Focus, menus, drafts, attachments, expanded cards,
drag operations, and open terminals pin residency. Drafts and attachments are main-owned per session and shared with
the normal thread composer, so virtualization, filtering, navigation, and restart cannot discard unsent work.

Queued composer items are also main-owned. The live runtime queue remains authoritative while a session is running; Electron main mirrors each item, including attachments and context-manifest metadata, into a per-session file under the app user-data directory. Persisted items are always treated as recovered after process restart and are never silently replayed. The renderer exposes edit, reorder, cancel, delivery-mode conversion, and explicit send-next actions; malformed or unavailable recovered content remains visible until the user repairs or cancels it.

User-controlled decisions and project memory live in the Electron profile, outside the repository. Nothing is derived
silently from transcript bodies. A user may create a decision or assumption directly, or confirm an assistant
proposal. Decision state changes (`active`, `superseded`, `withdrawn`) keep a compact revision audit.

Memory precedence is thread over workspace over global for the same key. Disabled, temporarily excluded, unconfirmed,
or out-of-scope entries are not injected. The Context inspector shows exact stored text and the next-message manifest
before submission; submitted user messages disclose when memory or decisions influenced the provider request.
Secret-shaped input (common API keys, tokens, bearer credentials, and secret/password assignments) is rejected before
storage, and malformed or secret-like persisted records are ignored. Missing workspace scopes remain visible as stale
records but are not injected.

## Change Intelligence And Review Safety

The durable evidence, checkpoint/restore, context/memory, hunk-rejection, artifact, and handoff boundaries are specified in
[`product-experience-safety.md`](product-experience-safety.md). This section summarizes how those contracts fit the desktop architecture.

The task-evidence ledger is the durable metadata source for change review. Structured file-write observations may
associate a changed path with a run, tool call, subagent, checkpoint, ownership, intent, and originating user request.
The renderer groups the current frozen review snapshot by the latest observed intent for each path. Missing evidence is
shown as unknown/external; proximity and unrelated passing tests are never treated as provenance or coverage.

Selective rejection is main-owned. It is available only when a Pi-owned text checkpoint contains both the before and
expected-after content and the current file still matches the safe hunk context. Binary files, renames, creations,
deletions, ambiguous ownership, and overlapping later edits do not receive a one-click hunk action. Main creates a
rollback checkpoint and rechecks current content before an atomic write. “Accept as reviewed” remains renderer review
state and never mutates the filesystem.

Inline review questions and recent-file history are local UI metadata. Questions retain frozen snapshot and line/range
anchors, report stale mappings after the snapshot changes, and attach an assistant answer explicitly. Recent files are
recorded only after an in-app open/inspect action; arbitrary shell output is not indexed as open history.

## Workspace Productivity, Artifacts, And Local Adaptation

Panel visibility and dimensions are renderer-owned preferences stored per workspace. Terminal, Changes, Browser,
Logs, Plan, Display Mode drawer, and VS Code restore independently; unavailable Plan state stays closed, narrow
windows clamp or overlay utility panels, Focus mode remains a temporary presentation override, and Reset clears every
layout owner together.

The artifact shelf is an index of references, not a content cache or repository writer. Main exposes only narrow
workspace-bounded inspect, reveal, handoff-save, and attachment-snapshot IPC. Private/log paths remain visible as
metadata but are excluded from handoff export. Absolute external paths, secret-shaped values, transcript bodies,
environment values, and binary/log contents are not exported. Attachment snapshots live under Electron user data,
use copy-on-write cloning where the platform supports it, reject symlinks escaping the workspace, and preserve the
observed size/mtime so delayed or queued sends cannot silently substitute a later file version.

Command-palette adaptation is local renderer metadata scoped by workspace. It stores only command IDs and bounded
coarse counts. A recommendation appears after repeated use, explains its reason, and requires Apply; Dismiss and Reset
are explicit. No usage telemetry is emitted and controls are never reordered silently.

Product personality is derived from structured evidence into a small empty/working/waiting/success/failure/subagent
state vocabulary. The decorative accent reuses the curated shuriken assets and stays secondary to existing status
content. Success moments require an observed completed outcome plus every declared required verification record to be
trusted and green. Partial, failed, blocked, cancelled, interrupted, or assistant-narrative completion cannot trigger
them. The renderer suppresses motion for reduced-motion users, active text selection, Review, and focused writing.

State and transcript updates use typed delta channels. Extend the existing store/event contracts rather than adding parallel state paths.

## Driver Stack

- `packages/session-driver` defines the desktop-facing session-driver contract and runtime event types.
- `packages/pi-sdk-driver` adapts the upstream `@earendil-works/pi-coding-agent` runtime to that contract. Keep this layer thin; do not fork runtime behavior unless a plan explicitly calls for it.
- Electron main composes the driver with desktop services: catalog stores, terminal service, worktree manager, notifications, logs, subagent run records, and diagnostics.

## Test Tiers

- `core`: deterministic Electron window behavior, including composer, timeline, settings, persistence, worktrees, side panels, security policies, and layout.
- `live`: real provider/runtime behavior, including actual runs, tool events, transcript streaming, and runtime-backed notifications.
- `native`: foreground macOS integration such as real clipboard paste and picker/open-panel flows.
- `production`: packaged or installed app confidence checks, kept out of default lane globs.

Use `apps/desktop/package.json` as the command source of truth. Public lane scripts rebuild first; matching `:run` scripts skip rebuild for faster iteration after a known-current build.
