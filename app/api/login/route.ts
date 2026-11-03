import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { clearFailures, lockStatus, recordFailure } from "@/lib/lockout";
import { sessionCookieOptions, signSession, SESSION_COOKIE } from "@/lib/session";
import { getUsers } from "@/lib/users";

export const dynamic = "force-dynamic";

const DUMMY_HASH = bcrypt.hashSync("timing-pad-not-a-password", 12);
const GENERIC = "Wrong username or password.";

function denied(message: string, status = 401) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } },
  );
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
  const user = getUsers().find((item) => item.u === username);
  if (user) {
    try {
      const state = await lockStatus(username);
      if (state === "unconfigured") return denied("Sign-in is temporarily unavailable.", 503);
      if (state === "locked") return denied("Too many attempts. Try again in 15 minutes.");
    } catch (error) {
      console.error(JSON.stringify({ event: "lockout_error" }));
      return denied("Sign-in is temporarily unavailable.", 503);
    }
  }
  const ok = bcrypt.compareSync(password, user?.h || DUMMY_HASH);
  if (!user || !ok) {
    if (user) {
      try {
        await recordFailure(username);
      } catch {
        return denied("Sign-in is temporarily unavailable.", 503);
      }
    }
    console.info(JSON.stringify({ event: "login_failed", user: user ? username : "unknown" }));
    return denied(GENERIC);
  }
  try {
    await clearFailures(username);
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
