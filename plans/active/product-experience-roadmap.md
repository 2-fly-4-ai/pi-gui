# Product Experience Program — Trust, Control, and UI Excellence

Status: complete; PX0–PX8 implementation and verification green across unit, core, live-provider, native, packaged, accessibility, performance, and visual surfaces
Created: 2026-07-24
Source: real-Electron light/dark visual audit plus the three follow-up product-ideation rounds captured in the user-provided request.

## Goal

Turn Pi GUI from a strong Codex-style desktop shell into a trustworthy, legible, and distinctive agent workspace without weakening its conversation-first design.

This program covers all 52 accepted suggestions from the audit:

- 8 immediate UI and layout improvements;
- 12 product-level workflow improvements;
- 32 trust, conversation, timeline, review, workspace, and interaction improvements.

The program is intentionally larger than the archived [`../ui-polish.md`](../ui-polish.md) pass. That pass standardized the existing visual system. This plan adds new product behavior, persistent state, evidence models, safety boundaries, and cross-surface workflows.

## Definition of done

The program is complete only when:

1. Every item in the coverage matrix is implemented or explicitly rejected by the user with the reason recorded here.
2. No feature represents inferred assistant prose as trusted structured evidence.
3. Checkpoint restore, hunk rejection, command execution, memory injection, and export flows obey the safety requirements in [`../../docs/SAFETY.md`](../../docs/SAFETY.md).
4. New renderer capabilities use narrow typed IPC; the renderer does not receive broad filesystem, shell, process, environment, or credential access.
5. Main-process persisted records survive Electron relaunch and degrade honestly when upstream Pi does not expose required data.
6. Core UI behavior passes the full Electron `core` lane.
7. Runtime-backed activity, completion, subagent, queue, and verification behavior passes targeted fake-runtime coverage and the full real-provider `live` lane.
8. Native surfaces use targeted `native` or `production` proof where required.
9. Representative light, dark, compact, comfortable, empty, populated, running, failed, and completed states are visually inspected on the real Electron surface.
10. The roadmap status and implementation notes are kept current after every checkpoint.

## Product principles

### Conversation first

- Transcript, tool timeline, composer, and session state remain the main pane.
- Do not introduce a generic dashboard as the default experience.
- Secondary information should be progressively disclosed through compact summaries, drawers, panels, or explicit secondary surfaces.

### Evidence before claims

- “Verified,” “tested,” “changed,” “running,” and “complete” must be backed by structured app/runtime events.
- Assistant-authored Markdown may be displayed as narrative, but it cannot silently create verification badges, checkpoints, provenance, or health state.
- Unknown evidence is shown as unknown, not guessed.

### Recoverability before destructive control

- Pi GUI must never overwrite or delete user-owned work to implement undo.
- A restore operation creates a new rollback checkpoint before applying changes.
- Hunk rejection is limited to Pi-attributed changes by default.
- Destructive or ambiguous restores require a preview and explicit confirmation.

### Explicit memory and context

- Users control what is durable, what is sent to the provider, and what is removed from the next request.
- System/runtime-owned context that cannot be removed is visible but labeled read-only.
- Project memory is opt-in and editable; its use is disclosed in the thread.

### Stable navigation

- Adaptive behavior may recommend customization but must not silently move controls.
- Keyboard shortcuts, panel placement, and density choices remain predictable.
- Workspace-specific layout persistence always has a visible reset.

### Honest capability degradation

- Features that depend on upstream Pi hooks must ship with a defined degraded state.
- “Unavailable from this provider/runtime” is acceptable; fabricated coverage is not.
- Capability gaps discovered during implementation are recorded in this plan and, when durable, in `docs/`.

## Existing capabilities to extend

Implementation should build on these current surfaces instead of creating parallel systems:

- `DesktopAppStore` and typed delta channels for persisted app state.
- Selected-transcript materialization and virtualized conversation timeline.
- Runtime jobs, live tool-call events, observability ledger, and Logs panel.
- Durable subagent runs, audit correlation, workflow metadata, and Display Mode aggregation.
- Queued message edit, steer, remove, retry, and persistence behavior.
- Session tree modal and existing fork/branch runtime commands.
- Diff, review, terminal, browser, VS Code, plan, and Display Mode panels.
- Worktree manager and checkout selector.
- Command palette and global keyboard routing.
- Skills, agents, provider, model, notification, appearance, and general Settings surfaces.
- Attachment picker, paste/drop paths, file mentions, and Markdown renderer.
- Existing Shinobi, subagent, and shuriken asset rosters.
- Light/dark Electron screenshot harness.

## PX0 capability findings

Recorded 2026-07-24 from the current session-driver contracts, Electron store/event handlers, observability service, renderer state, and owning Electron tests.

| Capability | Current authoritative signal | Stable correlation available | Limitation / degraded behavior | Program route |
| --- | --- | --- | --- | --- |
| Session/run lifecycle | `sessionUpdated`, `runCompleted`, `runFailed`, `sessionClosed` | workspace ID, session ID, optional run ID | Completion contains a session snapshot but no structured changed-file or verification summary | PX2 evidence ledger derives only observed fields and keeps unknowns explicit |
| Tool lifecycle | `toolStarted`, `toolUpdated`, `toolFinished` | session/run ID and tool-call ID | Tool name/input/output require conservative interpretation; no universal typed read/write/test category | PX0/PX2 classifier records raw authority and refuses unsupported promotion |
| Runtime jobs/processes | `runtimeJobUpdated` plus `RuntimeJobSnapshot` | session/run/tool-call/job IDs | Detached processes may have `claimed` or `unknown` confidence | Health/activity UI preserves confidence instead of presenting certainty |
| Subagents | `subagentRunUpdated`, durable subagent store, audit log correlation | parent session, run, subagent run, optional tool-call IDs | Nested children depend on runtime/audit data actually emitted | PX4 renders known hierarchy and labels uncorrelated/nesting-unknown cases |
| Queued messages | driver queue snapshots and queue lifecycle events | durable queued-message ID | Reorder is not an explicit driver method; current replace operation can support an ordered list | PX4 extends the existing replace/edit/steer path |
| Host UI / approvals | `hostUiRequest` confirm/input/select/editor plus typed responses | request ID and session/run IDs | This is extension-host UI, not a universal provider/tool permission stream | PX3 approval center includes only desktop-managed requests and labels coverage |
| Session tree | `getSessionTree` and `navigateSessionTree` | stable tree node IDs and current leaf ID | Navigation can branch the current runtime history, but the contract does not create a separately comparable session from an arbitrary historical node | PX5 adds the missing explicit branch-session contract or ships an honest in-session branch state first |
| File reads/writes | tool lifecycle, tool names/inputs, diff/workspace state | tool-call/run IDs when emitted | No authoritative universal file-operation event; shell commands may change files without a typed path list | PX2/PX6 attribute only directly observed paths and mark shell/external changes unknown |
| Commands/tests | tool lifecycle, terminal/runtime jobs, project actions | tool-call/job/run IDs; saved action ID where applicable | Tests are not a first-class runtime event and arbitrary output is provider/tool specific | PX2 uses conservative command classification and explicit project-action adapters |
| Diff/change state | current diff/review surfaces and Git workspace inspection | workspace/checkout path; no line-level run provenance | Existing changes may predate Pi or be user-owned | PX3 checkpoints plus PX6 provenance never claim unknown changes |
| Attachments/context | composer attachments, file mentions, desktop instructions, model/tool/skill selection | attachment IDs and session/workspace selection | Upstream system prompt, provider-side context, automatic runtime discovery, and hidden prompt assembly are opaque | PX3 context inspector shows app-controlled entries and read-only opaque runtime entries |
| Artifacts | runtime-job log/artifact paths and subagent artifact paths | job/subagent/run IDs | Paths can be missing, private, external, or only assistant-mentioned | PX7 indexes observed references only and carries availability/sensitivity |
| Notifications/attention | notification preferences, run completion/failure, host UI requests | session/run/request IDs | Notification state is not a general approval queue | PX2/PX3 share evidence IDs but retain separate concepts |
| Verification | command exit state, current test harnesses, user-visible terminal/logs | command/tool/run IDs where observed | No existing authority ladder; assistant Markdown can currently mention tests without proof | PX0 evidence contract excludes narrative/declarations from trusted verification |
| Checkpoints/undo | none | none | No safe recoverable file snapshot or ownership contract exists | PX0 contract and fixtures precede all restore UI/filesystem work |
| Provider-hidden context | unavailable by design | none | Pi GUI cannot inspect or remove provider-side or hidden upstream context | Permanently degraded: display “Runtime managed · details unavailable” rather than guessing |

Signal availability by verification surface:

- Fake-runtime Electron can deterministically emit every typed session-driver event and is suitable for core state/UI coverage.
- Real-provider Electron is required to prove actual tool ordering, provider errors, streaming, queued delivery, subagent execution, and run completion.
- Provider-specific tool names and output shapes are treated as adapters, never as the universal evidence contract.
- Native Electron is needed only where a feature reaches a real macOS picker, clipboard, notification, system opener, or packaged application boundary.

## Proposed shared architecture

Names below are design targets, not mandatory filenames. Reuse existing types when they already express the contract.

### 1. Task evidence ledger

Electron main owns an append-only, bounded, per-session evidence ledger. Candidate record:

```ts
interface TaskEvidenceRecord {
  id: string;
  sessionId: string;
  runId?: string;
  timestamp: string;
  kind:
    | "activity"
    | "file-read"
    | "file-write"
    | "command"
    | "test"
    | "verification"
    | "approval"
    | "decision"
    | "artifact"
    | "checkpoint"
    | "error"
    | "completion";
  source: "desktop" | "runtime" | "tool" | "subagent" | "user";
  status?: "pending" | "running" | "passed" | "failed" | "blocked" | "unknown";
  summary: string;
  details?: Record<string, unknown>;
  parentId?: string;
  correlationIds?: {
    toolCallId?: string;
    subagentRunId?: string;
    commandId?: string;
    checkpointId?: string;
  };
}
```

Rules:

- Store structured metadata, not unrestricted tool output.
- Redact secrets and never duplicate transcript bodies into the ledger.
- Retain enough correlation to connect activity, changes, tests, subagents, and completion.
- Bound or compact the ledger without losing checkpoint manifests or explicit user decisions.
- Publish typed deltas to the renderer; do not add a second full-snapshot hot path.

### 2. Context manifest

Before submission, Pi GUI can construct an honest manifest of app-controlled context:

