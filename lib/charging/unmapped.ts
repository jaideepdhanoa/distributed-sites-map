import { layoutAssessment } from "../spaces/assessmentLoad";
import { mapCatalog } from "../spaces/mapCatalogLoad";
import { pipelineFit } from "../spaces/pipelineFit";
import type { SpaceCatalog } from "../spaces/mapCatalog";
import type { DealProps } from "../types";
import { chargingHold,type Inputs } from "../selection/screen";
import { readGeneratedOptional } from "../snapshot/read";
import { opportunityRegister } from "../selection/opportunityLoad";
import { selectionResearch } from "../selection/researchLoad";
import { purchaseFile } from "../purchaseReviewLoad";
import { isExcludedSite } from "../alerts/excluded";
export async function unmappedChargingSite(id:string,stage?:string,catalog?:SpaceCatalog):Promise<DealProps|null> {
  if(!/^PIPE-(LAS|MIA|PHX)-\d{4}$/.test(id) || isExcludedSite(id))return null;
  const input=(readGeneratedOptional("selection-inputs.json") as Record<string,Inputs>|undefined)?.[id];
  if(!input || input.land || /dropped|off[ -]?market/i.test(stage??input.stage))return null;
  const data=purchaseFile(),inputs=data?.sites[id],research=selectionResearch().get(id);
  const assessment=layoutAssessment(id)?.row;
  const outlines=catalog ?? await mapCatalog([],assessment ? [[id,assessment]] : []);
  const fit=pipelineFit(outlines.sites.find(s=>s.id===id),assessment,outlines.reviewsAvailable,inputs?.fit??input.recorded);
  fit.revision=assessment?.revision;
  return {chargingSpace:fit,opportunityReview:opportunityRegister()?.sites[id],chargingHold:chargingHold(input),deal_id:id,kind:"pipeline",name:id,city:id.split("-")[1],stage:stage??input.stage,stage_group:"desk",
    asking_price:inputs?.ask??null,bays_that_fit:input.recorded,selectionResearch:research,
    purchase:data && inputs?{inputs,assumptions:data.assumptions}:undefined} as DealProps;
}
