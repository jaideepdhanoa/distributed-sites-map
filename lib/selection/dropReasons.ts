import { tagFamily } from "../tags/vocab";

export const dropReasons = [
  ...(tagFamily("drop_reason")?.codes ?? []).map(({code, label}) => ({code, label})),
  {code: "business_excluded", label: "Operating business excluded"},
  {code: "property_excluded", label: "Property rights excluded"},
  {code: "seller_unreachable", label: "Seller unreachable"},
];

export function isDropReason(value: string) {
  return dropReasons.some(reason => reason.label === value);
}