```ts
interface ContextManifest {
  sessionId?: string;
  workspaceId: string;
  model: string;
  provider: string;
  checkout?: string;
  attachments: ContextEntry[];
  fileMentions: ContextEntry[];
  instructions: ContextEntry[];
  enabledSkills: ContextEntry[];
  projectMemory: ContextEntry[];
  runtimeManaged: ContextEntry[];
}
```

Each entry declares:

- source;
- scope;
- whether it is removable;
- whether content or only metadata is available;
- whether it will be sent to the provider;
- why it is included.

The manifest must not claim to reveal hidden provider-side or upstream runtime context that Pi GUI cannot inspect.

### 3. Checkpoint store

Checkpoint data lives under Electron-managed user data, not inside the repository by default.

A checkpoint contains:

- workspace and checkout identity;
- session and run correlation;
- creation reason and timestamp;
- pre-change file metadata;
- content blobs only for files necessary to restore;
- untracked-file state without deleting unrelated untracked files;
- a manifest hash and schema version;
- retention and size metadata.

Restore rules:

1. Re-scan the workspace before preview.
2. Identify conflicts and user changes made after the checkpoint.
3. Default to selecting only Pi-attributed paths.
4. Create a rollback checkpoint of current state.
5. Require explicit confirmation for overwrites, deletions, untracked-file removal, or ambiguous ownership.
6. Apply atomically where practical.
7. Report partial failure without discarding either checkpoint.

Do not implement checkpoints with automatic commits, `git reset`, `git checkout --`, or broad stash operations. Those mechanisms can capture or overwrite unrelated user work.

### 4. Workspace experience preferences

Persist separately scoped preferences:

- global appearance: theme, density, transcript font, monospace font;
- global navigation: command-palette recents and explicitly pinned tools;
- workspace layout: sidebar width, open panels, panel widths, Display Mode layout;
- workspace shortcuts;
- per-thread focus/minimap/compression state where appropriate.

Every adaptive recommendation has:

- an explanation;
- an explicit Apply action;
- a Dismiss action;
- a reset surface.

### 5. Artifact and handoff index

Index references to existing files rather than copying private artifacts automatically.

Records include:

- label, type, source path, workspace-relative display path;
- session/run ownership;
- created/updated timestamp;
- sensitivity classification;
- whether the artifact may be included in export;
- availability/missing status.

Exports are generated from an explicit preview and exclude logs, transcripts, absolute private paths, secrets, and binary contents unless the user opts in.

## Program sequencing

| Phase | Name | Primary dependency | Closing proof |
| --- | --- | --- | --- |
| PX0 | Contracts, capability spikes, and baselines | Existing architecture | Unit contracts + Electron baseline capture |
| PX1 | Immediate UI clarity and layout | PX0 baseline | Full `core` + light/dark/compact screenshots |
| PX2 | Evidence, activity, completion, and recovery | PX0 ledger contract | Full `core` + real-provider `live` |
| PX3 | Checkpoints, context, boundaries, and approvals | PX2 correlation IDs | Core restore simulations + targeted native/live |
| PX4 | Timeline calmness and subagent legibility | PX2 activity model | Timeline performance + real-provider subagents |
| PX5 | Thread organization, branching, decisions, and memory | PX2 evidence + PX3 context | Core persistence + live branch/queue proof |
| PX6 | Change intelligence and guided review | PX2 evidence + PX3 checkpoints | Core diff/review + real tool/write/test proof |
| PX7 | Workspace productivity, artifacts, settings, and handoff | PX3/PX5 data contracts | Core persistence + export safety tests |
| PX8 | Display Mode refinement, adaptive recommendations, and delight | PX1–PX7 | Full regression + final visual/product sweep |

Do not begin PX3 destructive-adjacent UI until PX0 safety contracts are reviewed in code and tests. Other phases may be split into focused checkpoints, but their dependency rules still apply.

---

## PX0 — Contracts, capability spikes, and baselines

### Outcome

Establish truthful data contracts and measurable baselines before adding UI that depends on provenance, context, verification, or restoration.

### PX0.1 Inventory existing signals

- [x] Map every current runtime, transcript, tool-call, job, subagent, queue, diff, test-like command, approval-like dialog, and notification event.
- [x] Record which signals contain stable IDs and which require desktop correlation IDs.
- [x] Determine which upstream Pi events distinguish file reads, writes, commands, tests, model activity, and final completion.
- [x] Document where current events are fake-runtime-only, real-provider-only, or provider-specific.
- [x] Confirm which context inputs Pi GUI controls directly and which remain opaque inside upstream Pi.
- [x] Confirm current session tree operations support branch creation from an arbitrary message, or document the runtime addition required.

Deliverable:

- Add a “Capability findings” section to this plan with supported, degraded, and blocked cases before PX2/PX5 implementation begins.

### PX0.2 Define evidence and provenance contracts

- [x] Add versioned types for evidence, activity, completion, verification, decision, artifact, approval, and file-change provenance.
- [x] Define stable correlation across parent run, child agent, tool call, command, file, test, and checkpoint.
- [x] Define evidence authority: desktop observation, runtime event, tool event, user declaration, or assistant narrative.
- [x] Prevent assistant narrative from creating trusted evidence without an observed matching event.
- [x] Define compaction so repetitive events can be summarized without losing drill-down IDs.
- [x] Add pure unit tests for parsing, authority ranking, correlation, compaction, and unknown states.

### PX0.3 Define checkpoint safety contract

- [x] Specify checkpoint manifest, blob storage, schema migration, size limits, and retention.
- [x] Specify ownership classification: Pi-attributed, user-attributed, pre-existing, external/unknown.
- [x] Specify restore conflict states and confirmation requirements.
- [x] Specify rollback-checkpoint behavior and partial-failure recovery.
- [x] Specify symlink, executable-bit, rename, deletion, binary, large-file, and untracked-file handling.
- [x] Specify worktree identity validation so a checkpoint cannot restore into the wrong checkout.
- [x] Add unit fixtures covering all states before filesystem mutation code is added.

### PX0.4 Define context and memory contract

- [x] Classify context as removable, read-only, provider-visible, local-only, persistent, or ephemeral.
- [x] Define project-memory scopes and precedence.
- [x] Define visible disclosure when memory is injected.
- [x] Define secret/path redaction for context inspection and handoff export.
- [x] Define stale and missing entry behavior.
- [x] Prohibit silent memory creation from assistant output.

### PX0.5 Capture UI and performance baselines

- [x] Extend the screenshot inventory to include empty, populated, running, failed, completed, approval-waiting, long-timeline, subagent, diff, and Display Mode states.
- [x] Record sidebar width, Settings content width, Display Mode drawer width, timeline frame/scroll behavior, and screenshot viewport.
- [x] Record current long-transcript render/scroll measurements using the existing dev performance harness.
- [x] Record contrast ratios for text tokens on every surface they are intended to support.
- [x] Store generated screenshots in temporary output only; do not commit private artifacts.

Baseline recorded 2026-07-24:

- Real Electron screenshot viewport: 1480 × 980.
- Primary sidebar token: 292 px; secondary Settings/catalog sidebar: 280 px.
- Display Mode preview drawer: approximately 322 px in the captured default state and user-resizable up to half the available width.
- Baseline screenshot harness: 18 temporary light/dark captures covering thread, new thread, Settings, Skills, Extensions, and Display Mode; the completed expanded inventory is recorded in the implementation and final verification notes below.
- Contrast audit: light `--muted-faint` on main was 2.76:1; dark `--muted-faint` on main was 3.23:1; light/dark `--muted` on surface were approximately 4.12:1/4.16:1.
- Existing long-transcript closeout: 1,000 seeded rows plus 80 streamed chunks, zero legacy full-state/full-transcript live IPC, two transcript events totaling 319,704 bytes with a 2,343-byte final payload, and two state-patch events totaling 3,062 bytes with a 66-byte final payload.
- Screenshots remained under `/tmp` and were not added to the repository.

### PX0 implementation notes

- 2026-07-24: Added versioned pure contracts under `apps/desktop/src/product-experience/` for task evidence/authority/correlation/compaction, checkpoint manifests and restore previews, and context manifests plus explicitly confirmed project memory.
- 2026-07-24: Evidence authority prevents assistant narrative and user declarations from creating trusted verification. Verification confidence retains passed, failed, and blocked scopes from observed evidence only.
- 2026-07-24: Checkpoint preview fixtures cover safe Pi-attributed restores, user/external ownership, later edits, unexpected hashes, Pi-created-file removal confirmation, symlinks, large binaries, renames, wrong-worktree identity, and no-op restoration. No filesystem mutation was introduced.
- 2026-07-24: Context fixtures cover removable/provider-visible disclosure, global/workspace/thread memory precedence, stale availability, secret/home-path display redaction, and the requirement that an assistant-proposed memory entry be explicitly confirmed before it can become active.
- 2026-07-24: Expanded `apps/desktop/tests/dev/ui-review-screenshots.spec.ts` from 18 to 25 real-Electron screenshots by adding running tool, subagent progress, approval dialog, failed run, completed run, 180-run long timeline, and real Git diff states.
- 2026-07-24 verification: focused Vitest contracts passed (3 files / 16 tests), desktop renderer/main typecheck passed, expanded Electron screenshot harness passed (1/1, 25 captures), representative approval/long-timeline/diff captures were visually inspected, and `git diff --check` passed.

### PX0 acceptance criteria

- Contract tests pass.
- Capability findings make unsupported upstream behavior explicit.
- Checkpoint implementation cannot start without conflict/rollback fixtures.
- The baseline is reproducible through repo-owned Electron helpers.
- No product-visible behavior is claimed complete in PX0.

---

## PX1 — Immediate UI clarity and layout

### Outcome

Address the high-confidence visual and interaction findings from the real-Electron audit before layering additional product state onto the same surfaces.

### PX1.1 Accessible contrast (`UI-01`)

- [x] Replace the current `--muted-faint` values with values that meet at least 4.5:1 for normal-size text on their intended primary backgrounds.
- [x] Split decorative/icon-only faint color from semantic small-text color if one token cannot serve both. (A split was not needed after the semantic tokens themselves passed on all intended surfaces.)
- [x] Audit timestamps, placeholders, disabled descriptions, sidebar previews, table metadata, composer hints, Display Mode labels, and empty states.
- [x] Preserve clear disabled-state differentiation without making instructions unreadable.
- [x] Add automated computed-style assertions for representative light and dark text/background pairs.
- [x] Add forced-colors and increased-contrast manual checks if supported by the Electron/Chromium version.

