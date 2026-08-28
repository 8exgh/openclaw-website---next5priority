/* Posts a message into the owner's own claw channel (#openclaw<X>) through
   the shared Rocket.Chat incoming webhook, styled as the worker so it reads
   like the claw itself talking. The specific claw (handed out when the
   customer paid) comes from CLAW_USERNAME. Gated: no webhook configured
   means return false so the caller leaves the message owed and retries. */
export async function postToClaw(text: string): Promise<boolean> {
  const url = process.env.ROCKETCHAT_WEBHOOK_URL;
  if (!url) {
    console.warn("ROCKETCHAT_WEBHOOK_URL not set; skipping Rocket.Chat delivery");
    return false;
  }
  const claw = process.env.CLAW_USERNAME; // e.g. "openclaw7"
  const body: Record<string, unknown> = { text, alias: "OpenClaw" };
  if (claw) body.channel = `#${claw}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`rocketchat webhook: HTTP ${res.status}`);
  return res.ok;
}
