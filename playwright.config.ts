import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const E2E = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/e2e/e2e.config.json"), "utf8"));
const baseURL = `http://${E2E.host}:${E2E.port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // One site, one event log: the specs share state and run in order.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    // Slots render in the visitor's zone; pinning it keeps what the browser
    // shows comparable to what the emails say.
    timezoneId: E2E.timeZone,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: process.env.CI
      ? undefined
      : { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/snap/bin/chromium" },
  },
  webServer: {
    // Boots the mock Rocket.Chat and SMTP hosts, then the site pointed at them.
    command: "node tests/e2e/mocks/serve.mjs",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
