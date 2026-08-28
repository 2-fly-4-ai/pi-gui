import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createSessionViaIpc,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedCompactedSessionFixture,
  seedTranscriptMessages,
  selectSession,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("selects and copies assistant transcript text", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-text-selection-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Selectable assistant response");
    await seedTranscriptMessages(harness, window, {
      count: 81,
      textFactory: (index) => index === 80
        ? "Selectable transcript text must remain available to the system clipboard."
        : `Earlier assistant response ${index}.`,
    });

    const paragraph = window.locator(".timeline-item--assistant .message__content p", {
      hasText: "Selectable transcript text",
    });
    await expect(paragraph).toBeVisible();
    await expect
      .poll(() => paragraph.evaluate((element) => getComputedStyle(element).userSelect))
      .toBe("text");

    const textRect = await paragraph.evaluate((element) => {
      const textNode = element.firstChild;
      if (!(textNode instanceof Text)) {
        throw new Error("Expected the assistant paragraph to start with a text node");
      }
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    await window.mouse.move(textRect.left + 2, (textRect.top + textRect.bottom) / 2);
    await window.mouse.down();
    await window.mouse.move(textRect.right - 2, (textRect.top + textRect.bottom) / 2, { steps: 12 });
    await window.mouse.up();
    await expect
      .poll(() => window.evaluate(() => window.getSelection()?.toString() ?? ""))
      .toContain("Selectable transcript text");

    await harness.electronApp.evaluate(({ clipboard }) => clipboard.clear());
    await window.keyboard.press("Meta+c");
    await expect
      .poll(() => harness.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain("Selectable transcript text");
  } finally {
    await harness.close();
  }
});

test("keeps virtualized transcript rows aligned with the composer column", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-composer-alignment-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Virtual transcript alignment");
    await seedTranscriptMessages(harness, window, {
      count: 100,
      textFactory: (index) => `Virtualized transcript row ${index}`,
    });

    await expect(window.locator(".timeline__virtual-row").first()).toBeVisible();
    await expect.poll(async () => window.evaluate(() => {
      const row = document.querySelector<HTMLElement>(".timeline__virtual-row");
      const composer = document.querySelector<HTMLElement>(".conversation--composer");
      if (!row || !composer) return null;
      const rowRect = row.getBoundingClientRect();
      const composerRect = composer.getBoundingClientRect();
      return {
        left: Math.round(rowRect.left - composerRect.left),
        right: Math.round(rowRect.right - composerRect.right),
      };
    })).toEqual({ left: 0, right: 0 });
  } finally {
    await harness.close();
  }
});

