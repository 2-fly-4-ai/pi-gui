# T3-Inspired Product And Platform Improvements

Date opened: 2026-08-28
Date completed: 2026-08-28
Status: complete
Owner: pi-gui desktop
Source review: `pingdotgg/t3code` `main` at `94401d01b956828eaa989ff4a80046c20d7b6088`

## Objective

Adapt the parts of T3 Code's current product that close real Pi GUI gaps without replacing Pi GUI's
existing Electron-main source of truth, Pi JSONL transcripts, typed delta IPC, evidence/checkpoint
model, session dormancy, or bounded Display Mode architecture.

This program is complete only when every locally actionable phase below is implemented and verified
on the real Electron surface. The remote-execution phase is an architecture **spike**, but its close
condition includes executable code and transport/lifecycle proof; a design document alone does not
complete it.

## Approved Scope

1. Resource Inspector and Diagnose Pi.
2. GitHub PR workbench.
3. Provider-neutral usage dashboard.
4. Project Actions v2.
5. Prompt Shelf.
6. Theme gallery with safe VS Code/OpenVSX-inspired palette import.
7. Remote-execution architecture spike.

## Existing Foundations To Preserve

- `DesktopAppStore` remains the desktop state source of truth.
- Selected transcripts remain bounded projections over Pi's authoritative JSONL history.
- Display Mode continues to use bounded eight-row projections and viewport residency.
- Runtime jobs, terminal roots, VS Code leases, subagent runs, and Electron metrics remain the
  authoritative ownership sources for local processes.
- The current evidence ledger, content-addressed checkpoints, frozen review snapshots, approvals,
  and selective hunk rejection remain authoritative.
- Skills continue to come from upstream Pi discovery and the current profile/catalog layer.
- Preload stays narrow; no generic shell, filesystem, process, GitHub, or network bridge is allowed.
- Existing dirty worktree changes are preserved. New work must not discard or rewrite unrelated
  edits.

## Explicit Non-Goals

- Do not port T3's Effect/SQLite event store or replace the state-delta architecture.
- Do not replace Pi's checkpoint model with hidden Git refs.
- Do not add separate Claude, Cursor, Grok, Codex, or OpenCode harness drivers; Pi's provider/model
  abstraction remains authoritative.
- Do not claim Windows support. The existing platform decision still requires a dedicated Windows
  project.
- Do not ship a public remote service, relay, mobile client, production SSH tunnel, or remote updater
  as part of the architecture spike.
- Do not post PR comments, create/merge PRs, publish releases, install themes, or mutate external
  services without the user's explicit action on the corresponding UI control.

## Cross-Cutting Product And Safety Contracts

### Data ownership

- New durable state is Electron-main owned and stored under `app.getPath("userData")` through the
  existing atomic/bounded JSON store patterns.
- Renderer storage may hold ephemeral presentation preferences only. Project actions, prompt shelf
  entries, usage indexes, diagnostic history, PR links, and theme definitions are not renderer-only
  state.
- Every list/history has count, byte, and age ceilings plus deterministic eviction.
- Corrupt persisted data produces a recoverable diagnostic and preserves the original bytes where
  the existing store contract supports that behavior.

### Privacy and secrets

- Diagnostic and resource surfaces never expose environment variables, prompt/transcript bodies,
  provider credentials, cookies, private keys, or full command arguments.
- Paths are reduced to workspace-relative paths or home-redacted display paths before renderer IPC.
- Source-control errors strip URL user info, query strings, fragments, and token-shaped text.
- Usage aggregation reads only Pi-owned session data and never scans `.env`, provider credential
  stores, or unrelated provider CLI histories.
- Imported themes are data only. Theme packages may not execute scripts or inject CSS/HTML.

### Performance

- No new feature may bulk-load every transcript or issue one IPC event per token/process sample.
- Resource streaming is demand-driven and coalesced; the inspector being closed must not create a
  renderer stream.
- Usage indexing is incremental and bounded; revisiting the dashboard must not rescan unchanged
  multi-megabyte histories.
- PR and theme network reads are cancellable, timeout-bounded, response-size bounded, and cached.
- Prompt Shelf and Project Actions must not add full-state persistence to composer keystrokes.

