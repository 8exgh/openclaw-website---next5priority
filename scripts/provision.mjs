#!/usr/bin/env node
/* Provision one OpenClaw customer website, deployed through 8exgh/devops.
   Deterministic, no Claude needed:
     1. create the repo from the template
     2. brand it (business name in config)
     3. assign a unique port + subdomain (repo variables the CI dispatches with)
     4. set the DEPLOY_TOKEN secret so the repo's CI can dispatch to devops
     5. (needs Cloudflare Tunnel:Edit) add <slug>.fusenv.com -> server7:port
     6. (needs GitHub App/PAT) grant the customer's claw write access
   Usage: node scripts/provision.mjs --name "Bob's Plumbing" --email bob@x.com [--domain bobsplumbing.com] [--dry-run]
*/
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";


async function addRocketCatToClawGroup(claw) {
  const url = process.env.ROCKETCHAT_URL, u = process.env.ROCKETCHAT_ADMIN_USERNAME, pw = process.env.ROCKETCHAT_ADMIN_PASSWORD;
  if (!url || !u || !pw) { console.log("  SKIP rocket.cat group add (ROCKETCHAT_ADMIN_* not set)"); return; }
  try {
    const login = await (await fetch(`${url}/api/v1/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: u, password: pw }) })).json();
    if (login.status !== "success") { console.log("  RocketChat admin login failed"); return; }
    const auth = { "X-Auth-Token": login.data.authToken, "X-User-Id": login.data.userId, "Content-Type": "application/json" };
    const r = await (await fetch(`${url}/api/v1/groups.invite`, { method: "POST", headers: auth, body: JSON.stringify({ roomName: claw, userId: "rocket.cat" }) })).json();
    console.log(`  rocket.cat -> #${claw}: ${r.success ? "added" : "(already a member or n/a)"}`);
    return true;
  } catch (e) { console.log("  rocket.cat group add error:", e.message); return false; }
}


async function reportStep(session, step, status, detail, error) {
  const url = process.env.PROVISION_STATUS_URL, tok = process.env.PROVISION_STATUS_TOKEN;
  if (!url || !tok || !session) return;
  try {
    await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session, step, status, detail: detail ?? null, error: error ?? null }) });
  } catch {}
}

async function verifyLiveSite(session, subdomain) {
  const base = `https://${subdomain}.fusenv.com`;
  let last = "no response";
  for (let i = 0; i < 60; i++) {   // up to ~10 min for build+deploy
    try {
      const r = await fetch(base, { redirect: "manual" });
      last = `HTTP ${r.status}`;
      if (r.status >= 200 && r.status < 500) {
        await reportStep(session, "deploy", "ok", "container is running");
        await reportStep(session, "live", "ok", base);
        // now literally test booking on their live site
        try {
          const b = await (await fetch(`${base}/api/queries/available-slots?days=7`)).json();
          if (Array.isArray(b.slots) && b.slots.length > 0)
            await reportStep(session, "booking", "ok", `${b.slots.length} open times offered`);
          else await reportStep(session, "booking", "error", null, "booking API returned no slots");
        } catch (e) { await reportStep(session, "booking", "error", null, "booking check failed: " + e.message); }
        return;
      }
    } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 10000));
  }
  await reportStep(session, "deploy", "error", null, "site did not come up in time (last: " + last + ")");
  await reportStep(session, "live", "error", null, "no response from " + base + " (last: " + last + ")");
}

/* Literally load the customer's real domain before checking it off. Green
   only when https://<domain> answers; red when registration is still
   pending or it has not come up within the timeout. Re-runs (from the
   registration watcher) flip red to green. */
async function verifyDomain(session, domain, wired) {
  if (wired === "unregistered") {
    await reportStep(session, "domain", "error", null,
      `${domain} is not registered yet. Registration is in progress; this wires itself and turns green automatically once the domain exists.`);
    return;
  }
  if (wired !== "ok") return; // setup error already reported
  const base = `https://${domain}`;
  let last = "no response";
  for (let i = 0; i < 30; i++) {   // up to ~5 min for DNS/proxy to go live
    try {
      const r = await fetch(base, { redirect: "manual" });
      last = `HTTP ${r.status}`;
      if (r.status >= 200 && r.status < 500) {
        await reportStep(session, "domain", "ok", `${base} loads (www too)`);
        return true;
      }
    } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 10000));
  }
  await reportStep(session, "domain", "error", null,
    `DNS and routing are set, but ${base} did not answer within 5 minutes (last: ${last}). It usually comes up shortly; this re-checks on the next provisioning run.`);
  return false;
}

