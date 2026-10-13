# Next 5 Priority

Shared feature planning and bug tracking, with passwordless email-code login,
admin/editor/read-only roles, SQLite CQRS events, and a bearer-token automation API.

## Workflows

- **Views:** List, Kanban, and Sprint. List has Next 5 (`/`) and Backlog (`/backlog`)
  sub-tabs. Next 5 preserves the five-feature order. Backlog combines all bugs
  with features outside Next 5, sorted by severity and newest report by default.
  Its Sort by control also offers Most recently added, ordering items and sibling
  subtasks by creation date, newest first. Sorting is saved in the URL as
  `sort=newest`; Reset filters restores the default severity order.
- **Sprint:** `/sprint` opens the current Monday–Sunday week in the site's
  configured time zone (America/Edmonton). Sprint IDs are generated as
  `YYYY-MM-dd-to-MM-dd`, for example `2026-10-05-to-10-11`; a year-crossing week
  is `2026-12-28-to-01-03`. The week selector offers the current week, including
  when empty, plus every other week with at least one assigned root item.
  Selecting another week is saved as `?sprint=<id>` and survives refresh and
  browser back/forward. If its last item leaves, the view returns to this week.
  Sprint shows only the root features and bugs assigned to that week, including
  completed items and Next 5 features. Open a root's details to see its subtasks.
  Editors assign, move, or remove a root using its searchable Sprint picker in
  the list, creation form, or item details. Suggestions include nearby weeks;
  typing any date (`YYYY-MM-DD`) or full sprint ID finds other weeks automatically.
  Choose No sprint to unassign. New items created from Sprint default to the
  selected week. Assignment is independent of list placement and survives
  feature/bug conversion. Subtasks cannot be assigned independently.
- **Backlog filters:** single-select ticket class (All, Features, Bugs), multiple
  severity selections (P1–P4), search, state, and My tickets. All severities start
  selected; clearing them shows no results. Filters combine, stay visible in a
  sticky header, and are saved in the URL for refresh and bookmarks. Matching
  subtasks retain their ancestors with a "Matching subtask" label; unrelated
  children are filtered out, and subtasks remain collapsed by default. Reset
  filters restores all items.
- **My tickets:** available on Next 5, Backlog, and Kanban. It keeps items where
  the signed-in person is the implementor or reviewer. A parent whose subtask is
  assigned to you stays visible as context, labelled "Matching subtask". The
  choice follows you between views and is saved in the URL as `mine=1`.
- **Effort:** every feature, subtask, and bug has an optional effort from 1 (low)
  to 5 (high), set when creating an item or editing its details. Lists, Kanban
  cards, and item details show it as a five-dot gauge; existing items start unset.
- **Features:** a feature backlog and an ordered Next 5 list. Move top-level
  features between lists and move priorities up/down. The server enforces a
  maximum of five, including concurrent requests. Subtasks move with their parent.
  Features and subtasks have P1–P4 priorities (default P3), editable in their
  details or directly in the list. Priority is independent of Next 5 rank and
  list placement; all five features remain eligible for Kanban at any priority.
  Subtasks start collapsed in list views. Each parent has an expand/collapse
  button, including nested parents; item details still show direct subtasks.
- **Bugs:** Report a bug is available separately from New feature. Bugs live in
  Backlog; changing their priority updates sorting and active filter results.
  Legacy `/bugs/p1-p2`, `/bugs/p3-p4`, and `/?view=bugs` bookmarks open Backlog with
  the corresponding class and severity filters. Existing `/?item=<id>` links
  still work and resolve to the appropriate list.
  Every bug gets a permanent, incrementing `SAV-000001` style identifier; deleted
  identifiers are never reused. Bugs are independent items; use links to connect them.
- **States:** Needs review → Ready for development → In progress → In QA →
  In review → Done. Editors can change any item's state directly from its
  colored label in lists, details, or Kanban. Parent and subtask states are
  independent: moving a parent keeps its subtasks in their current states.
  Completion does not automatically remove a feature from Next 5: move it back
  to the backlog to free its slot. The state filter includes completed work.
