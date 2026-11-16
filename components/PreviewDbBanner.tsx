import { connection } from "next/server";
import { PREVIEW_POINTS_AT_PRODUCTION, previewPointsAtProduction } from "@/lib/preview/safety";

/** The banner text. Rendered only when this request's preview database is closed. */
export function PreviewDbBannerView() {
  if (!previewPointsAtProduction()) return null;
  return (
    <p className="preview-db-banner" role="status">
      {PREVIEW_POINTS_AT_PRODUCTION}
    </p>
  );
}

/** Request-time banner. connection() keeps the decision out of the build. */
export default async function PreviewDbBanner() {
  await connection();
  return <PreviewDbBannerView />;
}
