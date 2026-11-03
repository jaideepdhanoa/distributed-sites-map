import fs from "fs";
import path from "path";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readSession, SESSION_COOKIE, type SessionUser } from "./session";

export const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function requireUser(): Promise<SessionUser | NextResponse> {
  const jar = await cookies();
  const session = await readSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  return session;
}

export function readGenerated(name: string) {
  const file = path.join(process.cwd(), "data", "generated", name);
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

export function isSession(value: SessionUser | NextResponse): value is SessionUser {
  return !(value instanceof NextResponse);
}
