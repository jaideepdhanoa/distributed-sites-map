"use client";
import {useEffect,useState} from "react";

export function LedgerNumber({label,value,valid,onValue}:{label:string;value:number|null;valid:(n:number)=>boolean;onValue:(n:number)=>void}){
  const [entry,setEntry]=useState(value?.toString()??"");
  useEffect(()=>setEntry(value?.toString()??""),[value]);
  const invalid=entry!=="" && !valid(Number(entry));
  return <label className="ledger-number">{label}<input type="number" className="field" step="any" value={entry} aria-invalid={invalid}
    onChange={e=>{const raw=e.target.value;setEntry(raw);if(raw!=="" && valid(Number(raw)))onValue(Number(raw));}}
    onBlur={()=>setEntry(value?.toString()??"")}/>{invalid && <small>Enter a valid amount.</small>}</label>;
}
