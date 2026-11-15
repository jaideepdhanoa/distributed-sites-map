import { createHash } from "node:crypto";

export const PHOTO_NAME = /^[a-f0-9]{20}\.(?:jpe?g|png|webp|gif)$/;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const LOCAL_PHOTO = /\/api\/data\/photos\/([a-f0-9]{20}\.(?:jpe?g|png|webp|gif))/g;

const CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export type PhotoBytes = { body: Buffer; contentType: string };

export function photoContentType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return CONTENT_TYPE[ext] || "application/octet-stream";
}

export function isPhotoName(name: string): boolean {
  return PHOTO_NAME.test(name);
}

/** Names a snapshot's JSON already points at. The deploy may not contain the files. */
export function referencedPhotoNames(files: { name: string; body: string }[]): string[] {
  const names = new Set<string>();
  for (const file of files) {
    if (!/\.(json|geojson)$/.test(file.name)) continue;
    for (const match of file.body.matchAll(LOCAL_PHOTO)) names.add(match[1]);
  }
  return [...names].sort();
}

export function photoSha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

export function looksLikeImage(body: Buffer): boolean {
  if (body.length < 12 || body.length > MAX_PHOTO_BYTES) return false;
  if (body[0] === 0xff && body[1] === 0xd8) return true;
  if (body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) return true;
  if (body.subarray(0, 4).toString("ascii") === "GIF8") return true;
  return body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP";
}

/**
 * A file that is on main but was left out of this deploy. The route still
 * requires a signed-in session before it fetches this.
 */
export function committedPhotoUrl(name: string): string {
  if (!isPhotoName(name)) return "";
  return `https://raw.githubusercontent.com/jaideepdhanoa/distributed-sites-map/main/data/generated/photos/${name}`;
}

export function asPhotoBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string" && value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
  return null;
}

/** Tries each source in order. The first real image wins. */
export async function resolvePhoto(
  name: string,
  sources: Array<(name: string) => Promise<Buffer | null>>,
): Promise<PhotoBytes | null> {
  if (!isPhotoName(name)) return null;
  const contentType = photoContentType(name);
  for (const read of sources) {
    try {
      const body = await read(name);
      if (body && looksLikeImage(body)) return { body, contentType };
    } catch {
      // A missing store or a failed fetch falls through to the next source.
    }
  }
  return null;
}