- **Kanban:** available directly at `/kanban`; refresh and browser back/forward
  retain the selected view, including open items at `/kanban?item=<id>`.
  Six columns from Needs review through Done combine the Next 5
  features with P1/P2 bugs. Editors move any card, including parent features,
  by dragging it into a column or selecting a state. Dragging near the board's
  left/right edges scrolls to other columns; Escape cancels a drag. On touch
  screens, use the grip to drag while the rest of the card allows vertical scrolling.
  Done shows features and P1/P2
  bugs completed within the last 28 days, including completed features moved
  back to the backlog. Older completed items remain accessible in the lists.
- **Details:** titles, multiline descriptions, effort, implementor/reviewer
  assignments, comments and attachments. The header shows when the item was
  logged and who created it, in both view and edit mode; items created through
  the automation API show "Automation". Descriptions display as text in view
  mode and as textareas when editing. Pasting an image into a description or
  comment stages it as an attachment named `pasted-image-N.png` and inserts an
  `![name](attachment:name)` marker at the caret; once saved, the marker
  renders the image inline and the file also appears under attachments.
  Kanban card previews omit these markers. Items have shareable `/?item=<id>` links;
  bugs also accept their SAV identifier. Subtasks show a "Part of" trail with
  every ancestor from the root feature down; each name opens that item.
- **Relationships:** connect a bug to a feature or another bug with Related to
  or Caused by. Links appear at both ends; the opposite end of Caused by shows
  Causes. Related to can also be added from a feature to a bug. The Link to item
  field is searchable: type part of a title or SAV ID, then pick a match with the
  mouse or the arrow keys and Enter.
- **People:** display names and two initials, with an uploaded profile photo
  replacing initials. Administrators add teammates and manage access/API keys.
  Readers can view, download attachments, follow, and update their own profile;
  editors can create/edit/delete work, comment, attach files, and link items.
- **Conversion:** use Convert to bug / Convert to feature in item details.
  Conversion keeps the item ID, priority, displayed state, completed date,
  comments, attachments, assignments, followers, and existing links. A feature
  becoming a bug gets a SAV ID and enters Backlog; any
  existing SAV ID is retained across future conversions. A bug becoming a feature
  goes into the backlog. Direct child features become backlog roots, keeping their
  descendants, and Related to links preserve the former parent/child connections.

## Storage and migration

`src/lib/events.ts` owns the append-only `events` table in the SQLite database
(`DB_PATH`, default `data/site.db`). Project command handlers validate and commit
item projections, events, and notification outbox entries in a single immediate
transaction. State and list changes are visible as soon as the command commits.
`project-store.ts` contains the schema, migration, and read projections;
`project-commands.ts` contains the command handlers.

Existing installations migrate automatically once, preserving item IDs, titles,
states, and feature nesting:

- Top 5 Priorities → Next 5 features; any excess roots move to the feature backlog.
- Backlog, Inbox, and In QA → Feature backlog, preserving workflow states.
- Patches → P3 bugs, receiving sequential SAV IDs in logged-date order. Nested
  patches become independent bugs connected by Related to links.

The migration records baseline item snapshots and migrated links in the event
log. Subsequent events include complete item snapshots, comment text, relationship
changes, attachment metadata, profile changes, and notification delivery records.

Completion dates are stored separately from edit dates. Reopening clears the
completion date; completing again starts a new 28-day window. Comments and other
edits do not extend that window. Each parent tracks its own completion date.
Existing completion dates are recovered from state transitions
in the event log, with the item's last edit date as a fallback when history is
unavailable.

Existing features without a priority receive P3 once, with snapshots recorded
in the event log. Their ordering, edit dates, and completion dates are preserved.

Existing items gain a nullable `sprint_id` column automatically and start with
no sprint. Sprint assignments are included in item snapshots in the event log.

