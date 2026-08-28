import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SPEC_GROUPS = [
  [
    "timeline-native-scroll.spec.ts", "display-mode.spec.ts", "appearance-settings.spec.ts",
    "subagent-timeline-card.spec.ts", "navigation.spec.ts", "skill-profiles.spec.ts",
    "provider-settings.spec.ts", "mentions-diff.spec.ts", "timeline-minimap.spec.ts",
    "security-policies.spec.ts", "resource-inspector.spec.ts", "task-evidence-ledger.spec.ts",
    "t3-resource-performance.spec.ts", "focus-mode.spec.ts", "contextual-result-actions.spec.ts",
  ],
  [
    "timeline-pinning.spec.ts", "chat-performance.spec.ts", "queued-messages.spec.ts",
    "new-thread-auto-title.spec.ts", "smoke.spec.ts", "project-actions-prompt-shelf.spec.ts",
    "persistence.spec.ts", "extension-dock.spec.ts", "thread-return-hydration.spec.ts",
    "session-cwd.spec.ts", "reopen-state.spec.ts", "notification-settings.spec.ts",
    "git-quick-actions.spec.ts", "context-inspector.spec.ts",
  ],
  [
    "timeline-layout.spec.ts", "new-thread-composer.spec.ts", "skills-settings.spec.ts",
    "worktrees.spec.ts", "integrated-review-mode.spec.ts", "update-status.spec.ts",
    "thread-return-subagents.spec.ts", "approval-center.spec.ts", "workspace-menu.spec.ts",
    "session-dormancy.spec.ts", "renderer-recovery.spec.ts", "terminal-diff-layout.spec.ts",
    "change-intelligence-review.spec.ts", "model-scope-toggle.spec.ts", "composer-quotas.spec.ts",
    "project-actions.spec.ts",
  ],
  [
    "timeline-thinking.spec.ts", "composer-drag-drop.spec.ts", "composer-controls.spec.ts",
    "remote-execution-spike.spec.ts", "tree-command.spec.ts", "sidebar-ordering.spec.ts",
    "display-mode-performance.spec.ts", "composer-draft-sync.spec.ts", "unread-state.spec.ts",
    "thread-organization.spec.ts", "sidebar-toggle.spec.ts", "t3-product-surface-matrix.spec.ts",
    "attention-markers.spec.ts", "branch-from-message.spec.ts", "diagnostics.spec.ts",
    "pull-requests.spec.ts",
  ],
  [
    "agent-settings.spec.ts", "review-ux.spec.ts", "observability-panel.spec.ts",
    "integrated-terminal.spec.ts", "workspace-productivity.spec.ts", "runtime-jobs.spec.ts",
    "desktop-custom-instructions.spec.ts", "usage-dashboard.spec.ts", "timeline-compression.spec.ts",
    "side-browser-panel.spec.ts", "startup-lifecycle.spec.ts", "archive.spec.ts",
    "command-preview.spec.ts", "execution-boundary.spec.ts", "project-knowledge.spec.ts",
  ],
];

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "../..");
const coreTestDir = join(appRoot, "tests/core");
const shardIndex = Number.parseInt(process.argv[2] ?? "", 10) - 1;

if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= SPEC_GROUPS.length) {
  console.error(`Expected a core CI shard number from 1 to ${SPEC_GROUPS.length}.`);
  process.exit(2);
}

const discoveredSpecs = (await readdir(coreTestDir))
  .filter((name) => name.endsWith(".spec.ts"))
  .sort();
const manifestSpecs = SPEC_GROUPS.flat();
const duplicateSpecs = [...new Set(manifestSpecs.filter((name, index) => manifestSpecs.indexOf(name) !== index))];
if (duplicateSpecs.length > 0) {
  console.error(`Core CI shard manifest assigns specs more than once: ${duplicateSpecs.join(", ")}`);
  process.exit(2);
}
const assignedSpecs = new Set(manifestSpecs);
const unknownSpecs = discoveredSpecs.filter((name) => !assignedSpecs.has(name));

for (const spec of unknownSpecs) {
  SPEC_GROUPS[stableShard(spec, SPEC_GROUPS.length)].push(spec);
}

const missingSpecs = [...assignedSpecs].filter((name) => !discoveredSpecs.includes(name));
if (missingSpecs.length > 0) {
  console.error(`Core CI shard manifest references missing specs: ${missingSpecs.join(", ")}`);
  process.exit(2);
}

const selectedSpecs = SPEC_GROUPS[shardIndex]
  .slice()
  .sort()
  .map((name) => `apps/desktop/tests/core/${name}`);
console.log(`Running duration-balanced core shard ${shardIndex + 1}/${SPEC_GROUPS.length} (${selectedSpecs.length} specs).`);

const result = spawnSync(
  "pnpm",
  ["exec", "playwright", "test", "-c", "apps/desktop/playwright.config.ts", ...selectedSpecs, ...process.argv.slice(3)],
  {
    cwd: repoRoot,
    env: { ...process.env, PI_APP_TEST_MODE: "background" },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);

function stableShard(value, shardCount) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % shardCount;
}
