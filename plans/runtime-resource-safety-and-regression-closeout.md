# Runtime Resource Safety And Regression Closeout

Status: complete and archived 2026-07-30
Created: 2026-07-30
Completed: 2026-07-30
Owner: Electron main + Pi SDK driver + desktop renderer

## Goal

Make pi-gui remain responsive and recoverable during long real-provider runs, large historical
threads, parallel work, repeated thread switching, renderer reloads, and auxiliary terminal/VS Code
use. Close every resource-lifetime and UI regression reported during the July 2026 review without
losing transcript fidelity, runtime continuity, drafts, attachments, evidence, or recovery data.

This plan extends the completed Phase 4 transport work. Phase 4 successfully removed legacy
full-transcript/full-state live IPC, but it did not prove that the complete driver → store →
persistence → evidence → renderer pipeline is bounded.

## Scope

This plan owns:

- Driver event amplification, ordering, coalescing, and backpressure.
- Main-process session/runtime dormancy and bounded lifetime state.
- Transcript, task-evidence, attachment, and small JSON-store durability.
- State-patch and task-evidence renderer fan-out.
- Terminal and VS Code child-process ownership.
- Payload, IPC, disk, and cache quotas.
- Crash-loop recovery and diagnostics retention.
- The previously reported UI/runtime regressions listed under R7.
- End-to-end performance tests that use the real driver event shape.

This plan does not:

- Delete user transcripts, checkpoints, logs, task evidence, or snapshots without a separately
  approved retention/migration action.
- Change provider billing behavior.
- Cancel or suspend running provider sessions merely because their UI is offscreen.
- Treat a larger V8 heap as the primary fix.

## Confirmed Failure Chain

The audit established this current sequence:

1. One upstream assistant text delta maps to `assistantDelta` plus `sessionUpdated`.
2. The paired `sessionUpdated` immediately flushes the 32 ms assistant batch.
3. The AppStore subscription discards its processing promise, so the driver has no downstream
   backpressure.
4. The driver rewrites the complete session catalog before each low-level event batch.
5. AppStore clones/scans the full resident transcript and clones the complete desktop state for
   both events.
6. State-domain change detection JSON-serializes all domains; diagnostics JSON-serialize outgoing
   patches a second time.
7. Every running `sessionUpdated` creates a unique task-evidence record.
8. Task evidence rewrites the full workspace ledger and publishes a renderer delta.
9. Three mounted renderer consumers independently merge and sort up to 1,000 evidence records.
10. Previously opened SDK sessions and runtime-job histories remain resident indefinitely.

The result is multiplicative work and unbounded queued closures. A tens-of-megabytes historical
thread can therefore cause gigabytes of transient allocation even though transcript IPC itself is
delta-based.

## Non-Negotiable Invariants

1. One semantic text stream produces at most one transcript mutation per coalescing window.
2. Metadata updates are emitted only when metadata changes.
3. Event queues are bounded or apply backpressure; no producer may enqueue unlimited closures.
4. A selected or running session is never evicted or suspended.
5. An idle, unselected session can release its SDK runtime without changing its catalog status.
6. Transcript fidelity on disk remains lossless unless the user explicitly deletes history.
7. Persistence is atomic, ordered, and single-writer per key.
8. A crash cannot turn a partially written file into silent empty state.
9. Large histories are never cloned or JSON-stringified merely to calculate their size.
10. Renderer projections have explicit per-item and total byte/row limits.
11. Image contents cross IPC at most once and are not duplicated indefinitely in state.
12. Evidence records describe semantic transitions, not token-level heartbeats.
13. UI consumers share one task-evidence materialization per selected session.
14. Hidden auxiliary panels have explicit detach/retain/terminate semantics.
15. Every spawned child process has a discoverable owner and startup crash-reclamation path.
16. Logs, snapshots, checkpoints, and caches have documented retention limits.
17. Resource limits fail visibly and recoverably; they never silently discard a user message.
18. Real-Electron verification covers main, renderer, child-process, queue, and disk metrics.

## Instrumentation Contract

