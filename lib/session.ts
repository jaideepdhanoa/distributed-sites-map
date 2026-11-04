import { resolveActionRole, type ActionRole } from "./actions/roles";
import { getUsers } from "./users";

export const SESSION_COOKIE = "sites_session";
const WEEK = 60 * 60 * 24 * 7;

export type SessionUser = { u: string; role: "admin" | "user"; actionRole: ActionRole };

type TokenBody = { u: string; iat: number; exp: number };

function bytesToB64(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function b64ToBytes(value: string): Uint8Array {
  const pad = (4 - (value.length % 4)) % 4;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(pad);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return bytesToB64(new Uint8Array(sig));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function sessionSecret(): string {
  return process.env.AUTH_SECRET || "";
}

export async function signSession(username: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body = bytesToB64(
    new TextEncoder().encode(JSON.stringify({ u: username, iat: now, exp: now + WEEK } satisfies TokenBody)),
  );
  return `${body}.${await hmac(sessionSecret(), body)}`;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: WEEK,
  };
}

export async function readSession(token: string | undefined): Promise<SessionUser | null> {
  const secret = sessionSecret();
  if (!token || !secret || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(secret, body);
  if (!safeEqual(sig, expected)) return null;
  let parsed: TokenBody;
  try {
    parsed = JSON.parse(new TextDecoder().decode(b64ToBytes(body))) as TokenBody;
  } catch {
    return null;
  }
  if (!parsed.u || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
  const user = getUsers().find((item) => item.u === parsed.u);
  if (!user) return null;
  return { u: user.u, role: user.role, actionRole: resolveActionRole(user) };
}
