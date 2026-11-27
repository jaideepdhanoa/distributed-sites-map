"use client";
import type {ReactNode} from "react";
import {explanationUrl} from "@/lib/charging/evidence";

export function ChargingLink({site,revision,returnTo,children,basis}:{site:string;revision?:string|null;returnTo?:string;basis?:"screen"|"detail";children?:ReactNode}){
  const href=explanationUrl(site,revision,returnTo)+(basis?"&basis="+basis:"");
  return <a className="text-link" href={href} onClick={event=>{
    if (returnTo) return;
    const destination=new URL(href,window.location.origin);
    destination.searchParams.set("returnTo",window.location.pathname+window.location.search+window.location.hash);
    event.currentTarget.href=destination.toString();
  }}>{children??"Explain cost per charge"}</a>;
}