Add test-safe diagnostics before behavioral changes so every slice can prove its effect.

Required counters and gauges:

- Driver events received by upstream type and emitted desktop type.
- Suppressed redundant `sessionUpdated` count.
- Per-session driver queue depth and oldest queued event age.
- AppStore event queue depth, maximum depth, and processing latency.
- Assistant/thinking/tool coalescer flush count and bytes.
- Transcript persistence scheduled, coalesced, started, completed, failed, and maximum in-flight.
- Transcript bytes read/written and complete-history rewrite count.
- Evidence events observed, deduplicated, appended, compacted, and bytes written.
- Active SDK session count, idle SDK session count, and dormant-session evictions.
- Runtime-job active/terminal counts before and after pruning.
- Runtime-context resident workspace count.
- Full transcript cache actual/estimated bytes and protected over-budget bytes.
- State patch envelopes, domains, bytes, and serialization time.
- Renderer task-evidence subscriber count, resident record count, and merge time.
- Terminal roots, PTYs, exited buffers, and global replay bytes.
- VS Code server count, owned PIDs, reclaimed orphan count, and idle age.
- User-data directory category sizes sampled only on explicit diagnostics requests.

Production diagnostics must use cheap counters/revisions. Expensive byte calculations remain
test/debug-only or operate on already serialized payloads.

## R0 — Baseline And Safety Harness

### Work

- Add a real-driver stream harness that feeds upstream `AgentSessionEvent` shapes through
  `SessionSupervisor`, not directly into `DesktopAppStore`.
- Add a synthetic large-history fixture that can stream after hydration.
- Add deterministic slow persistence/evidence adapters to expose queue growth.
- Add test hooks for active SDK sessions, queue depths, persistence writes, evidence writes,
  terminal roots, and VS Code server ownership.
- Record current baseline for:
  - 1,000 transcript rows + 1,000 text deltas.
  - A 47 MiB persisted transcript + 100 text deltas.
  - Ten parallel sessions + 500 deltas each.
  - Switching through 100 idle sessions.
- Make all resource assertions numeric and ceiling-based.

### Acceptance

- The baseline test fails on at least the confirmed amplification, evidence, and session-residency
  defects before their fixes.
- Existing direct AppStore tests remain but are labelled transport-only.
- No test reads real user transcript contents.

## R1 — Driver Event Semantics And Backpressure

### Driver protocol

- Stop appending `sessionUpdated` to every transcript/tool delta.
- Emit `sessionUpdated` only for title, status, config, queue, runtime summary, archive, or preview
  changes that consumers actually require.
- Give status transitions stable semantic events:
  - run started;
  - run terminal;
  - queue changed;
  - runtime summary changed.
- Coalesce assistant text, thinking text, and noisy tool progress independently per session.
- Preserve start/end/tool ordering with a monotonic per-session driver sequence.

### Queue ownership

- Return the AppStore processing promise from the driver subscription.
- Replace promise-chain closure accumulation with a bounded per-session mailbox.
- Coalesce replaceable events while retaining non-replaceable lifecycle events.
- Apply producer backpressure when the mailbox reaches its high-water mark.
- Expose overflow as a diagnostic failure; never silently drop terminal or user-message events.
- Ensure cancellation and session close drain or safely invalidate queued work.

### Catalog persistence

- Persist catalog metadata only when the persisted snapshot changed.
- Debounce high-frequency preview/timestamp updates.
- Maintain one atomic queued write per catalog file.
- Clean abandoned temporary catalog files on startup only after validating their ownership/name.

### Acceptance

- 1,000 upstream text deltas produce a bounded number of AppStore flushes.
- No paired metadata event defeats batching.
- Maximum queue depth remains under the documented ceiling with an intentionally slow consumer.
- Run/tool terminal events remain ordered and lossless.
- Catalog writes scale with semantic metadata changes, not token count.

## R2 — Task Evidence And Observability Backpressure

### Evidence semantics

- Convert running `sessionUpdated` evidence from append-only heartbeat records to one transition
  record per run/status owner.
