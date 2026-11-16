import { PREVIEW_POINTS_AT_PRODUCTION, previewPointsAtProduction } from "@/lib/preview/safety";

/** Shown when this preview deployment's database host is the production host. */
export default function PreviewDbBanner() {
  if (!previewPointsAtProduction()) return null;
  return (
    <p className="preview-db-banner" role="status">
      {PREVIEW_POINTS_AT_PRODUCTION}
    </p>
  );
}
