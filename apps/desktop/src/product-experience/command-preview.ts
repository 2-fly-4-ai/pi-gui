export type CommandOrigin = "saved-project-action" | "agent-proposed" | "user-terminal";
export type CommandRisk = "routine" | "significant" | "destructive";

export interface CommandPreview {
  readonly id: string;
  readonly origin: CommandOrigin;
  readonly originLabel: string;
  readonly command: string;
  readonly displayCommand: string;
  readonly cwd: string;
  readonly risk: CommandRisk;
  readonly requiresConfirmation: boolean;
  readonly environment: readonly {
    readonly name: string;
    readonly value: "[redacted]";
  }[];
}

export function buildCommandPreview(input: {
  readonly id: string;
  readonly origin: CommandOrigin;
  readonly command: string;
  readonly cwd: string;
  readonly confirmationThreshold?: CommandRisk;
}): CommandPreview {
  const command = input.command.trim();
  const risk = classifyCommandRisk(command);
  const threshold = input.confirmationThreshold ?? "significant";
  return {
    id: input.id,
    origin: input.origin,
    originLabel: commandOriginLabel(input.origin),
    command,
    displayCommand: redactCommandEnvironment(command),
    cwd: input.cwd,
    risk,
    requiresConfirmation: riskRank(risk) >= riskRank(threshold),
    environment: extractEnvironmentAssignments(command).map((name) => ({
      name,
      value: "[redacted]" as const,
    })),
  };
}

export function classifyCommandRisk(command: string): CommandRisk {
  if (
    /(^|[;&|]\s*)(sudo\s+)?rm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\b/i.test(command)
    || /\b(git\s+push\s+--force(?:-with-lease)?|git\s+reset\s+--hard|drop\s+(database|table)|mkfs|diskutil\s+erase)\b/i.test(command)
  ) return "destructive";
  if (
    /\b(sudo|git\s+(push|commit|merge|rebase)|npm\s+(install|uninstall|publish)|pnpm\s+(add|remove|publish)|yarn\s+(add|remove|publish)|pip\s+install|cargo\s+(add|publish)|curl\b|wget\b)\b/i.test(command)
    || /\b(rm|mv)\s+/i.test(command)
  ) return "significant";
  return "routine";
}

export function redactCommandEnvironment(command: string): string {
  return command
    .replace(
      /(^|[\s;&|])([A-Za-z_][A-Za-z0-9_]*)=(?:"[^"]*"|'[^']*'|[^\s;&|]+)/g,
      (match, prefix: string, name: string) =>
        /(?:TOKEN|KEY|SECRET|PASSWORD|PASS|CREDENTIAL)/i.test(name)
          ? `${prefix}${name}=[redacted]`
          : match,
    )
    .replace(
      /((?:--(?:api-?key|token|password|secret)|-[pP])(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s;&|]+)/gi,
      "$1[redacted]",
    );
}

export function extractEnvironmentAssignments(command: string): readonly string[] {
  const names = new Set<string>();
  const matcher = /(?:^|[\s;&|])([A-Za-z_][A-Za-z0-9_]*)=(?:"[^"]*"|'[^']*'|[^\s;&|]+)/g;
  for (const match of command.matchAll(matcher)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names];
}

export function commandOriginLabel(origin: CommandOrigin): string {
  if (origin === "saved-project-action") return "Saved project action";
  if (origin === "agent-proposed") return "Agent-proposed command";
  return "User-entered terminal command";
}

function riskRank(risk: CommandRisk): number {
  if (risk === "destructive") return 2;
  if (risk === "significant") return 1;
  return 0;
}
