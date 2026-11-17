# Sites

Private map of the site-sourcing universe for Phoenix, Las Vegas, and Miami. Sign-in is required. Generated data is not placed in `/public`.

Raw inputs stay in `data/source/` on your machine. That folder is gitignored. The repo only keeps the sanitized files under `data/generated`.

## Setup

```bash
npm install
python3 -m pip install -r requirements.txt
# Put the workbook, census CSV, depot file, and service-area KMZ files in data/source/
npm run build-data
npm run dev
```

`npm run build` produces a production build. Do not put passwords, hashes, or tokens in the repo.

## Environment variables

Set these in Vercel. A change applies on the next deployment.

| Variable | Required | Purpose |
|---|---|---|
| `AUTH_USERS` | yes | JSON list. Each object is `{"u":"jaideep","h":"<bcrypt>","role":"admin"}` or `"role":"user"`. |
| `AUTH_SECRET` | yes | Signs the session cookie. Changing it signs everyone out. |
| `KV_REST_API_URL` | yes on Vercel | Upstash Redis from the Marketplace integration. Login lockout. |
| `KV_REST_API_TOKEN` | yes on Vercel | Pair to the URL above. |
| `UPSTASH_REDIS_REST_URL` | alternative | Used when `KV_REST_API_URL` is unset. |
| `UPSTASH_REDIS_REST_TOKEN` | alternative | Pair to the Upstash URL. |
| `RESEND_API_KEY` | injected | Resend API key from the Vercel integration. |
| `RESEND_EMAIL_DOMAIN` | injected | Verified domain from that integration. `distributedsites.com`. |
| `ALERT_FROM` | no | Overrides From. When unset, From is `Distributed Sites <alerts@${RESEND_EMAIL_DOMAIN}>`. |
| `APP_URL` | no | Host for links in alert mail. Defaults to `https://distributedsites.com`. |
| `ALERT_REPLY_TO` | no | Reply-To. Defaults to `jaideep@dhanoa.in`. |
| `ALERT_EMAILS` | no | JSON map of username to mailbox. Overrides the optional `email` on an account. |
| `SMTP_USER` | fallback | Gmail address, used only when `RESEND_API_KEY` is unset. |
| `SMTP_PASS` | fallback | Google app password for that mailbox. |
| `CRON_SECRET` | for the digest | Bearer token Vercel Cron sends to the alert routes and to the workflow dispatch routes. It does not authenticate the agent feed. The workbook sync uses the same value, stored as a GitHub secret, to refresh the snapshot cache. Do not rotate it for the dispatch routes. |
| `GITHUB_DISPATCH_TOKEN` | for the schedule | Fine-grained GitHub token with Actions read and write on this repository only. Vercel Cron uses it to start Workbook sync and Alert flush. Set it in Vercel. Do not commit it. |
| `SNAPSHOT_READ` | no | Set to `off` to ignore Neon and serve `data/generated`. The default reads a live snapshot when one exists. |
| `AGENT_INBOX_SECRET` | for the agent feed | Bearer token for `GET /api/agent/inbox`, the ack route, and recommendation writes. Separate from `CRON_SECRET`. |
| `AGENT_WRITE_TOKEN_INDIE` | for Indie writes | Bearer token for `POST /api/changes`. The actor stored on the event is `indie`. |
| `AGENT_WRITE_TOKEN_MUSE` | for Muse writes | Bearer token for `POST /api/changes`. The actor stored on the event is `muse`. |
| `CHANGES_API_ENABLED` | off on production | Set to `1` to allow `POST /api/changes` in production. Preview allows writes when this is unset. Also set the GitHub repository variable of the same name. |
| `READ_STAGES_FROM_DB` | off | When `1`, and writes are on, deal stages are read from `site_stages`. Also set the GitHub repository variable of the same name. |
| `READ_ACTIVITY_FROM_DB` | off | When `1`, and writes are on, activity lines are read from `activities`. Also set the GitHub repository variable of the same name. |
| `READ_COMMS_FROM_DB` | off | When `1`, and writes are on, the comms log is read from `comms_entries`. Also set the GitHub repository variable of the same name. |
| `READ_SITES_FROM_DB` | off | When `1`, and writes are on, pipeline and land site fields are read from `sites`. Also set the GitHub repository variable of the same name. |
| `XAI_API_KEY` | for Ask | Direct xAI key. Ask stays in the "isn't set up yet" state until this is set. Not an AI Gateway key. |
| `ASK_MODEL` | no | Ask model. Defaults to `grok-4.7`. |
| `ASK_DAILY_LIMIT` | no | Questions per person per Pacific day. Defaults to 40. Counted in Upstash Redis. |
| `GMAIL_LINK_VIEWERS` | no | Comma-separated usernames or mailboxes who may see an Open in Gmail link. When unset, `config/comms.json` is the list. |
| `AI_GATEWAY_API_KEY` | for the backfill script | Vercel AI Gateway key used by `npm run search-backfill` on a machine that is not a Vercel deployment. Deployed functions use the project OIDC token instead. Never print or commit the key. |

Planned accounts, none created here: `jaideep` (admin), `cindel`, `ming`, `ricardo`, `yuka`, `muse`, `indie`. Admin only opens the accounts page. Everyone else sees the same map.

On Vercel, sign-in refuses to run if neither Redis pair is set. Locally, without Redis, lockout is skipped.

## Functions

Vercel is on a paid plan, which is what lets cron run every few minutes. The search embed cron runs every 15 minutes and the stale feed sweep runs daily. The deployment still stays small. Vercel packs routes into a function until the traced files approach the size limit, then starts another function. `data/generated/photos` is large enough that tracing it into every route splits the deployment past 12 functions, and a workbook sync then fails to deploy.

API handlers live in `lib/api/handlers` and are served by one catch-all, `app/api/[...route]/route.ts` (`runtime` nodejs, `maxDuration` 300, which covers the digest cron). Photo bytes stay on `app/api/data/photos/[id]` (`maxDuration` 60) so they are not copied into the other function. `outputFileTracingExcludes` drops the photo directory from routes that do not serve images. `outputFileTracingIncludes` adds the generated files and SQL migrations those routes read. The cron paths are `/api/alerts/digest`, `/api/cron/workbook-sync`, `/api/cron/alert-flush`, `/api/cron/search`, and `/api/cron/stale`. The map worker stays a static route.

To add a route, register it in `lib/api/dispatch.ts` and put the handler under `lib/api/handlers`. Do not add another `app/api/**/route.ts` unless that route needs its own file trace or its own `maxDuration`. A separate route file is its own function once the trace no longer fits in an existing group. `node scripts/check-function-count.mjs` fails when a `vercel build` produces more than 10 Node.js functions, leaving room under that cap.

## Actions

Notes, suggestions, and saved views need Postgres. Without `DATABASE_URL` the map stays read-only and those controls stay hidden. The app never writes to the workbook or the Google Sheet, and it never edits `data/generated`. It reads the newest live workbook snapshot when Neon has one, and otherwise reads the committed files. An accepted stage change is drawn over the generated stage so the map, the funnel counts, and the site card update immediately. Pending proposals are not drawn. When a later sync's stage matches, the decision is marked `applied` and the overlay stops. If that sync shows a different stage than the one the decision was made against and the one it approved, the workbook stage wins. The waiting note (`Moved to <stage> by <name>, waiting for workbook`) is on the site card for signed-in viewers, where names are already shown. Drop reasons stay on the activity line. The map pin takes the new stage color and does not add the name or the reason.

