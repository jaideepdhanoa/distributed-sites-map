import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { MAX_PHOTO_BYTES, committedPhotoUrl, isPhotoName, looksLikeImage, photoContentType, resolvePhoto } from "@/lib/photos/bytes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

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

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const { id } = await context.params;
  // Disk is the fast path. Photo bytes are not copied into Neon: the files a
  // snapshot names are about 241 MiB, which does not fit Neon Free beside the
  // rest of the database. A name this deploy lacks is read from main.
  const photo = await resolvePhoto(id, [readLocal, readCommitted]);
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
  return new NextResponse(new Uint8Array(photo.body), {
    headers: {
      "Cache-Control": "private, max-age=86400",
      "Content-Type": photo.contentType || photoContentType(id),
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
