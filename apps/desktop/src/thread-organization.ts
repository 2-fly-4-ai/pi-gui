import type { ThreadListEntry } from "./thread-groups";

export type ThreadOrganizationFilter =
  | "running"
  | "waiting"
  | "failed"
  | "completed"
  | "interrupted"
  | "unverified";

export type ThreadDateBucket = "Today" | "Yesterday" | "Previous 7 days" | "Older";

export interface ThreadDateGroup {
  readonly label: ThreadDateBucket;
  readonly threads: readonly ThreadListEntry[];
}

const DATE_BUCKETS: readonly ThreadDateBucket[] = ["Today", "Yesterday", "Previous 7 days", "Older"];

export function matchesThreadOrganizationQuery(
  thread: ThreadListEntry,
  workspaceName: string,
  query: string,
): boolean {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const safeMetadata = normalize([
    thread.session.title,
    workspaceName,
    thread.environment.label,
    thread.environment.branchName ?? "",
    ...threadOrganizationStatuses(thread),
  ].join(" "));
  return terms.every((term) => safeMetadata.includes(term));
}

export function matchesThreadOrganizationFilters(
  thread: ThreadListEntry,
  filters: ReadonlySet<ThreadOrganizationFilter>,
): boolean {
  if (filters.size === 0) return true;
  const statuses = new Set(threadOrganizationStatuses(thread));
  return [...filters].some((filter) => statuses.has(filter));
}

export function threadOrganizationStatuses(
  thread: ThreadListEntry,
): readonly ThreadOrganizationFilter[] {
  if (thread.session.status === "running") {
    return thread.session.hasUnseenUpdate ? ["running", "waiting"] : ["running"];
  }
  if (thread.session.status === "failed") {
    return ["failed"];
  }
  const interrupted = /\b(abort(?:ed)?|interrupt(?:ed)?|cancelled)\b/i.test(thread.session.preview);
  return interrupted ? ["interrupted", "unverified"] : ["completed", "unverified"];
}

export function groupThreadsByDate(
  threads: readonly ThreadListEntry[],
  now = new Date(),
): readonly ThreadDateGroup[] {
  const groups = new Map<ThreadDateBucket, ThreadListEntry[]>(
    DATE_BUCKETS.map((bucket) => [bucket, []]),
  );
  for (const thread of threads) {
    groups.get(dateBucket(thread.session.updatedAt, now))?.push(thread);
  }
  return DATE_BUCKETS.flatMap((label) => {
    const entries = groups.get(label) ?? [];
    return entries.length > 0 ? [{ label, threads: entries }] : [];
  });
}

function dateBucket(timestamp: string, now: Date): ThreadDateBucket {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "Older";
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.floor((todayStart - dayStart) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= 7) return "Previous 7 days";
  return "Older";
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
