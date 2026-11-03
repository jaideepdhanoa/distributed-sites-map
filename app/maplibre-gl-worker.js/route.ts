import { readFileSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-static";

export function GET() {
  const file = path.join(process.cwd(), "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");
  return new NextResponse(readFileSync(file), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