Existing parents' displayed states and completion dates are preserved once when
migrating from computed child rollups to independently editable states. The
migration records each parent snapshot without changing children or edit dates.

### Attachments

Files are stored at **`data/assets/<event-id>/<attachment-id>`**, with their
original names and metadata in the `attachments` projection and event log.
The enclosing event ID is the ID of the create/edit/comment/profile event in the
CQRS `events` table. `ASSETS_PATH` can override the assets directory; by default
it is beside the SQLite database and inside the deployment's persistent data volume.
Back up the database **and** assets together.

Description and comment attachments accept any file type, up to 10 files and
25 MB total per request. Signature-identified PNG, JPEG, GIF, and WebP images
render inline; other types download as binary files. Profile pictures must use
one of those image formats and be at most 5 MB. Files are served only through the
authenticated `/api/assets/<attachment-id>` endpoint, never from `public/`.
Failed commands roll back their data and remove newly written files. Deleting an
item retains event-owned files for the audit trail but makes them inaccessible
through the item download endpoint.

## Background email

`project-notifications.ts` consumes a durable SQLite outbox. Commands only queue
messages; email delivery happens after the response, through Next.js `after()`,
and every five minutes through the in-process scheduler. The worker claims a
cross-process lease, records successful sends, and retries failed sends with
backoff (30 seconds up to one hour). Missing configuration leaves messages owed.
Delivery is at least once: a process crash after SMTP accepts a message but before
the success record commits may cause a duplicate on retry.

Recipients:

- **Assignment:** the newly assigned implementor/reviewer (one message if the
  same person receives both roles). Saving unchanged assignments sends nothing.
- **Comment:** the creator, current implementor, reviewer, and followers,
  deduplicated and excluding the commenter.
- **Status change:** the creator, current implementor, reviewer, and followers,
  deduplicated and excluding the person making the change. Each email includes
  that person's name/email, the item's title/identifier and link, and the old/new
  status. Unchanged status saves send nothing. A separate status event preserves
  both notifications when assignments and status change together.
- **Follow:** a confirmation for the follower plus notifications to the creator,
  implementor, reviewer, and current followers. Repeating Follow does not resend.
  Unfollow stops future follower mail; already queued messages remain queued.
- **Team access:** an invitation/access email, also queued in the background.

Login codes are sent immediately through the existing authentication route.
If the provider rejects delivery, the login form shows an error and allows a
retry. Failed resends leave any previously delivered, unexpired code valid.
The scheduler and protected `POST /api/jobs/notify` and `/api/jobs/tick` endpoints
process both project and existing booking notifications. Job requests require
`x-claw-key: <CLAW_API_KEY>`.

### Devops email secret

The existing `8exgh/devops` `deploy-openclaw-site` workflow injects SMTP credentials
at container runtime. Next 5 Priority explicitly uses the platform Gmail sender,
even when the provisioning record includes a customer mailbox. It reads
**`GMAIL_8EXAMPLES_APP_PASSWORD`** and exposes it to the app as
**`SMTP_PASS`**, alongside `GMAIL_8EXAMPLES_USER` as `SMTP_USER`.
The site uses the existing `email.ts` sender. No app password belongs in this
repository, the browser bundle, build arguments, or deployment dispatch payload.
No additional email credential is needed for project notifications.

Runtime configuration:

| Variable                 | Purpose                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `DB_PATH`                | SQLite file; the deployed container uses `/app/data/site.db`            |
| `ASSETS_PATH`            | Optional attachment directory; default is `assets` beside the database  |
| `OWNER_EMAIL`            | First administrator's email; defaults to `sean@besavvier.com`           |
| `SITE_URL`               | Trusted absolute site URL for notification links; required for delivery |
| `SMTP_HOST`, `SMTP_PORT` | SMTP server; port defaults to 465                                       |
| `SMTP_USER`, `SMTP_PASS` | Runtime SMTP credentials from devops                                    |
| `EMAIL_FROM`             | Sender address/display name                                             |
| `SMTP_SECURE`            | Optional `1`/`0`; otherwise port 465 implies TLS                        |
| `SITE_SCHEDULER`         | Set to `0` to disable in-process job timers                             |
| `CLAW_API_KEY`           | Authorization key for background job endpoints                          |

