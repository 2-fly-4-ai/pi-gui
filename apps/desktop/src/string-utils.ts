export function titleCase(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatRelativeTime(value: string): string {
  if (!value) {
    return "";
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  const diffMs = Date.now() - timestamp;
  const future = diffMs < -60_000;
  const diffMinutes = Math.floor(Math.abs(diffMs) / 60000);
  if (diffMinutes < 1) return "now";
  if (diffMinutes < 60) return future ? `in ${diffMinutes}m` : `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return future ? `in ${diffHours}h` : `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return future ? `in ${diffDays}d` : `${diffDays}d`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffDays < 30) return future ? `in ${diffWeeks}w` : `${diffWeeks}w`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return future ? `in ${diffMonths}mo` : `${diffMonths}mo`;
  const diffYears = Math.floor(diffDays / 365);
  return future ? `in ${diffYears}y` : `${diffYears}y`;
}

export function formatExactLocalTime(value: string): string {
  if (!value) {
    return "Time unavailable";
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return `Unrecognized time: ${value}`;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "long",
  }).format(new Date(timestamp));
}
