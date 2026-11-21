import type { GroundBox } from "./measure";
import type { SpaceLayout, SpaceType } from "./vocab";

export type SpaceWrite = {
  siteId: string;
  id: string;
  version: number;
  box: GroundBox;
  type: SpaceType;
  layout: SpaceLayout;
};

/** The site_space row posted to /api/changes. Delete uses the same path with `deleted`. */
export function siteSpaceChange(space: SpaceWrite, deleted = false) {
  return {
    entity_type: "site_space" as const,
    site_id: space.siteId,
    ...(space.version > 0 ? { entity_id: space.id } : {}),
    expected_version: space.version,
    source: "Site aerial",
    payload: deleted
      ? { deleted: true as const }
      : {
          center_lng: space.box.center.lng,
          center_lat: space.box.center.lat,
          length_ft: space.box.lengthFt,
          width_ft: space.box.widthFt,
          rotation_deg: space.box.rotationDeg,
          type: space.type,
          layout: space.layout,
        },
  };
}
