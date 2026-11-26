import type { DealProps } from "../types";
import { chargingHold,type Inputs } from "../selection/screen";
import { readGeneratedOptional } from "../snapshot/read";
import { selectionResearch } from "../selection/researchLoad";
import { purchaseFile } from "../purchaseReviewLoad";
import { isExcludedSite } from "../alerts/excluded";
export function unmappedChargingSite(id:string,stage?:string):DealProps|null {
  if(!/^PIPE-(LAS|MIA|PHX)-\d{4}$/.test(id) || isExcludedSite(id))return null;
  const input=(readGeneratedOptional("selection-inputs.json") as Record<string,Inputs>|undefined)?.[id];
  if(!input || input.land || /dropped|off[ -]?market/i.test(stage??input.stage))return null;
  const data=purchaseFile(),inputs=data?.sites[id],research=selectionResearch().get(id);
  return {chargingHold:chargingHold(input),deal_id:id,kind:"pipeline",name:id,city:id.split("-")[1],stage:stage??input.stage,stage_group:"desk",
    asking_price:inputs?.ask??null,bays_that_fit:input.recorded,selectionResearch:research,
    purchase:data && inputs?{inputs,assumptions:data.assumptions}:undefined} as DealProps;
}
