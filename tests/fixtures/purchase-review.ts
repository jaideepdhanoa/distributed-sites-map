import type { PurchaseData } from "../../lib/purchaseReview";

// Entirely synthetic. The private workbook is only processed by the normal sync.
export const example: PurchaseData = {
  inputs: {
    ask: 800000, revenue: 500000, ebitda: 100000, normalized: 80000,
    cash: 65000, charge: 88000, allowance: 20000, ceiling: 772727, landCap: 600000,
    walkAway: 600000, required: null, networkCost: 1000000, fit: 4, stalls: 4, cars: null,
    priorCars: null, priorRevenue: null, memberShare: null, claim: 120000, screeningPrice: null,
    periods: { normalized: "FY 2030", ebitda: "Seller estimate" }, claimLabel: "Seller SDE",
    status: "Claimed", package: "Received", open: "Yes", archetype: "Shared site", ownership: "Yes",
    checked: "", textInputs: [],
  },
  assumptions: { closing: .1, upkeep: .05, oversight: 10000, capital: .1, margin: .2,
    target:.3, lower:.15, hub:2000000, horizon:10, demand:8, defaultStalls:8, sharedStalls:4 },
  layout: { revision:"abcdef123456", zones:["Excess parking"] },
};