### Neon

1. In the Vercel project, add the Neon integration from the Marketplace (or create a Neon database and connect it). This repo does not provision the database.
2. Use the pooled connection string. Neon exposes it as `DATABASE_URL`. Do not commit that string.
3. Redeploy. On a preview or local database, the first notes, suggestions, or saved-view request applies `db/migrations`. Production does not. Run the **Production migrations** workflow and type `migrate-production`. `npm run db:migrate` applies pending files only when `DATABASE_URL` is not the production database.
4. After a workbook sync rebuilds `data/generated`, run `npm run reconcile-suggestions`. The suggestions panel also checks on open. A suggestion becomes `applied` only when the generated data already matches the proposed value. An accepted stage move, drop, or bring-back is shown on the map until that match. The app does not write the new stage into the workbook.

### Workbook snapshots

Workbook sync writes `data/generated` into Neon after the same checks that used to gate the bot pull request (the data checks, the internal-wording guard inside the build, and the universe-row check). The site reads that live snapshot at request time. The read is cached for about five minutes (`unstable_cache` plus `revalidateTag`), and the job busts the cache when the write succeeds, so a page view does not query Neon on every request. If Neon is down or has no live snapshot, the site serves the committed files. The signed-in routes for financials, the NDA queue, the email timeline, open loops, and the Gmail link are unchanged.

GitHub secret `NEON_DATABASE_URL` is the production pooled connection string. Put it on the repository, not in Vercel, and do not commit it. The app reads `DATABASE_URL` only. If `NEON_DATABASE_URL` is missing, the job prints a notice, skips the write, and still opens a pull request. GitHub secret `CRON_SECRET` must match the Vercel `CRON_SECRET`. The job sends `Authorization: Bearer` to `POST /api/data/revalidate` on `https://distributedsites.com`. The sign-in proxy allows that Bearer header through, and the handler checks the secret. If that secret is missing, the job continues and the cache expires on its own within about five minutes.

The schedule is every 15 minutes. A run takes about 7 minutes, and the concurrency group `workbook-sync` waits for the current run instead of starting a second one. GitHub has been starting that schedule hours late. Production Vercel Cron calls `GET /api/cron/workbook-sync` every 15 minutes and starts the same workflow with `workflow_dispatch`. The route checks `CRON_SECRET`. It uses `GITHUB_DISPATCH_TOKEN` for the GitHub API. If a run of that workflow is already queued or in progress, the route starts nothing and logs that run id. A start logs the new run id. The log does not include the token or the workbook. The `*/15` line in the workflow stays as the backup. Vercel Cron runs only on the production deployment.

After the rebuild, the job hashes the generated json, geojson, and csv files, the same files a snapshot stores. The last published digest is kept in the GitHub Actions cache under the prefix `workbook-sync-published-`. It is not stored in Neon and it is not committed. Restoring that cache does not open a database connection. When the new digest matches, the job skips the publish and the cache refresh and exits successfully. GitHub drops a cache that is not restored for 7 days. An unchanged sheet restores it on every run, so the entry stays. If the cache is missing, the job reads the live snapshot's file hashes once, still skips the write when they match, and then saves the cache. That save still runs when a later step is cancelled, so a cancelled mirror does not publish the same snapshot again. The mirror writes its `runs` row before it changes cells, and a cancel updates that row when the process can still reach the database.

The Pipeline workbook is exported once per run. Drive `files.export` costs 200 quota units. Ninety-six runs a day is 19,200 units, against a per-user cap of 325,000 units a minute and a daily billing threshold of 400,000,000 units. The inputs folder can add one export when reconciliation is a native Sheet. That remains a small fraction of the quota. The hash does not export the Sheet again. This repository is public and the job uses `ubuntu-latest`, a standard runner. Standard runners are free on public repositories, so those minutes are not billed. A larger runner would be billed.

A failed data check does not publish and does not open a new pull request. When an open sync pull request has only `github-actions[bot]` commits since main, the failed run updates that branch. It does not force-push over anyone else's commits. An unchanged hash does not open a pull request.

The repository variable `WORKBOOK_SYNC_OPEN_PR` defaults to unset, which means a successful database write does not open a pull request. Set it to `true` to keep opening that pull request as well.

To roll back to files:

1. Set `WORKBOOK_SYNC_OPEN_PR` to `true`, or remove `NEON_DATABASE_URL`, so the next sync opens a pull request again.
2. Set Vercel `SNAPSHOT_READ` to `off` and redeploy. The site then ignores Neon.
3. Merge the sync pull request so `data/generated` is current.

To see which snapshot is live, sign in and request `GET /api/actions/status`. The JSON includes `snapshot_id`, `snapshot_created_at`, and `snapshot_source` (`database` or `files`). `GET /api/data/funnel` repeats the id and time under `meta`. The Actions job summary prints them after a publish.

Preview deployments share one long-lived Neon branch named `preview`. Run **Reset preview database** and type `reset-preview-db` to copy production into that branch and point only the Vercel Preview `DATABASE_URL` at it. Preview data is a copy and can drift. See `docs/preview-database.md`. The sync job is the only writer of snapshots. It refuses to run inside Vercel, and it refuses to refresh any host other than the production site. A preview cannot publish a production snapshot. The job keeps every snapshot from the last 24 hours, and it always keeps at least the last 14. Fourteen snapshots at a publish every 15 minutes would be about three and a half hours. Unchanged runs no longer publish, so a quiet sheet's 14 rows can span days. A snapshot is about 1 MiB after compression. The generated files are about 8 MiB before that. A change on every run for a full day is about 100 MiB, and Neon Free allows 1 GB per project, so that day of history is cheap. A failed check or a failed write leaves the previous live snapshot in place. The sync does not apply migrations that are still pending on production. If `snapshots` is missing, the job stops and says to run the Production migrations workflow.

### Shadow events

Stage, activity, comms, and the core site record are stored in Neon. Write them through `POST /api/changes` or the signed-in site. The Pipeline workbook is a read-only mirror of that database. The scheduled sync does not copy sheet edits into Neon, and nothing except the workbook mirror writes the sheet. Production schema changes still go through the Production migrations workflow. Pull-request jobs and preview deployments do not migrate production.

When a site's stage becomes Dropped, each still-open proposal on that site is closed. The assignee or an admin can also close one from the proposal block. That close does not change Stage. Proposals already sitting on Dropped sites are closed by a one-off script. Dry run is the default and prints proposal ids and site ids only:

```
npx tsx scripts/close-dropped-proposals.ts
```

Apply needs the confirm phrase, and a production write also needs `ALLOW_CLOSE_DROPPED_PROPOSALS=1` after that dry run has been read. The **Close dropped proposals** workflow is the same job, started by hand on `main`. Previews and pull-request jobs cannot write. Do not run an apply against production from a pull request. Apply migration `020_proposal_close.sql` with the Production migrations workflow before the app writes these closes.

`POST /api/changes` accepts one batch. Send `Idempotency-Key`. Each change has `entity_type` (`stage`, `activity`, `comms`, `site`, or `pnl_line`), `site_id`, `expected_version`, `source`, and `payload`. A new row uses `expected_version: 0` and omits `entity_id`. The server assigns `A-` activity ids, `CM-` comms ids, `PL-` P&L line ids, and `EV-` event ids. A site id is the `PIPE-` or `LAND-` id, not a minted id. An update sends the id the server already assigned and the `version` from the previous response. A mismatch is `409` with `conflicts`, and the whole batch is rolled back. The same key and the same body returns the original ids and does not write again.