test("keeps assistant markdown from widening the chat surface", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-layout-overflow-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Wide assistant markdown");

    const longToken = "x".repeat(2_400);
    const longPath = ["workspace", "generated", `${"deep".repeat(160)}.ts`].join("/");
    await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => [
        `A long inline token must wrap: \`${longToken}\``,
        "",
        "```ts",
        `const generatedIdentifier = \"${longToken}\";`,
        "```",
        "",
        "> A quoted note should use the app line token.",
        "",
        "[Open pi-gui](https://example.test/pi-gui)",
        "",
        "| file | note |",
        "| --- | --- |",
        `| ${longPath} | ${longToken} |`,
        "| next.md | second row |",
      ].join("\n"),
    });

    await expect(window.getByTestId("transcript")).toContainText("A long inline token must wrap");

    await expect
      .poll(async () => {
        return window.evaluate(() => {
          const pane = document.querySelector<HTMLElement>("[data-testid='timeline-pane']");
          const transcript = document.querySelector<HTMLElement>("[data-testid='transcript']");
          const main = document.querySelector<HTMLElement>(".main");
          if (!pane || !transcript || !main) {
            return null;
          }
          const paneRect = pane.getBoundingClientRect();
          const transcriptRect = transcript.getBoundingClientRect();
          const mainRect = main.getBoundingClientRect();
          const widestMessageRight = Math.max(
            ...Array.from(document.querySelectorAll<HTMLElement>(".timeline-item, .timeline-tool"), (node) =>
              node.getBoundingClientRect().right,
            ),
          );
          return {
            documentOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
            paneOverflows: pane.scrollWidth > pane.clientWidth + 1,
            paneRightAtChatEdge: Math.abs(paneRect.right - mainRect.right) <= 1,
            scrollbarLivesOutsideTranscript: paneRect.right - transcriptRect.right > 24,
            transcriptNarrowerThanPane: transcriptRect.width < paneRect.width - 24,
            transcriptWithinPane: transcriptRect.right <= paneRect.right + 1,
            messagesWithinMain: widestMessageRight <= mainRect.right + 1,
          };
        });
      })
      .toEqual({
        documentOverflows: false,
        paneOverflows: false,
        paneRightAtChatEdge: true,
        scrollbarLivesOutsideTranscript: true,
        transcriptNarrowerThanPane: true,
        transcriptWithinPane: true,
        messagesWithinMain: true,
      });

    await expect
      .poll(async () => window.evaluate(() => {
        const root = document.documentElement;
        const content = document.querySelector<HTMLElement>(".message__content");
        const pre = content?.querySelector<HTMLElement>("pre");
        const inlineCode = content?.querySelector<HTMLElement>(":not(pre) > code");
        const table = content?.querySelector<HTMLElement>("table");
        const headingCell = content?.querySelector<HTMLElement>("th");
        const bodyCell = content?.querySelector<HTMLElement>("td");
        const link = content?.querySelector<HTMLElement>("a");
        const blockquote = content?.querySelector<HTMLElement>("blockquote");
        if (!content || !pre || !inlineCode || !table || !headingCell || !bodyCell || !link || !blockquote) return null;

        const resolveColor = (value: string) => {
          const probe = document.createElement("span");
          probe.style.color = value;
          document.body.append(probe);
          const color = getComputedStyle(probe).color;
          probe.remove();
          return color;
        };
        const rootStyles = getComputedStyle(root);
        const expectedSurfaceMuted = resolveColor(rootStyles.getPropertyValue("--surface-muted").trim());
        const expectedLine = resolveColor(rootStyles.getPropertyValue("--line").trim());
        const expectedLink = resolveColor(rootStyles.getPropertyValue("--link").trim());
        const preStyles = getComputedStyle(pre);
        const inlineCodeStyles = getComputedStyle(inlineCode);
        const headingStyles = getComputedStyle(headingCell);
        const bodyStyles = getComputedStyle(bodyCell);
        const linkStyles = getComputedStyle(link);
        const quoteStyles = getComputedStyle(blockquote);

        const light = {
          preUsesSurfaceMuted: preStyles.backgroundColor === expectedSurfaceMuted,
          preUsesLine: preStyles.borderTopColor === expectedLine,
          inlineCodeUsesSurfaceMuted: inlineCodeStyles.backgroundColor === expectedSurfaceMuted,
          headingUsesSurfaceMuted: headingStyles.backgroundColor === expectedSurfaceMuted,
          headingAlign: headingStyles.textAlign,
          bodyBorderBottom: bodyStyles.borderBottomStyle,
          bodyBorderLeftWidth: bodyStyles.borderLeftWidth,
          bodyBorderRightWidth: bodyStyles.borderRightWidth,
          linkUsesToken: linkStyles.color === expectedLink,
          linkDecoration: linkStyles.textDecorationLine,
          quoteUsesLine: quoteStyles.borderLeftColor === expectedLine,
        };

        root.classList.add("dark");
        const darkRootStyles = getComputedStyle(root);
        const darkPreStyles = getComputedStyle(pre);
        const darkLinkStyles = getComputedStyle(link);
        const darkExpectedSurfaceMuted = resolveColor(darkRootStyles.getPropertyValue("--surface-muted").trim());
        const darkExpectedLine = resolveColor(darkRootStyles.getPropertyValue("--line").trim());
        const darkExpectedLink = resolveColor(darkRootStyles.getPropertyValue("--link").trim());
        const dark = {
          preUsesSurfaceMuted: darkPreStyles.backgroundColor === darkExpectedSurfaceMuted,
          preUsesLine: darkPreStyles.borderTopColor === darkExpectedLine,
          linkUsesToken: darkLinkStyles.color === darkExpectedLink,
        };
        root.classList.remove("dark");

        return { light, dark };
      }))
      .toMatchObject({
        light: {
          preUsesSurfaceMuted: true,
          preUsesLine: true,
          inlineCodeUsesSurfaceMuted: true,
          headingUsesSurfaceMuted: true,
          headingAlign: "left",
          bodyBorderBottom: "solid",
          bodyBorderLeftWidth: "0px",
          bodyBorderRightWidth: "0px",
          linkUsesToken: true,
          linkDecoration: "underline",
          quoteUsesLine: true,
        },
        dark: {
          preUsesSurfaceMuted: true,
          preUsesLine: true,
          linkUsesToken: true,
        },
      });
  } finally {
    await harness.close();
  }
});

