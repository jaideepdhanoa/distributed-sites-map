import { inventoryLabels, type Inventory } from "@/lib/spaces/parcelLayout";
import type { Zone } from "@/lib/spaces/options";

export default function ParcelInventory({inventory,zones}: {inventory?:Inventory;zones:Zone[]}) {
  const categories: Record<keyof Inventory, Zone["kind"][]> = {parking:["parking"],ground:["ground","pad"],operations:["apron","clear","storage","vacuum"],bays:["bay"]};
  return <details className="disclosure parcel-inventory"><summary className="disclosure">Whole-parcel review</summary>
    <dl>{(Object.keys(inventoryLabels) as (keyof Inventory)[]).map(key=>{
      const areas=zones.filter(z=>categories[key].includes(z.kind)).map(z=>z.label);
      return <div key={key}><dt>{inventoryLabels[key]}</dt><dd>{inventory?.[key] || (areas.length ? areas.join(" · ") : "No area documented. Check the parcel.")}</dd></div>;
    })}</dl></details>;
}