A `pnl_line` change stores one captured profit-and-loss line. The first line for a period creates that period. Later lines for the same site, grain, and coverage must use the same business type. The server stores only the lines you send and does not fill a missing month. The sheet may label a total, EBITDA, SDE, or margin as Calculated when that figure is arithmetic on captured lines. Send only figures the package states, normalizes, or estimates. `amount` is a string such as `1000000`, `1000000.5`, or `1000000.50`, stored as sent, not a JSON number. `source_page` is a string. `captured_at` is required, an ISO-8601 time with a numeric offset or `Z`, stored exactly. `status` is `stated`, `reported`, `normalized`, or `estimated`. `stated` is stored as `reported`. A normalized line can sit beside the stated line for the same period. The exact payload, including a fake example for a month, a year, a range, a fiscal year, and a missing month, is in `docs/agent-api.md`. Muse sends `Authorization: Bearer` with `AGENT_WRITE_TOKEN_MUSE`. A contributor or reviewer session can write a line. Indie cannot. The line is not mirrored to the workbook.

```json
{
  "changes": [
    {
      "entity_type": "pnl_line",
      "site_id": "PIPE-LAS-9001",
      "expected_version": 0,
      "source": "Sample package",
      "payload": {
        "grain": "annual",
        "year": 2024,
        "business_type": "car_wash",
        "line": "labor",
        "amount": "500000",
        "status": "reported",
        "source_document": "Sample package",
        "source_page": "Sheet 2024",
        "captured_at": "2026-03-01T15:00:00-07:00"
      }
    }
  ]
}
```

`grain` is `annual` or `monthly`. A monthly line also sends `month` (1–12). An annual line may send `start_month` when the year does not start in January, `through_month` when the package stops at a month end, or `period_end` (`YYYY-MM-DD`) when it stops on a day inside a month. Two annual lines that share a start and differ by their end are different periods. A monthly line may send `missing: true` and omit `amount` when that month should have been in the package. `business_type` is `car_wash` or `auto_service`. `line` is one of `revenue_wash`, `revenue_membership`, `revenue_retail`, `revenue_service`, `revenue_parts`, `revenue_other`, `revenue`, `cogs`, `labor`, `utilities`, `chemicals`, `occupancy`, `repairs`, `marketing`, `ga`, `other`, `ebitda`, `noi`, `addback_owner_pay`, `addback_personal`, `addback_one_time`, `addback_other`. `source_page` is a string, the page or sheet name. `source_href` is optional and must be an `https` URL. The figures above are an example of the shape. They are not a site.

The tables are `pnl_periods` and `pnl_lines` in `db/migrations/014_pnl.sql`, extended by `db/migrations/018_pnl_basis.sql` and `db/migrations/019_pnl_retract.sql`. Muse can retract a line with a reason. The row and the change log stay. Other agents cannot. A disagreement between two sources is a `data_conflict` in `db/migrations/021_data_conflicts.sql`. Muse writes it through the changes API. The signed-in financials sheet, the site's open loops, and the morning brief count can see it. Production does not apply those files until the Production migrations workflow runs. Until then, a signed-in financials panel says the profit and loss is not on the database yet. A signed-out request never receives it.

A session cookie is a person. Activity, comms, and site content need contributor access. Stage changes need a reviewer. A viewer gets 403. `Dropped` needs a reviewer and a `reason`; the event records who dropped it and why. Moving a row off `Dropped` also needs a reason. Cookie writes must be same-origin (`Sec-Fetch-Site: same-origin`, or an `Origin` on the same host). Indie and Muse send `Authorization: Bearer` with `AGENT_WRITE_TOKEN_INDIE` or `AGENT_WRITE_TOKEN_MUSE`. An agent can write activity, comms, and site content. An agent cannot change a stage. A site change cannot set Stage. A new site does not accept Folder, photos, land evidence or land notes, typed power, check statuses, or financial claims. Every numeric site fact needs its own source. Do not invent token values and do not print them.

New API writes accept the canonical stages `1 Desk screen`, `2 Financial screen`, `3 Site checks`, `4 Offer and close`, and `Dropped`. Market is `PHX`, `LAS`, `MIA`, or `SNA`. Service area is `inside`, `near_0_5`, `near_5_10`, `outside`, `unknown`, or `edge_legacy`, stored as written. Comms direction is `in` or `out`. A comms row may use a blank site id or a listing id matching `L-` and digits. Any other site id is rejected.

`CHANGES_API_ENABLED` controls writes. On production it is off until you set it to `1`. Preview turns writes on by itself. A read flag does not cut the site over while writes are off.

| Variable | Default | Effect |
|---|---|---|
| `CHANGES_API_ENABLED` | off on production, on in preview | `POST /api/changes` |
| `READ_STAGES_FROM_DB` | off | Deal stages come from `site_stages`. |
| `READ_ACTIVITY_FROM_DB` | off | Timeline activity lines come from `activities`. |
| `READ_COMMS_FROM_DB` | off | The comms log comes from `comms_entries`. |
| `READ_SITES_FROM_DB` | off | Pipeline and land core fields come from `sites`. |

Each read flag chooses whether the site reads that entity from the database. The flag takes effect only when `CHANGES_API_ENABLED` is on. Turning a read flag off returns that read to the snapshot. It does not start copying sheet edits into the database. If Neon is down, that read falls back to the snapshot.

`CHANGES_API_ENABLED`, `READ_STAGES_FROM_DB`, `READ_ACTIVITY_FROM_DB`, `READ_COMMS_FROM_DB`, and `READ_SITES_FROM_DB` each have to be set in both places: Vercel Production, and a GitHub repository variable with the same name. The drift step and the mirror step read the GitHub variables. They cannot see the Vercel values. An unset GitHub `CHANGES_API_ENABLED` is passed as `0`, which is the production default. A read flag set only on Vercel does not change what the mirror copies.

After a snapshot is published, and only on `main`, Workbook sync compares the workbook with the database and prints counts and hashed ids. It does not write those rows into `events`. A hash match skips the publish and that comparison. The comparison still raises the activity and comms id floors from the ids on the sheet, so a later API id does not collide. It does not copy cell text. Legacy stage names (`Financial screen`, `Off-market target`, `Off market (no lead)`, `Sourced`) and `internal` comms stay as they were already stored. Unknown values are counted and are not rewritten into a known value.

**Shadow diff** is started by hand (`workflow_dispatch`). It reads production, compares the whole workbook with the shadow tables, and writes neither events nor the sheet. The summary and the `shadow-diff` artifact say `Clean: yes` or `Clean: no`, and `clean_by_entity` for stage, activity, comms, and site. An entity whose read flag is on is reported clean there, because that job was the cutover gate. The scheduled drift report is the check that still compares those entities, and it does not apply the workbook.

Current rows live in `site_stages`, `activities`, `comms_entries`, and `sites`, each with a `version`. History is append-only in `events`. The scorecard weights live in `scoring_config` version 1 and in `config/scorecard.json`: Economics 40, Land 25, Power 15, Location 10, Deal 10. Location points are Inside 10, Near 0-5 5, Near 5-10 2.5, Outside 0. Those weights are not applied to a stored score. `sites.score`, `sites.location_points`, `sites.economics_points`, `sites.land_points`, `sites.power_points`, and `sites.deal_points` stay the workbook numbers. Power points stay a workbook formula. The grade in that formula is derived in `lib/score/power-rating.ts` and stored on `sites.power_rating`. See `docs/scoring.md`.

