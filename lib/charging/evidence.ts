import type {Evidence,Inputs,Key} from "./model";

export const planning:Evidence={status:"assumed",source:"Scenario estimate",date:""};
export function sourceValue(input:Inputs,key:Key){
  return input.sourceValues?.[key] ?? {value:input.values[key],evidence:input.evidence[key]??planning};
}

/** Keep the first source observation while the case value is explored repeatedly. */
export function trialValue(input:Inputs,key:Key,value:number|null):Inputs {
  if(input.values[key]===value)return input;
  const source=sourceValue(input,key);
  const sourceValues={...input.sourceValues};
  const follows=value===source.value;
  if(follows)delete sourceValues[key];else sourceValues[key]=source;
  return {...input,values:{...input.values,[key]:value},sourceValues,
    evidence:{...input.evidence,[key]:follows?source.evidence:{...planning}},
    comparable:["depot","years","energy","efficiency","rate"].includes(key)?false:input.comparable};
}
export function changeValue(input:Inputs,key:Key,value:number|null){
  let next=trialValue(input,key,value);
  if((key==="hostWeek" || key==="hostEnd") && value!=null){
    const own=key==="hostWeek"?"ownWeek":"ownEnd",required=key==="hostWeek"?"weekdayHours":"weekendHours";
    const total=input.values[required], covered=input.values[own], host=input.values[key];
    if(total!=null && covered!=null && host!=null && covered+host===total)
      next=trialValue(next,own,Math.max(0,total-value));
  }
  return next;
}
export function explanationUrl(site:string,revision?:string|null,returnTo?:string){
  const params=new URLSearchParams({site,view:"explain"});
  if(revision)params.set("case",revision);
  if(returnTo)params.set("returnTo",returnTo);
  return "/charging?"+params.toString();
}

export function reviseSource(input:Inputs,key:Key,value:number|null,evidence:Evidence):Inputs{
  if(input.sourceValues?.[key] && value!==input.values[key])
    return {...input,sourceValues:{...input.sourceValues,[key]:{value,evidence}}};
  const sourceValues={...input.sourceValues};
  delete sourceValues[key];
  return {...input,sourceValues,values:{...input.values,[key]:value},evidence:{...input.evidence,[key]:evidence},
    comparable:key==="depot"?false:input.comparable};
}
