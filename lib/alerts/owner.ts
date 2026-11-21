/** The owner account. Follow-all and the instant-cap exemption apply to this login only. */
export const OWNER_ID = "jaideep";

export function isOwnerAccount(userId: string | null | undefined): boolean {
  return String(userId || "").trim().toLowerCase() === OWNER_ID;
}