`sites` is one row per Pipeline or Land Sites id. It holds the name, address, market, latitude and longitude, category, broker and firm, listing link, asking price, acreage, parcel or APN, county value and its basis, land value, improvement value, service-area class, distance, and polygon, miles to the depot, the public next step, photo references, the linked universe id, listing status, and the copied score. The published snapshot stores Muse's assessor figure as County value ($). It does not split that figure into land and improvement, so those two columns stay empty until a snapshot carries them. Financial claims, the NDA queue, the email timeline, and open loops stay on their signed-in reads. Package revenue and multiples stay visible to any signed-in user through the existing pricing overlay.

The sheet keeps Stage on the stage path, the Site label, Segment, Folder, and the financial columns. The mirror does not write those. An API edit of the broker replaces the person or the firm inside the current cell and leaves that cell's order alone. A placeholder that does not split is left unchanged. Firm is not its own column. Universe census rows and Listings Register rows stay in the snapshot. They are not `PIPE-` or `LAND-` ids. A deal still stores the universe id and the listing link it needs.

Workbook sync writes the raw Pipeline and Land Sites cells to `SITE_SHEET_PATH` (`/tmp/site_sheet.json` on the runner). That file is not committed, not published in the snapshot, and not served. The shadow diff builds the same private file when the sync secret is set, and does not upload it. Without that file, the diff skips the raw sheet, the next step, the address, the listing status, and the listing link, which are cleaned in the published deals. The drift check reads the private file and does not store the cells. A fresh database row leaves `sites.sheet_writes` empty, so the mirror plans no site writes. An API edit records only the allow-listed header it changed. Site tabs are read unformatted, and formula cells are skipped. Activity, stage, and comms tabs stay on the formatted values, so a date serial is not written back. Numeric and date site cells are written with `USER_ENTERED`. Text cells, including Stage, Activity, and Comms, are written with `RAW`. The public next step is cleaned the same way as the build: names, outreach, package files, and legal chatter stay off the card. Listing status `On hold` covers annotated cells such as `On hold - broker Nov 6: …`. The cell is stored as written.

Photo references, miles to the depot, the asking-price source, the open-land basis, parcel acres and match, and the source line are computed or joined, so they are not written back. Stalls that fit, Score, Economics points, Land points, Power points, Location points, Deal points, and Segment group are formulas and are never overwritten.

Workbook mirror copies database rows back to the Sheet for each entity whose read flag is on. It writes the Stage column on Pipeline and Land Sites, the site headers an API change touched, the Activity tab fields, and the Comms Log fields. Rows match on Site ID, Event ID, or Comms ID. New `A-` and `CM-` rows use the headers on the tab. It does not write other columns. It does not write Stage from a site change. It does not write the quarantined pipeline row, and it does not write row 10 on Pipeline or Land Sites. Activity and Comms Log can still use row 10, except a row for that quarantined site, which is skipped. Clearing an API field clears that cell. A filled date is not replaced with a blank. After a write it reads those cells back and fails if they differ. A `runs` row stores the counts. A cell that already has a value and differs from the database is drift. The run prints the cell count and hashed ids, and does not print the cell text. It then overwrites those cells with the database value. A database value that is only a prefix of the longer sheet cell is held: it is not written, and the log shows the count and hashed ids. Photo notes and the next step are capped at 400 characters on a write, and an activity summary at 300, while a sheet cell holds 50,000. Those caps, and the other mirrored text caps, are listed in `lib/changes/caps.ts`. That count includes a database change the sheet does not have yet and a hand edit. The next mirror does not keep the hand edit. An id that exists only on the sheet is left in place.

The 15-minute Workbook sync runs the mirror on `main` when the repository variable `WORKBOOK_MIRROR_ENABLED` is `1`, including a run whose snapshot hash did not change. **Workbook mirror** can also be started by hand. Its dry run is the default: it prints the planned cells and does not write, and it does not need `WORKBOOK_MIRROR_ENABLED`. A real write still needs that variable set to `1`. A pull request, a preview deployment, and any ref other than `main` are refused. The dispatch input `simulate_site_flag` sets `READ_SITES_FROM_DB=1` for that dry run only. The run fails when that input is on and dry run is off. The plan summary counts cells for site, stage, activity, and comms. Every cell in that public plan stays a hash, including stage, numeric, and date headers. The drift lines are counts and hashed ids. Those cutover flags, including `READ_SITES_FROM_DB`, have to match Vercel Production, as repository variables. An unset `CHANGES_API_ENABLED` is passed as `0`, so a read flag left on by itself does not start the mirror. The drift report still does not apply workbook rows. A dry run with `simulate_site_flag` still plans site cells when the API flag is off.

**Workbook protect** is started by hand and is off. Dry run is the default: it lists tab titles and writes nothing. It does not need a new secret. It uses `GOOGLE_SERVICE_ACCOUNT_JSON` with the same Sheets scope as the mirror. Apply needs `dry_run` false, `apply` true, and the confirm phrase `protect-workbook-readonly`, on `main`. That adds a whole-tab protected range on every tab except Rules & Decisions and Run Log, and sets the note `Read-only — edit in distributedsites.com` on A1. The note does not change the cell value. The mirror service account stays an editor of the protected tabs. The spreadsheet owner can still edit. Do not run apply until that dry run has been read.

**Capture import** is started by hand on `main`. It copies Activity rows of type capture into the production database and keeps each workbook id. Dry run is the default: it prints counts per site and a list of workbook id, site id, kind, and date. It does not print summaries, links, or prices, and it writes nothing. A write needs mode `write` and the confirm phrase `import-production`. The sheet is not written. `PIPE-PHX-0006` is left out. A date with no clock is stored as approximate, with the source `workbook capture import, row <id>`. A `runs` row records the mode, the count, the person, and the time. Re-running does not insert an id that is already stored. Muse can correct a stored row through `POST /api/changes`.

The sync secret is `GOOGLE_SERVICE_ACCOUNT_JSON`. The sync asks Google only for `https://www.googleapis.com/auth/drive.readonly`, so that token cannot edit cells. The mirror asks the same secret for `https://www.googleapis.com/auth/spreadsheets`. Writes work when the Pipeline workbook is shared with that service account as Editor. A Viewer share fails with a Sheets write error and no new secret name. There is no second credential.

Run **Reset preview database** and type `reset-preview-db`. That keeps a single Neon branch named `preview` and points only the Vercel Preview environment at it. Do not create one Neon branch per pull request. Preview data is a copy of production at the last reset and can drift. **Preview migrations** applies `db/migrations` to that branch when you type `migrate-preview`. If a preview fails with `Resource provisioning failed`, that is the Neon branch limit. The Neon preview branch cleanup workflow deletes the Neon branch named `preview/<pull request head ref>` when that pull request closes. Other open pull requests keep their preview branches. It never deletes the branch named `preview`, or a primary, default, protected, or production branch. An empty head ref deletes nothing. A manual run lists stale `preview/*` branches whose pull request is closed and deletes nothing unless dry run is turned off. It needs the secret `NEON_API_KEY` and the variable `NEON_PROJECT_ID`. Until those are set, the job skips and says so. Repository variable `NEON_PRODUCTION_HOST` is the production endpoint hostname only.

### Roles

