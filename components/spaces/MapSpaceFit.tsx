import { kinds, type Aerial, type Zone } from "@/lib/spaces/options";
import { checkSpaceFit } from "@/lib/spaces/fitCheck";
import type { Review } from "@/lib/spaces/optionReview";

const availability: Record<Zone["kind"], string> = {
  parking: "Confirm peak parking demand and rights to the row.",
  vacuum: "Confirm peak vacuum use and how many positions the wash needs to retain.",
  bay: "Confirm which service bays can be released and during which hours.",
  pad: "Confirm land control, access and equipment clearance.",
  apron: "Check vehicle turning paths, stacking and the hours the apron is free.",
  storage: "Confirm tenant rights and where displaced vehicles would go.",
  clear: "Keep this access open.",
};

const rangeText = ([low, high]: readonly [number, number]) =>
  low === high ? String(low) : low + "–" + high;
export default function MapSpaceFit({
  zone,
  image,
  review,
}: {
  zone: Zone;
  image?: Aerial;
  review?: Review|null;
}) {
  const {dimensions:dims,inside:range,adjacent:edge} = checkSpaceFit(zone,image);
  const adjacent = edge && range && edge[1] > range[1] ? edge : null;
  return (
    <div className="map-space-fit">
      <strong>
        {adjacent
          ? rangeText(adjacent) + " stalls with an adjacent aisle"
          : range
            ? rangeText(range) +
              (range[0] === 1 && range[1] === 1 ? " stall" : " stalls") +
              " within outline"
            : "Stall fit unresolved"}
      </strong>
      <dl>
        <dt>Physical fit</dt>
        <dd>
          {dims && range
            ? dims[0] +
              " × " +
              dims[1] +
              " ft. With a 90° layout and an aisle inside the outline, " +
              rangeText(range) +
              " fit."
            : zone.kind === "bay"
              ? "An interior plan must establish clear dimensions and access."
              : "Measure the clear footprint and drive aisle."}
          {adjacent && (
            <> The higher estimate requires a continuous, usable 24 ft aisle alongside the row.</>
          )}
        </dd>
        {review?.measured && <><dt>Recorded measurement</dt><dd>{review.measured.stalls} stalls · {review.measured.source}</dd></>}
        <dt>Availability</dt>
        <dd>{review?.reason || zone.check || availability[zone.kind] || kinds[zone.kind].check}</dd>
      </dl>
    </div>
  );
}
