# openclaw-website-template

The event-sourced website every OpenClaw customer is provisioned from. It is
not a brochure: it takes bookings, shows the owner's calendar, and gets them
paid, and the owner's OpenClaw worker keeps it up to date.

## Architecture

Same shape as `inventory-shopify`: a Next.js app (frontend + API + command/query
handlers) over a single append-only SQLite event log per site, with a background
processor for async integration jobs. Every feature folds its state from the one
event log (`src/lib/events.ts`).

## Auth

The owner logs into their own site admin with the **same credentials as their
OpenClaw** (their Rocket.Chat username and password at chat.fusenv.com). The
admin login validates against the Rocket.Chat REST API; no separate account.
The claw can also configure the site directly, since it holds those credentials.

## Features

### Self-booking (`src/lib/booking.ts`) — built, tested
Event-sourced. Events: `availability_set`, `booking_requested`, `booking_confirmed`,
`booking_declined`, `booking_cancelled`. Visitors see open slots derived by replay
from the owner's weekly availability; `requestBooking` folds and appends inside one
SQLite transaction, so two visitors can never take the same slot.

A request lands as **pending** and holds its slot until the owner answers.
**Confirmation without a password:** each booking mints a UUID confirm token
that lives only in the event log. The owner gets `/confirm/<token>` (in the
Rocket.Chat ping, the owner email, and on their calendar page); that page shows
the request and two buttons. The token is the whole authorization — it is never
returned to the visitor, so a visitor cannot confirm their own booking. GET is
read-only (mail clients prefetch links); the decision is a POST to
`/api/commands/confirm-booking` or `/api/commands/decline-booking`. Declining or
cancelling frees the slot. Pre-confirmation `booking_requested` events (no token)
fold as confirmed. See `booking.test.ts` (9 tests).

### Booking notifications (`src/lib/booking-notifications.ts`, `notification-processor.ts`) — built, tested
CQRS + ES, no sends in the command path. What a booking **owes** is a pure
function of its status (`owedNotifications`): pending → owner ping on
Rocket.Chat (+ owner email if `site.ownerEmail` is set) carrying the confirm
link, and a "we got your request" email to the visitor; confirmed → "you're
booked in" email; declined → "pick another time" email. What has **gone out**
is the replay of `notification_sent` events. The background processor delivers
the difference, deliver-then-record, so an unconfigured or failing channel just
stays owed and is retried — at-least-once, never silently dropped.

It runs right after each booking command responds (`after()` from
`next/server`), every 5 minutes from the in-process scheduler
(`src/instrumentation.ts` → `scheduler.ts`; nothing external crons these
containers, and the scheduler also fires the daily tick), and on demand via
`POST /api/jobs/notify` / `/api/jobs/tick` (gated by `CLAW_API_KEY`). A sweep
with nothing owed is a no-op. Channels: Rocket.Chat via the shared incoming
webhook (`rocketchat.ts`), email over SMTP with nodemailer (`email.ts`).
Visitor emails carry `Reply-To: ownerEmail`, so "reply to this email" actually
reaches the owner. Visitor-typed text is HTML-escaped in email and quoted as
data in the chat ping (the same trust boundary as the chat widget). Senders
are injected, so the loop is tested with fakes and no network
(`booking-notifications.test.ts`, 11 tests).