Queue access is separate from the admin page. It is read from the account list, not from names in the code.

| Access | Can do |
|---|---|
| viewer | Read notes and suggestions. Save a personal view. Export the suggestion CSV. |
| contributor | Viewer, plus notes, replies, and proposals. Authors can edit or remove their own posts. |
| reviewer | Contributor, plus accept or reject an open suggestion, resolve a thread, and share a team view. |

Set it in either place:

- On one account: `"actionRole":"viewer"` inside that person's `AUTH_USERS` object. An optional `"name"` is the label shown in the owner list.
- For a whole role label: `ACTION_ROLE_MAP={"admin":"reviewer","user":"contributor"}`.

If you set neither, `admin` is a reviewer and `user` is a contributor. A bad `ACTION_ROLE_MAP` falls back to that default. The accounts page shows the resolved access. Every saved note, reply, edit, removal, suggestion, decision, saved view, and export is appended to `audit_log`.

Free text is checked before it is stored. Text that fails the same wording rules as the map is rejected and is not written. The rejection does not repeat the blocked text.

### Suggestion CSV

More → Suggestions → Download CSV. Apply those rows through the site or `POST /api/changes`. Do not type them into the workbook. The columns are the record, the field, the current value, the proposed value, the reason, and the status (`open`, `accepted`, `rejected`, or `applied`).

Approved next steps have their own download on that panel. Columns are the site id (the permanent id when the record has one), the target date, the title, the owner, when it was approved, and when it was marked done. Approving a work item does not change the stage. Approving a stage move, drop, or bring-back stores the stage in the database and updates the map. The workbook mirror copies it. Do not edit the Stage column. A later approval leaves the earlier one in the history on the card.

The owner of a next step, or a reviewer, can mark it Done. That is recorded in the audit log and in the done-at column. A contributor who is not the owner cannot mark it done.

### Review queue

Queue sits next to Map and List. It lists pipeline sites with something new since you last marked that site reviewed. The first time through, every active pipeline site is shown as new, and Mark all reviewed clears that baseline. Build changes are stored in `data/generated/queue_changes.json`. Notes, replies, and next-step decisions are stored in the database. Mail is described under Alerts.

Typing @ in a note, a reply, or a next-step title opens the account list. The chosen account is stored as an id and shown as a chip. That person gets a Mentioned you item at the top of their queue. Marking the site reviewed, or opening the thread, clears it. The Mentions filter shows only those items.

The next-step owner is the assignment. Assigned to me lists open and approved steps you own, with their target dates.

Review opens with Needs my approval, then Mentions, then Assigned. A pipeline deal marked as a c-store stays out of that default list. An open approval on it still shows.

### C-stores

The workbook Segment column is free text, and the generated business type folds c-stores into Gas station. During the data build, a pipeline deal gets `is_c_store` when Segment or the deal name contains "c-store" (any case) or a branded token such as ampm. A segment that is only "Gas station" does not qualify. Land rows stay on the land layer and are not flagged. The workbook is not edited.

Those deals are hidden on the map, the list, the counts, and the default Review queue until the C-stores filter is on (`cstore=1`). Search still finds one by name or id. Open approvals on a hidden c-store stay in Needs my approval.

### Alerts

Instant mail goes only to the person involved, one email per ten-minute batch:

- an open next-step proposal, document request, or suggested drop waiting for their approval
- an explicit @mention in a note or a suggestion
- a flag or an assignment sent to them
- an agent decision request
- an agent stage change that is not tied to an approved decision

Replies, agent draft replies, approved stage changes, inbound comms, new listings, and ask gaps wait for the morning digest. Activity rows, workbook imports, a site's first stage row, a stage write that does not change the stage, and the person's own actions are not mailed. `PIPE-PHX-0006` is left out of every alert, digest, and catch-up, and mail never links to it.

A burst for one person is one email, titled `Distributed Sites · N updates`, grouped by site. Mail that has been waiting at least an hour is a catch-up, titled `Distributed Sites catch-up · N updates`. The one-time catch-up uses the subject `Distributed Sites catch-up · since Nov 8`. Stage changes, new listings, and inbound replies start at 2026-11-08. Open proposals, draft replies, decision requests, and ask gaps are included while they are still unresolved, including ones opened before that date. Decided proposals stay out. The same import, first-stage, unchanged-stage, and own-action filters as the digest still apply. The daily digest subject is only used by the morning cron. The flush sends once the oldest unsent item is about ten minutes old (`ALERT_BATCH_MS`, default 600000), and it includes everything still waiting for that person. A later item does not hold an earlier one past that window. Each person gets at most six instant emails in a Pacific day. Anything past that cap is moved onto the digest and is not dropped. The person who took the action is not mailed about it.

The daily digest runs from two Vercel Crons, `0 14 * * *` and `0 15 * * *` UTC. The handler sends only when the America/Los_Angeles hour is 7, so the mail is 7:00 AM both in standard time and in daylight time, at most once per person per day. On Nov 16 that is the 15:00 UTC run. The first run, and any checkpoint from before then, starts at midnight Pacific on Nov 16, so the Nov 15 workbook import is outside the window. Later runs start at the previous send. It is skipped when there is nothing new. It counts agent draft replies still waiting, open proposals, open decision requests that are not already recorded, stage changes that actually changed and were not the site's first row, new listings by market with up to five links, inbound comms grouped by site, open ask gaps, notes on followed sites, and the open Review count. Workbook imports, activity rows, unchanged stages, and comms the person sent are left out. Each site links on the production host.

Saving a note, reply, mention, proposal, flag, or assignment schedules an instant flush after the response, so the page does not wait on mail. The Alert flush GitHub Actions workflow posts to `/api/alerts/flush` on `APP_URL` (the repository variable, defaulting to `https://distributedsites.com`). Production Vercel Cron calls `GET /api/cron/alert-flush` every five minutes and starts that workflow. The workflow's `*/5` schedule stays as the backup. GitHub may start that backup later than the mark. That job and the daily digest cron are the backstops when the background flush does not run. The flush claims each row before sending, so a repeated or overlapping run does not send the same item twice. The sign-in proxy allows an Authorization Bearer header through to `/api/alerts/flush`, `/api/alerts/digest`, `/api/data/revalidate`, `/api/cron/workbook-sync`, `/api/cron/alert-flush`, `/api/cron/search`, and `/api/cron/stale`. Any other API path still needs a session. The handler checks the secret. Set the same `CRON_SECRET` as a GitHub Actions secret and as a Vercel environment variable. The workflow sends it as `Authorization: Bearer <CRON_SECRET>`. If the GitHub secret is missing, the workflow logs that and skips instead of failing. `GITHUB_DISPATCH_TOKEN` is set only in Vercel. Leave `CRON_SECRET` as it is.

A link opens the same place as the agent feed, on `APP_URL` when that host is not a preview, otherwise `https://distributedsites.com`. Notes, replies, and mentions open Discussion. Proposals and assignments open the proposal. Flags open Review. A portfolio row opens the home map. Preview hosts are not used. The message shows the site name as a text link or a button, not a raw URL, plus the type, a short note, and the author. It does not include a package link or a financial figure. A phone number is left out of the note.

Only app accounts are mailed. Add an optional `email` on that person's `AUTH_USERS` object, or set `ALERT_EMAILS` so the password hash does not have to be rebuilt:

```json
{"cindel":"cindel.pena@moove.io","jaideep":"jaideep@dhanoa.in"}
```

