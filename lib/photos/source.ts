import { readFile } from "fs/promises";
import path from "path";
import { MAX_PHOTO_BYTES, committedPhotoUrl, isPhotoName, looksLikeImage, resolvePhoto } from "./bytes";

async function readLocal(name: string): Promise<Buffer | null> {
  if (!isPhotoName(name)) return null;
  try {
    return await readFile(path.join(process.cwd(), "data", "generated", "photos", name));
  } catch {
    return null;
  }
}

function skip(name: string, reason: string): null {
  console.error(JSON.stringify({ event: "photo_skipped", name, reason }));
  return null;
}

/** A file this deploy did not include, read from the copy committed on main. */
async function readCommitted(name: string): Promise<Buffer | null> {
  const url = committedPhotoUrl(name);
  if (!url) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "follow" });
  if (!response.ok) return null;
  const declared = Number(response.headers.get("content-length") || "");
  if (Number.isFinite(declared) && declared > MAX_PHOTO_BYTES) return skip(name, "larger than 8 MB");
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_PHOTO_BYTES) return skip(name, "larger than 8 MB");
  if (!looksLikeImage(body)) return skip(name, "not an image");
  return body;
}

export function sourcePhoto(name: string) {
  return resolvePhoto(name, [readLocal, readCommitted]);
}
