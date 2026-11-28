import {defaultListAssumptions, type ListAssumptions} from "./preliminary";

export function validListTrial(v:unknown):v is ListAssumptions {
  if(!v || typeof v!=="object")return false;
  const t=v as ListAssumptions;
  return Number.isInteger(t.stalls) && t.stalls>=1 && t.stalls<=200 && Number.isFinite(t.volume) && t.volume>=1 && t.volume<=200 &&
    (t.assumeFit===undefined || typeof t.assumeFit==="boolean") && typeof t.creditCash==="boolean" && [t.unitBuild,t.attendant,t.upgrade].every(n=>n===undefined || (Number.isFinite(n) && n>=0 && n<=1e9)) &&
    Object.keys(t).every(k=>["assumeFit","stalls","volume","creditCash","upgrade","unitBuild","attendant"].includes(k));
}

export function listTrialHash(a:ListAssumptions){
  return "#trial="+encodeURIComponent(JSON.stringify(a));
}
export function readListTrial(hash:string){
  const raw=new URLSearchParams(hash.slice(1)).get("trial");
  if(!raw)return defaultListAssumptions;
  try{const data:unknown=JSON.parse(raw);return validListTrial(data)?{...data,assumeFit:data.assumeFit??true,volume:100}:null;}catch{return null;}
}