### Accessibility and visual quality

- Every interactive control is keyboard reachable, named, focus-visible, and usable at narrow
  widths.
- Charts have text/table equivalents and never encode state by color alone.
- Light, dark, forced-colors, reduced-motion, compact density, and increased font sizes are covered.
- New secondary surfaces reuse the existing settings/secondary-surface shell and semantic tokens.

## Phase T3-0 — Baseline, Contracts, And Harness

### Work

- [x] Record this plan in `plans/active/README.md` and keep phase status current.
- [x] Capture a baseline `typecheck`, targeted unit suite, production build, and current Electron
  core failures before feature edits; existing failures must be distinguished from regressions.
- [x] Add shared bounded-value helpers only where existing helpers cannot own the contract.
- [x] Define typed IPC/domain contracts for resources, diagnostics, source control, usage, project
  actions, prompt shelf, themes, and the remote spike before exposing UI.
- [x] Identify each feature's main-owned service, preload method, renderer hook, UI surface, and
  persistence file.

### Close evidence

- The baseline result is recorded in this file.
- Contracts contain explicit limits and redacted display shapes.
- No broad preload method is introduced.

## Phase T3-1 — Resource Inspector And Diagnose Pi

### Main-owned resource service

- [x] Add a `ResourceInspectorService` that merges:
  - Electron `app.getAppMetrics()` process metrics;
  - main and renderer heap/working-set data already used by the memory monitor;
  - runtime-job process identities from selected/running sessions;
  - terminal PTY roots from `TerminalService`;
  - verified VS Code owned leases;
  - subagent process/run ownership and existing resource-safety counters.
- [x] Use PID plus process start identity where available. Unknown start identity must be shown as
  lower-confidence attribution rather than silently trusted.
- [x] Collect one host process snapshot per sampling interval, not one process command per owned PID.
- [x] Default to a low-frequency 15-second health sample; use a 1-second sample only while the
  inspector is subscribed and visible; stop high-frequency sampling promptly on unsubscribe.
- [x] Retain at most 15 minutes of detailed history, 900 snapshots, 20,000 process rows, and 16 MiB,
  whichever limit is reached first.
- [x] Publish aggregate snapshots at most once per second and only to active subscribers.
- [x] Detect sustained memory growth, critical heap ratio, sustained high CPU, owned-process
  multiplication, stale running jobs, and provider-wait duration. Warnings require multiple samples
  to avoid single-sample noise.
- [x] Allow stop actions only for already-owned cancellable runtime jobs/terminals. Never kill an
  arbitrary PID from renderer input.
- [x] Retain the current opt-in JSONL memory monitor for deep support evidence; the new inspector is
  not a second unbounded log.

### Resource UI

- [x] Add a Resource Inspector panel reachable from the top-bar panels menu and App Logs.
- [x] Show total app CPU/RAM, main/renderer heap, owned children, active tasks, top consumers,
  confidence, recent warnings, and a bounded history graph plus accessible table.
- [x] Provide filters for Electron, provider/runtime, terminal, VS Code, and subagent categories.
- [x] Provide `Open task`, `Open logs`, and safe `Stop owned job` actions.
- [x] Preserve panel state across task switches without keeping the high-frequency subscription
  alive while hidden.

### Diagnose Pi

- [x] Add `Diagnose Pi` to App Logs and the command palette.
- [x] Generate a redacted, size-bounded diagnostic bundle containing versions, platform, app health,
  recent failure summaries, current resource summary, owned-child summary, provider availability,
  VS Code/terminal health, and relevant safe paths.
- [x] Never include transcript text, prompts, tool output, environment values, credentials, or raw
  command lines.
- [x] Offer `Start diagnostic task`, `Copy redacted report`, and `Open logs folder`.
- [x] Starting a diagnostic task creates one normal Pi task with a stable local playbook and bundle
  reference; it must not duplicate the task on double activation.
- [x] The playbook asks for symptoms, inspects evidence read-only, searches for an existing issue
  only when the user requests network use, and requires explicit confirmation before posting.

### Verification

- [x] Unit: limits, attribution, PID reuse, redaction, warning hysteresis, no arbitrary PID stop,
  bundle bounds, corrupt history, and subscription lifecycle.
