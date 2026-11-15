/** Cookie writes must come from the same origin. A bearer token is not a browser cookie. */
export function cookieWriteAllowed(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin")?.trim();
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
