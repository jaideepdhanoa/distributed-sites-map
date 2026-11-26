import type { DealProps } from "./types";

type Amounts<K extends string> = Record<K, number | null>;
export type PurchaseInputs = Amounts<"ask"|"revenue"|"ebitda"|"normalized"|"cash"|"charge"|"allowance"|"ceiling"|"landCap"|"walkAway"|"required"|"networkCost"|"stalls"|"fit"|"cars"|"priorCars"|"priorRevenue"|"memberShare"|"claim"|"screeningPrice"> & {
  periods?: Partial<Record<"ebitda"|"normalized"|"revenue",string>>; claimLabel: string; status: string; package: string; open: string; archetype: string; ownership: string; checked: string; textInputs: string[];
};
export type PurchaseAssumptions = Amounts<"closing"|"upkeep"|"oversight"|"capital"|"margin"|"target"|"lower"|"hub"|"horizon"|"demand"|"defaultStalls"|"sharedStalls">;
export type PurchaseData = { inputs: PurchaseInputs; assumptions: PurchaseAssumptions; layout?: {revision:string; zones:string[]}; };
export type PurchaseBasis = "workbook" | "normalized";
export const purchaseLabels = ["Financial evidence", "Retained annual cash", "Annual capital charge", "Annual surplus or shortfall", "Business-supported price", "Network target ceiling", "Purchase check"] as const;
export const amount = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});
export function financialEvidence(d: DealProps) {
  const w = d.purchase?.inputs;
  if (d.kind === "land" || d.figures_status === "vacant" || d.financials_open === false) return "Not applicable";
  const pkg = w?.package || d.package_status || "";
  if (/refus|unavailable/i.test(pkg) || d.figures_status === "withheld") return "Withheld";
  if (d.statementCoverage === "present") return "P&L captured";
  if (w?.normalized != null) return "Recast on file";
  if (/receiv|partial|on file/i.test(pkg)) return "Package on file";
  if (w?.claim != null || d.stated_cash_flow != null || d.stated_revenue != null || w?.revenue != null) return "Figures on file";
  if (/request/i.test(pkg)) return "Package requested";
  return d.statementCoverage === "unavailable" ? "Statement lookup unavailable" : "No figures on file";
}
export type Sensitivity = {
  basis: PurchaseBasis; lostCash: number; upgrade: number; downtime: number;
};
export const baseCase: Sensitivity = {basis:"workbook",lostCash:0,upgrade:0,downtime:0};
export function purchaseCase(data: PurchaseData, scenario: Sensitivity) {
  const {inputs:w, assumptions:a} = data;
  const basis = scenario.basis;
  const open = !(/^no$/i.test(w.open) || (!w.open && /land only/i.test(w.archetype)));
  const ebitda = basis === "normalized" ? w.normalized : w.ebitda;
  const inferredRevenue = w.revenue == null && ebitda != null && a.margin != null && a.margin > 0;
  const revenue = w.revenue ?? (inferredRevenue ? Math.max(0,ebitda!) / a.margin! : null);
  const upkeep = revenue != null && a.upkeep != null ? revenue * a.upkeep : null;
  const rebuilt = !open ? 0 : ebitda != null && upkeep != null && a.oversight != null ? ebitda - upkeep - a.oversight : null;
  // Preserve the workbook output, including blanks when a cell was stored as text.
  const base = basis === "workbook" ? w.cash : rebuilt;
  const cash = base == null ? null : base - (open ? scenario.lostCash : 0);
  const factor = a.closing != null && a.capital != null && a.capital > 0 ? (1+a.closing)*a.capital : null;
  const charge = w.charge;
  const cashPrice = cash != null && factor && factor > 0 ? Math.max(0,cash) / factor : null;
  const extraAnnual = scenario.upgrade === 0 ? 0 : a.capital != null ? scenario.upgrade * a.capital : null;
  const gap = cash != null && charge != null && extraAnnual != null ? cash - charge - extraAnnual : null;
  const layoutStalls = w.stalls ?? (/shared/i.test(w.archetype) ? a.sharedStalls : a.defaultStalls);
  const sites = layoutStalls && layoutStalls > 0 && a.demand ? Math.ceil(a.demand/layoutStalls) : null;
  function price(allowance: number | null) {
    return cash != null && allowance != null && extraAnnual != null && factor && factor > 0 ? Math.max(0, cash + allowance - extraAnnual) / factor : null;
  }
  function atTarget(target: number | null) {
    return a.hub != null && w.networkCost != null && sites && a.horizon && target != null
      ? price(((1-target)*a.hub-w.networkCost)/(sites*a.horizon)) : null;
  }
  const ceiling = basis === "workbook" && !scenario.lostCash && !scenario.upgrade ? w.ceiling : price(w.allowance);
  const firstYear = cash == null ? null : cash - Math.max(0,cash)*scenario.downtime/12;
  return {ebitda, revenue, inferredRevenue, upkeep, cash, charge, gap, cashPrice, ceiling,
    lower:atTarget(a.lower), breakeven:atTarget(0), walkAway: ceiling == null || w.landCap == null ? null : Math.min(ceiling,w.landCap),
    firstYear, extraAnnual, open};
}

