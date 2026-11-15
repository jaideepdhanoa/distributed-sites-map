import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { committedPhotoUrl, isPhotoName, photoContentType, resolvePhoto } from "@/lib/photos/bytes";
import { readStoredPhoto } from "@/lib/photos/store";

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

async function readStored(name: string): Promise<Buffer | null> {
  if (!actionsEnabled()) return null;
  try {
    return await withSql((sql) => readStoredPhoto(sql, name));
  } catch {
    return null;
  }
}

async function readCommitted(name: string): Promise<Buffer | null> {
  const url = committedPhotoUrl(name);
  if (!url) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "follow" });
  if (!response.ok) return null;
  const body = Buffer.from(await response.arrayBuffer());
  return body;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const { id } = await context.params;
  // Disk is the fast path for a file this deploy contains. A snapshot can name
  // a file the deploy lacks; that copy is in photo_files, then on main.
  const photo = await resolvePhoto(id, [readLocal, readStored, readCommitted]);
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
