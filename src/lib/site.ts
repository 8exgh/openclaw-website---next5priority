import type Database from "better-sqlite3";
import { openDb } from "./events.ts";
import { getAvailability, setAvailability } from "./booking.ts";

/* Windows are stored as UTC wall-clock. The default is 9-5 Mountain time
   (15:00-23:00 UTC), so a Calgary customer's booking page offers sane local
   hours out of the box instead of 3 AM slots. Owners (or their claw) can set
   real hours later. */
const DEFAULT_WINDOW = [{ start: "15:00", end: "23:00" }];
const DEFAULT_AVAILABILITY = {
  weekly: { 1: DEFAULT_WINDOW, 2: DEFAULT_WINDOW, 3: DEFAULT_WINDOW, 4: DEFAULT_WINDOW, 5: DEFAULT_WINDOW },
  slotMinutes: 30,
};

/* The pre-fix default seeded 9-5 UTC (3 AM-11 AM Mountain). If a site still
   has exactly that untouched default, replace it. */
function isOldUtcDefault(a: { weekly: Record<number, { start: string; end: string }[]>; slotMinutes: number }): boolean {
  const days = Object.keys(a.weekly);
  return (
    a.slotMinutes === 30 &&
    days.length === 5 &&
    [1, 2, 3, 4, 5].every((d) => {
      const w = a.weekly[d];
      return w?.length === 1 && w[0].start === "09:00" && w[0].end === "17:00";
    })
  );
}

/* Opens the site's event store and seeds sensible defaults on first run so
   the public booking page works out of the box. */
export function siteDb(): Database.Database {
  const db = openDb();
  const current = getAvailability(db);
  if (!current || isOldUtcDefault(current)) {
    setAvailability(db, DEFAULT_AVAILABILITY);
  }
  return db;
}
