import { describe, expect, it } from "vitest";
import { SourceControlService, parseGitHubRemote, redactSourceControlOutput } from "../../electron/source-control-service";

describe("GitHub source control provider", () => {
  it.each([
    ["git@github.com:openai/codex.git", "github.com", "openai", "codex"],
    ["ssh://git@github.example.com/team/repo.git", "github.example.com", "team", "repo"],
    ["https://github.com/openai/codex.git", "github.com", "openai", "codex"],
  ])("parses supported GitHub remotes without retaining credentials", (remote, host, owner, name) => {
    expect(parseGitHubRemote(remote)).toEqual({
      provider: "github",
      host,
      owner,
      name,
      webUrl: `https://${host}/${owner}/${name}`,
    });
  });

  it("rejects ambiguous, local, and over-nested remotes", () => {
    expect(parseGitHubRemote("/tmp/repo")).toBeUndefined();
    expect(parseGitHubRemote("https://github.com/org/group/repo.git")).toBeUndefined();
    expect(parseGitHubRemote("https://github.com/org/../repo.git")).toBeUndefined();
  });

  it("redacts URL credentials, query credentials, GitHub tokens, and long hex values", () => {
    const redacted = redactSourceControlOutput(
      "https://user:password@github.com/a/b?access_token=secret ghp_abcdefghijklmnopqrstuvwxyz123456 0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    expect(redacted).not.toContain("password");
    expect(redacted).not.toContain("secret");
    expect(redacted).not.toContain("ghp_");
    expect(redacted).not.toContain("0123456789abcdef");
    expect(redacted).toContain("[redacted]");
  });

  it("creates consequence-rich previews before every mutation", () => {
    const service = new SourceControlService("/tmp/pi-gui-source-control-test", () => undefined);
    const checkout = service.previewMutation({ kind: "checkout", pullRequestNumber: 42 });
    expect(checkout.requiresConfirmation).toBe(true);
    expect(checkout.consequences.join(" ")).toContain("working-tree");
    const create = service.previewMutation({ kind: "create", title: "Feature", body: "Description", base: "main" });
    expect(create.requiresConfirmation).toBe(true);
    expect(create.summary).toContain("main");
    expect(() => service.previewMutation({ kind: "comment", pullRequestNumber: 42, body: "" })).toThrow(/required/i);
    expect(service.previewMutation({ kind: "edit-comment", pullRequestNumber: 42, commentId: "IC_user", body: "Updated" }).title).toContain("your comment");
    service.dispose();
  });
});
