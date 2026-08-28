import type Database from "better-sqlite3";
import crypto from "node:crypto";
import { appendEvent, readEvents } from "./events.ts";

/* Event-sourced payments. The site owner (the OpenClaw customer) connects
   their OWN Stripe account; the site creates payment links and invoices on
   it and records each as an event. A Stripe webhook appends payment_received.

   Events: stripe_connected, payment_link_created, invoice_issued,
           payment_received.
   Stripe API calls are gated on STRIPE_SECRET_KEY (the customer's key,
   injected per-site at deploy); without it the domain still records intent
   so the owner or their claw can finish it manually. */

const PAYMENT_TYPES = ["payment_link_created", "invoice_issued", "payment_received"];

export type PaymentRecord = {
  id: string;
  kind: "link" | "invoice";
  amountCents: number;
  currency: string;
  description: string;
  customerEmail?: string;
  url?: string;
  paid: boolean;
};

function fold(db: Database.Database): Map<string, PaymentRecord> {
  const map = new Map<string, PaymentRecord>();
  for (const e of readEvents(db, PAYMENT_TYPES)) {
    if (e.type === "payment_link_created" || e.type === "invoice_issued") {
      const id = e.data.id as string;
      map.set(id, {
        id,
        kind: e.type === "invoice_issued" ? "invoice" : "link",
        amountCents: e.data.amountCents as number,
        currency: e.data.currency as string,
        description: e.data.description as string,
        customerEmail: e.data.customerEmail as string | undefined,
        url: e.data.url as string | undefined,
        paid: false,
      });
    } else if (e.type === "payment_received") {
      const r = map.get(e.data.id as string);
      if (r) r.paid = true;
    }
  }
  return map;
}

function stripeKey(): string | null {
  return process.env.STRIPE_SECRET_KEY || null;
}

export function stripeConfigured(): boolean {
  return stripeKey() !== null;
}

async function stripe(pathPart: string, params: URLSearchParams) {
  const key = stripeKey();
  if (!key) throw new Error("stripe not configured");
  const res = await fetch(`https://api.stripe.com/v1/${pathPart}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  return { ok: res.ok, status: res.status, data: (await res.json()) as Record<string, unknown> };
}

export type CreateResult =
  | { ok: true; id: string; url?: string; pending?: boolean }
  | { ok: false; error: string };

/* Creates a Stripe Payment Link and records it. Falls back to recording a
   pending intent when Stripe is not configured. */
export async function createPaymentLink(
  db: Database.Database,
  input: { amountCents: number; currency?: string; description: string; customerEmail?: string }
): Promise<CreateResult> {
  const id = crypto.randomUUID();
  const currency = (input.currency || "cad").toLowerCase();
  if (!stripeConfigured()) {
    appendEvent(db, "payment_link_created", { ...input, id, currency, url: null, pending: true });
    return { ok: true, id, pending: true };
  }
  const p = new URLSearchParams();
  p.set("line_items[0][price_data][currency]", currency);
  p.set("line_items[0][price_data][product_data][name]", input.description);
  p.set("line_items[0][price_data][unit_amount]", String(input.amountCents));
  p.set("line_items[0][quantity]", "1");
  const res = await stripe("payment_links", p);
  if (!res.ok || !res.data.url) return { ok: false, error: String((res.data.error as { message?: string })?.message ?? "stripe_error") };
  appendEvent(db, "payment_link_created", {
    id,
    amountCents: input.amountCents,
    currency,
    description: input.description,
    customerEmail: input.customerEmail ?? null,
    url: res.data.url,
    stripeId: res.data.id,
  });
  return { ok: true, id, url: res.data.url as string };
}

/* Creates and sends a Stripe invoice to a customer, recorded as an event. */
export async function issueInvoice(
  db: Database.Database,
  input: { amountCents: number; currency?: string; description: string; customerEmail: string }
): Promise<CreateResult> {
  const id = crypto.randomUUID();
  const currency = (input.currency || "cad").toLowerCase();
  if (!stripeConfigured()) {
    appendEvent(db, "invoice_issued", { ...input, id, currency, url: null, pending: true });
    return { ok: true, id, pending: true };
  }
  const cust = await stripe("customers", new URLSearchParams({ email: input.customerEmail }));
  if (!cust.ok || !cust.data.id) return { ok: false, error: "customer_create_failed" };
  const customerId = cust.data.id as string;
  const item = new URLSearchParams();
  item.set("customer", customerId);
  item.set("amount", String(input.amountCents));
  item.set("currency", currency);
  item.set("description", input.description);
  const ii = await stripe("invoiceitems", item);
  if (!ii.ok) return { ok: false, error: "invoice_item_failed" };
  const inv = await stripe("invoices", new URLSearchParams({ customer: customerId, auto_advance: "true" }));
  if (!inv.ok || !inv.data.id) return { ok: false, error: "invoice_create_failed" };
  await stripe(`invoices/${inv.data.id}/finalize`, new URLSearchParams());
  await stripe(`invoices/${inv.data.id}/send`, new URLSearchParams());
  appendEvent(db, "invoice_issued", {
    id,
    amountCents: input.amountCents,
    currency,
    description: input.description,
    customerEmail: input.customerEmail,
    url: inv.data.hosted_invoice_url ?? null,
    stripeId: inv.data.id,
  });
  return { ok: true, id, url: inv.data.hosted_invoice_url as string | undefined };
}

export function markPaid(db: Database.Database, id: string, stripeEventId: string): void {
  appendEvent(db, "payment_received", { id, stripeEventId });
}

export function listPayments(db: Database.Database): PaymentRecord[] {
  return [...fold(db).values()];
}
