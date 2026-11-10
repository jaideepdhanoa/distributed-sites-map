/** Planning rates for the admin estimate. Update when the invoice rate changes. */
export const ASK_PRICE = { inputPerMillion: 3, outputPerMillion: 15 };

export function estimateCost(promptTokens: number, completionTokens: number): number {
  const input = Math.max(0, promptTokens) * (ASK_PRICE.inputPerMillion / 1_000_000);
  const output = Math.max(0, completionTokens) * (ASK_PRICE.outputPerMillion / 1_000_000);
  return Math.round((input + output) * 1_000_000) / 1_000_000;
}