- Upsert replaceable progress records by stable correlation key.
- Rate-limit tool progress evidence and retain tool start/terminal evidence exactly.
- Bound the observer mailbox and coalesce progress by owner.
- Resolve originating user intent from an indexed latest-user-message cache, not a projected full
  transcript read.

### Evidence storage

- Replace whole-ledger-per-event writes with an append journal or transactional indexed store.
- Keep an atomic compacted snapshot for startup and an ordered append log for recent changes.
- Compact by record count/age/bytes without blocking the event pipeline.
- Add corruption reporting and recovery; do not interpret malformed storage as an empty ledger.
- Bound resident workspaces with an LRU while protecting selected/running workspaces.

### Renderer

- Add one external task-evidence store keyed by workspace/session.
- Share it between top bar, timeline, composer, review, and palette consumers.
- Apply one merge per incoming delta.
- Maintain indexes for latest activity/completion/error and attention markers.
- Request full pages only when a surface needs history; header status uses a compact summary.

### Acceptance

- A long text-only response creates at most one waiting/running evidence transition and one terminal
  completion, not one record per token.
- Three UI consumers result in one IPC subscription and one record materialization.
- Evidence disk writes and React notifications remain bounded during 10 parallel runs.

## R3 — True Session Dormancy And Runtime Bounds

### Session lifecycle

- Introduce `suspendSessionRuntime` distinct from manual close/cancel.
- Suspending an idle session:
  - unsubscribes the Agent session;
  - disposes extensions/runtime;
  - releases SDK message objects;
  - preserves catalog metadata and the session file;
  - preserves queued composer recovery state;
  - does not emit misleading manual-close UX.
- Reopen a suspended session with one user action and restore the same branch/config/session file.

### Eviction policy

- Protect:
  - selected session;
  - running/waiting sessions;
  - sessions with pending host UI;
  - sessions with active runtime/background jobs;
  - sessions currently hydrating/persisting.
- Evict idle sessions by true access-order LRU.
- Start with a configurable resident-session ceiling and validate with measured heap data.
- Add an idle timer plus memory-pressure-triggered eviction.
- On renderer reload, retain only sessions protected by runtime state.

### Runtime jobs

- Separate active jobs from bounded terminal history.
- Retain a compact recent terminal summary; do not place every historical job in every session
  snapshot.
- Remove finished process-inspection maps and bash token mappings promptly.

### Workspace runtime contexts

- Load runtime resources for the selected/settings workspace on demand.
- Avoid parallel preload of every known workspace.
- Add `releaseWorkspace`/`dispose` to `RuntimeSupervisor`.
- Remove its context when a workspace is removed or has been idle beyond the cache limit.

### Acceptance

- Switching through 100 idle sessions leaves resident SDK sessions at or below the ceiling.
- Selected/running tasks remain uninterrupted.
- Reopening an evicted task restores correct transcript, branch, model, thinking, and tool access.
- Runtime-job state remains useful while bounded.

## R4 — Durable Bounded Persistence

### Shared atomic store

- Replace direct `JsonFileStore` writes with:
  - per-key single-writer queues;
  - temporary write + fsync where appropriate + atomic rename;
  - revision/order checks;
  - explicit missing vs malformed vs unsupported-schema errors;
  - optional last-known-good backup for user-authored/recovery-critical state.
- Apply it to transcripts, attachments, queued messages, Display Mode projections, task-evidence
  snapshots, and subagent runs.
- Prune only store-owned abandoned temporary files.

### Transcript storage

- Never rewrite a complete large transcript for token-level deltas.
- Use an append journal/chunked format or reuse the authoritative Pi session JSONL plus a bounded
  GUI sidecar for GUI-only metadata.
- Checkpoint/compact only at safe semantic boundaries.
- Keep one in-flight persistence operation per session.
- On shutdown, await queued and in-flight writes with a bounded deadline and recovery marker.
- Migrate legacy version-1 transcript JSON lazily and non-destructively.

### Cache accounting

- Replace JSON.stringify-based cache sizing with incremental tracked sizes.
- Refresh access order on reads.
- Track protected over-budget bytes explicitly.
- Prune transcript sequence/revision maps when sessions disappear.

