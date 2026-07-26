import type { SessionTreeNodeSnapshot, SessionTreeSnapshot } from "@pi-gui/session-driver/types";

export interface BranchComparisonMetrics {
  readonly id: string;
  readonly label: string;
  readonly outcome: string;
  readonly duration: string;
  readonly model: string;
  readonly filesChanged: string;
  readonly verification: string;
  readonly boundaries: string;
  readonly subagents: string;
  readonly blockers: string;
}

export function listComparableBranches(tree: SessionTreeSnapshot): readonly SessionTreeNodeSnapshot[] {
  return flatten(tree.roots).filter((node) => node.children.length === 0 && isVisibleBranchLeaf(node));
}

export function compareBranch(
  tree: SessionTreeSnapshot,
  branchId: string,
): BranchComparisonMetrics | undefined {
  const nodes = flatten(tree.roots);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const leaf = byId.get(branchId);
  if (!leaf) return undefined;
  const path = pathToRoot(leaf, byId);
  const first = path[0];
  const start = first ? Date.parse(first.timestamp) : Number.NaN;
  const end = Date.parse(leaf.timestamp);
  const model = [...path].reverse().find((node) => node.kind === "model_change")?.preview;
  const blocker = [...path].reverse().find((node) => (
    /\b(fail(?:ed|ure)?|blocked|error|cancelled|interrupted)\b/i.test(`${node.title} ${node.preview ?? ""}`)
  ));

  return {
    id: leaf.id,
    label: leaf.preview || leaf.title,
    outcome: leaf.preview || "No final message was observed.",
    duration: Number.isFinite(start) && Number.isFinite(end)
      ? formatDuration(Math.max(0, end - start))
      : "Unknown",
    model: model || "Not recorded on this branch",
    filesChanged: "Not attributed by the runtime",
    verification: "No branch-specific evidence recorded",
    boundaries: "Not recorded on this branch",
    subagents: "No branch-specific subagent evidence recorded",
    blockers: blocker?.preview || blocker?.title || "None observed",
  };
}

export function branchRecommendation(
  left: BranchComparisonMetrics,
  right: BranchComparisonMetrics,
): string {
  if (left.blockers === "None observed" && right.blockers !== "None observed") {
    return `Review ${left.label} first because no blocker was observed there.`;
  }
  if (right.blockers === "None observed" && left.blockers !== "None observed") {
    return `Review ${right.label} first because no blocker was observed there.`;
  }
  return "No automatic winner: review the observed outcomes and branch-specific evidence before continuing.";
}

function flatten(nodes: readonly SessionTreeNodeSnapshot[]): SessionTreeNodeSnapshot[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

function pathToRoot(
  leaf: SessionTreeNodeSnapshot,
  byId: ReadonlyMap<string, SessionTreeNodeSnapshot>,
): SessionTreeNodeSnapshot[] {
  const path: SessionTreeNodeSnapshot[] = [];
  let current: SessionTreeNodeSnapshot | undefined = leaf;
  while (current) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

function isVisibleBranchLeaf(node: SessionTreeNodeSnapshot): boolean {
  return node.kind === "message" || node.kind === "branch_summary" || node.kind === "compaction";
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}