- [x] Electron core: panel navigation, keyboard/accessibility, live sampling, task switching,
  hidden-panel unsubscribe, safe stop, diagnostic bundle, and exactly-one task creation.
- [x] Performance: ten parallel seeded runs plus terminal and VS Code remain within existing queue,
  heap, IPC, and process ceilings while the panel is opened and closed repeatedly.
- [x] Restart: no stale high-frequency sampler, duplicate diagnostic task, or lost panel preference.
- [x] Visual: light, dark, forced-colors, reduced-motion, compact, increased font, and narrow width.
- [x] Live provider: a real run is attributed to its task and reaches a terminal state without an
  orphaned process.

## Phase T3-2 — GitHub PR Workbench

### Source-control service

- [x] Replace the direct GitHub-only command helpers with a typed `SourceControlProvider` boundary
  while retaining the existing commit/push/create-PR UI behavior.
- [x] Implement GitHub first through `gh` JSON output and bounded `git` commands; provider methods
  cover discovery/auth health, current repository, current branch PR, PR list/detail, checks,
  reviews, comments, files, checkout, update branch, create, edit own content, and external open.
- [x] Normalize HTTPS and SSH remotes, forks, self-hosted hosts, detached/unborn branches, missing
  upstreams, and unauthenticated/missing `gh` states.
- [x] Add timeouts, maximum output bytes, cancellable reads, redacted errors, and per-workspace cache
  invalidation after mutations.
- [x] Persist a bounded task-to-PR link containing only provider, host, repository, PR number, and
  last observed state.

### PR UI

- [x] Add a `Pull requests` secondary surface and a compact current-PR panel from the existing
  GitHub actions menu/review surface.
- [x] Show current/open PRs, title, author, branch/base, merge state, checks, review verdicts,
  comments, commits, and changed files without duplicating the local diff viewer.
- [x] Allow opening/checking out a PR, linking/unlinking the current task, refreshing, creating a PR,
  editing user-owned title/body/comments, replying, and sending a line/comment to Pi as quoted
  context.
- [x] All remote writes show a preview and require an explicit final user activation. No background
  auto-comment, auto-push, auto-update, auto-merge, or auto-archive.
- [x] When a linked PR becomes merged/closed, show a task completion suggestion; archival remains a
  user action.
- [x] Surface auth health and exact recovery instructions instead of a generic failure.

### Verification

- [x] Unit: remote parsing, provider discovery, auth states, error redaction, output limits, cache,
  PR link persistence, mutation previews, and self-hosted/fork edge cases.
- [x] Electron core: fake `gh` contract covers list/detail/checks/comments/checkout/link/task-context,
  keyboard behavior, task switching, restart hydration, and no external mutation on read paths.
- [x] Live: read-only proof against a public GitHub repository when network is available.
- [x] External-write proof remains opt-in and is not required for local completion unless the user
  explicitly authorizes a disposable test PR/repository.
- [x] Visual/accessibility matrix matches T3-1.

## Phase T3-3 — Provider-Neutral Usage Dashboard

### Usage index

- [x] Aggregate usage from Pi-owned assistant records: input, output, cache read/write, reasoning
  where reported, total tokens, and provider-reported cost fields.
- [x] Key records by stable session/message identity and source file revision so repeated scans do
  not double-count.
- [x] Maintain an incremental, main-owned, bounded index; prune records older than 90 days and cap
  index bytes.
- [x] Support task, workspace, provider, model, and time buckets for current task, 24 hours, 7 days,
  30 days, and 90 days.
- [x] Distinguish provider-reported cost, model-estimated cost, unpriced usage, and subscription/API
  billing. Do not present an estimate as a bill.
- [x] Keep pricing data versioned and optional. Unknown/new models still contribute tokens.
- [x] Reconcile current context-window usage with the existing composer indicator without making
  the Codex usage extension authoritative for historical usage.

### Usage UI

- [x] Add a `Usage` secondary surface and a context-indicator link.
- [x] Show totals, trend, cache savings, provider share, model breakdown, and workspace/task tables.
- [x] Provide token/cost toggles and exact accessible tabular values for every chart.
- [x] Explain data source, last indexed time, unpriced rows, and billing limitations.

