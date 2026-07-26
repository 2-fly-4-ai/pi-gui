import { describe, expect, it } from "vitest";
import {
  buildCommandPreview,
  classifyCommandRisk,
  commandOriginLabel,
  redactCommandEnvironment,
} from "../../src/product-experience/command-preview";

describe("command previews", () => {
  it("keeps routine commands efficient and gates significant or destructive commands", () => {
    expect(classifyCommandRisk("pnpm test")).toBe("routine");
    expect(classifyCommandRisk("curl https://example.com")).toBe("significant");
    expect(classifyCommandRisk("git push --force-with-lease")).toBe("destructive");
    expect(buildCommandPreview({
      id: "routine",
      origin: "saved-project-action",
      command: "pnpm test",
      cwd: "/tmp/project",
    }).requiresConfirmation).toBe(false);
    expect(buildCommandPreview({
      id: "significant",
      origin: "saved-project-action",
      command: "git push",
      cwd: "/tmp/project",
    }).requiresConfirmation).toBe(true);
  });

  it("redacts secret-like environment values while retaining environment names", () => {
    const preview = buildCommandPreview({
      id: "secret",
      origin: "saved-project-action",
      command: "OPENAI_API_KEY=sk-sensitive SAFE_MODE=1 curl --token abc123 https://example.com",
      cwd: "/tmp/project",
    });
    expect(preview.displayCommand).toBe(
      "OPENAI_API_KEY=[redacted] SAFE_MODE=1 curl --token [redacted] https://example.com",
    );
    expect(preview.environment).toEqual([
      { name: "OPENAI_API_KEY", value: "[redacted]" },
      { name: "SAFE_MODE", value: "[redacted]" },
    ]);
    expect(redactCommandEnvironment("PASSWORD='hello world' echo ok")).toBe("PASSWORD=[redacted] echo ok");
  });

  it("distinguishes all supported command origins", () => {
    expect(commandOriginLabel("saved-project-action")).toBe("Saved project action");
    expect(commandOriginLabel("agent-proposed")).toBe("Agent-proposed command");
    expect(commandOriginLabel("user-terminal")).toBe("User-entered terminal command");
  });
});