Acceptance:

- No essential text uses a failing faint token.
- Decorative icons may remain lower contrast only when they carry no unique information.

### PX1.2 Empty-state layout and actions (`UI-03`)

- [x] Override implicit multi-column grids when Skills or Extensions has no rows.
- [x] Center a single empty-state card across the entire available content region.
- [x] Put “Create skill,” “Refresh extensions,” or the correct recovery action inside the state.
- [x] Distinguish no discovery results from a search/filter with zero matches.
- [x] Preserve selected workspace context and explain whether global items still apply.
- [x] Add Electron coverage for empty discovery, no-match search, refresh failure, and successful recovery.

### PX1.3 Topbar hierarchy (`UI-04`)

- [x] Measure actual action usage through local anonymous counters only if already permitted; otherwise use explicit product priority.
- [x] Keep the most frequent thread actions visible.
- [x] Move Browser, Logs, VS Code, folder, and other lower-frequency utilities into one keyboard-accessible Panels/Tools menu.
- [x] Keep active/open panel state visible inside the menu and on any retained icon.
- [x] Preserve direct shortcuts and tooltip discoverability.
- [x] Ensure update, approval, running, and error states are never hidden solely inside overflow.
- [x] Verify usable layout at narrow supported window widths.

### PX1.4 New Thread usefulness (`UI-05`)

- [x] Replace the inert empty region with three or four repo-aware starter actions.
- [x] Initial starters: inspect current changes, find failing tests, review the project, explain architecture.
- [x] Derive availability from workspace state; do not claim tests or changes exist without checking.
- [x] Insert an editable prompt rather than immediately sending it.
- [x] Move the one-time diagnostics choice outside the primary composer control hierarchy.
- [x] Preserve immediate autofocus and keyboard-first submission.
- [x] Provide a minimal state when no workspace is selected.

### PX1.5 Settings geometry (`UI-07`)

- [x] Cap readable Settings content width.
- [x] Define a consistent label/description/control grid.
- [x] Keep related controls close enough to their explanatory text.
- [x] Collapse to one column at narrower widths.
- [x] Ensure long provider/model names and translated text cannot overlap.
- [x] Preserve native control accessibility and tab order.

### PX1.6 Sidebar scanability (`UI-08`)

- [x] Add a constrained resizable sidebar with global or workspace persistence.
- [x] Keep a clear minimum for icons/actions and a maximum that cannot consume the conversation.
- [x] Rebalance title, preview, timestamp, worktree, running, failed, unread, and pinned states.
- [x] Use tooltips for truncation but do not rely on hover as the only access to a full title.
- [x] Make running/error indicators semantically labeled and distinguishable without color.
- [x] Verify drag, keyboard reset, relaunch persistence, and narrow-window behavior.

### PX1.7 Attachment presentation (`EX-10`)

- [x] Show image thumbnails and file-type icons.
- [x] Display a safe filename and size without exposing unnecessary absolute paths.
- [x] Distinguish workspace reference, copied attachment, pending processing, ready, missing, and failed.
- [x] Keep remove/retry operations reachable by keyboard.
- [x] Preserve paste, drop, picker, and queued-message attachment behavior.
- [x] Add overflow behavior for many attachments without growing the composer unboundedly.

### PX1.8 Density and font preferences (`EX-11`)

- [x] Add Compact and Comfortable density.
- [x] Add transcript and monospace font-size controls with sensible bounded steps.
- [x] Apply tokens rather than per-component overrides.
- [x] Preserve timeline virtualization measurements and composer pinning after changes.
- [x] Persist globally with an obvious reset.
- [x] Add screenshot coverage for both densities in light and dark.

### PX1.9 Relative-time detail (`ST-02`)

- [x] Preserve compact relative labels at rest.
- [x] Show exact local timestamp and duration on hover and keyboard focus.
- [x] Add accessible names for screen readers.
- [x] Handle clock skew and unknown start/end times honestly.

### PX1 verification

During iteration:

```bash
pnpm --filter @pi-gui/desktop run typecheck
pnpm --filter @pi-gui/desktop run test:e2e:runner -- \
  apps/desktop/tests/core/appearance-settings.spec.ts \
  apps/desktop/tests/core/skills-settings.spec.ts \
  apps/desktop/tests/core/sidebar-toggle.spec.ts \
  apps/desktop/tests/core/new-thread-composer.spec.ts \
  apps/desktop/tests/core/composer-drag-drop.spec.ts
```

Close with:

```bash
pnpm lint
pnpm test:unit
pnpm --filter @pi-gui/desktop run test:e2e:core
UI_REVIEW_OUT_DIR="$(mktemp -d /tmp/pi-gui-px1.XXXXXX)" \
  pnpm --filter @pi-gui/desktop run test:e2e:runner -- \
  apps/desktop/tests/dev/ui-review-screenshots.spec.ts
```

Perform real Electron visual inspection in light/dark and Compact/Comfortable modes.

Implementation note, 2026-07-24:

- Semantic muted tokens now meet the 4.5:1 normal-text threshold on both `--main` and `--surface` in light and dark themes. A real-Electron computed-style test guards all six foreground/background combinations per theme.
- Skills and Extensions use a single-column empty layout, distinguish discovery-empty from filter-empty, and expose Create, Refresh, or Clear actions in place.
- Focused verification passed: desktop typecheck, production build, 13 Display Mode/Skills Electron tests, the new contrast regression, and the 25-state screenshot harness.
- Light/dark screenshots were visually inspected for Skills empty discovery, Extensions empty discovery, and the collapsed Display Mode command center. Later passes added forced-colors, recovery, and Compact/Comfortable light/dark coverage.
- Settings now uses a centered 960 px readable maximum and a consistent two-column label/control grid that collapses without overflow. The real-Electron geometry test covers wide and 720 px layouts.
- The primary sidebar now resizes from 240–440 px, persists globally, clamps against the conversation at narrow widths, supports pointer drag, arrow-key adjustment, Home/double-click reset, and relaunch restoration. Thread titles remain available to assistive technology, failed/running/unread states have non-color semantics, and exact local update times are focusable.
- New Thread now offers four repository starters that insert editable prompts and explicitly inspect before claiming changes or test failures. The one-time diagnostics choice is outside the composer, autofocus/keyboard submission remain intact, and the no-workspace state remains minimal.
- Relative timestamps stay compact at rest and now disclose localized exact time on hover/focus in the sidebar, Display Mode tiles/logs, Skills usage, and run summaries. Future clock skew is labeled as future instead of “now,” and known durations are keyboard-focusable.
- Additional proof passed: string utility unit tests (7/7), the production build, 12 Settings/Display Mode/sidebar Electron tests after the narrow-layout correction, all 8 New Thread Electron tests, and a fresh 25-state light/dark screenshot pass. New Thread and Settings captures were visually inspected.
- The topbar now retains Terminal, Changes, update, runtime, error, and Git actions while Browser, App logs, Preview, VS Code, and Add folder live in one ARIA menu. The menu exposes Open/Closed state, closes on Escape/outside click/view changes, and passed 21 affected core Electron tests plus light/dark visual inspection.
- The native open-folder lane was initially blocked before action dispatch while macOS was locked at `loginwindow`. After unlock, the complete nine-test native lane passed, including all five folder-picker paths, Finder Reveal, image attachment, cancellation safety, and both real clipboard paste surfaces.
- Attachment chips now show safe leaf names, decoded/persisted size, previews or file-type badges, lifecycle/source metadata, keyboard removal, and a bounded scrolling region. Queued messages retain the same presentation.
- Appearance Settings now owns persisted Comfortable/Compact density plus bounded transcript and monospace font sizes, applied through root tokens with an obvious Reset. Unit normalization, Electron relaunch/reset, light/dark screenshots, forced-colors, and compact virtualization/pinning coverage passed.
- PX1 closeout: empty discovery now exposes loading, failure, retry, recovery, and no-match states; the full flow passed on Electron for Skills and Extensions. Sidebar rows now persist explicit pin/unpin state, keep pinned threads above recency ordering, and retain the pin after relaunch.
- Attachment records now carry copied-versus-workspace-reference source and pending/ready/missing/failed lifecycle state. Persisted workspace references are revalidated on relaunch, missing files are visibly blocked from submission, and copied images remain self-contained. Focused attachment unit tests and 13 affected Electron tests passed.
- Compact density now has a real long-timeline assertion proving virtualization remains active while composer growth stays bottom-pinned. The updated compact test passed with the owning drag/drop lane.

---

## PX2 — Evidence, activity, completion, and recovery

### Outcome

Give the app a structured, honest account of what is happening, what happened, what was verified, and what needs recovery.

### PX2.1 Persisted evidence ledger

- [x] Implement main-owned append, query, compaction, retention, and migration.
- [x] Expose narrow query and delta IPC.
- [x] Correlate runtime runs, tool calls, commands, subagents, files, and observed tests.
- [x] Redact sensitive command arguments and paths according to the existing log policy.
- [x] Keep ledger writes off the composer/timeline hot path.
- [x] Recover cleanly from malformed or newer-schema records.
- [x] Add relaunch persistence and bounded-growth tests.

### PX2.2 Clear live activity (`EX-02`, `TL-04`)

- [x] Derive current activity from structured events, not the most recent Markdown sentence.
- [x] Support reading, editing, running command, running tests, waiting for approval, waiting for provider, waiting for subagent, retrying, and blocked.
- [x] Show a sticky compact row above the composer while work is active.
- [x] Keep the topbar state concise and consistent with the sticky row.
- [x] Clicking activity jumps to or expands the owning timeline item.
- [x] Fall back to “Working” when details are unavailable.
- [x] Ensure rapid tool events do not create flicker; debounce presentation without delaying stop/error states.

### PX2.3 Completion summary card (`EX-01`)

- [x] Emit a completion record when the run reaches a terminal state.
- [x] Summarize observed files changed, tests/verification, elapsed time, branch/worktree, child-agent outcomes, approvals, and blockers.
- [x] Separate “Pi reported” narrative from app-observed evidence.
- [x] Provide Review changes, Open failed test/log, Commit, Continue, and Retry actions only when applicable.
- [x] Support completed, partially completed, failed, cancelled, interrupted, and externally blocked outcomes.
- [x] Rehydrate the card after relaunch.
- [x] Avoid duplicate completion cards during retries or provider reconnects.

