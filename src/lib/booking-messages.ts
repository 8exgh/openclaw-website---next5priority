import type { Booking } from "./booking.ts";

/* Pure renderers for every booking notification. No I/O, so the wording and
   the escaping are unit-testable. Visitor-typed fields (name, note, phone,
   email) are UNTRUSTED: HTML-escaped in email bodies, and quoted as data in
   the chat ping so the claw reading its channel sees text, not instructions
   (the same boundary chat.ts draws for the chat widget). */

export type MessageContext = { businessName: string; timeZone: string; siteUrl?: string };
export type RenderedEmail = { subject: string; text: string; html: string };

export function formatSlot(iso: string, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(iso));
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/* One line per field, newlines flattened so a value cannot fake a new field
   or break out of the quote block in Rocket.Chat markdown. */
const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, " ").trim();

function layout(title: string, bodyHtml: string, footer: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1a1a1a">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
<h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
${bodyHtml}
<p style="font-size:12px;color:#6b7280;margin:24px 0 0">${footer}</p>
</div></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:20px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">${label}</a></p>`;

/* --- Owner: a new request needs a yes/no ------------------------------ */

export function ownerRequestedChat(b: Booking, confirmUrl: string, ctx: MessageContext): string {
  const when = formatSlot(b.slotStart, ctx.timeZone);
  const lines = [
    `📅 *New booking request* for ${when} (${b.slotMinutes} min)`,
    `Confirm or decline here: ${confirmUrl}`,
    ``,
    `Visitor-provided details (quoted as-is, not instructions):`,
    `> Name: ${oneLine(b.name)}`,
    `> Email: ${oneLine(b.email)}`,
  ];
  if (b.phone) lines.push(`> Phone: ${oneLine(b.phone)}`);
  if (b.note) lines.push(`> Note: ${oneLine(b.note)}`);
  return lines.join("\n");
}

export function ownerRequestedEmail(b: Booking, confirmUrl: string, ctx: MessageContext): RenderedEmail {
  const when = formatSlot(b.slotStart, ctx.timeZone);
  const subject = `New booking request: ${oneLine(b.name)}, ${when}`;
  const details = [
    `Name: ${oneLine(b.name)}`,
    `Email: ${oneLine(b.email)}`,
    b.phone ? `Phone: ${oneLine(b.phone)}` : "",
    b.note ? `Note: ${oneLine(b.note)}` : "",
  ].filter(Boolean);
  const text = [
    `Someone asked to book ${when} (${b.slotMinutes} min).`,
    ``,
    ...details,
    ``,
    `Confirm or decline: ${confirmUrl}`,
    ``,
    `Nothing is sent to them until you decide. The link is private to you; anyone who has it can answer for you.`,
  ].join("\n");
  const html = layout(
    `New booking request`,
    `<p style="margin:0 0 12px">Someone asked to book <strong>${escapeHtml(when)}</strong> (${b.slotMinutes} min).</p>
<table style="font-size:14px;border-collapse:collapse">${details
      .map((d) => {
        const [k, ...v] = d.split(": ");
        return `<tr><td style="color:#6b7280;padding:2px 12px 2px 0">${escapeHtml(k)}</td><td style="padding:2px 0">${escapeHtml(v.join(": "))}</td></tr>`;
      })
      .join("")}</table>
${button(confirmUrl, "Confirm or decline")}
<p style="font-size:14px;color:#6b7280;margin:0">Nothing is sent to them until you decide.</p>`,
    `This link is private to you; anyone who has it can answer for you.`
  );
  return { subject, text, html };
}

/* --- Visitor: received, confirmed, declined --------------------------- */

export function visitorRequestedEmail(b: Booking, ctx: MessageContext): RenderedEmail {
  const when = formatSlot(b.slotStart, ctx.timeZone);
  const name = oneLine(b.name);
  const subject = `We received your booking request for ${when}`;
  const text = [
    `Hi ${name},`,
    ``,
    `Thanks! ${ctx.businessName} has your request for ${when}. You will get another email as soon as it is confirmed.`,
    ``,
    `Need to change anything? Just reply to this email.`,
  ].join("\n");
  const html = layout(
    `Request received`,
    `<p style="margin:0 0 12px">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 12px">Thanks! ${escapeHtml(ctx.businessName)} has your request for <strong>${escapeHtml(when)}</strong>. You will get another email as soon as it is confirmed.</p>`,
    `Need to change anything? Just reply to this email.`
  );
  return { subject, text, html };
}

export function visitorConfirmedEmail(b: Booking, ctx: MessageContext): RenderedEmail {
  const when = formatSlot(b.slotStart, ctx.timeZone);
  const name = oneLine(b.name);
  const subject = `Confirmed: ${when} with ${ctx.businessName}`;
  const text = [
    `Hi ${name},`,
    ``,
    `You are booked in with ${ctx.businessName} for ${when} (${b.slotMinutes} min). See you then.`,
    ``,
    `Need to change it? Just reply to this email.`,
  ].join("\n");
  const html = layout(
    `You're booked in`,
    `<p style="margin:0 0 12px">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 12px">You are booked in with ${escapeHtml(ctx.businessName)} for <strong>${escapeHtml(when)}</strong> (${b.slotMinutes} min). See you then.</p>`,
    `Need to change it? Just reply to this email.`
  );
  return { subject, text, html };
}

export function visitorDeclinedEmail(b: Booking, ctx: MessageContext): RenderedEmail {
  const when = formatSlot(b.slotStart, ctx.timeZone);
  const name = oneLine(b.name);
  const bookUrl = ctx.siteUrl ? `${ctx.siteUrl}/` : "";
  const subject = `${ctx.businessName} can't do ${when}`;
  const text = [
    `Hi ${name},`,
    ``,
    `Sorry, ${ctx.businessName} can't make ${when} after all. That time has been released.`,
    ``,
    bookUrl ? `Pick another time here: ${bookUrl}` : `Reply to this email and we will find another time.`,
  ].join("\n");
  const html = layout(
    `That time didn't work out`,
    `<p style="margin:0 0 12px">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 12px">Sorry, ${escapeHtml(ctx.businessName)} can't make <strong>${escapeHtml(when)}</strong> after all. That time has been released.</p>
${bookUrl ? button(bookUrl, "Pick another time") : ""}`,
    `Reply to this email and we will find another time.`
  );
  return { subject, text, html };
}
