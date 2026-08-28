/* Playwright's webServer command.

   Starts the mock Rocket.Chat webhook and SMTP host, then boots the site
   pointed at them. Doing both in one process guarantees the mocks are
   listening before the site's first notification, and that they die with it.

   The site is otherwise configured exactly as the devops deploy configures a
   real one: same env var names, same shape of values. SITE_SCHEDULER=0 keeps
   the background timers out of the way so the specs decide when a sweep
   happens (POST /api/jobs/notify), instead of racing a five-minute tick. */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startWebhookMock, startSmtpMock } from "./integrations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const E2E = JSON.parse(fs.readFileSync(path.join(root, "tests/e2e/e2e.config.json"), "utf8"));
E2E.baseURL = `http://${E2E.host}:${E2E.port}`;
const dir = path.join(root, E2E.artifactDir);

fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

await startWebhookMock({ port: E2E.webhookPort, logFile: path.join(root, E2E.webhookLog) });
await startSmtpMock({
  port: E2E.smtpPort,
  logFile: path.join(root, E2E.mailLog),
  modeFile: path.join(root, E2E.smtpModeFile),
});
console.log(`mocks listening: webhook :${E2E.webhookPort}, smtp :${E2E.smtpPort}`);

/* Serve the standalone build, which is what the container runs (Dockerfile
   CMD ["node","server.js"]). Next emits it without the static assets, so copy
   them in exactly as the image build does; otherwise the page never hydrates. */
const standalone = path.join(root, ".next/standalone");
if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error("no standalone build found - run `next build` first (npm run test:e2e does)");
  process.exit(1);
}
fs.cpSync(path.join(root, ".next/static"), path.join(standalone, ".next/static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) {
  fs.cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
}

const site = spawn(
  "node",
  [path.join(standalone, "server.js")],
  {
    cwd: standalone,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: E2E.host,
      PORT: String(E2E.port),
      DB_PATH: path.join(root, E2E.dbFile),
      SITE_URL: E2E.baseURL,
      SITE_SCHEDULER: "0",
      CLAW_API_KEY: E2E.clawKey,
      CLAW_USERNAME: E2E.claw,
      ROCKETCHAT_WEBHOOK_URL: `http://${E2E.host}:${E2E.webhookPort}/hooks/e2e`,
      OWNER_EMAIL: E2E.ownerEmail,
      SMTP_HOST: E2E.host,
      SMTP_PORT: String(E2E.smtpPort),
      SMTP_SECURE: "0",
      SMTP_USER: E2E.smtpUser,
      SMTP_PASS: "e2e-smtp-password",
      EMAIL_FROM: E2E.emailFrom,
    },
  }
);

const stop = (signal) => {
  if (!site.killed) site.kill(signal === "SIGINT" ? "SIGINT" : "SIGTERM");
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
site.on("exit", (code) => process.exit(code ?? 0));
