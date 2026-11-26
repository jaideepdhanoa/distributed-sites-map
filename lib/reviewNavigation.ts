import { rememberSearch } from "./navSearch";

const pipeline = "/?funnel=pipeline&view=list";
type ReviewPath = "/" | "/selection-review" | "/space-review";

/** A return link is always one of the three local screening screens. */
export function reviewReturn(value: string | null, allowed: ReviewPath[], fallback = pipeline) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const url = new URL(value,"https://local.invalid");
    return url.origin === "https://local.invalid" && allowed.includes(url.pathname as ReviewPath)
      ? url.pathname + url.search + url.hash : fallback;
  } catch { return fallback; }
}

export function reviewLink(path: ReviewPath, values: Record<string,string>, origin: string) {
  return path + "?" + new URLSearchParams({...values,returnTo:origin});
}

export function reviewLabel(href: string) {
  if (href.startsWith("/selection-review")) return "Back to selection review";
  if (href.startsWith("/space-review")) return "Back to layout reviews";
  return "Back to Pipeline list";
}

export function setReviewFilter(key:string,value:string) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key,value);
  else url.searchParams.delete(key);
  url.hash = "";
  window.history.replaceState(null,"",url);
  if (url.pathname === "/") rememberSearch(url.pathname + url.search);
}

const positionKey = (href:string) => "review-position:" + href.split("#")[0];

export function rememberReviewPosition(element:HTMLElement | null, row = "", selected?:string[]) {
  if (!element) return;
  const {pathname,search} = window.location;
  try { sessionStorage.setItem(positionKey(pathname+search),JSON.stringify({top:element.scrollTop,left:element.scrollLeft,row,selected})); } catch {}
}

export function restoreReviewPosition(element:HTMLElement | null) {
  if (!element) return;
  const {pathname,search,hash} = window.location;
  let row = hash.slice(1);
  try {
    const key = positionKey(pathname+search);
    const saved = sessionStorage.getItem(key);
    if (saved) {
      const position = JSON.parse(saved);
      element.scrollTo(position.left,position.top);
      row ||= position.row;
      sessionStorage.removeItem(key);
      if (row) document.getElementById(row)?.focus({preventScroll:true});
      return Array.isArray(position.selected) ? position.selected.filter((id:unknown): id is string=>typeof id==="string") as string[] : undefined;
    }
  } catch {}
  const target = row && document.getElementById(row);
  if (target) {target.scrollIntoView({block:"nearest"});target.focus({preventScroll:true});}
}
