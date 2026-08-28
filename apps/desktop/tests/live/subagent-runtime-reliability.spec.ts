import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  getRealAuthConfig,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

const execFileAsync = promisify(execFile);

test("background subagent completes once without a blocking join or orphan runner", async () => {
  test.setTimeout(300_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);

  const userDataDir = await makeUserDataDir("pi-gui-subagent-runtime-reliability-");
  const workspacePath = await makeWorkspace("subagent-runtime-reliability");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    realAuthSourceDir: realAuth.sourceDir,
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Subagent runtime reliability");
    const composer = window.getByTestId("composer");
    await composer.fill([
      "Use the Agent tool exactly once with subagent_type general-purpose, run_in_background true,",
      "and description 'runtime reliability child'. Tell the child to reply exactly CHILD_RUNTIME_OK without tools.",
      "Do not poll it and do not call get_subagent_result. End your current turn after launching it.",
      "When its automatic completion message arrives, reply exactly PARENT_RUNTIME_OK.",
    ].join(" "));
    await composer.press("Enter");

    await expect.poll(async () => {
      const transcript = await getSelectedTranscript(window);
      return transcript?.transcript.some((item) =>
        item.kind === "message" && item.role === "assistant" && item.text.includes("PARENT_RUNTIME_OK"),
      ) ?? false;
    }, { timeout: 240_000 }).toBe(true);

    const transcript = await getSelectedTranscript(window);
    const agentCalls = transcript?.transcript.filter((item) => item.kind === "tool" && item.toolName === "Agent") ?? [];
    expect(agentCalls).toHaveLength(1);
    expect(agentCalls[0]?.input).toMatchObject({ run_in_background: true });

    const resultCalls = transcript?.transcript.filter(
      (item) => item.kind === "tool" && item.toolName.endsWith("get_subagent_result"),
    ) ?? [];
    for (const resultCall of resultCalls) {
      expect(resultCall.input).not.toMatchObject({ wait: true });
    }

    const transcriptSurface = window.getByTestId("transcript");
    const agentButton = transcriptSurface.getByRole("button", { name: /Completed general-purpose/i }).first();
    await expect(agentButton).toHaveAttribute("aria-expanded", "false");

    await expect.poll(async () => {
      const state = await getDesktopState(window);
      return state.workspaces
        .flatMap((workspace) => workspace.sessions)
        .find((session) => session.id === state.selectedSessionId)?.status;
    }, { timeout: 30_000 }).toBe("idle");
    const completionHealth = window.getByTestId("completion-card").getByTestId("thread-health-strip");
    await expect(completionHealth).toContainText("1 subagent");
    await expect(completionHealth).not.toContainText("2 subagents");

    const runRoot = join(userDataDir, "agent", "subagents", "runs");
    const runIds = await readdir(runRoot);
    expect(runIds).toHaveLength(1);
    const agentId = runIds[0]!;
    const detachedConfig = JSON.parse(await readFile(
      join(runRoot, agentId, "config.json"),
      "utf8",
    )) as Record<string, unknown>;
    expect(detachedConfig).toMatchObject({ maxTurns: 40, maxRuntimeMs: 3_600_000 });
    const detachedStatus = JSON.parse(await readFile(
      join(runRoot, agentId, "status.json"),
      "utf8",
    )) as Record<string, unknown>;
    expect(detachedStatus).toMatchObject({ status: "completed", turnCount: 1, toolUses: 0 });
    await expect.poll(async () => {
      const { stdout } = await execFileAsync("ps", ["-Ao", "command"]);
      return stdout.includes(`/${agentId}/config.json`);
    }, { timeout: 10_000 }).toBe(false);
  } finally {
    await harness.close();
  }
});