### PX2.4 Verification confidence (`TC-05`)

- [x] Define an evidence ladder: implemented/unverified, unit-tested, package-tested, Electron core, Electron live, native, packaged, external.
- [x] Derive badges from recorded commands and harness outcomes.
- [x] Label user-declared or imported evidence separately.
- [x] Represent partial and failed verification per scope.
- [x] Let users inspect the exact command, time, exit status, and source.
- [x] Never promote a badge based only on assistant Markdown.

### PX2.5 Thread health strip (`EX-09`)

- [x] Aggregate dirty files, failing tests, running jobs, unknown jobs, context usage, waiting approvals, child runs, and verification state.
- [x] Show only non-neutral or explicitly pinned health items at rest.
- [x] Make each item actionable and jump to its source.
- [x] Avoid duplicating the topbar, activity row, and completion card.
- [x] Define stale state and refresh behavior.

### PX2.6 Stronger error recovery (`EX-06`)

- [x] Introduce structured error categories: provider auth, rate limit, runtime crash, tool failure, command failure, test failure, permission, missing file, stale workspace, and unknown.
- [x] Map categories to safe actions: Retry, Re-authenticate, Continue, Open logs, Open Settings, Copy redacted diagnostics.
- [x] Keep the original error inspectable.
- [x] Prevent retry loops and make attempt count visible.
- [x] Correlate recovery with the original failed action.
- [x] Preserve draft/queue state through failure and recovery.

### PX2.7 Evidence-backed test observation

- [x] Classify test commands using explicit project actions and conservative command parsing.
- [x] Record command, cwd, exit status, duration, and parsed test identifiers when available.
- [x] Treat unrecognized commands as commands, not tests.
- [x] Add adapters for the repo’s own Playwright/Vitest output without making them universal assumptions.
- [x] Keep raw output in existing terminal/log artifacts rather than duplicating it into evidence records.

### PX2 implementation notes

- Main now owns a per-workspace `TaskEvidenceLedger` under Electron user data. It serializes writes outside renderer hot paths, applies count/age retention, supports compact query groups with raw evidence IDs retained for drill-down, and refuses malformed or unsupported store/record schemas.
- Runtime session events feed the ledger through a dedicated observer. Run IDs, tool-call IDs, command IDs, subagent IDs, file paths, approvals, errors, and deterministic terminal completion IDs are correlated without copying transcript bodies or raw tool output.
- The renderer receives only a typed, workspace/session-scoped query and append delta channel. No filesystem or store access crosses preload.
- Focused unit coverage proves persistence, deduplication, bounded growth, compaction, redaction, conservative test classification, correlation, output exclusion, and schema recovery. `task-evidence-ledger.spec.ts` proves real Electron delta delivery and relaunch hydration; the full 159-test Electron core lane passed after this integration.
- The selected thread now subscribes to evidence deltas and rehydrates a bounded evidence page. Structured running tools drive a compact composer-adjacent activity row; a generic runtime-only state falls back to “Working,” and completed tools cannot remain falsely active because presentation resolves the latest correlated state.
- Terminal run events create deterministic completion evidence enriched with observed changed paths, passed verification IDs, and child-run IDs. The completion card explicitly labels itself “Observed completion,” keeps assistant narrative outside trusted status, summarizes unknowns honestly, and survives relaunch without duplication.
- A compact health strip now exposes only non-neutral observed facts (changes, failures, approvals, child runs, and highest passed verification scope). Fifteen focused evidence unit tests and the real-Electron activity/completion/relaunch spec pass.
- Verification evidence expands in place to show the redacted exact command, cwd, exit status, local time, source, and whether the authority is trusted. User/assistant declarations remain explicitly outside trusted verification.
- Runtime and local failures now share a pure structured classifier covering provider auth, rate limit, runtime crash, tool/command/test failure, permission, missing file, stale workspace, and unknown states. Recovery cards preserve the original message, show attempt count, route to Logs or provider Settings when applicable, and copy only redacted diagnostics. Unit redaction/mapping coverage and six affected Electron core tests pass.
- Activity evidence now carries an explicit state for reads, edits, commands, tests, provider waits, approvals, subagent waits, retries, and blocks. The topbar and composer derive the same authoritative label, and correlated tool activity can expand and center its owning timeline row.
- Completion evidence now carries observed elapsed time, redacted checkout identity, approvals, blockers, changed paths, verification IDs, and child runs. Its compact disclosure occupies a stable status lane so run completion cannot dislodge a bottom-pinned or manually positioned virtualized timeline.
- Verification confidence exposes passed, failed, and blocked scopes independently. Explicit saved project actions use a narrow main-process observation IPC after terminal delivery; they retain the exact redacted command/cwd and conservative test identifiers while leaving exit status unknown rather than inventing terminal completion.
- Retry failures retain an attempt count and first-failure evidence ID across subsequent runs. Evidence updates never clear or rewrite composer drafts or queued messages.
- Focused proof after these changes: 20 evidence unit tests passed; real Electron project-action, evidence/relaunch, oversized-row bottom restore, mid-thread composer growth, and streaming pin semantics all passed together.
- Rapid transitions between independently correlated tools now hold the prior activity for a 140 ms stabilization window, while stop and blocked/error states update immediately; composer and topbar use the same policy. Electron proof observes the old state during the window and the new state afterward.
- Terminal outcome derivation now distinguishes completed, failed, cancelled, interrupted, externally blocked, and partially completed runs (the latter only when successful observed work precedes failure). Completion actions are conditional: Review changes, failed log/test, Commit, Continue, and bounded Retry appear only with supporting state.
- Health aggregation now covers changed paths, failures, running/unknown jobs, submitted context entries, approvals, child runs, verification, checkpoints, and unresolved stale state. Stale unresolved evidence exposes an explicit refresh. Error recovery displays correlated attempt count, stops offering Retry after three attempts, and keeps Continue as an explicit alternate-path draft.

### PX2 verification

- Unit-test evidence authority, correlation, compaction, error mapping, completion derivation, and test classification.
- Core Electron: fake structured activity, failures, completion, relaunch, and health state.
- Live Electron: actual file/tool/command/test activity and terminal completion with real provider auth.
- Re-run:

```bash
pnpm lint
pnpm test:unit
pnpm --filter @pi-gui/desktop run typecheck
pnpm --filter @pi-gui/desktop run test:e2e:core
PI_APP_REAL_AUTH=1 PI_APP_REAL_AUTH_SOURCE_DIR=/absolute/path/to/agent \
  pnpm --filter @pi-gui/desktop run test:e2e:live
```

Real-provider credentials are an execution-time proof requirement, not a reason to weaken the feature contract.

---

## PX3 — Checkpoints, context, boundaries, and approvals

### Outcome

Give users reliable control over what Pi may do, what context it receives, what awaits approval, and how to recover from unwanted changes.

### PX3.1 Automatic checkpoints and undo (`TC-01`)

- [x] Implement checkpoint creation from the PX0 safety contract.
- [x] Create checkpoints before the first observed mutating tool action in a run and before explicit restore/reject operations.
- [x] Avoid repeated full snapshots during one logical change set.
- [x] Expose checkpoint status without interrupting normal work.
- [x] Add a preview listing restorable, conflicted, missing, binary, large, user-owned, and unknown files.
- [x] Default-select only Pi-attributed safe paths.
- [x] Create a rollback checkpoint before restore.
- [x] Verify wrong-worktree, symlink, permissions, disk-full, partial write, concurrent edit, and relaunch cases.
- [x] Add retention controls that never delete checkpoints silently while a restore is pending.

### PX3.2 Context inspector (`TC-02`)

- [x] Add an inspector reachable from the composer.
- [x] Show model/provider, checkout, attachments, file mentions, instructions, skills, memory, and runtime-managed context.
- [x] Explain why each entry is included and whether it is sent externally.
- [x] Allow removal only where Pi GUI actually controls inclusion.
- [x] Make runtime/system entries visibly read-only.
- [x] Preview the manifest for the next message and snapshot the submitted manifest for later inspection.
- [x] Do not expose secret values or hidden system prompts.

### PX3.3 Execution boundaries (`TC-03`)

- [x] Add optional per-thread limits for file count, path allow/deny patterns, dependency modification, command categories, test-only mode, elapsed time, and tool access.
- [x] Validate limits before submission and show the active boundary near the composer.
- [x] Enforce through existing tool-access/runtime hooks where possible.
- [x] Mark advisory-only limits clearly when upstream runtime cannot enforce them.
- [x] Pause and request approval when a hard boundary would be exceeded.
- [x] Record boundary changes and exceptions in the evidence ledger.
- [x] Make “disable boundary” explicit and reversible.

### PX3.4 Approval center (`TC-04`)

- [x] Define desktop-managed approval records with request, source, scope, risk, age, and owning thread/run.
- [x] Add a compact global attention entry without replacing inline approval cards.
- [x] Support approve once, deny, and open thread.
- [x] Do not add “always approve” unless the specific permission model safely supports persisted scope.
- [x] Expire stale requests and show when the runtime no longer accepts a response.
- [x] Restore pending approvals after renderer reload without replaying already answered decisions.
- [x] Notify only according to existing notification preferences.

### PX3.5 Command preview (`ST-01`)

- [x] Preview exact command, cwd, environment redaction, and expected source before significant project actions.
- [x] Distinguish saved project action, agent-proposed command, and user-entered terminal command.
- [x] Require confirmation only for the configured risk threshold; keep routine safe actions efficient.
- [x] Never render secret environment values.
- [x] Record approval/denial and execution outcome.

### PX3.6 Hunk restore substrate (`CR-02` prerequisite)

- [x] Compute Pi-attributed before/after hunks from checkpoints and observed writes.
- [x] Detect overlap with later user/external edits.
- [x] Make conflicted hunks unavailable to one-click reject until reviewed.
- [x] Add pure patch application tests before exposing the control in PX6.

### PX3 implementation notes

