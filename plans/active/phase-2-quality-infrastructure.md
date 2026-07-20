# Phase 2 — Quality Infrastructure (Lint, Unit Tests, CI)

## Goal

Put the missing safety net in place BEFORE the phase 3–4 refactors: linting, a fast unit-test layer under the existing e2e suite, faster e2e iteration, and an auditable error-handling convention.

## Findings being fixed

- No ESLint or Prettier config anywhere; `pnpm lint` is a no-op.
- Zero unit tests; 77 Playwright e2e specs are the only coverage (inverted pyramid, slow feedback).
- The consolidated `test:e2e:runner` can run a single spec without rebuilding, but the tier scripts (`test:e2e:core`, `test:e2e:live`, `test:e2e:native`) still rebuild every time, so local iteration and CI still pay more than necessary.
- Many empty/no-op/near-empty catch paths and `.catch(() => undefined)` calls have no logging convention; can't distinguish intent from swallowed failures.
- Dependency debt: pinned transitive-looking deps for the packaged `pi` runtime are undocumented; `@legendapp/list` pinned to a beta; `@dnd-kit/*` misfiled in devDependencies.

## Constraints

- Keep the e2e tiers (core/live/native/production) intact — they are a strength.
- Lint adoption must not turn into a mass-reformat commit mixed with logic changes; land config + autofix as its own checkpoint.
- Existing strict-TS discipline (zero `any`) is the bar; lint should enforce, not relax.

## Steps

