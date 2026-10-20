import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { getStore, type User } from "./store";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

// ---------------------------------------------------------------- passwords (scrypt, salted)
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `s1:${salt.toString("base64")}:${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  // Always do the work, even for an unknown user, so response time doesn't reveal which names exist.
  const [, saltB64, keyB64] = (stored ?? "s1:AAAAAAAAAAAAAAAAAAAAAA==:" + "A".repeat(86) + "==").split(":");
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(actual, expected) && stored !== undefined;
}

// ---------------------------------------------------------------- session cookie (signed, stateless)
export const COOKIE = "gs_session";
const MAX_AGE = 7 * 24 * 3600;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters");
  return s;
}
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

function makeSession(username: string): string {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readSession(value: string | undefined): string | undefined {
  const [payload, sig] = (value ?? "").split(".");
  if (!payload || !sig) return;
  const good = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (good.length !== given.length || !timingSafeEqual(good, given)) return;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof u === "string" && typeof exp === "number" && exp > Date.now() / 1000) return u;
  } catch {
    /* fall through */
  }
}

export async function setSessionCookie(username: string) {
  (await cookies()).set(COOKIE, makeSession(username), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(COOKIE);
}

export async function getSessionUser(): Promise<User | undefined> {
  const username = readSession((await cookies()).get(COOKIE)?.value);
  return username ? getStore().getUser(username) : undefined;
}

/** Cheap check (cookie signature only, no database read) for pages that just need to know if someone is signed in. */
export async function hasSession(): Promise<boolean> {
  return !!readSession((await cookies()).get(COOKIE)?.value);
}