### Verification

- [x] Unit: provider/model aggregation, legacy missing usage, dedupe, incremental updates, pruning,
  time zones, cache savings, unknown pricing, corrupt files, and index byte limits.
- [x] Electron core: navigation, filters, task switching, context-indicator link, restart persistence,
  empty/partial states, and no full rescan of unchanged transcripts.
- [x] Performance: 90-day synthetic index and thousands of messages remain responsive and bounded.
- [x] Live provider: a real completed turn increases the correct provider/model bucket exactly once.
- [x] Visual/accessibility matrix matches T3-1.

## Phase T3-4 — Project Actions V2 And Prompt Shelf

### Project Actions v2

- [x] Move actions from renderer `localStorage` to a main-owned bounded store with versioned lazy
  migration that leaves the legacy value intact until the main write succeeds.
- [x] Preserve name, command, keybinding, workspace, and worktree-creation behavior.
- [x] Add semantic icon, optional preview URL, optional auto-open-preview, ordering, and a primary
  action.
- [x] Discover common package-manager scripts read-only; discovered scripts require explicit save
  before becoming trusted Pi actions.
- [x] Add import/export for a repository-owned declarative action file after path/command review.
  Import never auto-runs a command.
- [x] Run through the existing terminal/runtime-job boundary so lifecycle, cancellation,
  observability, execution-boundary rules, and evidence remain authoritative.

### Prompt Shelf

- [x] Add a main-owned, provider/model/workspace-neutral shelf capped at 20 entries and a documented
  byte budget.
- [x] Shelf entries contain text, safe attachment snapshots/references, creation time, and optional
  user label; they never restore model, access, boundary, branch, or workspace implicitly.
- [x] `Stash` persists before clearing the composer. Failed persistence leaves the draft untouched.
- [x] `Restore` previews missing/expired attachments and removes the shelf entry only after the
  destination draft is durably updated.
- [x] Reuse attachment quotas and main-owned snapshots; do not store base64 images in renderer
  `localStorage`.
- [x] Support reorder, rename, delete with confirmation, copy into current draft, and move into an
  explicitly selected workspace/task.

### Verification

- [x] Unit: migration, corruption, bounds, trust state, preview URL validation, script discovery,
  attachment expiry, persist-before-clear, restore atomicity, and quota failures.
- [x] Electron core: action CRUD/run/cancel/restart/worktree/preview behavior and Shelf
  stash/restore/reorder/task-switch/restart flows using visible UI.
- [x] Performance: 20 maximum-size shelf entries and hundreds of discovered scripts do not impair
  composer input or command-palette search.
- [x] Visual/accessibility matrix matches T3-1.

## Phase T3-5 — Theme Gallery

### Theme model and import

- [x] Extend appearance from mode-only state to semantic palette definitions layered under
  system/light/dark resolution.
- [x] Ship a small curated built-in gallery using existing Pi semantic tokens.
- [x] Import a local VS Code JSON theme as data; support JSON/JSONC colors and includes only within
  the selected import root.
- [x] Add OpenVSX-inspired search/download only through a narrow main-owned service with HTTPS host
  allowlisting, timeout/size/entry/path/decompression/include-depth limits, SHA verification where
  published, and an explicit license allowlist.
- [x] Never run extension code, lifecycle scripts, CSS, HTML, fonts, binaries, or settings.
- [x] Derive a complete Pi palette from editor canvas/accent, flatten alpha colors, clamp gamut, and
  repair required contrast ratios. Reject a theme that cannot satisfy core accessibility roles.
- [x] Preserve appearance mode independently from selected palette and provide a one-click reset.
- [x] Persist imported definitions with count/byte limits and source/version metadata.

### Theme UI

- [x] Add built-in, imported-file, and OpenVSX gallery sections under Appearance with preview,
  search, source/license, install, apply, remove, and reset controls.
- [x] Preview applies reversibly and reverts on cancel, navigation, crash recovery, or failed save.
- [x] Embedded VS Code, terminal, charts, review, diagnostics, and all secondary surfaces consume the
  resolved semantic palette consistently.

### Verification

