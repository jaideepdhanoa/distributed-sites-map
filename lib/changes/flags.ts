export type ShadowEntity = "stage" | "activity" | "comms";

const READ_FLAG: Record<ShadowEntity, string> = {
  stage: "READ_STAGES_FROM_DB",
  activity: "READ_ACTIVITY_FROM_DB",
  comms: "READ_COMMS_FROM_DB",
};

function enabled(value: string | undefined): boolean | null {
  const text = value?.trim().toLowerCase();
  if (text === "1" || text === "true" || text === "on") return true;
  if (text === "0" || text === "false" || text === "off") return false;
  return null;
}

/**
 * Production writes stay off until CHANGES_API_ENABLED is set.
 * Preview turns them on. Local runs and tests turn them on so the API can be exercised.
 */
export function changesApiEnabled(): boolean {
  const explicit = enabled(process.env.CHANGES_API_ENABLED);
  if (explicit !== null) return explicit;
  if (process.env.VERCEL_ENV === "production") return false;
  return true;
}

export function readFlagRequested(entity: ShadowEntity): boolean {
  return enabled(process.env[READ_FLAG[entity]]) === true;
}

/**
 * A cutover is both flags. A read flag alone leaves the site on the snapshot
 * and leaves the workbook import running.
 */
export function readEntityFromDb(entity: ShadowEntity): boolean {
  return readFlagRequested(entity) && changesApiEnabled();
}

/** While the database is the record, the sync stops copying that entity. */
export function importEntityFromWorkbook(entity: ShadowEntity): boolean {
  return !readEntityFromDb(entity);
}

export function readFlags(): Record<ShadowEntity, { requested: boolean; active: boolean }> {
  return {
    stage: { requested: readFlagRequested("stage"), active: readEntityFromDb("stage") },
    activity: { requested: readFlagRequested("activity"), active: readEntityFromDb("activity") },
    comms: { requested: readFlagRequested("comms"), active: readEntityFromDb("comms") },
  };
}