`cindel` should be `cindel.pena@moove.io`. `jaideep` should be `jaideep@dhanoa.in`. An address that is not mapped to an app account is not used. Brokers and sellers are not mailed.

The account menu opens a settings sheet. Approvals, mentions, replies, flags, assignments, recommendations, proposals, decisions, stage changes, and ask gaps can each be Instant, Digest, or Off. The daily digest can be on or off. A reviewer starts with proposals, decisions, approvals, mentions, flags, and assignments instant. Stages, recommendations, replies, and ask gaps start on the digest, and the digest is on. A contributor starts with instant mentions, flags, and assignments. Replies, recommendations, proposals, decisions, stage changes, and ask gaps start on the digest, and the digest is on. A viewer starts with mentions only, and the digest off. New categories use that default until the person saves, including before the alert-category migration has been applied.

The one-time catch-up is the Alert catch-up workflow, run by hand on `main`. Leave dry run on to print counts only. Set dry run to false to send one email, "Distributed Sites catch-up · since Nov 8", to `jaideep@dhanoa.in`. A second real run does not send again. `PREVIEW=true` prints that email on your machine and does not write a log row or send. Preview does not run in GitHub Actions.

#### Resend

Resend is the sender. The Vercel integration injects `RESEND_API_KEY` and `RESEND_EMAIL_DOMAIN` (`distributedsites.com`). DNS for that domain is managed by Vercel DNS. When `ALERT_FROM` is unset, From is `Distributed Sites <alerts@${RESEND_EMAIL_DOMAIN}>`.

1. In Resend, add the domain `distributedsites.com`.
2. Add the SPF, DKIM, and DMARC DNS records Resend lists. Create those records in Vercel DNS for `distributedsites.com`.
3. Wait until Resend marks the domain verified.
4. Connect the Resend integration to this project so `RESEND_API_KEY` and `RESEND_EMAIL_DOMAIN` are set. `ALERT_FROM` is optional.
5. Set `APP_URL` to `https://distributedsites.com`. Links in the mail use `APP_URL`. If it is unset, they use `https://distributedsites.com`.

Live mail goes only to accounts named in `liveUsernames` in `config/alerts.json`. That list is `jaideep` until a test send is approved. Every other account is written to the would-send log and is not handed to Resend.

Replies go to `jaideep@dhanoa.in`. Set `ALERT_REPLY_TO` only to use a different reply address.

