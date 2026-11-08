export type SavedSearch = { name: string; query: string };
export type Shortlist = { name: string; ids: string[] };

const SEARCH_KEY = "sites-saved-searches";
const LIST_KEY = "sites-shortlists";

function readList<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]") as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, rows: T[]) {
  window.localStorage.setItem(key, JSON.stringify(rows.slice(0, 30)));
}

export function readSearches(): SavedSearch[] {
  return readList<SavedSearch>(SEARCH_KEY).filter((row) => row && row.name && typeof row.query === "string");
}

export function saveSearch(name: string, query: string): SavedSearch[] {
  const clean = name.trim().slice(0, 80);
  if (!clean) return readSearches();
  const next = readSearches().filter((row) => row.name.toLowerCase() !== clean.toLowerCase());
  next.unshift({ name: clean, query });
  writeList(SEARCH_KEY, next);
  return next;
}

export function removeSearch(name: string): SavedSearch[] {
  const next = readSearches().filter((row) => row.name !== name);
  writeList(SEARCH_KEY, next);
  return next;
}

export function readShortlists(): Shortlist[] {
  return readList<Shortlist>(LIST_KEY).filter((row) => row && row.name && Array.isArray(row.ids));
}

export function saveShortlist(name: string, ids: string[]): Shortlist[] {
  const clean = name.trim().slice(0, 80);
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(0, 12);
  if (!clean || unique.length < 2) return readShortlists();
  const next = readShortlists().filter((row) => row.name.toLowerCase() !== clean.toLowerCase());
  next.unshift({ name: clean, ids: unique });
  writeList(LIST_KEY, next);
  return next;
}

export function removeShortlist(name: string): Shortlist[] {
  const next = readShortlists().filter((row) => row.name !== name);
  writeList(LIST_KEY, next);
  return next;
}

export type LinkProposal = {
  fromId: string;
  toId: string;
  via: "apn" | "address";
  apn: string;
  status: "pending" | "approved";
};

const LINK_KEY = "sites-link-proposals";

export function readLinks(): LinkProposal[] {
  return readList<LinkProposal>(LINK_KEY).filter((row) => row && row.fromId && row.toId);
}

export function proposeLink(proposal: Omit<LinkProposal, "status">): LinkProposal[] {
  const rows = readLinks().filter((row) => !(row.fromId === proposal.fromId && row.toId === proposal.toId));
  rows.unshift({ ...proposal, status: "pending" });
  writeList(LINK_KEY, rows);
  return rows;
}

export function setLinkStatus(fromId: string, toId: string, status: "pending" | "approved"): LinkProposal[] {
  const rows = readLinks().map((row) => row.fromId === fromId && row.toId === toId ? { ...row, status } : row);
  writeList(LINK_KEY, rows);
  return rows;
}
