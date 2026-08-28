import { NextRequest, NextResponse } from "next/server";
import { siteDb } from "../../../../lib/site.ts";
import { availableSlots } from "../../../../lib/booking.ts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const days = Math.min(60, Math.max(1, Number(request.nextUrl.searchParams.get("days") ?? 14)));
  const db = siteDb();
  try {
    return NextResponse.json({ slots: availableSlots(db, new Date().toISOString(), days) });
  } finally {
    db.close();
  }
}