- Electron main now owns a content-addressed checkpoint store under user data. Manifests are checkout-identity-bound and integrity-hashed; blobs are hash-verified, size-bounded, and never placed in the repository. Traversal, absolute escape, directories, symlinks, oversized files, malformed manifests, and corrupted blobs fail closed.
- Typed write-tool events create one incremental pre-mutation checkpoint per path/run and finalize the observed post-write hash after tool completion. Repeated writes do not repeat full snapshots. Shell mutations or write tools without a typed path degrade into explicit unknown/failed checkpoint evidence.
- Restore preview rescans current files, selects only safe Pi-attributed paths, disables unsupported/wrong-workspace entries, and requires a second confirmation for deletion or conflicts. Restore creates a rollback checkpoint first, rechecks for concurrent edits, uses same-directory atomic replacement, preserves executable state, and reports per-path partial failure.
- The renderer receives only list, preview, and restore operations scoped by workspace/checkpoint IDs. A compact completion disclosure exposes checkpoint count; expanded recovery shows ownership/status/reason and the rollback result. The real Electron test performs capture, edit, safe preview, restore, rollback creation, and relaunch only in a disposable workspace.
- The composer context inspector builds an app-controlled next-message manifest covering model/provider, checkout, attachments, file mentions, desktop instructions, active skills, explicit project memory, and opaque runtime/workspace context. Only controllable entries can be removed; upstream context is read-only and explicitly unavailable.
- Submitted manifests are snapshotted in a bounded main-owned metadata store and linked to the outgoing message by snapshot ID. Labels and paths are redacted again at the persistence boundary; prompt bodies, secret values, and hidden system prompts are not stored. The inspector rehydrates submitted-history summaries.
- Execution boundaries persist per thread in a hashed main-process store. The composer exposes file-count, path, dependency, command-category, test-only, elapsed-time, and runtime tool-access controls. Explicit prompt crossings are preflighted before submission; denied requests remain drafted, approval-gated crossings require a one-time confirmation, and both policy changes and exceptions enter the evidence ledger. Runtime tool access is enforced through the existing session hook; limits without upstream enforcement are visibly labeled advisory.
- Runtime dialog requests now carry desktop-owned source, thread/run, received-at, and risk metadata. A compact topbar attention entry aggregates pending requests across threads while preserving inline dialogs. Confirm requests support approve-once and deny; all requests can open their owning thread. Timeouts become visibly expired with disabled response actions, pending records survive renderer reload, answered records are removed once, and decisions enter the evidence ledger. Existing notification preferences remain the sole notification gate.
- Significant and destructive saved project actions now open a source-labeled command preview with the exact redacted command, checkout cwd, environment names, and risk before terminal delivery; routine actions retain the one-click path. Secret-like assignments and credential flags are redacted at presentation and persistence boundaries. Denial/approve-once decisions and the subsequent honest execution state enter the ledger. Agent tool rows and the integrated terminal are explicitly identified as agent-proposed and user-entered command surfaces.
- Checkpoint finalization now retains the integrity-verified Pi post-write text blob as well as its hash. The pure hunk substrate computes stable before/after hunks, relocates unchanged hunks across non-overlapping later edits, detects overlapping or ambiguous edits, recognizes already-restored hunks, preserves LF/CRLF content, and refuses conflicted one-click application. Pure tests cover modification, insertion, deletion, partial selection, non-overlap preservation, overlap, ambiguity safety, and line endings.
- Checkpoint fault injection now proves permission-denied, disk-full, and pre-commit I/O failures leave original files intact while reporting per-path partial outcomes and retaining rollback state; wrong-checkout, symlink, concurrent-edit, and Electron relaunch cases remain covered. Persisted retention controls expose a bounded maximum and per-checkpoint protection. Opening a restore preview acquires a persisted lease, and retention excludes protected and pending-restore manifests until release or completion.
- Focused proof: checkpoint/context/boundary unit tests, context preview/removal/submission Electron coverage, checkpoint restore/relaunch Electron coverage, boundary persistence/enforcement/exception Electron coverage, and the affected timeline pinning scenarios pass. The full 163-test Electron core lane passed after PX3.3.

### PX3 verification

- Filesystem unit/integration fixtures must use isolated temporary workspaces.
- Core Electron verifies preview, selection, conflict messaging, approval persistence, context removal, and boundary UI.
- Live Electron verifies at least one real tool write checkpoint and one boundary/approval flow.
- Native proof is required only if restoration or export uses OS pickers.
- Never run destructive restore tests against the user’s real repository.

---

## PX4 — Timeline calmness and subagent legibility

### Outcome

Make long-running, tool-heavy, and multi-agent work easy to follow without hiding the underlying evidence.

### PX4.1 Better subagent visualization (`EX-03`)

- [x] Render parent/child hierarchy with role, task, status, elapsed time, tool count, and outcome.
- [x] Support multiple children, nested children when exposed, retries, cancellation, interruption, and partial aggregation.
- [x] Reuse durable subagent run IDs and audit correlation.
- [x] Keep a compact inline card in the conversation and a richer expanded view.
- [x] Jump from child to transcript preview, related activity, artifacts, and verification.
- [x] Use color as secondary encoding only.
- [x] Preserve Display Mode aggregation and relaunch hydration.

Implementation note: workflow runs now distinguish completed, partial, failed, cancelled, and interrupted outcomes; unfinished children inherit explicit cancellation/interruption instead of remaining deceptively running. Retried workflows persist their source run ID. The conversation card hydrates from the durable run store and expands from the compact role chain into child task/status/elapsed/tool/outcome rows with transcript previews, correlated activity, task evidence, and produced-artifact actions. Runtime/audit IDs remain the authority. Multiple children aggregate durably, while nested parentage is labeled unavailable when the runtime does not expose it. Existing Display Mode aggregation and relaunch hydration remain intact.

Focused proof: all 154 unit tests passed, the built-in workflow Electron scenario passed with two hydrated child runs and relaunch/artifact recovery, the compact-card Electron spec passed, and the full 166-test core lane reached 165 passing with only the pre-fix compact expected-artifact assertion failing; that assertion passed after the compatibility fix.

### PX4.2 Semantic timeline compression (`TL-01`)

- [x] Group repetitive reads, searches, commands, retries, and low-value progress events by correlation and time window.
- [x] Never merge across user messages, approvals, failures, decisions, or different child agents.
- [x] Show group count, duration, summary, and meaningful exceptions.
- [x] Keep raw items expandable and searchable.
- [x] Preserve stable row IDs and scroll restoration.
- [x] Add preference: automatic, compact, or fully expanded.
- [x] Benchmark long transcripts before and after.

Implementation note: a pure renderer model groups only successful low-value rows with the same semantic kind, metadata correlation, and 45-second window. User/assistant narrative, warnings, failures, approvals/decisions represented as non-compressible rows, Agent calls, correlation changes, and time-window crossings flush the group. Group IDs derive from the first raw row and therefore remain stable while streaming appends. Cards show count, duration, summary, and up to three differing labels; raw evidence expands in bounded 120-row pages. Opening thread search temporarily restores the full raw transcript so every item remains searchable. Appearance settings persist Automatic, Compact, or Fully expanded modes on-device.

Focused proof: pure tests cover stable IDs, raw membership, hard boundaries, different child correlation, time windows, all preference modes, and 10,000-row performance (10,000 raw rows to one display row inside a 500 ms budget). The real Electron spec proved grouping, exceptions, raw expansion, search expansion, all three settings choices, fully-expanded behavior, and relaunch persistence.

### PX4.3 Focus mode (`TL-02`)

- [x] Add a keyboard-accessible action that hides sidebar and secondary panels.
- [x] Preserve composer, transcript, essential activity, and approval/error status.
- [x] Escape restores the exact previous layout.
- [x] Persist only if the user explicitly chooses to keep Focus mode.
- [x] Ensure dialogs and command palette still layer correctly.

Implementation note: the topbar Focus action and Shift+Command/Ctrl+F shortcut temporarily suppress the sidebar, sidebar toggle, Changes, Plan, Browser, VS Code, Logs, and Terminal surfaces without mutating their underlying open/closed state. The conversation, composer, task activity/health, errors, and global Approval Center remain mounted. Escape exits and restores the exact prior layout. Focus persistence is off by default and is written only when the user checks Keep; explicitly exiting clears it. Escape is captured before dialog/palette teardown so it closes the topmost overlay first and exits Focus mode only on the next Escape.

Focused proof: the real Electron test opened Changes and Terminal, entered Focus mode from the keyboard, verified the sidebar/panels disappeared while transcript/composer/evidence remained, opened and dismissed the command palette without leaving Focus mode, restored all prior panels with Escape, proved opt-in relaunch persistence, then proved explicit exit clears persistence on the next relaunch.

### PX4.4 Attention markers (`TL-03`)

- [x] Mark user input required, approval, failure, direction change, checkpoint, decision, milestone, and completion.
- [x] Derive markers from evidence records or explicit user actions.
- [x] Provide previous/next keyboard navigation.
- [x] Show position and type without a noisy permanent rail.
- [x] Keep marker state stable after timeline compaction and relaunch.

Implementation note: marker derivation accepts only explicit user messages, trusted evidence records, and structured divider summaries. Pending approvals become Input required; resolved approvals, failures, checkpoints, decisions, passed tests/verifications, completion records, and user direction changes retain distinct text labels and stable evidence/message IDs. Tool-correlated evidence anchors to the exact tool row; other evidence anchors to the nearest durable transcript row. When compression groups a marked raw row, the marker remaps to the stable group ID. A compact floating `N of M · Type` control plus Previous/Next buttons and Option+Up/Down navigation replaces a permanent rail; marked rows use a small color-secondary dot and text/title metadata.

Focused proof: pure tests cover all eight marker categories, authority sources, exact tool correlation, stable IDs, and rehydration. The real Electron test created explicit direction, compressed passed-test milestones, a failed tool, and completion evidence; proved grouped-row marker remapping, button and keyboard navigation/highlighting, and the same marker count/anchors after Electron relaunch.

### PX4.5 Timeline minimap (`TL-05`)

- [x] Add an opt-in narrow overview for long timelines only.
- [x] Encode user messages, subagent spans, failures, approvals, decisions, milestones, and completion.
- [x] Clicking moves the virtualized timeline to the owning stable row.
- [x] Maintain accuracy as rows stream, resize, group, expand, or compact.
- [x] Avoid rendering one DOM node per raw event for huge transcripts.
- [x] Hide automatically when the timeline is too short to benefit.

Implementation note: Appearance now includes an off-by-default Timeline minimap preference. The overview appears only at 100+ raw rows and derives user, Agent/subagent, failure, approval/input, decision, checkpoint/milestone, and completion signals from the same transcript/evidence authorities as attention markers. It recomputes from raw rows, current compressed display rows, and stable marker anchors, so streaming and compression changes cannot leave stale pixel positions. Signals are binned into at most 96 interactive segments regardless of transcript size; bin priority preserves failures/approvals over lower-attention signals. Clicking uses the virtual list’s stable row index and retries highlight attachment while recycled rows materialize.

