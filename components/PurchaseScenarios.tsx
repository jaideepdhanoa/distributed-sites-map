"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { preferredScenario, type PurchaseScenario } from "@/lib/purchaseReview";

const Context = createContext<{cases:Record<string,PurchaseScenario>; set:(id:string,s:PurchaseScenario)=>void}>({cases:{},set:()=>{}});
export function PurchaseScenarios({children}:{children:ReactNode}) {
  const [cases,update]=useState<Record<string,PurchaseScenario>>({});
  return <Context.Provider value={{cases,set:(id,s)=>update(previous=>({...previous,[id]:s}))}}>{children}</Context.Provider>;
}
export const usePurchaseScenarios = () => useContext(Context);
export function usePurchaseScenario(deal:import("@/lib/types").DealProps) {
  const {cases,set}=usePurchaseScenarios();
  return { scenario:cases[deal.deal_id] || preferredScenario(deal), update:(s:PurchaseScenario)=>set(deal.deal_id,s) };
}
