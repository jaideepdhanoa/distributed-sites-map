import { z } from "zod";
import { fields,keys,type Key,type Inputs } from "./model";
const bounds=Object.fromEntries(keys.map(k=>[k,z.number().finite().min(fields[k].min).max(fields[k].max).nullable()])) as Record<Key,z.ZodNullable<z.ZodNumber>>;
const date=z.union([z.literal(""),z.iso.date()]);
const inputs=z.strictObject({
  values:z.strictObject(bounds), evidence:z.partialRecord(z.enum(keys as [Key,...Key[]]),z.strictObject({
    status:z.enum(["assumed","quoted","verified"]),source:z.string().max(400),date
  }).refine(e=>e.status==="assumed" || Boolean(e.source.trim() && e.date),"Quoted or verified inputs need a dated source.")),
  layout:z.string().min(1).max(240),rights:z.enum(["unknown","controlled","unavailable"]),rightsSource:z.string().max(400),
  terms:z.enum(["purchase","lease"]),comparator:z.enum(["workbook","local"]),energyScope:z.enum(["included","excluded"]),
  openEarly:date,openLate:date,depotDate:date,allOptionsReviewed:z.boolean(),
}).refine(c=>!c.openEarly || !c.openLate || c.openEarly<=c.openLate,"Opening dates are reversed.")
.refine(c=>c.comparator!=="workbook" || c.energyScope==="excluded","The workbook proxy excludes electricity.")
.refine(c=>c.rights==="unknown" || Boolean(c.rightsSource.trim()),"Document the rights evidence.")
.refine(c=>c.values.stalls===null || Number.isInteger(c.values.stalls),"Stalls must be a whole number.");
export const saveSchema=z.strictObject({id:z.uuid(),requestId:z.uuid(),base:z.number().int().nonnegative(),name:z.string().trim().min(1).max(80),
  sourceRevision:z.string().regex(/^[a-f0-9]{16}$/), expectedSelection:z.string().max(70).nullable(),select:z.boolean(),inputs});
export const validateInputs=(v:Inputs)=>inputs.safeParse(v);
