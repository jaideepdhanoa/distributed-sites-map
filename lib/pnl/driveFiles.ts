import { createHash } from "node:crypto";
import { SYNC_DRIVE_SCOPE } from "@/lib/changes/mirror";
import { sheetsAccessToken } from "@/lib/changes/sheetsAuth";
import { redisConfig } from "@/lib/lockout";
import { isolatedKey } from "@/lib/preview/safety";
import {
  isSafeFileId,
  matchDriveFile,
  normalizeFileName,
  type DriveFile,
} from "@/lib/pnl/sourceLink";

const FOLDER = "application/vnd.google-apps.folder";
const EMAIL_FOLDER = /^(?:4\b)|emails and calls/i;
const FOLDER_TTL = 10 * 60 * 1000;
const NAME_TTL = 10 * 60 * 1000;
const REDIS_HIT = 6 * 60 * 60;
const REDIS_MISS = 10 * 60;
const MAX_DEPTH = 6;
const MAX_FILES = 500;

export type DriveChild = { id: string; name: string; mimeType: string };

export type DriveLister = {
  listChildren(folderId: string): Promise<DriveChild[]>;
};

type CachedName = { at: number; value: { id: string; mime: string } | null };

const folders = new Map<string, { at: number; files: DriveFile[] }>();
const names = new Map<string, CachedName>();

export function clearDriveFileCache(): void {
  folders.clear();
  names.clear();
}

function nameKey(folderId: string, filename: string): string {
  return `${folderId}\n${normalizeFileName(filename)}`;
}

function redisKey(folderId: string, filename: string): string {
  const digest = createHash("sha256").update(nameKey(folderId, filename)).digest("hex").slice(0, 32);
  return isolatedKey(`pnl:src:${digest}`);
}

function readMemory(folderId: string, filename: string): { id: string; mime: string } | null | undefined {
  const hit = names.get(nameKey(folderId, filename));
  if (!hit || Date.now() - hit.at > NAME_TTL) return undefined;
  return hit.value;
}

function writeMemory(folderId: string, filename: string, value: { id: string; mime: string } | null): void {
  names.set(nameKey(folderId, filename), { at: Date.now(), value });
}

async function redisCommand(parts: (string | number)[]): Promise<unknown> {
  const cfg = redisConfig();
  if (!cfg) return undefined;
  const response = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(parts),
    cache: "no-store",
  });
  if (!response.ok) return undefined;
  const payload = (await response.json()) as { result?: unknown };
  return payload.result;
}

async function readRedis(folderId: string, filename: string): Promise<{ id: string; mime: string } | null | undefined> {
  try {
    const raw = await redisCommand(["GET", redisKey(folderId, filename)]);
    if (typeof raw !== "string" || !raw) return undefined;
    if (raw === "-") return null;
    const [id, mime] = raw.split("\t");
    if (!id || !isSafeFileId(id)) return undefined;
    return { id, mime: mime || "" };
  } catch {
    return undefined;
  }
}

async function writeRedis(folderId: string, filename: string, value: { id: string; mime: string } | null): Promise<void> {
  try {
    const body = value ? `${value.id}\t${value.mime}` : "-";
    await redisCommand(["SET", redisKey(folderId, filename), body, "EX", value ? REDIS_HIT : REDIS_MISS]);
  } catch {
    // The in-memory listing still serves this process.
  }
}

async function walk(folderId: string, lister: DriveLister, depth: number, files: DriveFile[], seen: Set<string>): Promise<void> {
  if (depth > MAX_DEPTH || files.length >= MAX_FILES || seen.has(folderId) || !isSafeFileId(folderId)) return;
  seen.add(folderId);
  let children: DriveChild[] = [];
  try {
    children = await lister.listChildren(folderId);
  } catch {
    return;
  }
  for (const child of children) {
    const id = String(child.id || "").trim();
    if (!isSafeFileId(id)) continue;
    if (child.mimeType === FOLDER) {
      if (EMAIL_FOLDER.test(String(child.name || "").trim())) continue;
      await walk(id, lister, depth + 1, files, seen);
      continue;
    }
    if (child.mimeType === "application/vnd.google-apps.shortcut") continue;
    files.push({ id, name: String(child.name || ""), mime: String(child.mimeType || "") });
    if (files.length >= MAX_FILES) return;
  }
}

export async function listSiteFiles(folderId: string, lister: DriveLister): Promise<DriveFile[]> {
  if (!isSafeFileId(folderId)) return [];
  const cached = folders.get(folderId);
  if (cached && Date.now() - cached.at < FOLDER_TTL) return cached.files;
  const files: DriveFile[] = [];
  await walk(folderId, lister, 0, files, new Set());
  folders.set(folderId, { at: Date.now(), files });
  return files;
}

/**
 * Filename to the one Drive file with that name inside the site folder.
 * A miss, a parent folder, or two matches stays empty. The filename is not stored in the cache key.
 */
export async function resolveFileNames(
  folderId: string,
  filenames: string[],
  lister: DriveLister | null,
): Promise<Map<string, { id: string; mime: string } | null>> {
  const out = new Map<string, { id: string; mime: string } | null>();
  const unique = [...new Set(filenames.map((name) => normalizeFileName(name)).filter(Boolean))];
  if (!isSafeFileId(folderId)) {
    for (const name of unique) out.set(name, null);
    return out;
  }
  const pending: string[] = [];
  for (const name of unique) {
    const memory = readMemory(folderId, name);
    if (memory !== undefined) {
      out.set(name, memory);
      continue;
    }
    const remote = await readRedis(folderId, name);
    if (remote !== undefined) {
      writeMemory(folderId, name, remote);
      out.set(name, remote);
      continue;
    }
    pending.push(name);
  }
  if (!pending.length || !lister) {
    for (const name of pending) out.set(name, null);
    return out;
  }
  const files = await listSiteFiles(folderId, lister);
  for (const name of pending) {
    const file = matchDriveFile(files, name);
    const value = file ? { id: file.id, mime: file.mime } : null;
    writeMemory(folderId, name, value);
    void writeRedis(folderId, name, value);
    out.set(name, value);
  }
  return out;
}

let tokenCache: { token: string; exp: number } | null = null;

async function driveToken(raw: string): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now()) return tokenCache.token;
  const token = await sheetsAccessToken(raw, SYNC_DRIVE_SCOPE);
  tokenCache = { token, exp: Date.now() + 45 * 60 * 1000 };
  return token;
}

async function listChildren(token: string, folderId: string): Promise<DriveChild[]> {
  if (!isSafeFileId(folderId)) return [];
  const items: DriveChild[] = [];
  let page = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,mimeType)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      pageSize: "200",
    });
    if (page) params.set("pageToken", page);
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Drive list failed (${response.status})`);
    const payload = (await response.json()) as { nextPageToken?: string; files?: { id?: string; name?: string; mimeType?: string }[] };
    for (const file of payload.files || []) {
      items.push({ id: String(file.id || ""), name: String(file.name || ""), mimeType: String(file.mimeType || "") });
    }
    page = payload.nextPageToken || "";
    if (!page) break;
  }
  return items;
}

/** Read-only Drive listing for the service account. Null when the secret is unset. */
export async function serviceDriveLister(): Promise<DriveLister | null> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  return {
    async listChildren(folderId: string) {
      const token = await driveToken(raw);
      return listChildren(token, folderId);
    },
  };
}