Runtime env, all injected by the devops `deploy-openclaw-site` workflow:
`ROCKETCHAT_WEBHOOK_URL` and `CLAW_USERNAME` (channel) from devops secrets;
`SITE_URL` (absolute origin for links, `https://<subdomain>.fusenv.com` or the
verified custom domain); `OWNER_EMAIL`; and the SMTP sender `SMTP_HOST`,
`SMTP_PORT` (465 = implicit TLS), `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`. The
deploy pulls `SITE_URL`/`OWNER_EMAIL`/SMTP just-in-time from 8examples
(`GET /api/provisioning/site-env?claw=<claw>`, the system of record for the
customer's Migadu mailbox), so the site mails as the business and no secret
ever sits in a repo or a dispatch payload; with no claw/mailbox it falls back
to the platform Gmail sender. `config.ts` carries `ownerEmail` (stamped by
provisioning from `--email`; env overrides it) and `timeZone` for rendering
times. `SITE_SCHEDULER=0` disables the timers.

### Payments (`src/lib/payments.ts`) — built, tested
Event-sourced. The owner connects their **own Stripe**; the site creates payment
links and invoices on it and records each event; a Stripe webhook appends
`payment_received`. Without a Stripe key the domain records a pending intent so
the owner or their claw can finish it. See `payments.test.ts` (3 tests).

### Chat with us (`src/lib/chat.ts`) — built, tested
The website "Chat Now" widget, with a hard security boundary. A website
visitor is **untrusted**: their messages are recorded and relayed to the owner
(and shown to the owner's claw only as quoted data for drafting), but they
**never reach the claw's agent as instructions and can never trigger a tool or
an action**. There is no code path from a visitor message to sending email,
booking, taking a payment, or editing the site.

The visitor can do exactly one thing (`receiveVisitorMessage`): record a message
and fire the relay notification. Replies flow back only through `sendReply`,
which is owner-side, authenticated, text-only, and side-effect-free. Any real
action the owner wants still happens in their own trusted Rocket.Chat channel,
where they explicitly instruct the claw. This defeats prompt injection: the
worst a hostile visitor can do is send text a human reads. See `chat.test.ts`
(4 tests, including that an injection payload stays inert text).


### Daily "did you know?" nudges (`src/lib/suggestions.ts`, `tips.ts`) — built, tested
An education/retention engine. A scheduler hits `/api/jobs/tick` once a day;
with a ~1 in 3 chance it fires, picks a tip at random from a big library
(`tips.ts`), and has the owner's claw pitch it over chat ("Did you know you can
get a business phone number for $6/mo, just ask to sign up..."). Event-sourced:
at most one a day, never repeats a tip until the whole library is exhausted,
then resets. Delivery is deliver-then-record (a failed send retries next day),
gated on `ROCKETCHAT_WEBHOOK_URL`. Randomness is injected so it is fully
testable (5 tests). Purpose: pull owners into using more of what they have, so
they get more value and stick.

## Integrations

### Google Calendar sync — first integration (planned)
The owner's bookings show as their calendar on the site and sync to Google
Calendar. Set up two ways: the claw configures it, or the owner logs into the
site (Rocket.Chat creds) and connects Google. Implemented as a background job
that, for each confirmed booking without a `gcal_synced` marker, creates a
Google Calendar event via the Calendar API using stored OAuth tokens. Requires a
Google OAuth client with the `calendar.events` scope (a standard sensitive scope,
far less restricted than the admin.directory scopes) and the owner's one-time
consent.

## Tests

Two layers, both offline.

`npm run test:domain` — the domain logic (`src/lib/*.test.ts`, node:test, 35
tests). Pure folds and the notification loop with injected senders.

`npm run test:e2e` — the booking flow through a real browser (Playwright,
6 tests). It builds, then serves **the standalone output the container
actually runs** (`.next/standalone/server.js`, static assets copied in the way
the Dockerfile does) against local stand-ins for the only two services a live
site talks to:

- **Rocket.Chat** — an HTTP server on `:3211` recording each posted message.
- **SMTP** — a real (small) ESMTP server on `:3212` that nodemailer
  authenticates and delivers to, recording each message. Writing `fail` into
  `.playwright/smtp-mode` makes it reject everything, which is how the specs
  exercise a provider outage.

Nothing reaches the network, and the site is configured with the same env var
names the devops deploy uses. The specs assert on what the mocks *received* —
decoded subjects and bodies, not stub call counts — covering: a visitor
booking and the owner confirming from their link; declining freeing the time;
that loading the confirm link decides nothing (mail clients prefetch URLs) and
a second answer is refused; a time taken while the form was open; a mail
outage leaving the message owed and the next sweep delivering it without
repeating the chat ping; and the job endpoints refusing an unauthenticated
call. Config and ports live in `tests/e2e/e2e.config.json`.

Both suites are run by hand today; neither is wired into CI.

## Status

- All domain tests: `npm run test:domain` (runs every `src/lib/*.test.ts`).
- Browser end-to-end: `npm run test:e2e` (needs Chromium; set
  `PLAYWRIGHT_CHROMIUM_PATH` if it is not at `/snap/bin/chromium`).
- Booking domain + confirm flow + notifications: built and tested.
- Payments domain: built and tested.
- Next: Next.js app shell, public booking page, admin (Rocket.Chat auth,
  availability, calendar, connect-Stripe, connect-Google), the Google Calendar
  sync processor, and the provisioning that stamps out one of these per customer.

## Provisioning (open decisions)

How each customer's copy is deployed is still to be decided with Sean: Cloudflare
Pages vs per-customer containers for hosting, and a GitHub App vs per-repo PAT for
letting each claw edit its own site. The app code above is independent of that
choice.
