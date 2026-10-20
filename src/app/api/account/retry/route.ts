import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { startProvisioning } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (user.status !== "failed") return NextResponse.json({ error: "Nothing to retry." }, { status: 409 });

  // Clear anything a crashed attempt left behind, then start again. Safe because a failed
  // account has no data in its tables yet.
  startProvisioning(user.username, { clean: true });
  return NextResponse.json({ ok: true });
}
