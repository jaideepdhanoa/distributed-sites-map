const KEY = "sites-not-a-fit";

export function readHidden(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) || "[]") as string[];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function hideSite(id: string): string[] {
  const next = [...new Set([...readHidden(), id])];
  window.localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearHidden(id?: string): string[] {
  const next = id ? readHidden().filter((item) => item !== id) : [];
  window.localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
