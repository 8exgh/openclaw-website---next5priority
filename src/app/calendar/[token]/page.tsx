import { siteDb } from "../../../lib/site.ts";
import { calendarFor } from "../../../lib/calendar-link.ts";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = siteDb();
  let bookings;
  try {
    bookings = calendarFor(db, token);
  } finally {
    db.close();
  }

  if (!bookings) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold">This calendar link has expired.</h1>
        <p className="text-muted mt-2">Ask your worker to send you a fresh one.</p>
      </main>
    );
  }

  const pending = bookings.filter((b) => b.status === "pending").length;
  const byDay: Record<string, typeof bookings> = {};
  for (const b of bookings) {
    const day = new Date(b.slotStart).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    (byDay[day] ??= []).push(b);
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight mb-1">Your calendar</h1>
      <p className="text-muted mb-8">
        Private link, good for 24 hours. {bookings.length} upcoming booking{bookings.length === 1 ? "" : "s"}
        {pending > 0 ? `, ${pending} waiting for your answer` : ""}.
      </p>
      {bookings.length === 0 ? (
        <p className="text-muted">Nothing booked yet.</p>
      ) : (
        <div className="grid gap-6">
          {Object.entries(byDay).map(([day, items]) => (
            <div key={day}>
              <div className="text-xs uppercase tracking-wide text-muted mb-2">{day}</div>
              <div className="grid gap-2">
                {items.map((b) => (
                  <div key={b.bookingId} className="rounded-md border border-line px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {new Date(b.slotStart).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · {b.name}
                      {b.status === "pending" && (
                        <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-medium text-amber-800">
                          Needs your answer
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted">{b.email}{b.phone ? ` · ${b.phone}` : ""}{b.note ? ` · ${b.note}` : ""}</div>
                    {b.status === "pending" && b.confirmToken && (
                      <a href={`/confirm/${b.confirmToken}`} className="mt-2 inline-block text-sm font-medium text-brand hover:underline">
                        Confirm or decline →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
