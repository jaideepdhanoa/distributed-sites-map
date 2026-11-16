import { actionsEnabled, withSql } from "@/lib/actions/db";
import { jsonError, jsonOk } from "@/lib/actions/http";
import { ProductionWriteRefused, shadowContext } from "@/lib/changes/guard";
import { PIPELINE_COLUMNS } from "@/lib/keyNumbers";
import { isLayoutSurface, sanitizeLayout, type LayoutSurface } from "@/lib/listLayout";
import { loadListLayout, missingLayoutTable, saveListLayout } from "@/lib/listLayoutStore";
import { previewPointsAtProduction } from "@/lib/preview/safety";
import { isSession, requireUser } from "@/lib/guard";

const UNIVERSE_IDS = ["site", "type", "stage", "score", "spare", "grade", "traffic", "listed"];

function allowedFor(surface: LayoutSurface): string[] {
  if (surface === "pipeline") return PIPELINE_COLUMNS.map((column) => column.id);
  return UNIVERSE_IDS;
}

/** A preview pointed at production must keep the sheet usable while 015 is still pending. */
export function layoutStoreUnavailable(error: unknown): boolean {
  if (missingLayoutTable(error) || error instanceof ProductionWriteRefused) return true;
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "42P01" || code === "42703" || code === "25P02") return true;
  return shadowContext() === "preview";
}

function surfaceOf(request: Request, body?: { surface?: unknown }): LayoutSurface | null {
  const url = new URL(request.url);
  const value = typeof body?.surface === "string" ? body.surface : url.searchParams.get("surface");
  return isLayoutSurface(value) ? value : null;
}

export async function GET(request: Request) {
  const surface = surfaceOf(request);
  if (!surface) return jsonError("That list is not available.", 400);
  if (previewPointsAtProduction()) return jsonOk({ layout: null, stored: false });
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!actionsEnabled()) return jsonOk({ layout: null, stored: false });
  try {
    const layout = await withSql((sql) => loadListLayout(sql, session.u, surface, allowedFor(surface)));
    return jsonOk({ layout, stored: true });
  } catch (error) {
    if (layoutStoreUnavailable(error)) return jsonOk({ layout: null, stored: false });
    console.error(JSON.stringify({ event: "list_layout_read", name: error instanceof Error ? error.name : "error" }));
    return jsonError("The list layout could not be read.", 500);
  }
}

export async function PUT(request: Request) {
  let body: { surface?: unknown; layout?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The list layout could not be read.", 400);
  }
  const surface = surfaceOf(request, body);
  if (!surface) return jsonError("That list is not available.", 400);
  if (previewPointsAtProduction()) {
    return jsonOk({ layout: sanitizeLayout(body.layout, allowedFor(surface)), stored: false });
  }
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!actionsEnabled()) return jsonOk({ layout: sanitizeLayout(body.layout, allowedFor(surface)), stored: false });
  try {
    const saved = await withSql((sql) => saveListLayout(sql, session.u, surface, sanitizeLayout(body.layout, allowedFor(surface)), allowedFor(surface)));
    if (!saved) return jsonError("The list layout could not be saved.", 400);
    return jsonOk({ layout: saved, stored: true });
  } catch (error) {
    if (layoutStoreUnavailable(error)) return jsonOk({ layout: sanitizeLayout(body.layout, allowedFor(surface)), stored: false });
    console.error(JSON.stringify({ event: "list_layout_write", name: error instanceof Error ? error.name : "error" }));
    return jsonError("The list layout could not be saved.", 500);
  }
}