Gmail is an optional fallback, used only when `RESEND_API_KEY` is unset. Set `SMTP_USER` to `jaideep@dhanoa.in` and `SMTP_PASS` to a Google app password. The host is `smtp.gmail.com`, port 465, with TLS. An app password requires 2-Step Verification on that Google account. Turn that on, then create the password at [App passwords](https://myaccount.google.com/apppasswords). Use the 16-character password, not the normal account password.

If neither transport is configured, the action still saves. The app records a would-send row and does not throw. An admin can read those rows at `/admin/alerts` before mail is live.

Sends stop at 400 in a Pacific day. The log keeps a warning, and that delivery is not sent again. Each delivery has an idempotency key.

Failed attempts are counted for unknown usernames as well as known ones, with the same message. A separate Redis counter limits attempts per IP (10 in 15 minutes). A username locks after 5 failures in 15 minutes.

Imagery uses the public Esri World Imagery tiles. No imagery key is sent to the browser.

## Add a user

```bash
npm run add-user -- cindel
```

The script prints a password once and a JSON object. Paste that object into `AUTH_USERS` and redeploy. Give the person the password by a separate channel.

```bash
npm run hash-password -- 'the-password'
```

## Regenerate the data

Keep source files in `data/source/` (not in git). Newer reviewer rows can be passed without editing the script:

```bash
python3 scripts/build_data.py --muse-verdicts path/to/verdicts.csv
```

or `MUSE_VERDICTS_FILE`. If you omit it, the Muse call comes from the reconciliation workbook's latest Muse column.

Other new county rows go in `data/source/incoming/` as `.csv` or `.xlsx` with `site_id` or `market` plus `apn`, and `adjudicated_verdict` (`PASS`, `MAYBE`, `FAIL`, `NOT_A_WASH`, `UNRESOLVED`). Then run `npm run build-data`.

Verdict rows are append-only in `data/verdicts/verdicts.csv`. Pull requests run `python scripts/build_data.py --check`.

## Workbook sync

A scheduled workflow exports the Pipeline Sheet and reads the other build inputs from a Drive folder named Map sync inputs. The folder id is the repository variable `MAP_SYNC_INPUTS_FOLDER_ID`. There is no default, and the sync does not look in the program root. It lists only the top level of that folder.

The service account needs Viewer on the Pipeline workbook and on Map sync inputs. That is enough for the Open site folder link: each sync copies column AE onto the deal and onto the universe site the panel opens. It does not need access to the program root. The workflow never writes to Drive or the Sheet, and it never merges its pull request. A passing sync with `NEON_DATABASE_URL` set publishes a Neon snapshot when the generated data changed, and does not connect to Neon when the hash matches the last publish. It opens or updates one pull request when that publish did not happen. The details are under Workbook snapshots.

Materials counts need one more share. `2 Sites` (`TIMELINE_SITES_FOLDER_ID`, `1_oIqMjBJqOj-WApM7xOUz1EWydW3Fydk`) must be shared with `sites-map-sync@sites-map-sync.iam.gserviceaccount.com` as Viewer, and each site folder must inherit that access. A site folder set to limited access stays invisible. The card link still ships from column AE. The sync comment's "Matched folders" counts only folders that account listed under 2 Sites. "Sheet folder links" counts column AE. Those two numbers differ when the account cannot see a folder.

`python scripts/build_data.py --check` rebuilds from the export when `data/source` is present and fails if a Pipeline or Land Sites row has a Folder URL that the generated deal or linked site dropped.

### Universe gap

Universe stays a strict superset of every Pipeline or Land deal that already has a location in LAS, PHX, or MIA. The map links that deal to a counted Universe row by parcel or a unique street. The market is the deal's city field. Workbook sync reads the Sheet and publishes a snapshot when `NEON_DATABASE_URL` is set and the generated data changed. It opens or updates one pull request when that publish did not happen, or when `WORKBOOK_SYNC_OPEN_PR` is `true`. It leaves the Sheet unchanged.

`python scripts/build_data.py --gap-gate` prints every located LAS, PHX, and MIA deal id that has no `universe_id`. The check fails when that count is above zero. Inside those three markets there is no exception list. A located deal in another market, including SNA, is listed when a sync pull request is opened and does not fail the check. `python scripts/build_data.py --check` runs the same gate. Pull requests run both steps. Workbook sync runs the gate before it publishes a snapshot or opens a pull request. A red gate publishes nothing and does not open a pull request. If a bot sync pull request is already open and every commit on it since main is by github-actions[bot], the failed run updates that branch instead of opening another one. It does not force-push over anyone else's commits. The previous live snapshot stays, and the Actions summary lists the deal ids.

On 5 Nov 2026 Jaideep kept PIPE-SNA-0002 (Newport Beach) outside this check. The map does not assign that deal a LAS, PHX, or MIA market, and it does not require an SNA Universe row. The map does not mint a row, invent a coordinate, or invent a parcel number.

Leave a sync pull request unmerged while a located LAS, PHX, or MIA deal has no Universe row.

Map sync inputs sits in the Moove root, next to 2 Sites. Its top level holds:

- `universe_v3.csv`
- `listings_match_v3.csv`
- `depots.csv`
- `las_ring100_screen.csv`
- `reconciliation_final`, a Google Sheet, exported to xlsx when the sync reads it
- `service-area-PHX.kmz`, `service-area-LAS.kmz`, and `service-area-MIA.kmz`

Any file ending in `.kmz` is kept. The three names above are the ones this folder uses. A Google Doc never counts. A csv Sheet export must have one tab. Anything else in the folder is skipped.

`note_rewrites.json` is map configuration, committed at `data/note_rewrites.json`. It is not a Drive input. The build still runs if that file is missing.

## Counts from this data drop

| Step | Count |
|---|---|
| Census rows | 1,701 (LAS 428 / PHX 561 / MIA 712) |
| Unique sites | 1,643 |
| In service area | 1,041 (LAS 182 / PHX 251 / MIA 608) |
| Land tier L10 | 22. FAIL and not-a-wash sites are not given a tier |
| Land tier L4 | 44, of which 3 are county-checked and 41 are aerial only |
| Eliminated, not a wash, in area | 7 |
| Held for network expansion | 20, including LAS-U15 and LAS-U866 |
| In-area candidates | 66, including all 8 cleared PASS sites |
| Of which listed | 5 |
| Of which contacted | 0 |

The eight cleared PASS sites are LAS-U129, LAS-U877, MIA-U1347, MIA-U753, PHX-U180, PHX-U197, PHX-U232, and PHX-U535.

Muse's in-area reference, shown in the app and not used as our count, is 1,043 (LV 179 / PHX 254 / MIA 610).

Aerial screening alone had 25 in-area L10 sites. County-checked sites that are not FAIL or not-a-wash, and that have no aerial code, take L10 at 10,000 sq ft of spare land and L4 at 4,000 sq ft. Same-owner adjoining land counts toward that line. In-area L10 is 22 after dropping eliminated sites. L4 remains 44 against an expected figure near 48. The screening tab has 61 partial-fit rows: 57 joined to a site, 44 are inside the operative area, 13 are in the Las Vegas 200/300 rings, and 4 did not join a site.

The Universe bar counts deals in the categories you have on, in this city, with an outbound email or call on file. Dropped deals stay out of that count. Auto service is on with car washes. Land parcels and c-stores are included only when those categories are on. The current split is the `contacted` stage in `data/generated/funnel.json`.

## Activity timeline

Each site and deal card has an Activity section: one link to the site folder, a count and latest date for each materials category, a last-touched date, and the activity lines marked Map. When the workbook Folder column has a link, that same link also sits with Open in Google Maps and the listing, under the address. The app does not write the workbook or Drive, and it does not read file contents.

`config/timeline.json` holds the names. `ui.showActivityLines` defaults to true. Set it to false to keep the folder link, the counts and the last-touched date, and hide the lines. `GOOGLE_DRIVE_ROOT_FOLDER_ID` overrides `drive.rootFolderId`. `ACTIVITY_SHEET` and `ACTIVITY_HEADER_ROW` override the activity tab.

### Site ID

Pipeline and Land Sites gain a `Site ID` column (column CK). Values look like `PIPE-PHX-0001` and `LAND-PHX-0036`. When that cell is present and well formed, it is the deal id and the id on `linked_deal_id`. A blank or unusable cell falls back to an existing registry id, then to the row position. A prefix that does not match the tab, or a duplicate id, stops the build. Until the column exists, ids stay on row order.

### Activity tab

Header on row 1. The map reads Event ID, Date, Site ID, Type, Summary and Visibility. It does not read Source link, File link, Logged by, Direction, Counterparty role or Outcome. Only rows whose Visibility is `Map` are shipped, and only for `listing`, `brochure`, `om`, `financials`, `photos`, `legal`, `doc`, `visit` and `stage`. A blank summary uses a fixed line. A summary that contains a price mark or a phone number is dropped.

### Drive folders

The parent folder is `2 Sites` (`1_oIqMjBJqOj-WApM7xOUz1EWydW3Fydk`). Its id is the default `drive.rootFolderId`.

The card link comes from the Folder column (column AE) on Pipeline and Land Sites. The cell may be the URL itself or a hyperlink whose text is `Open folder`. Every workbook sync copies that URL onto the deal as `folder_url` and onto the linked universe site. The card shows it as Open site folder, next to Open in Google Maps and the listing. A build with no Drive credential still ships those links. Counts stay empty until a listing can open the folder. The build stops if a row's Folder URL is missing from the deal or from the site the panel opens.

Each site folder is named `{Site ID} {column A label}`, for example `PIPE-MIA-0080 MIA 7520 W McNab Rd`. The map matches the first token to Site ID. If the name has no id, it uses the folder id in column AE. A label that does not match column A is a warning, not a failure. When the root listing omits a folder that column AE points at, the build opens that folder id directly and still keeps the link.

Inside the site folder, only `Source files` is opened. Its categories are `1 Financials`, `2 Property and legal` and `3 Operations`, including nested folders. The fourth category, `4 Emails and calls`, is never listed. Loose files and memos are not counted. The filed date is the `YYYY-MM-DD` at the start of a file name. The card shows counts and dates, never a file name or a file link.

Share `2 Sites` with `sites-map-sync@sites-map-sync.iam.gserviceaccount.com` as Viewer. Site folders have to inherit that access. A site folder set to limited access is invisible to the account even though the parent is shared: the card still shows the column AE link, the counts stay empty, and the build log names the folder id and this share.

```bash
python3 scripts/build_timeline.py --workbook path/to/export.xlsx
```

That command only reads. It writes `data/generated/timeline.json`.

## Agent feed contract

Muse reads the feed and writes drafts. She does not post, approve, reject, resolve, or assign. Those actions stay on the signed-in routes, and only a person can call them. The feed routes do not accept `CRON_SECRET`.

Send `Authorization: Bearer <AGENT_INBOX_SECRET>`. A missing or wrong token is `401`. The compare is constant-time.

### Pull

`GET /api/agent/inbox?after=<cursor>&limit=<1-100>`

`limit` defaults to 50. `after` is the `cursor` of the last row you have already stored. Omit it to start at the oldest row. A bad cursor is `400`.

```json
{
  "items": [
    {
      "id": "uuid",
      "kind": "reply",
      "subtype": null,
      "ref_id": "note-or-proposal-id",
      "site_id": "PIPE-PHX-0008",
      "actor": "cindel",
      "text": "Full text of the note, proposal, flag, or decision.",
      "thread": { "key": "note:root-id", "context": "Parent text or the proposal being decided." },
      "proposal_id": null,
      "proposal_status": null,
      "stage": null,
      "workbook_stage": false,
      "current_stage": null,
      "proposal_outcome": null,
      "open_blockers": [],
      "stale": false,
      "status": "new",
      "created_at": "2026-11-10T00:00:00.000Z",
      "site_url": "https://distributedsites.com/?site=PIPE-PHX-0008&panel=discussion",
      "cursor": "opaque"
    }
  ],
  "next": null
}
```

`kind` is `note`, `reply`, `mention`, `suggestion` (with `subtype` for the proposal type, such as `stage_move`), `flag`, `decision`, `ask_gap`, `proposal_ready`, `proposal_overtaken`, or `proposal_closed`. `status` is `new`, `picked`, `done`, or `superseded`. A newer event on the same thread marks older open rows `superseded`. Skip those.

On `suggestion`, `decision`, `proposal_ready`, `proposal_overtaken`, and `proposal_closed` rows, four fields describe the proposal as it stands now:

- `current_stage` is the site's stage on the map.
- `proposal_outcome` is the live proposal status: `open`, `agreed_waiting`, `ready`, `accepted`, `rejected`, `overtaken`, `superseded`, or `applied`. `proposal_status` stays the status recorded on that event.
- `open_blockers` lists blockers that are still open. Each has `id`, `kind` (`document_request`, `checklist`, or `hold`), `label`, `party`, `asked_on`, and `follow_up_on`.
- `stale` is true when the site's stage changed after the proposal was made. Older proposals with no stored stage are not marked stale.

Other kinds send `current_stage` and `proposal_outcome` as null, `open_blockers` as `[]`, and `stale` as false.

`proposal_ready` is written once, when every blocker linked to an agreed proposal has closed. It does not set `workbook_stage`. `proposal_overtaken` is written once, with the reason, when a proposal is closed because events made it moot. `proposal_closed` is written once, with the reason, when an open proposal is closed by its assignee or an admin, or when the site's stage becomes Dropped. Closing a proposal does not change Stage. Each uses the idempotency key `kind:ref_id`, where `ref_id` is the proposal id.

The idempotency key is `kind:ref_id`. Posting the same event twice does not create a second row.

`site_url` is an absolute link to that row on the map. The host is the request host (`x-forwarded-host`, then `Host`). When the request has no host, the link uses `APP_URL`, or `https://distributedsites.com` when that is unset. Notes, replies, and mentions open Discussion (`/?site=ID&panel=discussion`). Suggestions, decisions, `proposal_ready`, `proposal_overtaken`, and `proposal_closed` open the proposal on that site (`/?site=ID&panel=proposal`). Flags open Review on that site (`/?view=review&site=ID`). An `ask_gap` for one site opens that site. `site_id` `portfolio` opens the home map (`/`).

`next` is the cursor to pass as `after`, or `null` when this page is the end.

### Backfill

The feed only recorded events after it shipped. This reads the existing notes, replies, mentions, flags, and suggestions and inserts the feed rows the live path would have written, including a `decision` for an accepted, rejected, agreed-and-waiting, or later-applied proposal, a `proposal_ready` row for a proposal whose blockers have cleared, and a `proposal_overtaken` row for a proposal closed as overtaken. It does not change proposal rows. `created_at`, the idempotency key, the thread, and the actor come from the original event. A newer row on a thread supersedes older `new` or `picked` rows. Running it again inserts nothing. It does not create `ask_gap` rows.

Preview and production share one `DATABASE_URL`. `--write` updates that database. Do not run `--write` from CI. Dry-run only reads, and prints counts by kind and by actor:

```bash
npm run backfill-inbox -- --dry-run
npm run backfill-inbox -- --write
```

### Ack

`POST /api/agent/inbox/ack`

```json
{ "ids": ["uuid"], "status": "picked" }
```

`status` is `picked` or `done`. Superseded rows stay superseded.

### Recommendation

`POST /api/agent/inbox/<id>/recommendation`

```json
{
  "kind": "reply",
  "draft_text": "The driveway is the tight part.",
  "decision": "none",
  "rationale": "The thread is about the frontage.",
  "sources": [{ "label": "Discussion", "url": "/?site=PIPE-PHX-0008&panel=discussion" }],
  "confidence": "medium",
  "model": "muse"
}
```

`kind` is `reply` (decision `none`), `status_reply` (decision `none`, the proposal stays open), or `decision`. A decision is `approve`, `reject`, `agree_waiting`, or `close_overtaken`. `confidence` is `high`, `medium`, or `low`. `sources` is required. Each source has a `label` and a `url` (`https://` or a map link starting `/?`) or a `ref`.

The draft and the rationale are stored as written. A phone number is refused. A superseded inbox row, or a proposal that is no longer open, is `409`. `agree_waiting` is only accepted while the proposal is open. `approve` and `reject` are refused while it is waiting on blockers. Nothing in this response is posted.

Agreed, waiting keeps the stage and links the site's open document requests, open diligence checklist items, and any NDA or hold named with the decision. When every linked blocker closes, the proposal becomes `ready` and the feed gains one `proposal_ready` row. That surfaces the stage move. It does not write the workbook.

A stage change that Jaideep approves — a move between stages, a drop, or a bring-back — adds a `decision` row with `workbook_stage: true` and `stage` set to the approved stage. The text says the stage is stored in the database and the workbook mirror copies it. That is not a request to edit the sheet. Write the stage through `POST /api/changes` or the signed-in accept action. Do not edit the workbook. Accepting while the proposal is still waiting on blockers is refused. Closing a proposal as overtaken records the reason and adds one `proposal_overtaken` row. Reject stays for a real finding.

Unanswered Ask questions are logged as `ask_gap`.

### What a person sees

Suggested drafts render only for the usernames in `RECOMMENDATION_RECIPIENTS` (`jaideep`). Use this fills the reply and selects the outcome. One Send records the outcome and, when the reply is filled in, posts that reply on the proposal. The saved row records `recommendation_id` and `drafted_by_agent` for the audit log. The map does not show an agent byline. Each draft includes a link to the site, using the same `site_url` rules as the feed.

The proposal form calls the stage-move choice Prioritize: push to Financials. It lists what is still needed on that site: open document requests and diligence items that are not on file and not unavailable.

## Ask

Ask streams from the API catch-all, which has a 300 second `maxDuration`. It sits in the top bar for every signed-in account. It answers from the map data, with a server-side tool loop of at most 5 steps. Quarantined rows, including `PIPE-PHX-0006`, are named quarantined and their values are not sent to the model. The map does not apply a display-term check. Ask still refuses walk-away, max-pay, savings, and offer-price language, refuses drafted broker or seller messages, and refuses autonomous-vehicle or charging language framed for a broker.

Ask does not approve, propose, assign, email, or change the workbook. If it cannot answer, the panel offers Make it a work item, which opens the existing work-item composer. The question is also written to the agent feed as `ask_gap`.

The workbook sync does not publish a Rules file or a Task Board file, so Ask has no tool for those.

Financials stay available to every signed-in role. The route checks `FINANCIALS_ROLES` in `lib/agent/access.ts`, which lists viewer, contributor, and reviewer. Narrow that list to change who can read them.

Without `XAI_API_KEY`, the panel says Ask isn't set up yet. Usage by user and day, and the month-to-date estimated cost, is on `/admin` for an admin. The estimate uses the rates in `lib/ask/cost.ts`. It is not an invoice.

`db/migrations` apply on the first notes, suggestions, saved-view, agent-feed, or admin request, or when someone runs `npm run db:migrate`. A deploy by itself does not run them.

## Not in this version

- The workbook sync runs every 15 minutes. It publishes a snapshot when the generated data changed, and it opens or updates a pull request when that publish did not happen. It does not merge, and it does not write back to the Sheet.
- Parcel outlines are drawn for Clark, Maricopa, Miami-Dade, and Broward. A folio or parcel number is tried first, then the pin. Broward uses the County Property Appraiser parcel layer. Same-owner adjoining outlines are drawn where the site record has adjoining spare land.
- The 75–250 m review band was not recomputed. Two same-parcel pairs are counted once.
- No write-back of a human call, and no PDF export. The current view exports to CSV.
- The map loads sites, areas, depots, parcels, and the funnel on separate routes, and loads one site's full record when you select it.
