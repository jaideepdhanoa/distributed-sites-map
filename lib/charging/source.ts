import { createHash } from "node:crypto";
import type { DealProps } from "../types";
import { actionsEnabled,withSql } from "../actions/db";
import { activeCases } from "./store";
export function sourceRevision(d:DealProps) {
  return createHash("sha256").update(JSON.stringify([d.purchase,d.selectionResearch,d.screening,d.asking_price,d.bays_that_fit,d.stage])).digest("hex").slice(0,24);
}
export async function selectedCases() {
  if(!actionsEnabled())return new Map();
  try {const rows=await withSql(activeCases);return new Map(rows.map(r=>[r.site_id,r]));}
  catch(error){if((error as {code?:string}).code==="42P01")return new Map();throw error;}
}