test("keeps compacted session context collapsed until requested", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-compaction-workspace");
  const title = "Compacted history thread";
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir);
  const longArtifactPath = "/Users/brianfarley/Desktop/Githhub-project/serp-extensions-v2-app-factory/runtime/probes/browser-inspect-artifacts/stragglers-1/network-interesting.json";
  const summaryText = [
    "## Goal",
    "False-pass rerun recap should stay readable after compaction.",
    "",
    "<read-files>",
    Array.from({ length: 16 }, () => longArtifactPath).join("\n"),
    "</read-files>",
  ].join("\n");
  await seedCompactedSessionFixture(agentDir, workspacePath, title, summaryText);

  const secondRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    agentDir,
  });

  try {
    const window = await secondRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await selectSession(window, title);

    const card = window.getByTestId("timeline-compaction-summary");
    await expect(card).toBeVisible();
    await expect(card).toContainText("False-pass rerun recap should stay readable");
    await expect(card).not.toContainText(longArtifactPath);
    await expect
      .poll(async () => card.evaluate((node) => Math.round(node.getBoundingClientRect().height)))
      .toBeLessThan(180);

    await card.getByRole("button", { name: "Show compacted context" }).click();
    await expect(card).toContainText(longArtifactPath);
    await expect(card.getByRole("button", { name: "Hide compacted context" })).toBeVisible();
  } finally {
    await secondRun.close();
  }
});

test("opens the latest assistant plan in a side panel and queues an implementation prompt", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("plan-panel-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Plan panel thread");
    await seedTranscriptMessages(harness, window, {
      count: 2,
      textFactory: (index) =>
        index === 0
          ? "# Old Plan\n\n1. Old plan step\n\n- [ ] Do old thing"
          : "# Implementation Plan\n\n1. Add the model.\n2. Add the UI.\n\n- [ ] Write tests\n- [ ] Implement feature",
    });

    const composer = window.getByTestId("composer");
    await composer.fill("draft before plan prompt");

    await expect(window.getByLabel("Toggle plan")).toBeVisible();
    await window.getByLabel("Toggle plan").click();
    const panel = window.getByTestId("plan-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Implementation Plan");
    await expect(panel).toContainText("Write tests");
    await expect(panel).not.toContainText("Old plan step");

    await panel.getByRole("button", { name: "Ask pi to implement this plan" }).click();
    await expect(composer).toHaveValue(/draft before plan prompt/);
    await expect(composer).toHaveValue(/Please implement this plan/);
    await expect(composer).toHaveValue(/Add the model/);
    await expect(composer).not.toHaveValue(/Old plan step/);
    await expect(composer).toBeFocused();
  } finally {
    await harness.close();
  }
});