- [x] Unit: JSONC, includes, alpha/P3 colors, contrast correction, zip-slip, zip bombs, host
  allowlist, hash/license rejection, palette persistence, and mode independence.
- [x] Electron core: import/apply/preview/cancel/remove/restart plus every major secondary surface.
- [x] Network search uses a deterministic fake in core; optional live read-only OpenVSX proof may
  run when network is available.
- [x] Full light/dark/forced-colors/reduced-motion/compact/increased-font/narrow screenshot audit.

## Phase T3-6 — Remote-Execution Architecture Spike

The spike proves the boundary with executable code. It does not claim that production remote
workspaces are shipped.

### Contracts and executable prototype

- [x] Add a typed `ExecutionEnvironment` capability descriptor covering filesystem, process,
  terminal, Git, runtime/provider, editor-open, watch, and reconnect support.
- [x] Route one narrow existing read-only operation through the abstraction locally without changing
  behavior.
- [x] Implement a loopback remote prototype as a separate child process using framed typed messages,
  an ephemeral per-launch credential, request IDs, cancellation, bounded payloads, heartbeat,
  version negotiation, and explicit shutdown.
- [x] Prototype operations are read-only: health, capability negotiation, canonical workspace root,
  bounded directory listing, and bounded Git status.
- [x] Prove disconnect/reconnect, child crash, stale response, timeout, cancellation, version
  mismatch, traversal rejection, credential rejection, and cleanup without orphaning the child.
- [x] Add an experimental Diagnostics entry that can launch the loopback prototype, display its
  negotiated capabilities/health, exercise the read-only probe, and shut it down.
- [x] Keep the prototype disabled by default and exclude it from production remote claims.

### Architecture decision record

- [x] Document the measured prototype, threat model, source-of-truth split, transport options,
  authentication, reconnection, remote filesystem/watch semantics, provider credential ownership,
  terminal/VS Code strategy, update/rollback strategy, packaging implications, and estimated path
  from prototype to product.
- [x] Make an explicit go/no-go recommendation grounded in the executable evidence.

### Verification

- [x] Unit/integration: protocol validation, bounds, auth, traversal, cancellation, timeouts,
  reconnect, version mismatch, and process cleanup.
- [x] Electron core: launch/probe/disconnect/reconnect/shutdown through visible Diagnostics UI.
- [x] Restart: no credential persistence and no loopback child survives app shutdown/relaunch.
- [x] Packaged smoke: the prototype helper is either deliberately included and verified or
  deliberately development-only with a truthful unavailable state.

## Phase T3-7 — Integrated Verification And Closeout

### Required checks

- [x] `git diff --check`.
- [x] `pnpm lint`.
- [x] `pnpm typecheck`.
- [x] `pnpm test:unit`.
- [x] `pnpm --filter @pi-gui/desktop run build`.
- [x] Targeted core specs for every phase while iterating.
- [x] Full `pnpm --filter @pi-gui/desktop run test:e2e:core` on final source.
- [x] Full `pnpm --filter @pi-gui/desktop run test:e2e:live` on final source; provider-authenticated
  assertions must run when credentials are already available and otherwise skip truthfully.
- [x] Targeted native lane only if the final implementation adds a real file picker for theme or
  action import.
- [x] Packaged app smoke plus packaged runtime dependency proof.
- [x] Restart/recovery matrix across task, settings, resource, PR, usage, prompt shelf, project
  action, theme, and remote-spike state.
- [x] Performance/resource matrix with 200 Display Mode sessions, ten parallel runs, a long selected
  transcript, Resource Inspector open/closed, terminal, and VS Code.
- [x] Accessibility and screenshot matrix in light, dark, forced-colors, reduced-motion, compact,
  increased font size, and narrow layouts.
- [x] `simplify` if available; otherwise record its absence and perform manual diff review.

### Completion audit

- [x] Re-read every checkbox and identify its authoritative code/test/runtime evidence.
- [x] Treat missing, indirect, skipped-without-reason, or stale evidence as incomplete.
- [x] Record exact final commands and results in this file.
- [x] Update `docs/architecture.md`, related user docs, and `plans/active/README.md`.
- [x] Move this plan out of `plans/active/` only after every locally actionable item is proven.
- [x] Report external blockers separately. Expected possible external blockers are limited to:
  provider credentials/paid real runs, disposable GitHub write target, signing/notarization assets,
  and the already-existing signed N/N+1 updater staging proof.

