import { expect, test } from "@playwright/test";
import {
  getDesktopState,
  getRealAuthConfig,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

function assistantMessages(transcript: Awaited<ReturnType<typeof getSelectedTranscript>>): string[] {
  return (transcript?.transcript ?? [])
    .filter((item): item is Extract<NonNullable<typeof transcript>["transcript"][number], { kind: "message"; role: "assistant" }> =>
      item.kind === "message" && item.role === "assistant",
    )
    .map((item) => item.text.trim());
}

test("steers the current run with Enter while a run is active", async () => {
  test.setTimeout(240_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("queued-messages-live");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    realAuthSourceDir: realAuth.sourceDir,
  });

  try {
    const window = await harness.firstWindow();

    await window.getByRole("complementary").getByRole("button", { name: "New thread" }).click();
    await window.getByLabel("New thread prompt").fill(
      "Use your bash or shell tool to run `python - <<'PY'\nimport time\nprint(\"queue-start\")\ntime.sleep(8)\nprint(\"queue-end\")\nPY` and, after the tool call, reply with exactly BASELINE_DONE.",
    );
    await window.getByRole("button", { name: "Start thread" }).click();

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions[0]?.status ?? "";
      }, { timeout: 60_000 })
      .toBe("running");

    const composer = window.getByTestId("composer");
    const sendButton = window.getByTestId("send");
    await expect(sendButton).toHaveAttribute("aria-label", "Stop run");

    await composer.fill("Change your pending final answer for the current run to exactly STEER_DONE.");
    await expect(sendButton).toHaveAttribute("aria-label", "Steer current run");
    await composer.press("Enter");
    await expect(window.getByTestId("queued-composer-message").filter({ hasText: "STEER_DONE" })).toHaveCount(0);
    await expect(window.getByTestId("transcript")).toContainText("STEER_DONE");

    await expect(window.getByTestId("transcript")).toContainText("STEER_DONE", { timeout: 180_000 });

    await expect
      .poll(async () => {
        const messages = assistantMessages(await getSelectedTranscript(window));
        return messages.some((message) => message.includes("STEER_DONE"));
      }, { timeout: 180_000 })
      .toBe(true);

    const finalAssistantText = assistantMessages(await getSelectedTranscript(window)).join("\n");
    expect(finalAssistantText.includes("STEER_DONE")).toBe(true);
    expect(finalAssistantText.includes("BASELINE_DONE")).toBe(false);

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions[0]?.status ?? "";
      }, { timeout: 180_000 })
      .toBe("idle");
    await expect(window.getByTestId("queued-composer-messages")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