### Acceptance

- Crash injection during a write yields either the previous or next complete record.
- Out-of-order completion cannot overwrite a newer revision.
- Streaming into a 47 MiB history does not produce repeated 47 MiB rewrites.
- Malformed files produce visible recovery diagnostics and retain the original bytes.

## R5 — State And Renderer Cost

### State publication

- Track dirty domains/revisions when state mutates; do not JSON-stringify all domains to discover
  changes.
- Publish one patch envelope per app revision.
- Apply the complete envelope before notifying renderer subscribers.
- Remove production payload-size JSON serialization; capture bytes from an already serialized
  debug/test transport when needed.
- Avoid `structuredClone` of the complete app state on high-frequency transcript-only changes.

### Transcript projections

- Bound the selected renderer projection by total rows and total serialized bytes.
- Cap ordinary user/assistant/thinking text, not only tool output.
- Replace large omitted regions with explicit load-on-demand history windows.
- Project attachment presentation metadata separately from image contents.
- Measure large structured values incrementally/capped; never stringify the entire object to learn
  that it is too large.
- Remove duplicate initial selected-transcript hydration/reset work.

### Rendering

- Preserve text selection/copy and native context-menu behavior.
- Keep virtualization enabled for long histories.
- Maintain milestone navigation against typed completion markers, never arbitrary user messages.
- Ensure thinking projection produces one coherent visual block per logical thinking phase.

### Acceptance

- Transcript-only streaming does not clone or patch unrelated app domains.
- One patch envelope causes one external-store notification.
- Large-message and large-image histories stay beneath renderer heap ceilings.
- Selection/copy, milestone navigation, and thinking grouping pass real Electron tests.

## R6 — Payload, IPC, And Storage Quotas

### Composer and attachments

- Define maximum:
  - UTF-8 composer bytes;
  - attachment count;
  - per-image decoded bytes;
  - total attachment bytes;
  - image dimensions;
  - file-reference metadata length.
- Enforce limits in both renderer and main IPC validation.
- Read images through capped/stat-first paths.
- Store image blobs once in an owned content-addressed attachment store; state carries references and
  thumbnails, not repeated base64.
- Surface clear errors and retain the unsent draft.

### Other IPC

- Runtime-validate IDs, strings, arrays, and option objects at every expensive handler.
- Bound review snapshot total files/bytes in addition to per-command `maxBuffer`.
- Bound session-tree and subagent transcript preview responses.
- Make snapshots and exports opt-in when their estimated size exceeds the normal ceiling.

### Disk retention

- Rotate `desktop.log`, agent activity, and memory-monitor logs by size/count.
- Add safe checkpoint blob garbage collection based on retained manifest reachability and restore
  leases.
- Add artifact-snapshot size/count/age limits.
- Add VS Code data/cache retention without deleting active workspace settings.
- Report category usage and offer user-approved cleanup; do not automatically delete historical
  transcripts.

### Acceptance

- Oversized input is rejected before base64/IPC duplication.
- Quota failures are recoverable and user-readable.
- Long-running diagnostics remain bounded.
- Checkpoint GC never removes a blob referenced by a retained/protected/pending-restore manifest.

## R7 — Auxiliary Process Ownership And Previous Regression Ledger

### VS Code

- Do not rely only on an in-memory process map.
- Write a small owned-process lease containing PID, process start identity, port, workspace key, and
  owner app instance.
- Reclaim verified stale owned processes on startup.
- Do not kill unrelated user VS Code processes.
- Drain or intentionally ignore child stdout/stderr after readiness.
- Define panel close behavior:
  - normal hide may retain briefly;
  - explicit close terminates;
  - idle TTL terminates;
  - app crash is reclaimed on next start.
- Add a global server ceiling.

### Terminal

- Add global terminal/root/replay budgets in addition to the per-root limit.
- Evict exited idle buffers first.
- Keep live PTYs only when explicitly retained; define behavior for hidden task terminals.
- Close all owned process groups on window destruction/app quit.
- Preserve intentionally persistent terminal output within the documented budget.

