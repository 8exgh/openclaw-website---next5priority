"use client";

import { useState } from "react";

type Status = "pending" | "confirmed" | "declined" | "cancelled";

/* The two buttons. Each one POSTs the token to its command; the response
   status becomes the new view. A 409 means the decision was already made
   (another device, the claw), so we just show that. */
export function ConfirmActions({ token, status: initial, visitorEmail }: { token: string; status: Status; visitorEmail: string }) {
  const [status, setStatus] = useState<Status>(initial);
  const [busy, setBusy] = useState<"confirm" | "decline" | null>(null);
  const [error, setError] = useState(false);

  async function act(decision: "confirm" | "decline") {
    setBusy(decision);
    setError(false);
    try {
      const res = await fetch(`/api/commands/${decision}-booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok || (res.status === 409 && body?.status)) setStatus(body.status as Status);
      else throw new Error();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  if (status === "confirmed") {
    return (
      <p className="rounded-lg bg-brand-soft border border-brand/20 px-4 py-3 text-sm animate-fade-up">
        <span className="font-semibold">Confirmed.</span> A confirmation email goes to {visitorEmail}.
      </p>
    );
  }
  if (status === "declined") {
    return (
      <p className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 animate-fade-up">
        <span className="font-semibold">Declined.</span> The time is open again and {visitorEmail} will be asked to pick another.
      </p>
    );
  }
  if (status === "cancelled") {
    return (
      <p className="rounded-lg bg-gray-50 border border-line px-4 py-3 text-sm text-muted">
        This booking was cancelled.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => act("confirm")}
          disabled={busy !== null}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
        >
          {busy === "confirm" && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
          )}
          Confirm booking
        </button>
        <button
          type="button"
          onClick={() => act("decline")}
          disabled={busy !== null}
          className="inline-flex flex-1 items-center justify-center rounded-lg border border-line bg-white px-6 py-3 text-sm font-semibold transition hover:bg-gray-50 active:scale-[0.99] disabled:opacity-60"
        >
          Decline
        </button>
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          Something went wrong. Please try again in a moment.
        </p>
      )}
    </div>
  );
}
