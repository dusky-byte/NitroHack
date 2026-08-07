import { NextResponse } from "next/server";
import { getActivities } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const activities = getActivities(50);
    return NextResponse.json({ activities });
  } catch (err: any) {
    console.error("Failed to fetch activities:", err);
    return NextResponse.json({ error: "Failed to fetch activities" }, { status: 500 });
  }
}