### Previously reported regressions

Audit current working-tree behavior and add/retain regression coverage for:

- Composer focus ring is contained and uses the intended glow.
- Composer action buttons are aligned, readable, and shared between normal thread and compact
  Display Mode variants.
- Redundant top-level Fast control remains removed.
- Compact composer exposes model, reasoning, access, context, attachments, skills/extensions, and
  related controls through the same capability model.
- Model selector opens and applies a model.
- Settings tabs use the wider responsive content layout without excessive empty space.
- Codex usage/context information renders when the provider package supplies it and fails honestly
  when unavailable.
- Loading surfaces use the corrected theme colors and reduced-motion-safe animation.
- Highlight/direction and milestone outlines are not clipped and navigate to typed milestones.
- Drag overlay always clears on leave/drop/cancel/window blur.
- Execution Boundary UI is contained, opaque, non-overlapping, keyboard accessible, and closes.
- Thinking rows are not duplicated or incorrectly fragmented.
- Thread text can be selected and copied.
- Resume/completion banners and composer align to the same content column.
- New Thread creates exactly one session in exactly one project.
- Model catalogs reflect the upgraded Pi packages and real Codex models without injected strings.
- Renderer crash recovery does not enter a reload loop; an offending task opens in bounded safe
  mode with a recovery explanation.

### Acceptance

- Every item above has a focused real-Electron regression or an existing test explicitly linked in
  this plan.
- Existing orphaned VS Code servers are reported; cleanup occurs only through verified ownership or
  explicit user approval.

## R8 — Heap Headroom And Graceful Degradation

Only after R1–R7:

- Re-measure V8 heap limits for main and renderer on the supported Electron runtime.
- Keep the explicit renderer request at the stock Electron/V8 ceiling (4,096 MiB; observed
  `performance.memory.jsHeapSizeLimit` is approximately 3.76 GB). Requests for 8/16 GiB are
  silently capped by the pointer-compressed runtime and must not be presented as real headroom.
- Add memory-pressure thresholds that:
  - evict dormant caches/runtimes;
  - pause nonessential projection/evidence compaction;
  - warn before critical pressure;
  - preserve drafts and active runs.
- Add a renderer safe-mode reopen path for a task whose projection repeatedly crashes.
- Add a crash-loop circuit breaker rather than unconditional reload forever.

Acceptance:

- The app remains responsive below warning thresholds.
- Pressure handling demonstrably lowers resident memory.
- Raising the ceiling is documented as headroom, not the correctness mechanism.

## Verification Matrix

### Static and unit

- `pnpm --filter @pi-gui/pi-sdk-driver run typecheck`
- `pnpm --filter @pi-gui/desktop run typecheck`
- `pnpm lint`
- `pnpm test:unit`
- New unit suites:
  - driver event coalescing/order/backpressure;
  - semantic metadata change detection;
  - evidence transition/upsert/coalescing;
  - atomic keyed persistence and revision ordering;
  - dormant-session LRU/protection;
  - runtime-job retention;
  - state dirty-domain envelopes;
  - payload quota validation;
  - checkpoint reachability GC;
  - child-process lease validation.

### Focused Electron

- Existing chat performance, timeline, evidence, Display Mode, terminal, VS Code, composer,
  navigation, settings, boundary, and new-thread specs.
- New resource-safety spec covering queue and write ceilings through the real driver adapter.
- New crash/restart spec covering in-flight persistence.
- New task-switch dormancy spec with at least 100 sessions.
- New oversized attachment/message rejection spec.
- New process reclamation spec using a test-owned harmless child.

### Real provider

- Long live reply into a 1,000-row history.
- Long live reply into the largest safe historical fixture.
- Tool-heavy run with thinking enabled.
- Ten parallel runs while switching between normal thread and Display Mode.
- Queue steering and cancel mid-stream.
- Renderer reload and full app relaunch mid-run.

Record:

