import { readGeneratedOptional } from "./snapshot/read";
import type { PurchaseAssumptions, PurchaseInputs } from "./purchaseReview";
type File = { version:number; assumptions:PurchaseAssumptions; sites:Record<string,PurchaseInputs> };
export function purchaseFile() {
  const data = readGeneratedOptional("purchase-review.json") as File | undefined;
  return data?.version === 1 && data.assumptions && data.sites ? data : null;
}
