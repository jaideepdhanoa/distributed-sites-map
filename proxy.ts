import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSession } from "./lib/session";

const OPEN = new Set([
  "/login",
  "/api/login",
  "/robots.txt",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icon.svg",
  "/apple-icon.png",
  "/icon-192.png",
  "/icon-512.png",
]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (OPEN.has(pathname) || pathname === "/maplibre-gl-worker.js") return NextResponse.next();
  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) {
    const response = NextResponse.next();
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders() });
  }
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|icon-192.png|icon-512.png|manifest.webmanifest|maplibre-gl-worker\\.js).*)"],
};
