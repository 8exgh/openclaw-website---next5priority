import { site } from "../lib/config.ts";
import { BookingForm } from "./book/booking-form.tsx";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6">
      <div className="mt-6 rounded-lg bg-brand/10 border border-brand/30 px-4 py-3 text-sm">
        ✨ This is a free preview site built for {site.businessName} by 8Examples.{" "}
        <a className="text-brand font-medium underline" href={site.claimPhoneHref}>
          Make it yours →
        </a>
      </div>

      <header className="pt-10 pb-10 border-b border-line">
        <div className="text-sm font-medium text-brand">{site.businessName}</div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">{site.tagline}</h1>
        <p className="mt-4 text-muted">
          Affordable &amp; reliable · {site.location} ·{" "}
          <a className="text-brand font-medium" href={site.phoneHref}>{site.phone}</a>
        </p>
      </header>

      <section className="py-12">
        <h2 className="text-2xl font-semibold tracking-tight mb-2">{site.bookingHeading}</h2>
        <p className="text-muted mb-8">{site.bookingIntro}</p>
        <BookingForm />
      </section>

      <section className="py-12 border-t border-line">
        <h2 className="text-2xl font-semibold tracking-tight mb-2">Like what you see?</h2>
        <p className="text-muted mb-5">
          We built this site for you — no charge to look. Get it live on your own
          domain, with a matching business email, in 48 hours. {site.offer}
        </p>
        <a
          className="inline-block rounded-lg bg-brand text-white px-5 py-3 font-medium"
          href={site.claimPhoneHref}
        >
          Call or text {site.claimPhone} to claim it
        </a>
        <p className="mt-3 text-xs text-muted">
          Built by 8Examples · Calgary, AB · {site.claimPhone} · reply STOP to opt out
        </p>
      </section>

      <footer className="py-10 border-t border-line text-sm text-muted">
        {site.businessName} · {site.location} ·{" "}
        <a className="text-brand" href={site.phoneHref}>{site.phone}</a>
      </footer>
    </main>
  );
}