/* The container's runtime env (SITE_URL, the mailbox it sends booking email
   from) is resolved by the devops deploy from 8examples' record of the
   customer. Once the real domain verifies, that record has changed (custom
   domain live, custom-domain mailbox provisioned), so redeploy the same image
   to pick it up. Same dispatch the repo's own CI sends, with the current
   commit so the deploy verifies it. */
async function redeployForDomain(repo, port, subdomain, claw) {
  try {
    const sha = sh(`gh api repos/${OWNER}/${repo}/commits/HEAD --jq .sha`);
    sh(`gh api repos/${OWNER}/devops/dispatches -f event_type=deploy-openclaw-site` +
       ` -f "client_payload[name]=${repo}" -f "client_payload[image]=ghcr.io/${OWNER}/${repo}:latest"` +
       ` -f "client_payload[port]=${port}" -f "client_payload[subdomain]=${subdomain}"` +
       ` -f "client_payload[claw]=${claw}" -f "client_payload[sha]=${sha}" > /dev/null`);
    console.log(`  redeploy dispatched so the site mails from its ${subdomain} domain mailbox`);
  } catch (e) { console.log("  redeploy dispatch failed:", e.message); }
}

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => {
    if (v.startsWith("--")) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]);
    return a;
  }, [])
);
const sh = (c) => execSync(c, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const OWNER = "8exgh";
const SERVER7_IP = "192.168.4.56";
const CF_ACCT = "be2484925dc7150169c09e6770fb7e38";
const CF_TUNNEL = "39498ef8-d3c6-4d42-9d0d-575835d98207";

async function addTunnelIngress(hostname, port) {
  const tok = process.env.CLOUDFLARE_TUNNEL_API_TOKEN;
  if (!tok) { console.log("  SKIP tunnel (set CLOUDFLARE_TUNNEL_API_TOKEN)"); return false; }
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCT}/cfd_tunnel/${CF_TUNNEL}/configurations`;
  const h = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };
  const cfg = (await (await fetch(url, { headers: h })).json()).result.config;
  const ing = cfg.ingress;
  if (ing.some((r) => r.hostname === hostname)) { console.log(`  tunnel: ${hostname} already routed`); return true; }
  const catchall = ing[ing.length - 1];               // must stay last
  cfg.ingress = [...ing.slice(0, -1), { hostname, service: `http://${SERVER7_IP}:${port}` }, catchall];
  const res = await (await fetch(url, { method: "PUT", headers: h, body: JSON.stringify({ config: cfg }) })).json();
  if (!res.success) throw new Error("tunnel PUT failed: " + JSON.stringify(res.errors));
  console.log(`  tunnel: ${hostname} -> ${SERVER7_IP}:${port}`);
  return true;
}
/* Custom domain: registration is the ONE manual step (the Cloudflare API
   cannot purchase new domains). Everything after is automatic: once the
   zone exists in the account, point apex + www at the tunnel (proxied
   CNAMEs; Cloudflare flattens the apex) and route both hostnames to this
   site's port. Idempotent. Needs Zone:Read + DNS:Edit on the token; falls
   back to the tunnel token when no dedicated DNS token is set. */
async function configureCustomDomain(domain, port) {
  const tok = process.env.CLOUDFLARE_DNS_API_TOKEN || process.env.CLOUDFLARE_TUNNEL_API_TOKEN;
  if (!tok) { console.log("  SKIP custom domain (no Cloudflare token)"); return "skipped"; }
  const h = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };
  const api = "https://api.cloudflare.com/client/v4";
  const zres = await (await fetch(`${api}/zones?name=${encodeURIComponent(domain)}`, { headers: h })).json();
  const zone = zres.result && zres.result[0];
  if (!zone) {
    console.log(`  custom domain: no zone for ${domain} yet — register it in the Cloudflare dashboard; the site wires itself once it exists`);
    return "unregistered";
  }
  const target = `${CF_TUNNEL}.cfargotunnel.com`;
  for (const name of [domain, `www.${domain}`]) {
    const list = await (await fetch(`${api}/zones/${zone.id}/dns_records?type=CNAME&name=${encodeURIComponent(name)}`, { headers: h })).json();
    const existing = list.result && list.result[0];
    const body = JSON.stringify({ type: "CNAME", name, content: target, proxied: true, ttl: 1 });
    if (existing && existing.content === target && existing.proxied) {
      console.log(`  dns: ${name} already -> ${target}`);
    } else {
      const r = await (await fetch(
        existing ? `${api}/zones/${zone.id}/dns_records/${existing.id}` : `${api}/zones/${zone.id}/dns_records`,
        { method: existing ? "PUT" : "POST", headers: h, body }
      )).json();
      if (!r.success) throw new Error(`dns upsert ${name} failed: ` + JSON.stringify(r.errors));
      console.log(`  dns: ${name} -> ${target} (proxied)`);
    }
    await addTunnelIngress(name, port);
  }
  return "ok";
}

