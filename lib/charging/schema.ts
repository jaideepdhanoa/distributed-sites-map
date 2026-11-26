import { downsideKeys,type DownsideKey } from "./merit";
import { z } from "zod";
import { fields,keys,type Key,type Inputs } from "./model";
const bounds=Object.fromEntries(keys.map(k=>[k,z.number().finite().min(fields[k].min).max(fields[k].max).nullable()])) as Record<Key,z.ZodNullable<z.ZodNumber>>;
const date=z.union([z.literal(""),z.iso.date()]);
const amount=z.number().finite().min(0).max(1e10).nullable();
const ranking=z.strictObject({
  valuationDate:date.optional(),
  schedule:z.strictObject({key:z.string().max(120),source:z.string().max(400),
    flows:z.array(z.strictObject({date,without:amount,withSite:amount})).max(120)}).optional(),
  source:z.string().max(400),date,needBy:date,pool:z.string().max(120),
  avoided:amount,annualNeed:amount,peakNeed:amount,checkDays:amount,checkCost:amount,
  downside:z.strictObject(Object.fromEntries(downsideKeys.map(k=>[k,z.number().finite().min(fields[k].min).max(fields[k].max).optional()])) as Record<DownsideKey,z.ZodOptional<z.ZodNumber>>)
}).refine(n=>n.downside.stalls==null || Number.isInteger(n.downside.stalls),"Downside stalls must be whole.");
const key=z.enum(keys as [Key,...Key[]]);
const evidence=z.strictObject({status:z.enum(["assumed","quoted","verified"]),source:z.string().max(400),date,url:z.url().startsWith("https://").max(2500).optional(),reviewer:z.string().max(160).optional()})
  .refine(e=>e.status==="assumed" || Boolean(e.source.trim() && e.date),"Quoted or verified inputs need a dated source.");
const inputs=z.strictObject({
  ranking:ranking.optional(),
  values:z.strictObject(bounds),evidence:z.partialRecord(key,evidence),
  sourceValues:z.partialRecord(key,z.strictObject({value:z.number().finite().nullable(),evidence})).optional(),
  layout:z.string().min(1).max(240),rights:z.enum(["unknown","controlled","unavailable"]),rightsSource:z.string().max(400),rightsDate:date,
  comparable:z.boolean(),sensitivityPct:z.number().finite().min(1).max(100),terms:z.enum(["purchase","lease"]),comparator:z.enum(["workbook","local"]),energyScope:z.enum(["included","excluded"]),
  openEarly:date,openLate:date,depotDate:date,allOptionsReviewed:z.boolean(),peakDay:z.enum(["weekday","weekend"]),temporaryEnd:date,temporarySource:z.string().max(400),
}).refine(c=>Object.entries(c.sourceValues??{}).every(([name,source])=>{
  const k=name as Key;
  return (source.value===null || (source.value>=fields[k].min && source.value<=fields[k].max && (k!=="stalls" || Number.isInteger(source.value)))) &&
    (c.evidence[k]?.status??"assumed")==="assumed";
}),"An override needs a valid source observation and an assumed case value.")
.refine(c=>!c.openEarly || !c.openLate || c.openEarly<=c.openLate,"Opening dates are reversed.")
.refine(c=>c.comparator!=="workbook" || c.energyScope==="excluded","The workbook proxy excludes electricity.")
.refine(c=>c.rights==="unknown" || Boolean(c.rightsSource.trim() && c.rightsDate),"Add a dated source for the rights evidence.")
.refine(c=>c.values.stalls===null || Number.isInteger(c.values.stalls),"Stalls must be a whole number.");
export const saveSchema=z.strictObject({id:z.uuid(),requestId:z.uuid(),base:z.number().int().nonnegative(),name:z.string().trim().min(1).max(80),
  sourceRevision:z.string().regex(/^[a-f0-9]{24}$/), expectedSelection:z.string().max(70).nullable(),select:z.boolean(),inputs});
export const validateInputs=(v:Inputs)=>inputs.safeParse(v);
