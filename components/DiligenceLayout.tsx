import { diligenceLayout } from "@/lib/charging/diligenceLayout";
import type { ChargingSummary } from "@/lib/charging/summary";
import { costRange } from "@/lib/charging/pipelineCost";

export function DiligenceLayout({site,charging}:{site:string;charging?:ChargingSummary}) {
  const layout=diligenceLayout(charging?.preliminary);
  if(!layout) return null;
  const query=new URLSearchParams({site,view:"explain",basis:"screen",layout:layout.mixId!});
  return <p className="layer-meta"><b>Layout within depot proxy</b> · {layout.stalls} stalls · {layout.condition.split(". ")[0]} · {" "}
    <a className="text-link" href={"/charging?"+query}>{costRange(layout)} per charge</a>
    {layout.rights?.pending ? " · Validate use and access for "+layout.rights.pending+" stalls" : ""}</p>;
}
