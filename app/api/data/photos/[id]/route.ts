import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NAME = /^([a-f0-9]{20})\.(jpe?g|png|webp|gif)$/;
const TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const { id } = await context.params;
  const match = NAME.exec(id);
  if (!match) return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
  const file = path.join(process.cwd(), "data", "generated", "photos", `${match[1]}.${match[2]}`);
  try {
    const body = await readFile(file);
    return new NextResponse(body, {
      headers: {
        "Cache-Control": "private, max-age=86400",
        "Content-Type": TYPE[match[2]],
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
  }
}
