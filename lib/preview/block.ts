import { jsonError } from "@/lib/actions/http";
import { PREVIEW_POINTS_AT_PRODUCTION, previewPointsAtProduction, productionJobAllowed } from "./safety";

export function previewDatabaseWriteResponse(): Response | null {
  if (!previewPointsAtProduction()) return null;
  return jsonError(PREVIEW_POINTS_AT_PRODUCTION, 503);
}

export function productionJobResponse(): Response | null {
  if (productionJobAllowed()) return null;
  return jsonError("This job runs only in production.", 403);
}
