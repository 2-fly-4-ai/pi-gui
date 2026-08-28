import { defineConfig } from "@playwright/test";

const isBackgroundRun = process.env.PI_APP_TEST_MODE === "background";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  // Background Electron tests use isolated user-data and agent directories, so
  // CI can distribute individual tests across independent one-worker shards.
  // Foreground/native tests stay file-ordered on one worker because they share
  // the real macOS input loop.
  fullyParallel: isBackgroundRun,
  // Electron user-surface tests are materially more reliable when one app owns the input loop at a time.
  workers: 1,
  retries: process.env.PI_APP_TEST_MODE === "foreground" ? 1 : 0,
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
