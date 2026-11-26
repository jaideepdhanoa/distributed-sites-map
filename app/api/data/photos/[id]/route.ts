import { NextResponse } from "next/server";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { photoContentType } from "@/lib/photos/bytes";
import { sourcePhoto } from "@/lib/photos/source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const { id } = await context.params;
  // Disk is the fast path. Photo bytes are not copied into Neon: the files a
  // snapshot names are about 241 MiB, which does not fit Neon Free beside the
  // rest of the database. A name this deploy lacks is read from main.
  const photo = await sourcePhoto(id);
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
