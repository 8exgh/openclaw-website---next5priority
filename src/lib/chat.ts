import type Database from "better-sqlite3";
import crypto from "node:crypto";
import { appendEvent, readEvents } from "./events.ts";

/* ------------------------------------------------------------------ */
/* Website "Chat with us" relay.                                       */
/*                                                                    */
/* SECURITY BOUNDARY (the whole point of this module):                */
/*                                                                    */
/* A website visitor is UNTRUSTED. Their messages are recorded and    */
/* relayed to the owner (and shown to the owner's claw only as quoted */
/* data for drafting), but they NEVER reach the claw's agent as        */
/* instructions and can NEVER trigger a tool or an action. There is no */
/* code path from a visitor message to sending email, booking, taking */
/* a payment, or editing the site. This defeats prompt-injection: the  */
/* worst a hostile visitor can do is send text that a human reads.     */
/*                                                                    */
/* The visitor can do exactly one thing: `receiveVisitorMessage`,      */
/* which records the message and fires the relay hook. Replies flow    */
/* the other way only through `sendReply`, which is callable from the  */
/* owner/relay side (authenticated), is text-only, and has no side     */
/* effects beyond appending the reply. Any real action the owner wants */
/* still happens in their OWN trusted Rocket.Chat channel, where they  */
/* explicitly instruct the claw, not here.                            */
/* ------------------------------------------------------------------ */

const CHAT_TYPES = ["chat_message_received", "chat_reply_sent"];

export type ChatMessage = {
  sessionId: string;
  from: "visitor" | "owner";
  text: string;
  at: string;
};

/* Relay hook: notify the owner (and, if they want, hand their claw the
   visitor text as clearly-delimited UNTRUSTED data to help draft a reply).
   The hook is deliberately a plain notification, not an execution path. */
export type RelayHook = (msg: ChatMessage) => void | Promise<void>;

/* THE ONLY THING A WEBSITE VISITOR CAN DO.
   Records the message and relays it to the owner. It does not, and by
   construction cannot, invoke the claw's tools or take any action. */
export async function receiveVisitorMessage(
  db: Database.Database,
  input: { sessionId?: string; text: string },
  relay?: RelayHook
): Promise<ChatMessage> {
  const sessionId = input.sessionId || crypto.randomUUID();
  const at = new Date().toISOString();
  // Cap length; store verbatim as data. No parsing, no interpretation.
  const text = input.text.slice(0, 4000);
  appendEvent(db, "chat_message_received", { sessionId, from: "visitor", text, at });
  const msg: ChatMessage = { sessionId, from: "visitor", text, at };
  if (relay) await relay(msg); // notify owner; not an action path
  return msg;
}

/* Owner-side reply back to the visitor. Text only, no side effects. This is
   the only way a message reaches the widget. Whether the text was typed by
   the owner or drafted by their claw and approved, it lands here as plain
   text and does nothing but get shown to the visitor. */
export function sendReply(
  db: Database.Database,
  input: { sessionId: string; text: string; by: "owner" | "claw-approved" }
): ChatMessage {
  const at = new Date().toISOString();
  const text = input.text.slice(0, 4000);
  appendEvent(db, "chat_reply_sent", { sessionId: input.sessionId, from: "owner", text, by: input.by, at });
  return { sessionId: input.sessionId, from: "owner", text, at };
}

/* Transcript for the widget (a single session) or the owner (all). */
export function getSession(db: Database.Database, sessionId: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const e of readEvents(db, CHAT_TYPES)) {
    if (e.data.sessionId !== sessionId) continue;
    out.push({
      sessionId,
      from: e.data.from as "visitor" | "owner",
      text: e.data.text as string,
      at: e.data.at as string,
    });
  }
  return out;
}

export function listSessions(db: Database.Database): string[] {
  const seen = new Set<string>();
  for (const e of readEvents(db, CHAT_TYPES)) seen.add(e.data.sessionId as string);
  return [...seen];
}
