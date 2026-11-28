export type PipelineTrack = "charging" | "service" | "filed";

export function pipelineTrack(disposition?:string):PipelineTrack {
  if(disposition==="Service diligence") return "service";
  if(["Dropped","Archive listing","Outside mandate","Off-market prospect"].includes(disposition??"")) return "filed";
  return "charging";
}
