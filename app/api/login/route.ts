import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { clearFailures, lockStatus, recordFailure } from "@/lib/lockout";
import { sessionCookieOptions, signSession, SESSION_COOKIE } from "@/lib/session";
import { getUsers } from "@/lib/users";

export const dynamic = "force-dynamic";

const DUMMY_HASH = bcrypt.hashSync("timing-pad-not-a-password", 12);
const GENERIC = "Wrong username or password.";
const LOCKED = "Too many attempts. Try again in 15 minutes.";
const USER_LIMIT = 5;
const IP_LIMIT = 10;

function denied(message: string, status = 401) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } },
  );
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const raw = forwarded ? forwarded.split(",")[0] : request.headers.get("x-real-ip") || "unknown";
  return raw.trim().slice(0, 80) || "unknown";
}

export async function POST(request: Request) {
  let body: { username?: string; password?: string };
  try {
    body = (await request.json()) as { username?: string; password?: string };
  } catch {
    return denied(GENERIC);
  }
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const ip = clientIp(request);
  try {
    const ipState = await lockStatus(`ip:${ip}`);
    const userState = username ? await lockStatus(`user:${username}`) : "open";
    if (ipState === "unconfigured" || userState === "unconfigured") {
      return denied("Sign-in is temporarily unavailable.", 503);
    }
    if (ipState === "locked" || userState === "locked") return denied(LOCKED);
  } catch {
    console.error(JSON.stringify({ event: "lockout_error" }));
    return denied("Sign-in is temporarily unavailable.", 503);
  }
  const user = username ? getUsers().find((item) => item.u === username) : undefined;
  const ok = bcrypt.compareSync(password, user?.h || DUMMY_HASH);
  if (!user || !ok) {
    try {
      if (username) await recordFailure(`user:${username}`, USER_LIMIT);
      await recordFailure(`ip:${ip}`, IP_LIMIT);
    } catch {
      return denied("Sign-in is temporarily unavailable.", 503);
    }
    console.info(JSON.stringify({ event: "login_failed", known: Boolean(user) }));
    return denied(GENERIC);
  }
  try {
    await clearFailures(`user:${username}`);
  } catch {
    return denied("Sign-in is temporarily unavailable.", 503);
  }
  const response = NextResponse.json(
    { ok: true, role: user.role },
    { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } },
  );
  response.cookies.set(SESSION_COOKIE, await signSession(user.u), sessionCookieOptions());
  console.info(JSON.stringify({ event: "login", user: user.u }));
  return response;
}
