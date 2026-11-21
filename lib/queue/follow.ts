import type { Sql } from "@/lib/actions/db";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { getUsers } from "@/lib/users";

export async function setFollow(sql: Sql, userId: string, siteId: string, follow: boolean): Promise<void> {
  if (follow) {
    await sql.query(
      `INSERT INTO queue_follows (user_id, site_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, siteId],
    );
    return;
  }
  await sql.query(`DELETE FROM queue_follows WHERE user_id = $1 AND site_id = $2`, [userId, siteId]);
}

/** Commenting, proposing, deciding, or being assigned follows the site. The quarantined site never follows. */
export async function autoFollow(sql: Sql, userId: string, siteId: string): Promise<void> {
  const id = userId.trim().toLowerCase();
  const site = siteId.trim();
  if (!id || !site || isExcludedSite(site)) return;
  if (!getUsers().some((user) => user.u === id)) return;
  await setFollow(sql, id, site, true);
}
