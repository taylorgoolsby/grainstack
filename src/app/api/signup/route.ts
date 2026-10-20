import { NextResponse } from "next/server";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { startProvisioning } from "@/lib/jobs";
import { getStore } from "@/lib/store";
import { checkSignup } from "@/lib/validate";

export const runtime = "nodejs";

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid request.");
  }
  const username = String(body.username ?? "").trim().toLowerCase();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  const problem = checkSignup({ username, email, password });
  if (problem) return fail(problem);

  // Every signup creates real AWS resources, so signup can be restricted to people with a code.
  const required = process.env.SIGNUP_INVITE_CODE;
  if (required && String(body.inviteCode ?? "").trim() !== required) return fail("That invite code isn't valid.", 403);

  const now = new Date().toISOString();
  const result = await getStore().createUser({
    username,
    email,
    passwordHash: await hashPassword(password),
    status: "provisioning",
    step: 0,
    error: "",
    createdAt: now,
    updatedAt: now,
  });
  if (result === "username_taken") return fail("That username is taken.", 409);
  if (result === "email_taken") return fail("An account with that email already exists.", 409);

  await setSessionCookie(username);
  startProvisioning(username); // runs in the background; the browser polls /api/account/status
  return NextResponse.json({ ok: true });
}
