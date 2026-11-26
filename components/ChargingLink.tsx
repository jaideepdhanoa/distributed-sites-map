"use client";
import type {ReactNode} from "react";
import {explanationUrl} from "@/lib/charging/evidence";

export function ChargingLink({site,revision,children}:{site:string;revision?:string|null;children?:ReactNode}){
  const href=explanationUrl(site,revision);
  return <a className="text-link" href={href} onClick={event=>{
    const destination=new URL(href,window.location.origin);
    destination.searchParams.set("returnTo",window.location.pathname+window.location.search+window.location.hash);
    event.currentTarget.href=destination.toString();
  }}>{children??"Explain cost per charge"}</a>;
}
