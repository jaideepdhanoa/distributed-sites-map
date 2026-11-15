import { NextResponse } from "next/server";
import { privateHeaders } from "@/lib/guard";
import { authorizeSnapshotRevalidate } from "@/lib/snapshot/auth";
import { revalidateSnapshotCache } from "@/lib/snapshot/read";

export const snapshotRevalidate = {
  async bust(): Promise<void> {
    await revalidateSnapshotCache();
  },
};

export async function POST(request: Request) {
  if (!authorizeSnapshotRevalidate(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  }
  try {
    await snapshotRevalidate.bust();
  } catch {
    return NextResponse.json({ error: "The cache could not be refreshed." }, { status: 500, headers: privateHeaders });
  }
  return NextResponse.json({ ok: true }, { headers: privateHeaders });
}
