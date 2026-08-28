import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./events.ts";
import { createPaymentLink, issueInvoice, markPaid, listPayments } from "./payments.ts";

// No STRIPE_SECRET_KEY in the test env, so calls take the pending-record path.

test("payment link records a pending intent when Stripe is not configured", async () => {
  const db = openDb(":memory:");
  const r = await createPaymentLink(db, { amountCents: 5000, description: "Deposit" });
  assert.equal(r.ok, true);
  const list = listPayments(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].amountCents, 5000);
  assert.equal(list[0].kind, "link");
  assert.equal(list[0].paid, false);
});

test("invoice records and later marks paid via webhook event", async () => {
  const db = openDb(":memory:");
  const r = await issueInvoice(db, { amountCents: 12000, description: "Job", customerEmail: "c@x.com" });
  assert.equal(r.ok, true);
  const id = r.ok ? r.id : "";
  assert.equal(listPayments(db)[0].paid, false);
  markPaid(db, id, "evt_test_123");
  assert.equal(listPayments(db)[0].paid, true);
  assert.equal(listPayments(db)[0].kind, "invoice");
});

test("payment history folds from the event log", async () => {
  const db = openDb(":memory:");
  await createPaymentLink(db, { amountCents: 1000, description: "A" });
  await createPaymentLink(db, { amountCents: 2000, description: "B" });
  assert.equal(listPayments(db).length, 2);
  assert.equal(listPayments(db).reduce((s, p) => s + p.amountCents, 0), 3000);
});