Focused proof: pure tests prove short-thread hiding, every signal category, compressed stable-row targeting, and a 10,000-row transcript bounded to at most 32 test bins. The real Electron test proved opt-in behavior, a bounded 110-run virtualized overview, milestone/completion encoding, click-to-virtual-row highlighting, resize stability, automatic hiding on a short thread, restoration on the long thread, and preference/relaunch persistence.

### PX4.6 Editable queue refinement (`CV-03`)

- [x] Present queued items in a compact stack above the composer.
- [x] Support edit, reorder, cancel, send next, and convert between queue and steer when runtime state permits.
- [x] Keep attachments and context manifests associated with the correct queued item.
- [x] Preserve ordering and edits across relaunch.
- [x] Make invalid/stale queued items recoverable rather than silently dropping them.

Implementation note: The runtime remains authoritative for its live queue while Electron main mirrors the ordered items into per-session user-data storage with attachments and message metadata intact. Persisted entries are explicitly restored as stale/invalid rather than replayed, can be edited, reordered, cancelled, switched between queue and steer, or sent next, and unavailable file attachments block sending until repaired or removed. Editing a recovered item saves it without accidentally starting a run; editing a live item preserves its identity and context metadata.

Focused proof: unit coverage verifies tolerant recovery and prevents stale items from being silently pushed into the runtime. The real Electron queue suite verifies the compact live stack, attachment edit/cancel behavior, queue/steer timeline semantics, abort cleanup, ordered relaunch recovery, context-manifest and image association, edit/reorder/mode persistence across a second relaunch, and a malformed third item remaining visible with a repair explanation.

### PX4 verification

- Extend timeline and subagent specs rather than adding a new harness.
- Run long-transcript performance and pinning suites.
- Use real-provider `live` proof for multi-child workflows, queued steer, interruption, retry, and relaunch.
- Close with full core and live lanes.

Phase proof: the rebuilt desktop passed 163 unit tests and the full 171-test core Electron lane, including long-transcript virtualization, native-scroll, streaming, pinning, reopen, focus mode, attention marker, compression, minimap, queue, and subagent surfaces. The paid-auth live lane passed all real-provider work (real file context, queued steer, runtime jobs, all built-in multi-child workflows with durable child hydration, prompt submission, tool calls, and branch summary). Its only two failures were deterministic notification-harness expectation issues unrelated to PX4: failed status now intentionally outranks the unseen dot, and background Electron cannot reliably acquire native macOS focus. The corrected notification contract then passed 6/6 in isolation; the final program matrix will rerun the complete live lane once after later phases rather than repeating the 8.7-minute paid workflow at every phase boundary.

---

## PX5 — Thread organization, branching, decisions, and memory

### Outcome

Make accumulated work easy to find, resume, branch, compare, and carry forward deliberately.

### PX5.1 Thread search and organization (`EX-04`)

- [x] Add search across title and safe locally indexed metadata; do not index private transcript bodies without an explicit product decision.
- [x] Group by Today, Yesterday, Previous 7 days, and Older while preserving workspace/worktree hierarchy.
- [x] Add pin/unpin and filters for Running, Waiting, Failed, Completed, Interrupted, and Unverified.
- [x] Keep search/filter state predictable and resettable.
- [x] Define archived-thread interaction and avoid mixing archive with delete.
- [x] Add keyboard navigation and command-palette integration.
- [x] Preserve drag/drop ordering rules where they still apply.

Implementation note: The sidebar organizer searches only thread titles, workspace/worktree labels, branch names, and derived status words; transcript preview/body text is deliberately absent from its index. Pinned threads remain in a dedicated leading section and the rest are grouped by local-calendar Today, Yesterday, Previous 7 days, and Older buckets within the existing workspace/worktree hierarchy. Multi-select status filters use explicit OR semantics, Archived is a separate opt-in, Escape/Reset returns to the default hierarchy, arrow/Enter navigation opens results, and the command palette focuses the search field. Workspace drag ordering is unchanged when the organizer is clear and intentionally disabled while results are filtered.

Focused proof: pure tests cover safe-index exclusion with a secret-like transcript fixture, status derivation, and timezone-safe calendar grouping. The real Electron organizer test covers search, empty state, explicit archived inclusion, reset, keyboard selection, date headings, and command-palette focus; existing archive and pin/relaunch suites remain green.

### PX5.2 Branch from any message (`CV-01`)

- [x] Expose “Try another approach” on eligible user/assistant timeline points.
- [x] Explain what transcript/context is inherited.
- [x] Create the branch through the existing session tree/runtime contract.
- [x] Preserve the original session and checkout state.
- [x] Handle unavailable historical branch points honestly.
- [x] Open the new branch with an editable starter prompt.
- [x] Record parent/branch relationship durably.

Implementation note: eligible user and assistant messages now expose a focusable “Try another approach” action with an
inline confirmation that states the transcript, context, original-tree, and checkout behavior. The action resolves the
visible message back to Pi's durable tree entry, navigates through the existing runtime contract without summarizing,
and synchronizes a persisted editable starter into the composer. If the historical entry cannot be resolved, the UI
reports that limitation without fabricating a branch.

Focused proof: the real Electron fixture branches at a historical assistant response, preserves the original alternate
path in `/tree`, opens the selected path with an editable starter, and retains the selected durable path after relaunch.

### PX5.3 Compare branches (`CV-02`)

- [x] Select two related branches from the session tree.
- [x] Compare outcome, files changed, verification evidence, duration, model, boundaries, subagents, and blockers.
- [x] Keep narrative recommendation visibly separate from observed metrics.
- [x] Open either branch, review its changes, or continue it.
- [x] Handle branches that target different worktrees or stale checkouts.
- [x] Do not auto-merge branches in this phase.

Implementation note: Compare branches lists durable leaves from the current session tree and places two observed-metric
cards beside a separately labelled narrative recommendation. Runtime-unattributed files, verification, boundaries, and
subagents remain explicitly unknown. The surface can open either selected path, continue it, or re-read current checkout
changes, and explains that checkout state may be stale and that no merge is performed.

Focused proof: pure comparison tests cover durable leaf selection, elapsed time, blocker detection, unknown attribution,
and recommendation separation. The branch Electron fixture opens the comparison, renders all required dimensions, and
retains explicit no-auto-merge/stale-checkout copy.

### PX5.4 Decision ledger (`CV-04`)

- [x] Add explicit user-created decisions and assumptions.
- [x] Allow Pi to propose a decision for user confirmation.
- [x] Link decisions to source message/evidence and affected scope.
- [x] Support active, superseded, and withdrawn states.
- [x] Show when a decision influenced a later context manifest.
- [x] Keep edits auditable without turning the UI into a document editor.

### PX5.5 Project memory with user control (`CV-05`)

- [x] Create memory only from explicit user action or confirmed proposal.
- [x] Support global, workspace, and optional thread scope with clear precedence.
- [x] Show exactly what memory will be injected.
- [x] Allow edit, disable, delete, and temporary exclusion.
- [x] Display a small disclosure when memory influenced a submitted request.
- [x] Detect missing/renamed workspace scope.
- [x] Never store secrets or silently import transcript content.

Implementation note: the Context inspector now contains a compact decision/memory control. Decisions retain source,
scope, status, confirmation, and prior-revision audit data. Assistant messages can create an unconfirmed proposal that
does not influence context until confirmed. Memory supports global/workspace/thread scopes with thread-over-workspace-
over-global precedence, edit/disable/delete/exclude-once controls, and missing-workspace disclosure. Resolved entries
are placed in an explicit provider preamble, stripped from the visible transcript, captured in the submitted context
manifest, and summarized by a small “Context used” disclosure.

Security proof: unit and Electron tests use secret-like fixtures to prove credentials are rejected before persistence,
confirm unconfirmed proposals remain inactive, and verify only explicit records survive relaunch. Architecture docs now
record scope, precedence, injection, disclosure, and redaction behavior.

### PX5.6 Resume cards (`CV-06`)

- [x] On reopening an inactive thread, summarize observed completed work, remaining plan items, failures, blockers, decisions, dirty state, and changed external state that can be checked safely.
- [x] Label stale data and provide Refresh.
- [x] Allow dismiss for the session without deleting evidence.
- [x] Avoid showing a card when the thread is recent and nothing meaningful changed.
- [x] Provide Continue, Review changes, Retry failure, and Inspect context actions when applicable.

Implementation note: pre-existing structured evidence on an inactive reopened thread produces a resume card with
observed completions, explicit unavailable plan state, failures/blockers, active decisions, and a freshly re-read
checkout dirty count. Provider/remote state is never guessed. Refresh timestamps the safe recheck, dismiss is
session-only, and applicable Continue, Review changes, Retry failure, and Inspect context actions reuse existing safe
surfaces. A card is not created for a new/recent thread with no meaningful pre-existing evidence.

Focused proof: the evidence-ledger Electron relaunch fixture shows the resume card from durable evidence, rechecks the
checkout, opens Context, dismisses without deleting the completion record, and retains the existing completion surface.

### PX5 verification

- Core Electron covers search, grouping, filters, pinning, branch UI, comparison, decision/memory persistence, and resume states.
- Live Electron proves a real branch from a historical point, continued child branch, queued continuation, and relaunch.
- Add explicit security tests showing memory and search indexes exclude secret-like fixture data.

---

## PX6 — Change intelligence and guided review

### Outcome

Connect requested intent, observed edits, verification, and recoverability into a coherent review workflow.

### PX6.1 Change-intent mapping (`TC-06`)

- [x] Attribute observed file changes to run, tool call, subagent, checkpoint, and originating user request where evidence permits.
- [x] Group changes by user-visible purpose.
- [x] Show unknown/external attribution rather than guessing.
- [x] Update attribution when later runs modify the same lines.
- [x] Keep user edits distinct from Pi edits.
- [x] Persist enough metadata to review after relaunch without storing duplicate file contents outside checkpoints.

### PX6.2 Guided change review (`CR-01`)

- [x] Add review groups ordered by feature/intent rather than filename alone.
- [x] Show summary, files, verification, related decisions, and risk for each group.
- [x] Let users move group-by-group, file-by-file, or hunk-by-hunk.
- [x] Preserve existing reviewed-file markers.
- [x] Support changes with unknown provenance in a separate group.
- [x] Provide a clear completion state for the review itself.