export function purchaseCheck(d:DealProps) {
  const w = d.purchase?.inputs;
  if (financialEvidence(d) === "Not applicable") return "Not applicable";
  if (!w) return "Check financial inputs";
  if (w.normalized != null && (w.ebitda == null || Math.abs(w.normalized-w.ebitda)>1)) return "Reconcile earnings basis";
  if (w.cash == null) return "Establish annual operating cash";
  if (w.ask == null || w.charge == null) return "Confirm asking price";
  if (d.asking_price != null && Math.abs(d.asking_price-w.ask)>1) return "Reconcile asking price";
  if (!/^yes$/i.test(w.ownership)) return "Confirm purchase scope";
  if (w.fit == null || w.fit <= 0 || w.stalls == null || w.stalls <= 0 || w.stalls>w.fit) return "Confirm usable layout";
  return "Check retained operations and lease terms";
}
export function purchaseRows(d:DealProps, scenario:PurchaseScenario=preferredScenario(d)) {
  const w=d.purchase?.inputs;
  const result=d.purchase ? purchaseCase(d.purchase,scenario) : null;
  const applicable = financialEvidence(d) !== "Not applicable";
  const values = [financialEvidence(d), result?.cash, result?.charge, result?.gap, result?.cashPrice, result?.ceiling, purchaseCheck(d)];
  return purchaseLabels.map((label,i)=>{
    const v=values[i];
    const basis = [scenario.basis,w?.periods?.[scenario.basis==="normalized"?"normalized":"ebitda"] || "Period unknown",w?.checked || "Date unrecorded",w?.archetype || "Default layout",w?.ownership || "Scope unknown",w?.status || "Unclassified"].join(" · ");
    return {label,key:applicable ? v ?? null : null,value:!applicable ? "Not applicable" : typeof v==="string" ? v : amount(v),
      basis:i>0 && i<6 ? basis : "",source:"Pipeline workbook · "+scenario.basis+" case"};
  });
}

export type PurchaseScenario = Sensitivity & {layout:string};
export const originalScenario: PurchaseScenario = {...baseCase, layout:""};
export function preferredScenario(d:DealProps):PurchaseScenario {
  return d.purchase?.inputs.normalized!=null ? {...originalScenario,basis:"normalized"} : originalScenario;
}
export function scenarioAnchor(s:PurchaseScenario) {
  return ["v1",s.basis,s.lostCash,s.upgrade,s.downtime,s.layout].join("|");
}
export function readScenario(anchor:string):PurchaseScenario|null {
  if (!anchor || anchor.length>180) return null;
  const [v,basis,loss,cost,months,layout,...rest] = anchor.split("|");
  if (rest.length || v!=="v1" || (basis!=="workbook" && basis!=="normalized") ||
      ![loss,cost,months].every(x=>/^\d{1,11}(?:\.\d{1,2})?$/.test(x)) || Number(months)>12 ||
      layout===undefined || (layout!=="" && !/^[a-f0-9]{12}\.\d{1,2}$/.test(layout))) return null;
  return {basis,lostCash:Number(loss),upgrade:Number(cost),downtime:Number(months),layout};
}
export function layoutName(d:DealProps,s:PurchaseScenario) {
  if (!s.layout) return "Workbook setup";
  const [rev,index]=s.layout.split(".");
  const layout=d.purchase?.layout;
  return layout?.revision===rev && layout.zones[Number(index)] ? layout.zones[Number(index)] : "Footprint changed";
}
export function scenarioFigure(d:DealProps,s:PurchaseScenario) {
  const w=d.purchase?.inputs;
  if (!w || !d.purchase || layoutName(d,s)==="Footprint changed") return null;
  const result=purchaseCase(d.purchase,s);
  const period=w.periods?.[s.basis==="normalized"?"normalized":"ebitda"] || "Annual input · period unconfirmed";
  const basis=(s.basis==="normalized"?"Normalized EBITDA":"Workbook EBITDA")+" · "+layoutName(d,s);
  const a=d.purchase.assumptions;
  // All selected assumptions and outputs are compared when a saved decision is reopened.
  const value = result.cash==null ? "—" : [amount(result.cash)+"/yr retained",amount(result.gap)+"/yr at ask",
    amount(result.firstYear)+" first year",amount(result.ceiling)+" target ceiling",
    purchaseCheck(d),
    "Capital "+(a.capital==null?"unknown":(100*a.capital)+"%")+", closing "+(a.closing==null?"unknown":(100*a.closing)+"%"),
    "Upkeep "+(a.upkeep==null?"unknown":(100*a.upkeep)+"%")+", oversight "+amount(a.oversight),
    [w.status,w.checked,financialEvidence(d),w.ownership,w.archetype,w.fit==null?"Fit unconfirmed":w.fit+" fit"].filter(Boolean).join(" · ")].join(" · ");
  const source=["Pipeline workbook",w.checked,s.basis==="normalized"?"Normalized EBITDA":"EBITDA",w.periods?.revenue,
    "Lost contribution "+amount(s.lostCash)+"/yr","Additional upgrade "+amount(s.upgrade),"Interruption "+s.downtime+" mo"].filter(Boolean).join(" · ");
  return {value,period,basis,source,anchor:scenarioAnchor(s)};
}
