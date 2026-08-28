"use client";

import { useEffect, useMemo, useState } from "react";

type Slot = string;
type Status = "idle" | "booking" | "booked" | "error" | "taken";

type Day = { key: string; date: Date; slots: Slot[] };

/* Group ISO slots into ordered days (local timezone). */
function toDays(slots: Slot[]): Day[] {
  const map = new Map<string, Day>();
  for (const s of slots) {
    const d = new Date(s);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!map.has(key)) map.set(key, { key, date: d, slots: [] });
    map.get(key)!.slots.push(s);
  }
  return [...map.values()];
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const fmtLong = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function BookingForm() {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function load() {
    const res = await fetch("/api/queries/available-slots");
    const body = await res.json();
    setSlots(body.slots ?? []);
  }
  useEffect(() => {
    load();
  }, []);

  const days = useMemo(() => (slots ? toDays(slots) : []), [slots]);
  const activeDay = days.find((d) => d.key === dayKey) ?? days[0] ?? null;
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setStatus("booking");
    try {
      const res = await fetch("/api/commands/request-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotStart: chosen, name, email, phone, note }),
      });
      if (res.status === 409) {
        setStatus("taken");
        setChosen(null);
        await load();
        return;
      }
      if (!res.ok) throw new Error();
      setStatus("booked");
    } catch {
      setStatus("error");
    }
  }

  /* Confirmed */
  if (status === "booked") {
    return (
      <div className="rounded-2xl border border-line bg-white shadow-sm p-8 text-center animate-fade-up">
        <svg viewBox="0 0 56 56" className="mx-auto mb-5 h-14 w-14 animate-pop-in" aria-hidden>
          <circle cx="28" cy="28" r="26" className="fill-brand-soft stroke-brand" strokeWidth="2" />
          <path
            d="M17 29 l8 8 14 -16"
            fill="none"
            className="stroke-brand animate-draw-check"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
          />
        </svg>
        <p className="text-xl font-semibold tracking-tight">Request sent.</p>
        <p className="text-muted mt-2">{chosen && fmtLong(chosen)}</p>
        <p className="text-sm text-muted mt-4">
          We&rsquo;ll confirm by email{email ? ` at ${email}` : ""} shortly. Need to change
          anything? Just reply to that email.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={book} className="rounded-2xl border border-line bg-white shadow-sm overflow-hidden">
      {/* Step 1: pick a time */}
      <div className="p-6 sm:p-8">
        <div className="flex items-baseline justify-between gap-4 mb-5">
          <div className="text-sm font-semibold tracking-tight">
            <span className="text-brand mr-2">1</span>Pick a time
          </div>
          {slots !== null && slots.length > 0 && (
            <div className="text-xs text-muted">Times shown in your timezone ({tz})</div>
          )}
        </div>

        {slots === null ? (
          /* Skeleton */
          <div aria-hidden>
            <div className="flex gap-2 mb-5">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-[68px] w-16 rounded-xl bg-line/60 animate-pulse" />
              ))}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-10 rounded-lg bg-line/60 animate-pulse" />
              ))}
            </div>
          </div>
        ) : days.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-8 text-center">
            <p className="text-sm text-muted">
              No open times right now. Check back soon, or send a message and we&rsquo;ll find
              one together.
            </p>
            <button
              type="button"
              onClick={load}
              className="mt-3 text-sm font-medium text-brand hover:underline"
            >
              Refresh times
            </button>
          </div>
        ) : (
          <>
            {/* Day strip */}
            <div className="flex gap-2 overflow-x-auto pb-2 -mb-2 mb-5 snap-x" role="tablist" aria-label="Choose a day">
              {days.map((d) => {
                const active = activeDay?.key === d.key;
                return (
                  <button
                    key={d.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setDayKey(d.key);
                      setChosen(null);
                    }}
                    className={`shrink-0 snap-start w-16 rounded-xl border px-2 py-2.5 text-center transition ${
                      active
                        ? "border-brand bg-brand text-white shadow-sm"
                        : "border-line hover:border-brand/60 bg-white"
                    }`}
                  >
                    <div className={`text-[10px] font-semibold uppercase tracking-wider ${active ? "text-white/80" : "text-muted"}`}>
                      {d.date.toLocaleDateString(undefined, { weekday: "short" })}
                    </div>
                    <div className="text-lg font-semibold leading-6">{d.date.getDate()}</div>
                    <div className={`text-[10px] ${active ? "text-white/80" : "text-muted"}`}>
                      {d.date.toLocaleDateString(undefined, { month: "short" })}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Time grid for the active day */}
            {activeDay && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" role="listbox" aria-label="Choose a time">
                {activeDay.slots.map((s) => {
                  const active = chosen === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => setChosen(active ? null : s)}
                      className={`rounded-lg border px-3 py-2.5 text-sm font-medium tabular-nums transition ${
                        active
                          ? "border-brand bg-brand text-white shadow-sm"
                          : "border-line hover:border-brand/60 hover:bg-brand-soft/50"
                      }`}
                    >
                      {fmtTime(s)}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Step 2: details */}
      {chosen && (
        <div className="border-t border-line bg-brand-soft/40 p-6 sm:p-8 animate-fade-up">
          <div className="text-sm font-semibold tracking-tight mb-4">
            <span className="text-brand mr-2">2</span>Your details
          </div>

          {/* Selection summary */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand/25 bg-white px-4 py-3">
            <div className="text-sm font-medium">{fmtLong(chosen)}</div>
            <button
              type="button"
              onClick={() => setChosen(null)}
              className="text-sm font-medium text-brand hover:underline"
            >
              Change
            </button>
          </div>

          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted">Name</span>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  className="rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted">Email</span>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
                />
              </label>
            </div>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted">Phone (optional)</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                className="rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted">Anything we should know? (optional)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15 resize-y"
              />
            </label>
            <button
              type="submit"
              disabled={status === "booking"}
              className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60 sm:w-auto"
            >
              {status === "booking" && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
              )}
              {status === "booking" ? "Sending your request..." : "Request this time"}
            </button>
          </div>
        </div>
      )}

      {/* Inline alerts */}
      {(status === "taken" || status === "error") && (
        <div className="border-t border-line p-4 sm:px-8">
          {status === "taken" && (
            <p className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              That time was just taken by someone else. The times above are fresh; please pick
              another.
            </p>
          )}
          {status === "error" && (
            <p className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              Something went wrong on our end. Please try again in a moment.
            </p>
          )}
        </div>
      )}
    </form>
  );
}
