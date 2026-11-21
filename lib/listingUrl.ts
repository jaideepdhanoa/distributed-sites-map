/**
 * A listing link must be one property, not a search or a category list.
 * A blank url is not a search page.
 */
export function listingSearchPage(value: string | null | undefined): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const path = url.pathname.replace(/\/+$/, "").toLowerCase() || "/";
  if (host === "crexi.com") {
    if (path === "/search" || path.startsWith("/search/")) return true;
    if (path === "/properties" && url.search) return true;
    return false;
  }
  if (host === "loopnet.com") {
    if (path === "/search" || path.startsWith("/search/")) return true;
    return false;
  }
  if (host === "realmo.com") {
    if (path.includes("/listing/")) return false;
    if (path.includes("/for-sale")) return true;
    return false;
  }
  if (host === "bizbuysell.com") {
    if (path === "/search" || path.startsWith("/search/")) return true;
    if (path === "/businesses-for-sale") return true;
    return false;
  }
  return false;
}

export const LISTING_SEARCH_MESSAGE = "That listing link is a search page. Use the property page.";
