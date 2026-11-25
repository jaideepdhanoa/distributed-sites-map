import { dealRows, MISSING, siteRows } from "@/lib/comparison";
import type { SiteProps, DealProps } from "@/lib/types";

export default function Economics({deal,site,signedIn}:{deal?:DealProps|null;site?:SiteProps|null;signedIn?:boolean}) {
  if (!signedIn) return <p>Sign in to view financial evidence.</p>;
  const rows = deal ? dealRows(deal,site ? [site] : [],true) : site ? siteRows(site,[],true) : [];
  return <dl className="record-economics">{["Asking","Revenue","Cash flow","Asking / earnings","Land estimate","Figure basis","Reporting period","Financial package"].map(label=>{
    const row = rows.find(item=>item.label===label);
    return <div key={label}><dt>{label}</dt><dd>{row?.value && row.value!==MISSING ? row.value : "Not on file"}</dd></div>;
  })}</dl>;
}