## Verification Log

- 2026-08-28: Current worktree and completed roadmap audited before edits. The branch already
  contains extensive uncommitted resource-safety, renderer-recovery, subagent, provider, and UI
  work; this program will extend those changes and preserve unrelated edits.
- 2026-08-28 baseline before T3 feature edits: `pnpm lint` passed; `pnpm typecheck` passed;
  `pnpm test:unit` passed 58 files / 247 tests; `pnpm --filter @pi-gui/desktop run build` passed.
  The full pre-feature Electron core lane passed 193/195 in 10.3 minutes. Existing failures are
  `change-intelligence-review.spec.ts` (seeded verification remained `running`/`scope-unknown`
  instead of `verified`) and `new-thread-auto-title.spec.ts` (manual rename/delayed title case
  timed out and caused a worker teardown timeout). These are baseline defects, not regressions from
  this program, and must be repaired before final closeout.
- 2026-08-28 implementation closeout: all seven approved product/platform phases are implemented.
  The main process owns bounded resource diagnosis, typed GitHub PR state, incremental provider-neutral
  usage, Project Actions v2, Prompt Shelf, semantic theme definitions/imports, and the disabled-by-default
  loopback execution prototype. The baseline change-intelligence and auto-title failures were repaired.
- Final static/build proof on final source: `git diff --check`, `pnpm lint`, `pnpm typecheck`, and
  `pnpm --filter @pi-gui/desktop build` passed. `pnpm test:unit` passed 67 files / 291 tests.
- Final Electron core proof: `pnpm --filter @pi-gui/desktop test:e2e:core:run -- --workers=1`
  passed 209/209 in 8.5 minutes. This includes the 12-cycle startup/reaping regression, 200-session
  Display Mode projection bound, 100-session dormancy, long transcript virtualization, ten-task
  resource stress with terminal and VS Code, restart recovery, and the full appearance/accessibility
  matrix. Additional pre-closeout stress passed 80/80 fresh launches and 50/50 Git-workspace
  auto-title launches.
- Final authenticated provider proof: with the existing isolated Pi auth profile,
  `PI_APP_REAL_AUTH=1 PI_APP_REAL_AUTH_SOURCE_DIR=/Users/brianfarley/.pi/agent pnpm --filter
  @pi-gui/desktop test:e2e:live:run -- --workers=1` passed 42/42 in 11.3 minutes. The lane covered
  real usage/resource attribution over 1,000 historical rows, files, tool calls, parallel tasks,
  background-subagent completion, intentional interrupted-run hydration, every built-in workflow,
  exact multi-child aggregation, and clean terminal states without orphan runners.
- Final native/packaged proof: the foreground macOS theme picker passed 1/1; `package:dir` produced
  the arm64 app; `verify:packaged-runtime-deps` verified Electron 43.2.0 / Node 24.18.0, the current
  gpt-5.6 Codex registry, native/runtime dependencies, and the packaged remote helper; packaged app
  smoke and installed VS Code dark-workbench proof passed 2/2.
- Read-only network proof succeeded against public GitHub PR metadata for `pingdotgg/t3code` and a
  bounded OpenVSX search response. No external writes, theme installs, PR mutations, commits, or
  pushes were performed.
- `simplify` was not installed. Manual diff review, typed-contract audit, secret-pattern audit, and
  `git diff --check` were used instead. The worktree remains intentionally dirty because it contains
  the user's existing work plus this completed implementation.

## External Closeout Boundaries

- macOS Developer ID signing/notarization remains external because no signing identity or
  notarization assets are installed. The unsigned local arm64 package and packaged runtime proofs
  are green.
- The signed N/N+1 updater staging round trip remains owned by the existing Phase 5 plan and requires
  signed release artifacts; it is not part of this T3 program's local implementation.
- GitHub write proof remains intentionally unexecuted because the approved scope forbids external
  mutations without an explicit disposable target/action. All mutation paths have typed previews,
  confirmation gates, deterministic core coverage, and no read-path side effects.
- Commit and push were not performed because this goal explicitly excluded them.