1. **ESLint (flat config) + Prettier.** typescript-eslint recommended-type-checked, react-hooks, `@typescript-eslint/no-floating-promises`, unused-imports. Repo-root config covering apps/* and packages/*. Separate commits: config, then autofix, then manual fixes.
2. **Vitest.** Root-level vitest workspace; first targets are the pure-logic modules: `composer-commands.ts`, `thread-groups.ts`, `conversation-timeline-rows.ts`, `assistant-delta-batcher.ts`, `app-store-utils.ts`, `string-utils.ts`, `plan-panel-model.ts`, `command-palette-model.ts`, plus `packages/pi-sdk-driver` utils (`runtime-command-utils`, `session-supervisor-utils`, `transcript`). Target: meaningful behavioral tests, not coverage theater.
3. **Split build from e2e run.** Keep `test:e2e:runner` as the raw no-build entry. Add explicit tier run halves (`test:e2e:core:run`, `test:e2e:live:run`, `test:e2e:native:run`) and have the public tier scripts call `build` + the run half. CI keeps the full path; local agents use the run halves after a known-current build.
4. **CI pipeline.** Jobs: gitleaks (from phase 0) → lint → typecheck → unit → desktop-core e2e → linux package. Fail fast on the cheap jobs.
5. **Error-handling convention.** Add `logIgnoredError(scope: string, error: unknown)` (main + renderer variants feeding the existing diagnostics/observability channel). Sweep the bare catches, noop `.catch(() => undefined)` paths, and near-empty handlers: each becomes either a real handler, `logIgnoredError`, or a comment-free intentional ignore only where provably safe (e.g. `catch { /* best-effort */ }` with the helper). Lint rule `no-empty` enforces from then on.
6. **Dependency housekeeping.** Move `@dnd-kit/*` to dependencies; document every runtime-dep pin (why it exists, which assert script guards it) in a comment block near `assert-packaged-runtime-deps.mjs` or a `docs/runtime-deps.md`; check whether `@legendapp/list` has a stable release; upgrade `yargs`/`parse5` pins if the packaged runtime allows (verify with `verify:packaged-runtime-deps`).
   - Closeout 2026-07-21: upgraded directly owned `@legendapp/list` to stable 3.3.3 and passed its renderer/packaging gates. `parse5` and `yargs` remain aligned to the bundled upstream runtime's `cli-highlight` dependency chain and are upstream-gated rather than independent local TODOs.
7. **`docs/architecture.md`.** Short doc: main/preload/renderer boundaries, state flow (store → coalesced IPC → renderer), driver stack (`session-driver` → `pi-sdk-driver` → `pi-mono`), test tiers. Pays off immediately for agent-driven work.

## Success Criteria

- `pnpm lint` runs ESLint across the workspace and passes; CI enforces it.
- `pnpm test:unit` runs in under ~10s locally and covers the listed modules with behavioral assertions.
- A developer can run a single e2e spec without a rebuild when the build is current.
- Zero `catch {}` blocks without either real handling or `logIgnoredError`; `no-empty` lint rule active.
- CI pipeline runs all six jobs; cheap jobs gate expensive ones.

## Verification

- CI green on a PR exercising the full pipeline.
- Mutation spot-check: intentionally break one covered pure function locally; unit layer catches it in seconds.
- Diagnostics panel shows `logIgnoredError` events when a known best-effort path fails (verified on real Electron surface).

## Verification Notes

- 2026-07-08: Started Phase 2 with the low-risk e2e iteration split. Added `test:e2e:core:run`, `test:e2e:live:run`, and `test:e2e:native:run`; public tier scripts still rebuild first and delegate to the run halves. Updated `apps/desktop/README.md`.
- 2026-07-08: Added `docs/architecture.md` covering main/preload/renderer boundaries, current full-snapshot state flow, driver stack, and test tiers; linked it from `docs/README.md`.
- 2026-07-08: Verified script parsing and docs links: package JSON parse check passed; `rg` confirmed the new run-half scripts and `docs/architecture.md` links are discoverable.
- 2026-07-08: `pnpm --filter @pi-gui/desktop run typecheck` passed after the script/test/doc slice.
- 2026-07-08: `pnpm --filter @pi-gui/desktop run test:e2e:core:run -- --grep "persists renderer diagnostics"` passed and proved the no-build core run-half forwards arguments correctly.
- 2026-07-08: `pnpm --filter @pi-gui/desktop run test:e2e:live:run -- --list` and `pnpm --filter @pi-gui/desktop run test:e2e:native:run -- --list` passed, proving the live/native run-half wiring without launching provider-dependent or foreground-native lanes.
- 2026-07-08: `pnpm --filter @pi-gui/desktop run test:e2e:core -- --grep "persists renderer diagnostics"` passed, proving the public core lane still rebuilds first and delegates to `test:e2e:core:run`.
- 2026-07-08: An accidental full `test:e2e:core:run` invocation reached 130/131 and exposed that `model-scope-toggle.spec.ts` could ask for `/model` slash options while the selected session was still running. Hardened that spec to cancel/wait for idle first; targeted `model-scope-toggle.spec.ts` passed afterward. Full core was not rerun after that targeted hardening in this slice.
- 2026-07-08: Added the first Vitest unit layer: root `test:unit`, `vitest.config.ts`, desktop pure-module specs for `string-utils.ts`, `command-palette-model.ts`, and `composer-commands.ts`, plus `packages/pi-sdk-driver` coverage for `runtime-command-utils.ts`.
- 2026-07-08: `pnpm test:unit` passed (4 files, 18 tests) and `pnpm --filter @pi-gui/desktop run typecheck` passed after the Vitest slice.
- 2026-07-08: Added a CI `unit` job that runs after `typecheck`; `desktop-core` and `desktop-package-linux` now wait for `unit` so the cheaper checks gate the expensive lanes.
- 2026-07-08: Verified the CI slice with `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yml")'`, `pnpm typecheck`, and `pnpm test:unit`.
- 2026-07-08: Added the ESLint/Prettier baseline (`eslint.config.mjs`, `tsconfig.eslint.json`, root `pnpm lint`) and wired CI as gitleaks -> lint -> typecheck -> unit -> desktop/package lanes. The baseline enforces `no-floating-promises`, React hooks rules, and explicit-`any` in source with one documented upstream adapter carve-out. The later warning-free lint closeout supersedes the original sweep note.
- 2026-07-08: `pnpm lint` passed with 38 warnings, `pnpm typecheck` passed, and `pnpm test:unit` passed after the lint/CI slice. Lint caught and fixed awaited reload/refresh promises in `packages/pi-sdk-driver/src/runtime-supervisor.ts` and startup/update paths in Electron.
- 2026-07-08: Moved runtime-used `@dnd-kit/*` packages from desktop `devDependencies` to `dependencies`; added `docs/runtime-deps.md` explaining packaged runtime dependency pins and linked it from `docs/README.md`.
- 2026-07-08: Checked npm metadata: `@legendapp/list` latest is `3.3.2`, `parse5` latest is `8.0.1`, and `yargs` latest is `18.0.0`. Left upgrades pending because they need packaged runtime verification and Electron surface checks.
- 2026-07-08: Verified the dependency-doc slice with package JSON parse checks, `rg` link/import checks, `pnpm --filter @pi-gui/desktop run verify:runtime-model-registry`, `pnpm lint`, `pnpm typecheck`, and `pnpm test:unit`.
- 2026-07-08: Added `logIgnoredError(scope, error)` helpers for Electron main diagnostics, renderer diagnostics, and `pi-sdk-driver` package warnings. Swept the obvious silent catch/noop `.catch` paths in desktop main, renderer localStorage/clipboard/display-mode flows, and `pi-sdk-driver` listener/event-queue cleanup paths.
- 2026-07-08: Re-enabled `no-empty` as an active lint error. `rg` found no remaining bare `catch {}` or `.catch(() => undefined/{})` patterns under `apps/desktop/electron`, `apps/desktop/src`, or `packages/pi-sdk-driver/src`.
- 2026-07-08: Verified the error-handling convention slice with `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, and real Electron diagnostics proof: `pnpm --filter @pi-gui/desktop run test:e2e:core -- --grep "persists renderer diagnostics"` passed and confirmed `ignored-error` payloads reach `desktop.log`.
- 2026-07-08: Expanded Vitest coverage with behavioral specs for `thread-groups.ts`, `plan-panel-model.ts`, and `packages/pi-sdk-driver/src/session-supervisor-utils.ts` (snapshots, config merging, run outcome detection, attachment preamble parsing, and transcript conversion).
- 2026-07-08: `pnpm test:unit` now passes 7 files / 33 tests; `pnpm lint` and `pnpm typecheck` also passed after the expanded unit slice.
- 2026-07-08: Removed low-risk unused imports/locals caught by the lint baseline. `pnpm lint` now passes with 19 warnings, all from `react-hooks/exhaustive-deps`; `pnpm typecheck` and `pnpm test:unit` passed afterward.
- 2026-07-08: Fixed smaller non-`App.tsx` React hook dependency warnings in diff, logs, extensions, skills, slash menu, and terminal surfaces. `pnpm lint` then passed with 13 warnings, all isolated to `App.tsx`; `pnpm typecheck` and `pnpm test:unit` passed afterward.
- 2026-07-08: Eliminated the remaining `App.tsx` React hook warnings by stabilizing view/action callbacks, memoizing selected transcript materialization, and tightening timeline cleanup dependencies. Root `pnpm lint` now runs with `--max-warnings=0` and passes cleanly.
- 2026-07-08: Verified the warning-free lint gate with `pnpm lint`, `pnpm typecheck`, and `pnpm test:unit` (7 files / 33 tests, ~211ms). Real Electron targeted proof also passed through the rebuilding core lane: `pnpm --filter @pi-gui/desktop run test:e2e:core -- --grep "opens and runs actions from the command palette|toggles and persists the primary sidebar|keeps the mid-thread viewport stable"` (3/3).
- 2026-07-09: Current quality gates remain green after the Phase 3/4 refactors: `pnpm --filter @pi-gui/desktop run typecheck`, `pnpm lint`, and `pnpm test:unit` (9 files / 50 tests) all passed. Full current core lane also passed with the no-build runner after a fresh build: `pnpm --filter @pi-gui/desktop run test:e2e:core:run` (134/134). Remaining Phase 2 closeout is CI proof on a PR plus the deferred dependency upgrades/packaged-runtime verification.
- 2026-07-09: Rechecked dependency metadata (`pnpm view @legendapp/list version`, `pnpm view parse5 version`, `pnpm view yargs version`) and kept the pending upgrades gated instead of landing unverified major/runtime-sensitive bumps. Updated `docs/runtime-deps.md` with upgrade gates for renderer virtualization and packaged runtime parser/CLI packages. Remaining Phase 2 closeout is CI proof on a PR and future upgrade spikes that satisfy those gates.
- 2026-07-20: Audited the actual GitHub Actions history instead of treating CI proof as merely unrun. Current `main` and the preceding remediation commits all failed in the Ubuntu unit job because `app-store-utils.test.ts` loaded the `@pi-gui/pi-sdk-driver` root barrel for `sessionKey`, which eagerly loaded the blocked `node-pty` native module. Removed that runtime-barrel dependency from the pure utility module; local unit (15 files / 68 tests), lint, and typecheck proof passes. Remote CI proof remains pending until this fix is pushed.
- 2026-07-21: Upgraded `@legendapp/list` from beta 44 to stable 3.3.3, adapted the removed per-row estimate API, and used the stable ref's `scrollToOffset` path so a virtualized off-bottom thread retains its position across session switches. Typecheck, lint, 72 unit tests, focused timeline regression, long-transcript/native-scroll/thread-return/Display Mode coverage (23/24 initially exposed the restore regression; 24/24 after the fix), packaged smoke, packaged runtime-dependency verification, and release-zip smoke passed. `parse5`/`yargs` are confirmed upstream runtime compatibility dependencies rather than locally owned majors. Remote CI remains the only Phase 2 blocker.