### PX6.3 Accept/reject by hunk (`CR-02`)

- [x] Expose reject only for safely restorable Pi-attributed hunks.
- [x] Preview the resulting diff before applying.
- [x] Create a rollback checkpoint.
- [x] Require explicit confirmation for conflicts, deletions, binary changes, or ownership ambiguity.
- [x] Recompute provenance and verification coverage after rejection.
- [x] Keep “accept” as review state, not a filesystem mutation.
- [x] Add robust patch, newline, rename, and concurrent-edit tests.

### PX6.4 Inline questions on diffs (`CR-03`)

- [x] Allow a line/range selection to create a composer context chip.
- [x] Include file, revision/checkpoint, and selected range without silently copying unrelated content.
- [x] Attach the answer to the reviewed location in local UI metadata.
- [x] Detect stale line mappings after subsequent edits.
- [x] Offer Refresh mapping or open the original checkpoint view.

### PX6.5 Test-to-change linking (`CR-04`)

- [x] Link explicit test evidence to changed files through command cwd, test paths, coverage metadata when available, and observed file references.
- [x] Rank links by authority and show the reason.
- [x] Avoid pretending proximity is proof.
- [x] Clicking a test highlights related change groups; clicking a change shows related tests.
- [x] Support failed, passed, skipped, and unknown results.

### PX6.6 Unverified-change warnings (`CR-05`)

- [x] Mark change groups with no supporting verification evidence.
- [x] Distinguish no tests run, tests failed, unrelated tests passed, and scope unknown.
- [x] Let users run a suggested project action only through the command-preview path.
- [x] Recalculate after hunk rejection or new verification.
- [x] Surface the aggregate in the completion summary and health strip.

### PX6.7 Contextual actions on results (`EX-05`)

- [x] Code blocks: Copy and safe Open first.
- [x] File references: open at file/line in Changes or VS Code when valid.
- [x] Test result cards: open failure, related change, or log.
- [x] Structured patches: preview Apply only when provenance and checkpoint protection exist.
- [x] Shell snippets: preview Run with exact cwd and risk disclosure.
- [x] Hide actions that cannot be supported safely.
- [x] Preserve keyboard and screen-reader access.

### PX6.8 Open-file history (`WA-03`)

- [x] Track files opened or inspected through explicit app/runtime events.
- [x] Store path, last relevant line/range, source, and time.
- [x] Avoid treating arbitrary shell output paths as opened files.
- [x] Provide a compact recent-files list in review/navigation surfaces.
- [x] Remove stale entries cleanly when files disappear.

### PX6 verification

- Unit-test provenance authority, hunk restore, stale mapping, verification-link ranking, and unverified-state derivation.
- Core Electron covers guided review and all safe/unsafe action states.
- Live Electron proves real file writes, tests, contextual opens, and completion recalculation.
- Native proof is required for any action that invokes an OS-level opener rather than the existing in-app route.

---

## PX7 — Workspace productivity, artifacts, settings, and handoff

### Outcome

Make the broader desktop workspace persistent, searchable, portable, and efficient without crowding the conversation.

### PX7.1 More useful command palette (`EX-07`)

- [x] Index threads, workspaces, Settings sections, panels, models, skills, agents, project actions, review groups, artifacts, and recent files.
- [x] Add category labels and stable keyboard navigation.
- [x] Show recent and explicitly pinned commands.
- [x] Keep destructive/significant actions behind preview or confirmation.
- [x] Add subtle `⌘K` education in appropriate empty states.
- [x] Avoid indexing secret values or full transcript content.
- [x] Keep palette results responsive for large histories.

### PX7.2 Persistent panel layouts (`EX-08`)

- [x] Persist open/closed state and widths for Terminal, Changes, Browser, Logs, plan, side drawer, and VS Code per workspace.
- [x] Restore only panels that remain available.
- [x] Clamp stale sizes to the current window.
- [x] Provide Reset workspace layout.
- [x] Preserve Focus mode’s temporary override semantics.
- [x] Test relaunch, workspace switch, narrow window, and removed capability cases.

### PX7.3 Artifact shelf (`WA-01`)

- [x] Index plans, screenshots, reports, generated assets, logs, and user-selected files as references.
- [x] Group by thread/run and type.
- [x] Show missing, moved, private, and export-excluded states.
- [x] Provide Open, Reveal, Copy path, Attach to next message, and Include in handoff where safe.
- [x] Do not copy or commit artifacts automatically.
- [x] Avoid previewing sensitive logs without explicit user action.

### PX7.4 Worktree lifecycle card (`WA-02`)

- [x] Show purpose, branch, source branch, path, owning thread, dirty state, running tasks, and creation time.
- [x] Distinguish active, ready, stale, missing, and cleanup-eligible.
- [x] Make cleanup eligibility advisory only.
- [x] Any actual deletion remains an explicit destructive action requiring approval and a resolved target list.
- [x] Link to related branches, changes, checkpoints, and artifacts.
- [x] Never equate “merged” with “safe to delete” without checking local state.

### PX7.5 Natural-language Settings search (`WA-04`)

- [x] Build a curated synonym index over Settings labels, descriptions, and actions.
- [x] Support queries such as “make text bigger,” “subagent model,” and “turn off crash reports.”
- [x] Navigate to and highlight the exact control.
- [x] Keep matching local and deterministic; no paid model call is required.
- [x] Add keyboard entry from Settings and the command palette.
- [x] Do not mutate a setting directly from search results without explicit activation.

### PX7.6 Workspace handoff package (`WA-05`)

- [x] Generate a previewable Markdown handoff containing user-selected decisions, changes, verification, blockers, artifacts, and links.
- [x] Redact absolute paths where workspace-relative paths suffice.
- [x] Exclude transcript bodies, logs, secrets, environment values, binary contents, and private artifacts by default.
- [x] Mark observed evidence versus narrative summary.
- [x] Support Copy, Save, and Attach to another task through existing safe surfaces.
- [x] Add deterministic snapshot tests for redaction and missing artifacts.

### PX7.7 Workspace-specific shortcuts (`ST-05`)

- [x] Allow shortcuts for project actions and safe navigation/workflow commands.
- [x] Detect conflicts with app, OS, and reserved shortcuts.
- [x] Provide disable, edit, and reset.
- [x] Keep command preview for significant actions.
- [x] Persist per workspace and surface assignments in the command palette/tooltips.

### PX7.8 Attachment and artifact convergence

- [x] Allow artifact references to become attachment chips without duplicating content unnecessarily.
- [x] Preserve sensitivity/export flags.
- [x] Handle missing files and workspace switches.
- [x] Ensure queued messages retain the intended artifact version.

### PX7 verification

- Core Electron covers palette breadth, search, persistence, reset, artifacts, worktree card, Settings search, shortcuts, and handoff preview.
- Native targeted specs cover Save/Open/Reveal only if those use real macOS dialogs.
- Production packaged smoke verifies restored layout and safe handoff generation after relaunch.

Implementation note, 2026-07-25:

- The palette now covers workspace and task navigation, Settings, panels, runtime choices, project actions, review groups, artifacts, and recent files with categories, recents, pinning, safe previews, bounded local indexing, and `⌘K` education.
- Palette search scans the complete local index but renders at most 120 matches and asks the user to refine broad queries. A 20,000-action unit regression proves broad results stay bounded while an exact late-index command remains discoverable.
- Workspace layouts, artifact references and immutable attachment versions, worktree health, deterministic Settings search, redacted handoff previews, and workspace shortcuts converge in the Workspace hub without copying, committing, deleting, or exporting data automatically.
- Core Electron coverage verifies palette breadth, layout persistence/reset/clamping, artifact and worktree states, Settings search, shortcut conflicts, handoff redaction, missing artifacts, and queued attachment version retention.

---

## PX8 — Display Mode refinement, adaptive recommendations, and delight

### Outcome

Complete the program with a more efficient command center, optional intelligent customization, and restrained product personality.

PX8.1 and PX8.2 are dependency-free after the PX0 baseline and are intentionally included in the recommended early checkpoints. PX8.3–PX8.6 remain final integration work because they depend on the completed navigation, evidence, activity, and preference systems.

### PX8.1 Collapse empty Display Mode preview (`UI-02`)

- [x] Keep the Preview drawer collapsed when no URL or previewable artifact exists.
- [x] Provide a clear affordance to open it manually.
- [x] Auto-open only from explicit preview actions, not incidental transcript links.
- [x] Use an app surface rather than a dominant black rectangle for an empty preview.
- [x] Persist user pin/open choice per workspace.
- [x] Restore tile width immediately when the drawer closes.

### PX8.2 Simplify Display Mode controls (`UI-06`)

- [x] Replace the `Auto, 1–8` strip with a compact layout control.
- [x] Keep Auto as the default and expose exact columns through a menu or stepper.
- [x] Strengthen selected state for Desktop/Mobile without using color alone.
- [x] Clarify compact-density scope.
- [x] Keep filters keyboard accessible and usable at narrow widths.
- [x] Preserve drag ordering and pinned tile behavior.

Implementation note, 2026-07-25:

- Preview drawer pin/open state and the broader panel layout now persist per workspace, restore only available surfaces, clamp stale widths, and retain Focus mode as a temporary override.
- The compact layout selector explains that density applies to Display Mode cards, while exact column choices, keyboard filters, drag ordering, and pinned tiles remain intact.
- Adaptive suggestions use coarse local counters only, explain their reason, and require Apply; Dismiss and Reset remain explicit and no telemetry or silent reordering is introduced.
- Restrained state artwork, evidence-gated success treatment, the Appearance toggle, and reduced-motion behavior are implemented across empty, working, waiting, success, failure, and subagent states.
- Cross-surface status vocabulary, density, focus restoration, Escape handling, labels, and secondary-surface states were audited in the final Electron screenshot set.

### PX8.3 Adaptive interface recommendations (`ST-04`)

- [x] Track only local coarse usage necessary to recommend a layout.
- [x] Never send usage telemetry automatically.
- [x] Recommend pinning frequent actions or moving unused controls to overflow.
- [x] Require explicit Apply.
- [x] Offer Dismiss and Reset recommendations.
- [x] Never silently reorder controls.
- [x] Explain why each recommendation appeared.

### PX8.4 Restrained personality (`EX-12`)

- [x] Define a small state mapping for empty, working, waiting, success, failure, and subagent activity.
- [x] Reuse the existing curated assets.
- [x] Keep artwork secondary to status and content.
- [x] Avoid animation during text selection, review, or focused writing.
- [x] Respect reduced motion.
- [x] Verify assets in light/dark and at high DPI.