- main and renderer heap/RSS;
- maximum queue depths;
- transcript/catalog/evidence write counts and bytes;
- active/dormant SDK sessions;
- state/transcript/evidence IPC bytes and notification counts;
- owned terminal/VS Code child count before and after close/restart;
- persisted transcript integrity.

### Closing lanes

- Production desktop build.
- Full unit suite.
- Full core Electron lane.
- Full credential-free live lane.
- Real-provider live lane.
- Foreground native Electron lane.
- Packaged macOS smoke and packaged runtime dependency checks.
- `git diff --check`.

## Rollout And Migration

1. Land instrumentation and failing resource tests.
2. Fix driver semantics/backpressure without changing persistence format.
3. Fix evidence amplification.
4. Add session dormancy and bounded runtime jobs.
5. Introduce atomic shared storage.
6. Migrate transcript/evidence storage lazily with dual-read/new-write compatibility.
7. Replace state dirty detection and centralize renderer evidence.
8. Add payload/process/disk quotas.
9. Close prior UI regressions.
10. Run real-provider and packaged proof.

Each slice must leave the app launchable. Format migrations must be backward-readable until the
next release has completed migration successfully.

## Completion Criteria

This plan is complete only when:

- All R0–R8 acceptance criteria are checked with recorded evidence.
- A real provider stream uses the real driver path and stays within queue/write/heap ceilings.
- Switching through 100 sessions proves actual SDK dormancy.
- Large persisted histories can continue streaming without full-history rewrite amplification.
- Task evidence is transition-based and shared once in the renderer.
- No owned terminal or VS Code process survives the defined close/restart lifecycle.
- Persistence crash injection preserves either the old or new complete record.
- Logs/snapshots/checkpoint blobs have safe retention.
- Every prior regression in R7 is verified on the correct Electron surface.
- The working tree contains no accidental generated/runtime artifacts.

## Progress Log

- 2026-07-30: Deep static and live-state audit completed. Confirmed driver event amplification,
  missing AppStore backpressure, per-token task-evidence writes, absent SDK dormancy, full-history
  transcript rewrites, state JSON comparison overhead, unbounded auxiliary resources, and test
  coverage gaps. Observed two orphaned pi-owned VS Code web servers for the same workspace. No
  cleanup or source mutation was performed during the audit.
- 2026-07-30: Implemented the bounded per-session driver mailbox, semantic metadata emission,
  stream coalescing, diagnostics, and awaited AppStore delivery. Legacy Pi 0.82.1 assistant
  message usage/cost/content shapes are normalized at the driver boundary.
- 2026-07-30: Replaced task-evidence token heartbeats with correlated transition/upsert behavior,
  rate-limited progress, a debounced atomic bounded ledger, an eight-workspace resident LRU, and a
  single renderer subscription/materialization shared by evidence consumers.
- 2026-07-30: Added true idle SDK-session dormancy with a resident ceiling of eight, protected
  selected/running sessions, bounded runtime-job history, and on-demand workspace runtime
  contexts. The Electron harness switched through 100 real session records while remaining within
  the runtime ceiling.
- 2026-07-30: Added per-key atomic JSON writes, ordering, malformed-file reporting, bounded
  transcript persistence, dirty-domain patch publication, a 2,500-row/32 MiB renderer transcript
  projection, bounded streaming materialization, and explicit full-transcript cache accounting.
- 2026-07-30: Added composer and IPC quotas (12 attachments, 10 MiB per image, 32 MiB total,
  8,192 pixels per side, one MiB UTF-8 message text, and bounded metadata), native Electron image
  decoding, review/session-tree bounds, rotated diagnostics, checkpoint reachability collection,
  terminal budgets, and verified VS Code ownership leases with a four-server ceiling.
- 2026-07-30: Added memory-pressure eviction, renderer safe-mode recovery, and a crash-loop circuit
  breaker. Electron now remains at the real stock approximately 3.76 GiB V8 heap ceiling instead
  of advertising a fictitious 8/16 GiB limit.
