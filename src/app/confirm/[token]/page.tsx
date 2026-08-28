import { siteDb } from "../../../lib/site.ts";
import { findBookingByConfirmToken } from "../../../lib/booking.ts";
import { site } from "../../../lib/config.ts";
import { formatSlot } from "../../../lib/booking-messages.ts";
import { ConfirmActions } from "./confirm-actions.tsx";

/* Owner's yes/no page. The token in the URL is the auth (UUID v4, minted
   per booking, sent only to the owner), so no login is needed. GET is
   read-only on purpose: mail clients and link scanners prefetch URLs, so
   the decision happens on an explicit button press (POST), never on view. */

export const dynamic = "force-dynamic";

export default async function ConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = siteDb();
  let booking;
  try {
    booking = findBookingByConfirmToken(db, token);
  } finally {
    db.close();
  }

  if (!booking) {
    return (
      <main className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold">This link isn&rsquo;t valid.</h1>
        <p className="text-muted mt-2">It may have been copied incorrectly. Use the link from your notification.</p>
      </main>
    );
  }

  const when = formatSlot(booking.slotStart, site.timeZone);

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <div className="text-sm font-medium text-brand">{site.businessName}</div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Booking request</h1>
      <p className="text-muted mt-1">Someone would like to book time with you.</p>

      <div className="mt-8 rounded-2xl border border-line bg-white shadow-sm p-6 sm:p-8">
        <div className="text-xs uppercase tracking-wide text-muted">When</div>
        <div className="mt-1 text-lg font-semibold">{when}</div>
        <div className="text-sm text-muted">{booking.slotMinutes} minutes</div>

        <dl className="mt-6 grid gap-3 text-sm">
          <div className="grid grid-cols-[5rem_1fr] gap-3">
            <dt className="text-muted">Name</dt>
            <dd className="font-medium break-words">{booking.name}</dd>
          </div>
          <div className="grid grid-cols-[5rem_1fr] gap-3">
            <dt className="text-muted">Email</dt>
            <dd className="break-all">
              <a className="text-brand hover:underline" href={`mailto:${booking.email}`}>{booking.email}</a>
            </dd>
          </div>
          {booking.phone && (
            <div className="grid grid-cols-[5rem_1fr] gap-3">
              <dt className="text-muted">Phone</dt>
              <dd className="break-words">{booking.phone}</dd>
            </div>
          )}
          {booking.note && (
            <div className="grid grid-cols-[5rem_1fr] gap-3">
              <dt className="text-muted">Note</dt>
              <dd className="whitespace-pre-wrap break-words">{booking.note}</dd>
            </div>
          )}
        </dl>

        <div className="mt-8 border-t border-line pt-6">
          <ConfirmActions token={token} status={booking.status} visitorEmail={booking.email} />
        </div>
      </div>

      <p className="text-xs text-muted mt-6">
        This link is private to you. Nothing is sent to the visitor until you decide.
      </p>
    </main>
  );
}
