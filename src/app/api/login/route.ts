import { NextResponse } from "next/server";
import { setSessionCookie, verifyPassword } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* handled below */
  }
  const username = String(body.username ?? "").trim().toLowerCase();
  const user = username ? await getStore().getUser(username) : undefined;
  const ok = await verifyPassword(String(body.password ?? ""), user?.passwordHash);
  if (!user || !ok) return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });

  await setSessionCookie(user.username);
  return NextResponse.json({ ok: true });
}
