import { NextResponse } from "next/server";
import { currentStatus } from "@/lib/account";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await currentStatus();
  if (!status) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
