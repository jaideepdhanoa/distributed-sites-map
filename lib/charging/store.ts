import type { Sql } from "../actions/db";
import { InputError } from "../actions/text";
import { calculate, modelVersion, type Inputs, type SavedCase } from "./model";

const projection = `r.case_id AS id, r.revision, r.name,r.author,r.saved_at AS at,r.model_version AS model,
  r.source_revision AS "sourceRevision",r.inputs,r.result,(s.case_id IS NOT NULL) AS selected`;
const join = "LEFT JOIN charging_site_case s USING (site_id,case_id,revision)";
export async function caseHistory(sql:Sql, site:string) {
  return (await sql.query<SavedCase>(`SELECT ${projection} FROM charging_case_revisions r ${join}
    WHERE r.site_id=$1 ORDER BY r.saved_at DESC,r.revision DESC`,[site])).rows;
}
export async function activeCases(sql:Sql) {
  return (await sql.query<SavedCase & {site_id:string}>(`SELECT r.site_id,${projection} FROM charging_case_revisions r
    JOIN charging_site_case s USING(site_id,case_id,revision)`)).rows;
}
export type SaveRequest={id:string; requestId:string; base:number; name:string; inputs:Inputs; sourceRevision:string; select:boolean; expectedSelection:string|null};
export async function saveCase(sql:Sql,site:string,who:string,d:SaveRequest) {
  await sql.exec("BEGIN");
  try {
    await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))",["charging-case:"+site]);
    const previous=await sql.query<{id:string;author:string;site:string;identical:boolean}>("SELECT case_id AS id,author,site_id AS site, (revision=$2 AND name=$3 AND inputs=$4::jsonb AND source_revision=$5 AND selection_intent=$6 AND expected_selection IS NOT DISTINCT FROM $7::text) AS identical FROM charging_case_revisions WHERE request_id=$1",[d.requestId,d.base+1,d.name,JSON.stringify(d.inputs),d.sourceRevision,d.select,d.expectedSelection]);
    if(previous.rows.length){
      const old=previous.rows[0];
      if(old.id!==d.id || old.author!==who || old.site!==site || !old.identical)throw new InputError("Save request conflicts with an earlier change.",409);
    } else {
      const current=await sql.query<{revision:number}>("SELECT COALESCE(MAX(revision),0) AS revision FROM charging_case_revisions WHERE site_id=$1 AND case_id=$2",[site,d.id]);
      if(current.rows[0].revision!==d.base)throw new InputError("A newer revision is available. Reload before saving.",409);
      if(d.select){
        const selected=await sql.query<{key:string}>("SELECT case_id::text || ':' || revision::text AS key FROM charging_site_case WHERE site_id=$1",[site]);
        if((selected.rows[0]?.key??null)!==d.expectedSelection)throw new InputError("The shared site case changed. Reload before selecting another case.",409);
      }
      await sql.query(`INSERT INTO charging_case_revisions (site_id,case_id,revision,request_id,name,author,model_version,source_revision,inputs,result,selection_intent,expected_selection)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)`,
        [site,d.id,d.base+1,d.requestId,d.name,who,modelVersion,d.sourceRevision,JSON.stringify(d.inputs),JSON.stringify(calculate(d.inputs)),d.select,d.expectedSelection]);
      if(d.select)await sql.query(`INSERT INTO charging_site_case VALUES($1,$2,$3) ON CONFLICT(site_id)
        DO UPDATE SET case_id=excluded.case_id,revision=excluded.revision`,[site,d.id,d.base+1]);
    }
    const history=await caseHistory(sql,site);
    await sql.exec("COMMIT");
    return history;
  }catch(error){await sql.exec("ROLLBACK");throw error;}
}
