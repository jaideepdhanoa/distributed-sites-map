import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { Sql } from "../actions/db";
import { InputError } from "../actions/text";
import {validListTrial} from "./listTrial";
import type { PreliminaryCost,ListAssumptions } from "./preliminary";
import { ledgerFields, remainingBasis, screenLedger, validChange, type LedgerKey, type SavedScreen } from "./screenLedger";

export const screenVersion="preliminary-ledger/1";
const key=z.enum(Object.keys(ledgerFields) as [LedgerKey,...LedgerKey[]]);
export const screenSaveSchema=z.strictObject({kind:z.literal("screen"),id:z.uuid(),name:z.string().trim().min(1).max(80),
  basis:z.unknown(),listTrial:z.custom<ListAssumptions>(validListTrial).optional(),omitted:z.array(z.string()).optional(),scenario:z.literal(0),sourceRevision:z.string().regex(/^[a-f0-9]{24}$/),
  changes:z.partialRecord(key,z.number().finite()).refine(changes=>
    Object.entries(changes).every(([k,v])=>validChange(k as LedgerKey,v)),"Review the trial values.")});
const projection="case_id AS id,name,author,saved_at AS at,inputs";

export async function screenHistory(sql:Sql,site:string) {
  return (await sql.query<SavedScreen>("SELECT "+projection+" FROM charging_case_revisions WHERE site_id=$1 AND model_version=$2 ORDER BY saved_at DESC",[site,screenVersion])).rows;
}

export async function saveScreen(sql:Sql,site:string,author:string,request:z.infer<typeof screenSaveSchema>,estimate:PreliminaryCost|undefined) {
  const basis=estimate && "layouts" in estimate && estimate.layouts.find(layout=>
    isDeepStrictEqual(JSON.parse(JSON.stringify(layout.ledger)),request.basis))?.ledger;
  if (!basis) throw new InputError("The screening inputs changed. Reload the ledger before saving.",409);
  if (basis.terms==="lease" && (request.changes.cash!=null || request.changes.displaced!=null))
    throw new InputError("Retained seller cash is outside this lease screen.",400);
  const omitted=request.omitted;
  if (omitted?.length && (!basis.parts || omitted.some(area=>!basis.parts!.some(p=>p.area===area)) ||
    !basis.parts.some(p=>!omitted.includes(p.area)))) throw new InputError("Review the selected layout areas.",400);
  if (["volume","benchmark","referenceYears","referenceStalls"].some(k=>k in request.changes))
    throw new InputError("Utilization is shared across site configurations.",400);
  const resolved=remainingBasis(basis,omitted??[],estimate && "layouts" in estimate?estimate.layouts.map(l=>l.ledger):[]);
  if(omitted?.length && request.changes.stalls!==resolved.inputs.stalls)
    throw new InputError("The stall count must match the remaining drawn areas.",400);
  const inputs={basis:resolved,changes:request.changes,scenario:request.scenario,...(omitted?.length?{omitted}:{})};
  const result=screenLedger(resolved,request.changes);
  if(result.perCharge==null) throw new InputError("A priced alternative needs completed charges.",400);
  // A screen is an immutable snapshot. Its UUID also makes retrying the insert idempotent.
  const values=[site,request.id,request.name,author,screenVersion,request.sourceRevision,JSON.stringify(inputs),JSON.stringify(result)];
  await sql.query(`INSERT INTO charging_case_revisions(site_id,case_id,revision,request_id,name,author,model_version,source_revision,inputs,result,selection_intent)
    VALUES($1,$2,1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,false) ON CONFLICT DO NOTHING`,values);
  const {rows}=await sql.query<SavedScreen>("SELECT "+projection+` FROM charging_case_revisions
    WHERE site_id=$1 AND case_id=$2 AND revision=1 AND name=$3 AND author=$4 AND model_version=$5 AND source_revision=$6 AND inputs=$7::jsonb`,values.slice(0,7));
  if(!rows.length) throw new InputError("That save belongs to another alternative. Reload and try again.",409);
  return rows[0];
}