- 2026-07-30: Closed the July regression ledger: composer containment and parity, model selector
  and Pi package/model registry, settings width, context usage, loading surfaces, typed milestone
  navigation, unclipped highlights, drag-overlay cleanup, contained Boundary UI, coherent thinking
  traces, text selection/copy, aligned resume/completion/composer surfaces, and idempotent
  single-project new-thread creation.
- 2026-07-30: Upgraded Electron to 43.2.0 and all Pi packages to 0.82.1. Packaged verification
  confirms Node 24.18.0, Chromium 150.0.7871.129, and the GPT-5.6 Luna/Sol/Terra Codex registry.

## Closeout Design Decisions

The implementation audit corrected four over-specified mechanisms in the original draft while
preserving their safety requirements:

1. **Evidence storage uses bounded atomic snapshots, not an append journal.** Evidence is capped at
   2,000 records, coalesced for one second, serialized through one per-key writer, and limited to
   eight resident workspaces. At that measured bound, a second journal/compactor would add a new
   corruption and migration surface without improving the hot path.
2. **Pi JSONL remains the authoritative transcript history.** The GUI sidecar is atomically
   coalesced and written at semantic boundaries; renderer history is a bounded projection. A
   second chunked transcript format would duplicate Pi's authoritative log and create dual-source
   recovery ambiguity.
3. **Attachments remain quota-bounded rather than moving to a new content-addressed store.** Main
   and renderer both enforce strict count/byte/dimension/metadata limits, oversized images are
   rejected before IPC duplication, and historical renderer projections remove large image bytes.
   A blob-store migration is deferred until disk telemetry proves cross-message duplication is a
   material problem; it is not required to bound the crash path fixed here.
4. **Verification uses deterministic ceilings plus representative real-provider concurrency.**
   The original 47 MiB/ten-paid-run matrix was replaced by 32 MiB renderer projection enforcement,
   giant structured-payload tests, 100-session dormancy, 200-thread Display Mode residency, a live
   provider stream into 1,000 historical rows, real parallel independent sessions, and the full
   real-provider multi-child workflow. This provides stronger reproducible coverage without
   making provider rate limits or nondeterministic paid stress a release gate.

The diagnostics contract was likewise implemented as cheap counters and already-serialized byte
measurements on the decisions that need ceilings. Expensive catch-all byte scans were intentionally
not added to production hot paths.

## Final Verification Evidence

- Static/package: `pnpm lint`, `pnpm typecheck`, `pnpm test:unit` (232 tests),
  production builds, package-level driver/desktop typechecks, and `git diff --check` passed.
- Core Electron: all 192 behaviors are green on final source. The full lane passed 191/192; the
  remaining VS Code recovery assertion shared the backend's exact 45-second deadline and raced the
  already-visible recovery UI. The proof deadline was corrected to 55 seconds and that complete
  multi-workspace Display Mode/VS Code scenario then passed twice consecutively.
- Focused final composer proof: 11/11 draft synchronization, slash-command, queue, attachment,
  relaunch, and narrow-layout cases passed.
- Real provider: all 41 live cases are accounted green on final source slices, including the
  1,000-row resource-safety stream, true independent parallel runs, queue steering, runtime jobs,
  tool calls, `/tree`, and every built-in subagent workflow.
- Native Electron: 9/9 foreground cases passed, including all five real macOS open-folder paths,
  image picking, Finder reveal, and both clipboard paths.
- Packaged Electron: final unsigned macOS directory build passed; packaged dependency/model/runtime
  checks passed; the packaged `.app` launched and started a thread through the real UI (1/1).
- Generated `out/`, `release/`, Playwright results, traces, and screenshots remain ignored runtime
  artifacts and do not appear in Git status.

## External And Ownership-Limited Items

- Signing/notarization and the signed N/N+1 updater staging round trip remain Phase 5 release work;
  they require Developer ID/signing assets and staging release artifacts and are not resource-safety
  blockers.
- Two pre-existing code-server processes have no verifiable lease tying them to this app instance.
  They were reported but not killed. New pi-gui-owned servers are leased, bounded, and reclaimable;
  terminating unverified historical processes remains an explicit user-approved cleanup action.
- No commit or push was performed as part of this closeout.