The existing devops deployment mounts `/opt/<site>/data` at `/app/data`, keeping
both the database and attachment files across image updates.

## API

Session cookies and `Authorization: Bearer <API_KEY>` work on `/api/project`
and its compatibility alias `/api/v1/tasks`.

- `GET`: `{ user, users, sections, items }`. `GET ?id=<uuid-or-SAV-id>` returns
  `{ detail: { task, attachments, comments, followers, links } }`.
- `POST`: create a feature or bug. Fields: `kind` (`feature`/`bug`), `title`,
  `description`, `state`, `implementorId`, `reviewerId`, feature `sectionId`
  (`feature-backlog`/`next-five`), optional feature `parentId`, `priority`
  (`P1`/`P2`/`P3`/`P4`) for either kind, and optional `effort` (a whole number
  from 1 to 5, or `null` to leave it unset). Root items also accept `sprintId`
  (`YYYY-MM-dd-to-MM-dd`, a Monday–Sunday range), or `null` for no sprint.
  Defaults: feature, backlog, Needs review, P3, and no effort.
- `PATCH`: supply `id` and changed fields. Set a root feature's `sectionId` to
  move it; set its zero-based `position` to reorder within Next 5. Set assignment
  fields, `effort`, or `sprintId` to `null` to clear them. A bug's section is always derived
  from its priority.
- `POST { action: "comment", id, body }`: add a comment and/or attachments.
- `POST { action: "convert", id, kind: "bug"|"feature" }`: convert an existing
  item without recreating it. Repeating the same target kind is a no-op.
- `POST { action: "follow", id, follow: true|false }`: personal accounts only.
- `POST { action: "link", id, targetId, relation: "related_to"|"caused_by" }`.
- `POST { action: "unlink", id, linkId }`.
- `DELETE ?id=<id>`: delete the item and its feature descendants.
- `PATCH /api/profile`: `name`, optional `removeAvatar: true`, and optional photo;
  applies only to the signed-in user.

For files, send multipart form data with a `data` field containing the JSON
command and repeated `files` fields. Description files accompany POST create or
PATCH edit; comment files accompany POST comment; profile photos accompany PATCH
profile. Otherwise send JSON. Errors return `{ error }` with 400 for validation,
401 for missing authentication, 403 for permissions, 404 for missing items,
409 for capacity/conflicts, and 413 for oversized uploads.

## Development and checks

```sh
npm ci
npm run dev
npm run test:domain
npm run build
npm run test:e2e
```

The domain suite covers migrations, workflow invariants, priority/ID allocation,
relationships, attachments and rollback, permissions, and notification retry
behavior alongside existing booking/payment/chat tests.

Browser tests run the production standalone build with local SMTP and Rocket.Chat
mocks. No test mail reaches real recipients. The project specs cover login,
feature ordering/capacity, bug triage, details, attachments, links, notifications,
profiles, read-only authorization, mobile layout, the My tickets filter, effort,
link search, and parent trails. Booking regression specs
exercise the original booking module at `/book`.
Kanban checks cover scope, completion cutoffs, state changes, drag-and-drop,
parent rollups, and mobile scrolling.

Chromium must be installed. Set `PLAYWRIGHT_CHROMIUM_PATH` to its executable
when it is not at `/snap/bin/chromium`. To run just the project browser suite
against an existing production build:

```sh
npx playwright test tests/e2e/project.spec.ts
```

## Existing site modules

The OpenClaw template's booking/calendar, payments, chat, and suggestion domain
modules share the event log. Booking uses private confirmation links and async
SMTP/Rocket.Chat notifications; chat visitor messages remain untrusted data.
Their domain tests and booking browser regression tests are retained.