const dry = args["dry-run"] === "true";

function slugify(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
const slug =
  (args.domain && slugify(args.domain.split(".")[0])) ||
  (args.email && slugify(args.email.split("@")[0])) ||
  slugify(args.name);
if (!slug) { console.error("need --name or --email or --domain"); process.exit(1); }
const repo = `openclaw-website---${slug}`;
const subdomain = slug;

/* Hands the claw its OWN issued email address, credentials included, and
   tells it to actually use it. Posted whenever the dispatch carries
   mailbox credentials (the app sends them exactly once, when the mailbox
   is first provisioned). */
async function briefClawMailbox(claw, address, password) {
  const url = process.env.ROCKETCHAT_URL, u = process.env.ROCKETCHAT_ADMIN_USERNAME, pw = process.env.ROCKETCHAT_ADMIN_PASSWORD;
  if (!url || !u || !pw) { console.log("  SKIP mailbox briefing (ROCKETCHAT_ADMIN_* not set)"); return; }
  const login = await (await fetch(`${url}/api/v1/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: u, password: pw }) })).json();
  if (login.status !== "success") { console.log("  mailbox briefing: admin login failed"); return; }
  const auth = { "X-Auth-Token": login.data.authToken, "X-User-Id": login.data.userId, "Content-Type": "application/json" };
  const text = [
    `@${claw} — you now have your own business email address. It is issued to YOU; use it.`,
    ``,
    `• Address: ${address}`,
    `• Password: ${password}`,
    `• IMAP: imap.migadu.com, port 993, SSL`,
    `• SMTP: smtp.migadu.com, port 465, SSL`,
    `• Webmail: https://webmail.migadu.com`,
    ``,
    `Standing instructions:`,
    `• Check this inbox regularly and read everything that arrives.`,
    `• Answer customer email in your owner's voice; loop them in when something needs a human decision.`,
    `• Send from this address for follow-ups, quotes, booking confirmations, and outreach your owner asks for.`,
    `• Your owner has these credentials too; the inbox is shared between you.`,
    `• Never send bulk unsolicited email. For any outreach, respect consent and include who you are and how to unsubscribe (Canada's anti-spam law, CASL).`,
  ].join("\n");
  const post = async () => (await fetch(`${url}/api/v1/chat.postMessage`, { method: "POST", headers: auth, body: JSON.stringify({ channel: `#${claw}`, text }) })).json();
  let r = await post();
  if (!r.success) {
    await fetch(`${url}/api/v1/groups.invite`, { method: "POST", headers: auth, body: JSON.stringify({ roomName: claw, userId: login.data.userId }) }).catch(() => {});
    r = await post();
  }
  console.log(`  mailbox briefing -> #${claw}: ${r.success ? "posted" : "FAILED: " + JSON.stringify(r.error ?? r).slice(0, 120)}`);
}

/* Hands the claw its own phone number and teaches it the phone gateway:
   one HTTP request places a real call (the gateway runs the voice loop),
   SMS both ways, and DTMF keypad navigation. */
async function briefClawPhone(claw, phone) {
  const url = process.env.ROCKETCHAT_URL, u = process.env.ROCKETCHAT_ADMIN_USERNAME, pw = process.env.ROCKETCHAT_ADMIN_PASSWORD;
  if (!url || !u || !pw) { console.log("  SKIP phone briefing (ROCKETCHAT_ADMIN_* not set)"); return; }
  const login = await (await fetch(`${url}/api/v1/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: u, password: pw }) })).json();
  if (login.status !== "success") { console.log("  phone briefing: admin login failed"); return; }
  const auth = { "X-Auth-Token": login.data.authToken, "X-User-Id": login.data.userId, "Content-Type": "application/json" };
  const text = [
    `@${claw} — you now have your own phone number: ${phone}. Calls out, texts (SMS), and touch-tone menus (DTMF) are all yours through the phone gateway.`,
    ``,
    `Place a call (the gateway's voice agent conducts it; you state the goal):`,
    "```",
    `curl -s -X POST "https://phone-gateway.fusenv.com/orchestrations" -H 'content-type: application/json' \\`,
    `  -d '{"from": "${phone}", "to": "+1...", "goal": "what to achieve", "openingLine": "optional first sentence"}'`,
    "```",
    `Then poll the returned statusUrl every few seconds until status is "ended" and read the transcript in "turns". For phone menus, write the goal like "press 2 for billing, then ask about the invoice" — the agent presses the keys itself.`,
    ``,
    `Send a text:`,
    "```",
    `curl -s -X POST "https://phone-gateway.fusenv.com/sms" -H 'content-type: application/json' \\`,
    `  -d '{"from": "${phone}", "to": "+1...", "body": "..."}'`,
    "```",
    `Receive texts by polling: curl -s "https://phone-gateway.fusenv.com/sms?days=7" and filtering for "to": "${phone}".`,
    ``,
    `Rules: agree the goal and callee with your owner BEFORE dialing. Never call emergency or premium-rate numbers. One call at a time. If someone asks not to be called, never call them again. After each call, report the outcome in two sentences.`,
  ].join("\n");
  const post = async () => (await fetch(`${url}/api/v1/chat.postMessage`, { method: "POST", headers: auth, body: JSON.stringify({ channel: `#${claw}`, text }) })).json();
  let r = await post();
  if (!r.success) {
    await fetch(`${url}/api/v1/groups.invite`, { method: "POST", headers: auth, body: JSON.stringify({ roomName: claw, userId: login.data.userId }) }).catch(() => {});
    r = await post();
  }
  console.log(`  phone briefing -> #${claw}: ${r.success ? "posted" : "FAILED: " + JSON.stringify(r.error ?? r).slice(0, 120)}`);
}

// Pick the lowest free port in 3100-3199 by reading existing sites' OC_SITE_PORT.
function freePort() {
  let used = new Set();
  try {
    const repos = JSON.parse(sh(`gh repo list ${OWNER} --limit 300 --json name --jq '[.[].name | select(startswith("openclaw-website---"))]'`));
    for (const r of repos) {
      try { used.add(Number(sh(`gh variable get OC_SITE_PORT --repo ${OWNER}/${r} 2>/dev/null`))); } catch {}
    }
  } catch {}
  for (let p = 3100; p <= 3199; p++) if (!used.has(p)) return p;
  throw new Error("no free port in 3100-3199");
}
// Re-runs must keep the port the tunnel already routes to; only new sites
// allocate a fresh one.
let port;
try { port = Number(sh(`gh api repos/${OWNER}/${repo}/actions/variables/OC_SITE_PORT --jq .value`)) || undefined; } catch {}
if (!port) port = freePort();

console.log(`Provisioning: ${args.name || slug}`);
console.log(`  repo:      ${OWNER}/${repo}`);
console.log(`  subdomain: ${subdomain}.fusenv.com`);
console.log(`  port:      ${port}  (server7)`);
if (dry) { console.log("  [dry-run] no changes made."); process.exit(0); }

// 1. repo from template (idempotent: reuse if a prior run already created it)
let repoExists = false;
try { sh(`gh api repos/${OWNER}/${repo} --jq .name`); repoExists = true; } catch {}
if (!repoExists) sh(`gh repo create ${OWNER}/${repo} --template ${OWNER}/openclaw-website-template --private`);
// wait for GitHub to finish copying the template (async) before cloning
for (let i=0;i<30;i++){ try{ sh(`gh api repos/${OWNER}/${repo}/contents/src/lib/config.ts --jq .name`); break; }catch{ execSync("sleep 2"); } }
// 2. brand it
const dir = mkdtempSync(join(tmpdir(), "prov-"));
// Clone/push over HTTPS with the provisioning token. The CI runner has no SSH
// key; git@github.com would fail with "Permission denied (publickey)".
const gitUrl = `https://x-access-token:${process.env.GH_TOKEN}@github.com/${OWNER}/${repo}.git`;
sh(`git clone ${gitUrl} ${dir}`);
const cfgPath = join(dir, "src/lib/config.ts");
let cfg = readFileSync(cfgPath, "utf8");
cfg = cfg.replace(/businessName: ".*?"/, `businessName: ${JSON.stringify(args.name || slug)}`);
if (args.email) cfg = cfg.replace(/ownerEmail: ".*?"/, `ownerEmail: ${JSON.stringify(args.email)}`);   // booking confirm links + reply-to
writeFileSync(cfgPath, cfg);
sh(`cd ${dir} && git config user.email bot@8examples.com && git config user.name "8Examples Provisioner" && git add -A && (git diff --cached --quiet || git commit -q -m "brand site for ${args.name || slug}")`);
// 3. Install the repo's deployment configuration BEFORE pushing the branded
// commit. GitHub snapshots vars/secrets when a workflow run is created; a push
// before these writes creates a build that can never dispatch its deployment.
sh(`gh variable set OC_SITE_PORT --repo ${OWNER}/${repo} --body ${port}`);
sh(`gh variable set OC_SITE_SUBDOMAIN --repo ${OWNER}/${repo} --body ${subdomain}`);
if (args.claw) { sh(`gh variable set OC_CLAW_USERNAME --repo ${OWNER}/${repo} --body ${args.claw}`); console.log(`  claw: ${args.claw} (its channel gets the daily tips)`); const inGroup = await addRocketCatToClawGroup(args.claw); await reportStep(args.session, "chatlink", inGroup ? "ok" : "error", inGroup ? `#${args.claw}` : null, inGroup ? null : "could not add rocket.cat to the claw group"); if (args.mailbox && args["mailbox-pass"]) await briefClawMailbox(args.claw, args.mailbox, args["mailbox-pass"]); if (args.phone) await briefClawPhone(args.claw, args.phone);
  // Every claw gets the phone gateway briefing (workspace doc + env),
  // own number or not — the shared number works out of the box.
  try {
    sh(`gh api repos/${OWNER}/devops/dispatches -f event_type=enable-claw-capability -f "client_payload[tenant]=${args.claw}" -f "client_payload[capability]=phone" > /dev/null`);
    console.log(`  enable-claw-capability(phone) dispatched for ${args.claw}`);
  } catch (e) { console.log("  enable-claw-capability dispatch failed:", e.message); }
  // The site IS the webdev capability: enable it so the claw's AGENTS.md
  // lists the website as its job rather than an upsell left to unlock.
  try {
    sh(`gh api repos/${OWNER}/devops/dispatches -f event_type=enable-claw-capability -f "client_payload[tenant]=${args.claw}" -f "client_payload[capability]=webdev" > /dev/null`);
    console.log(`  enable-claw-capability(webdev) dispatched for ${args.claw}`);
  } catch (e) { console.log("  enable-claw-capability(webdev) dispatch failed:", e.message); } }
else console.log("  SKIP claw username (pass --claw openclawN, from the claw handed out at payment)");
// 4. DEPLOY_TOKEN so the repo can dispatch to devops
if (process.env.PROVISION_DEPLOY_TOKEN) {
  sh(`gh secret set DEPLOY_TOKEN --repo ${OWNER}/${repo} --body "${process.env.PROVISION_DEPLOY_TOKEN}"`);
  console.log("  set DEPLOY_TOKEN secret");
} else {
  console.log("  SKIP DEPLOY_TOKEN (set PROVISION_DEPLOY_TOKEN to enable CI->devops dispatch)");
}
// This is the first push expected to deploy. The template-creation run is
// guarded in the workflow and skips deployment while variables are absent.
sh(`cd ${dir} && git push -q`);
// Report only after the finished, branded repository is available. The
// 8Examples background processor then dispatches the retryable access job.
try { sh(`gh api repos/${OWNER}/${repo} --jq .name`); await reportStep(args.session, "website", "ok", `github.com/${OWNER}/${repo}`); }
catch (e) { await reportStep(args.session, "website", "error", null, "repo not found after branding"); }
// 5. tunnel ingress (needs Cloudflare Tunnel:Edit)
const routed = await addTunnelIngress(`${subdomain}.fusenv.com`, port);
await reportStep(args.session, "route", routed ? "ok" : "error", routed ? `${subdomain}.fusenv.com` : null, routed ? null : "tunnel ingress not added");
console.log("  DNS: covered by the *.fusenv.com wildcard (no per-host record needed)");
// 5b. custom domain, when one was bought: DNS records + apex/www ingress.
// Harmless before registration; the 8examples app re-dispatches this run
// automatically once the zone shows up in the Cloudflare account.
let domainWired = "skipped";
if (args.domain) {
  try {
    domainWired = await configureCustomDomain(args.domain, port);
    if (domainWired === "ok") await reportStep(args.session, "route", "ok", `${subdomain}.fusenv.com + ${args.domain} (with www)`);
  } catch (e) {
    domainWired = "error";
    console.log("  custom domain error: " + e.message);
    await reportStep(args.session, "domain", "error", null, "domain setup failed: " + e.message);
  }
}
console.log(`Done. Repo: https://github.com/${OWNER}/${repo}`);

// Poll the customer's live site and literally test it before checking off deploy/live/booking.
await verifyLiveSite(args.session, subdomain);

// Same for the real domain, when one was bought. When it answers, redeploy so
// the container's SITE_URL and sender mailbox move to the custom domain.
if (args.domain && (await verifyDomain(args.session, args.domain, domainWired)) && args.claw) {
  await redeployForDomain(repo, port, subdomain, args.claw);
}