### PX8.5 Success moments (`ST-03`)

- [x] Trigger only from evidence-backed terminal success.
- [x] Require planned work complete and required verification green when those concepts exist.
- [x] Use a brief, non-blocking visual treatment.
- [x] Do not trigger for partial completion, cancelled work, or assistant-only claims.
- [x] Respect reduced motion and provide an Appearance toggle.

### PX8.6 Final cross-surface coherence

- [x] Ensure activity, health, completion, attention markers, approvals, and verification do not duplicate one another.
- [x] Ensure topbar, composer, sidebar, Display Mode tiles, and completion cards use the same status vocabulary.
- [x] Ensure density/font settings apply coherently.
- [x] Ensure every new secondary surface has a useful empty, loading, error, stale, and populated state.
- [x] Audit tab order, focus restoration, escape behavior, screen-reader labels, and reduced motion.
- [x] Repeat the full screenshot set and compare against PX0.

### PX8 verification

```bash
pnpm lint
pnpm test:unit
pnpm typecheck
pnpm build
pnpm --filter @pi-gui/desktop run test:e2e:core
PI_APP_REAL_AUTH=1 PI_APP_REAL_AUTH_SOURCE_DIR=/absolute/path/to/agent \
  pnpm --filter @pi-gui/desktop run test:e2e:live
pnpm --filter @pi-gui/desktop run test:e2e:native
pnpm --filter @pi-gui/desktop run test:prod:packaged-smoke
```

Final verification note, 2026-07-25:

- Lint, typecheck, all 46 unit files / 199 tests, the root production build, and `git diff --check` passed. Reduced-motion suppression has a direct unit regression in addition to the CSS media-query and visual accessibility coverage.
- The real Electron core lane passed 179/179 after review refresh dependencies were stabilized; repeated timeline pinning passed 10/10 and the complete timeline/change-review focus lane passed 11/11.
- The expanded screenshot harness passed and was inspected across light, dark, forced-colors, compact, narrow, command palette, artifact shelf, Display Mode, success, and review surfaces.
- A fresh packaged macOS bundle passed smoke. The complete paid-auth real-provider Electron lane passed 40/40 in one 14.2-minute run, including real file/test mapping, attachments, queues, runtime jobs, every built-in multi-child workflow with durable relaunch hydration, prompt submission, tool calls, and tree summarization.
- The complete foreground native Electron lane passed 9/9 after macOS was unlocked: Finder Reveal, native image attachment, all five open-folder entry/cancel paths, and both real clipboard paste surfaces.

Also run the final real-Electron screenshot harness for:

- light and dark;
- Compact and Comfortable;
- empty, populated, running, waiting, failed, blocked, and successful;
- long timeline with compression/minimap;
- parent plus multiple child agents;
- Settings, Skills, Extensions, Review, Changes, artifacts, command palette, and Display Mode;
- normal and narrow supported window sizes.

---

## Coverage matrix — all accepted suggestions

| ID | Accepted suggestion | Owning phase/task |
| --- | --- | --- |
| UI-01 | Improve text contrast | PX1.1 |
| UI-02 | Collapse empty Display Mode preview | PX8.1 |
| UI-03 | Center and improve Skills/Extensions empty states | PX1.2 |
| UI-04 | Reduce topbar icon overload | PX1.3 |
| UI-05 | Make New Thread useful with repo-aware starters | PX1.4 |
| UI-06 | Simplify Display Mode controls | PX8.2 |
| UI-07 | Tighten Settings layout | PX1.5 |
| UI-08 | Improve sidebar scanability and width | PX1.6 |
| EX-01 | Completion summary card | PX2.3 |
| EX-02 | Clearer live activity | PX2.2 |
| EX-03 | Better subagent visualization | PX4.1 |
| EX-04 | Thread search and organization | PX5.1 |
| EX-05 | Contextual actions on assistant results | PX6.7 |
| EX-06 | Stronger error recovery | PX2.6 |
| EX-07 | Universal command palette | PX7.1 |
| EX-08 | Persistent panel layouts | PX7.2 |
| EX-09 | Compact thread health strip | PX2.5 |
| EX-10 | Better attachment presentation | PX1.7 |
| EX-11 | Density and font preferences | PX1.8 |
| EX-12 | Restrained Pi/Shinobi personality | PX8.4 |
| TC-01 | Automatic checkpoints and one-click undo | PX3.1 |
| TC-02 | Context inspector | PX3.2 |
| TC-03 | Execution boundaries | PX3.3 |
| TC-04 | Approval center | PX3.4 |
| TC-05 | Verification confidence | PX2.4 |
| TC-06 | Change-intent mapping | PX6.1 |
| CV-01 | Branch from any message | PX5.2 |
| CV-02 | Compare branches | PX5.3 |
| CV-03 | Editable message queue | PX4.6 |
| CV-04 | Decision ledger | PX5.4 |
| CV-05 | Project memory with user control | PX5.5 |
| CV-06 | Resume cards | PX5.6 |
| TL-01 | Semantic timeline compression | PX4.2 |
| TL-02 | Focus mode | PX4.3 |
| TL-03 | Attention markers | PX4.4 |
| TL-04 | Sticky current activity | PX2.2 |
| TL-05 | Timeline minimap | PX4.5 |
| CR-01 | Guided change review | PX6.2 |
| CR-02 | Accept/reject by hunk | PX3.6 + PX6.3 |
| CR-03 | Inline questions on diffs | PX6.4 |
| CR-04 | Test-to-change linking | PX2.7 + PX6.5 |
| CR-05 | Unverified-change warnings | PX2.4 + PX6.6 |
| WA-01 | Artifact shelf | PX7.3 |
| WA-02 | Worktree lifecycle card | PX7.4 |
| WA-03 | Open-file history | PX6.8 |
| WA-04 | Natural-language Settings search | PX7.5 |
| WA-05 | Workspace handoff package | PX7.6 |
| ST-01 | Command preview | PX3.5 |
| ST-02 | Relative-time expansion | PX1.9 |
| ST-03 | Success moments | PX8.5 |
| ST-04 | Adaptive interface learning | PX8.3 |
| ST-05 | Workspace-specific shortcuts | PX7.7 |

Coverage: **52 of 52 accepted suggestions assigned.**

## Cross-cutting test matrix

| Capability | Unit | Core Electron | Live Electron | Native | Production |
| --- | --- | --- | --- | --- | --- |
| Visual layout, contrast, density | token/model checks | required | — | — | screenshot smoke |
| Activity/evidence/completion | derivation and authority | fake-event required | real-provider required | — | relaunch smoke |
| Checkpoint/restore | filesystem fixtures | isolated workspace required | real write required | picker only if used | packaged persistence |
| Context/memory/boundaries | manifest/precedence | required | provider submission required | — | relaunch |
| Approvals/queue/subagents | state machines | required | real-provider required | notifications if used | relaunch |
| Timeline compression/minimap | grouping/model | long transcript required | streaming/subagents | — | packaged smoke |
| Branch/compare/resume | graph/summary | required | real branch required | — | relaunch |
| Review/provenance/hunks | patch/authority | required | real writes/tests | opener if used | — |
| Artifacts/handoff | index/redaction | required | — | Save/Open if used | packaged export |
| Panels/palette/shortcuts | models/conflicts | required | — | reserved shortcut smoke | relaunch |

## Performance budgets

These are initial budgets; PX0 records baselines and may tighten them.

- Evidence append must not trigger a full desktop-state persistence write for every streaming token.
- Activity presentation may coalesce rapid events, but terminal failure/stop must become visible promptly.
- Timeline grouping/minimap must not regress current long-transcript scroll stability.
- Command palette query should remain interactive with large thread/artifact indexes.
- Sidebar resize and panel restore must not cause visible transcript scroll jumps.
- Context manifest generation must not read arbitrary file contents merely to display metadata.
- Checkpoint creation must avoid copying unchanged workspace trees.

## Security and privacy gates

- No secrets, tokens, cookies, provider credentials, hidden prompts, or environment values in evidence, memory, exports, screenshots, or command previews.
- No transcript indexing for search or memory without an explicit follow-up product decision.
- No checkpoint cleanup, worktree cleanup, or artifact deletion without resolved targets and approval.
- No restore into a different workspace/worktree identity.
- No automatic execution from code blocks.
- No “verified” badge from assistant prose.
- No automatic memory creation or silent memory injection.
- No adaptive control movement without explicit Apply.
- No external telemetry added by this program.

## Documentation updates required during implementation

- Update [`../../docs/architecture.md`](../../docs/architecture.md) when evidence, checkpoint, context, memory, artifact, or preference ownership lands.
- Add a durable checkpoint/restore safety document before PX3 closes.
- Document evidence authority and verification semantics before PX2 closes.
- Document memory/context scopes and export redaction before PX5/PX7 close.
- Update [`../../apps/desktop/README.md`](../../apps/desktop/README.md) if new test lanes, environment variables, or production proofs are introduced.
- Keep this file’s status and implementation notes current after every focused checkpoint.

## Execution rules

1. Work in phase order unless a task is explicitly dependency-free.
2. Keep each checkpoint focused enough to review and revert independently.
3. Do not combine checkpoint filesystem mutation with unrelated visual redesign.
4. Use existing Electron helpers and lanes; extend them rather than creating another harness.
5. Run `simplify` before closing non-trivial implementation work when available; otherwise record the unavailable command and perform manual diff review plus `git diff --check`.
6. Do not commit or push unless the user separately authorizes it.
7. Do not use real user workspaces for destructive-adjacent test cases.
8. When capability discovery changes scope, update the coverage row and degraded behavior rather than silently dropping the suggestion.

## Recommended first implementation checkpoints

1. PX0 capability/evidence/checkpoint contracts and baseline.
2. PX1.1 contrast plus PX1.2 empty-state correction.
3. PX8.1 empty preview collapse plus PX8.2 Display Mode control simplification.
4. PX1.5 Settings width and PX1.6 sidebar resize/scanability.
5. PX1.3 topbar hierarchy and PX1.4 New Thread starters.
6. PX2.1 evidence ledger foundation.
7. PX2.2 live activity plus PX2.6 error recovery.
8. PX2.3 completion card plus PX2.4 verification confidence.

This ordering delivers visible improvements early while establishing the evidence substrate required for the program’s more ambitious trust and review features.
