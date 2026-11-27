# Agent onboarding

Practical guide for a coding agent working in this repo on its own. `AGENTS.md` is the short copy. This file is the rest. Commands, checks, and env names below are the ones in the repo. Values stay out.

## Project

Distributed Sites is a Moove program. Jaideep Dhanoa consults. The program sources small car-wash and auto-service businesses that come with real estate, in Phoenix, Las Vegas, and Miami.

`distributedsites.com` is the private team map. Sign-in is required. The GitHub repo `jaideepdhanoa/distributed-sites-map` is public. Generated files under `data/generated` are what the app ships. Raw inputs stay in gitignored `data/source/` and are not in the clone.

Package name is `sites-map`. The app is Next.js 16 (`next` in `package.json`) on React 19. Read `node_modules/next/dist/docs/` before writing framework code. The block at the top of `AGENTS.md` is re-added by `next dev`. Leave it in place.

Market codes in the API are `PHX`, `LAS`, `MIA`, and `SNA`. The universe gate covers located deals in LAS, PHX, and MIA. README records that on 5 Nov 2026 Jaideep kept the Newport Beach row outside that gate. A new site still needs a market of PHX, LAS, or MIA.

## Site decisions

The Pipeline list shows all deals in the chosen market and stage. **Review shortlisted sites** opens the acquisition shortlist for those filters. The default list shows review priority, estimated charging spaces and modeled cost per completed charge. A mapped space estimate describes one candidate layout. The site record identifies its basis and links to the charging calculation. Start the commercial review in **Selection Review**. Join on the stable site ID and confirm the address or parcel. A site can have several offers. Read the route under review, the selected charging case and the current site stage separately.

| Question | Where to read and maintain it |
| --- | --- |
| Which transaction deserves staff time? | Selection Review shows the private commercial register. Maintain one primary opportunity per site and one alternative per distinct transaction in the existing Opportunities tab. Acquisition shortlist order spans markets. Fleet-service diligence has its own order. |
| What would a visit settle? | The shortlist and site brief show the Visit decisions entry for the site. Record why a peak-hour visit matters, the booking condition, seller and utility work, what to measure, and the condition for considering an LOI. Distinguish proposed owners and dates from confirmed arrangements. |
| What does the operating case support? | Financials, the charging explanation and Compare expose the selected revision. State the source, date, units, case assumptions, joint downside and next evidence needed. The Charging cases worksheet mirrors the result. Historical Scorecard points describe the earlier screen. |
| Has the site changed stage? | Read the signed-in site record. A route disposition or model action can prompt review. A contributor proposes a site-wide change, and an authorized human decides. The package-receipt exception below is narrowly scoped. |

For physical fit, inspect each candidate in Spaces, including conversion of surplus parking, vacuums or bays. Record aisle and access rights, peak use and displaced operating cash. Keep an aerial estimate, a measured layout and written control distinct. For power, distinguish nearby infrastructure and utility forecasts from measured existing service, available headroom and a dated utility response on cost and delivery. Traffic and competition provide business context. Use source-period statement lines and retained cash after conversion to test purchase support.

Use comparable local costs per completed charge for the selected site and the next feasible depot addition. Label a network reference or proxy. Keep unknown values distinct from verified zeroes, and a saved trial distinct from the team selection. An investment sequence requires qualifying base and downside cases and incremental value after allocating shared market demand. A diligence or visit priority can have an unresolved charging case.

When a transaction ends, record its reason, dated evidence and reopening condition. Check for duplicate pending proposals before suggesting a site-wide drop. The authorized reviewer’s acceptance records the stage and reason. Reload the site and check the stage, reason and history. After a register publication, compare the affected route, next check and visit plan with signed-in Selection Review. Keep live counts, terms and case details on authorized private surfaces.

For future workflow changes, update the affected shared manual, rule and playbook passages at the point an agent uses them. Update this guide and relevant in-app instructions when their behavior changes. Include the source revision and next decision-changing check in handoffs. Give unresolved discrepancies an owner or record that ownership is open.

## Architecture

```
workbook  --export-->  build_data.py  --snapshot-->  Neon
   ^                                                    |
   |                     mirror (DB -> sheet)           |
   +----------------------------------------------------+
                                                        |
                              distributedsites.com <----+
                              POST /api/changes
```

The site is a Next.js app on Vercel, in team `jaideepdhanoas-projects`. A pull request gets a preview deployment. Merge to `main` deploys production. The commit status context is `Vercel`. The functions job in `.github/workflows/validate-data.yml` pins the project and org ids it builds with.

Neon Postgres is attached through the Vercel Marketplace. Jaideep, 24 Nov 2026: the database is on the Launch plan. Previews use one long-lived Neon branch named `preview`, so preview data is a copy and can drift. It is not production, and it is not one branch per pull request. See `docs/preview-database.md`. That doc, and the header of `.github/workflows/workbook-sync.yml`, still describe the old Free plan.

Resend sends team alert mail. The Vercel integration injects the key and the domain. Upstash Redis (Marketplace) holds login lockout and the Ask daily count. Preview keys are prefixed so they do not hit production keys.

The Pipeline workbook in Google Sheets is the legacy source. Workbook sync runs about every 15 minutes:

- `vercel.json` cron `*/15 * * * *` calls `GET /api/cron/workbook-sync` on the production deployment.
- That route checks `CRON_SECRET` and starts the GitHub workflow with `GITHUB_DISPATCH_TOKEN`.
- `.github/workflows/workbook-sync.yml` also has `schedule: */15 * * * *` as the backup. GitHub has started that schedule late.
- The workflow exports the sheet, runs `scripts/build_data.py`, and publishes a Neon snapshot when the generated hash changed.
- Concurrency group `workbook-sync` waits. It does not start a second run.

Neon is the record for activity, comms, stages, and sites when writes are on and the matching read flag is on. The code default for each flag is off. These five have to be set in both places, Vercel Production and a GitHub repository variable of the same name. The drift step and the mirror read the GitHub variables. They cannot see the Vercel values.

| Name | Effect when `1` |
| --- | --- |
| `CHANGES_API_ENABLED` | `POST /api/changes` on production. Preview allows writes when this is unset, after the preview-host check. |
| `READ_STAGES_FROM_DB` | Deal stages come from `site_stages`. |
| `READ_ACTIVITY_FROM_DB` | Activity lines come from `activities`. |
| `READ_COMMS_FROM_DB` | The comms log comes from `comms_entries`. |
| `READ_SITES_FROM_DB` | Pipeline and land fields come from `sites`. |

A read flag does nothing while writes are off. Turning a flag off returns that read to the snapshot. It does not start copying sheet edits into the database.

The mirror copies database rows back into the workbook for each entity whose read flag is on. It runs on `main` when `WORKBOOK_MIRROR_ENABLED` is `1`, including a run whose snapshot hash did not change. It is the only writer of those cells. A hand edit is overwritten. The scheduled sync reports drift and does not copy sheet edits into the database.

Current rows live in `site_stages`, `activities`, `comms_entries`, and `sites`, each with a `version`. History is append-only in `events`.

### Writes

`POST /api/changes` takes one batch. Send `Idempotency-Key` and `Authorization: Bearer` with that agent's token. The same key and the same body return the original ids. The same key and a different body return 409. A version mismatch returns 409 and the batch rolls back.

The server recognizes three agent bearers (`lib/agent/auth.ts`):

| Env name | Actor on the event |
| --- | --- |
| `AGENT_WRITE_TOKEN_INDIE` | `indie` |
| `AGENT_WRITE_TOKEN_MUSE` | `muse` |
| `AGENT_WRITE_TOKEN_CHATGPT` | `chatgpt` |

Use one independently generated secret per actor. A signed-in session cookie is a person. Activity, comms, and site content need contributor access. Stage changes need a reviewer, except the one agent stage move below. Payload shapes are in `docs/agent-api.md`.

An agent can write activity, comms, and the site fields its token is allowed to touch (`assertSiteOwnership` in `lib/changes/schema.ts`). Capture activity, P&L lines, P&L retracts, and `data_conflict` rows are available to the capture role. ChatGPT has both capture and site maintenance permissions. Indie can update the site fields that function allows, including segment, with a source. A new site does not accept Folder, photos, land evidence, typed power, check statuses, or financial claims. Every numeric fact needs its own source.

The only agent stage write is Desk screen to Financial screen, with a package receipt. Anything else, including Dropped, is refused for an agent.

`pnl_line` is not mirrored to the workbook. Amounts are strings. `captured_at` is an ISO-8601 time with a numeric offset or `Z`.

### NDA

NDA overlay rows are `nda_state` and `nda_history`, created by `db/migrations/033_nda_queue.sql` and extended by `db/migrations/034_nda_dossier.sql`. The register snapshot stays the baseline. `lib/ndaStore.ts` reads the overlay for a signed-in session and for an agent bearer. A database without the tables keeps the snapshot.

Muse, Indie and ChatGPT capture an NDA with `POST /api/changes` (`entity_type: "nda"`) and read it back with `GET /api/data/nda` and the same bearer. Field rules are in `docs/nda-capture.md`. Unknown payload fields are refused. `payload.at` is an ISO-8601 time with a zone offset.

`parseNda` admits the three registered agents or a human with content-write access. Do not widen that check. Do not set `owner`, and do not send `action: "assign"`. The two legacy agent tokens still accept `owner` on a payload (`tests/changes/nda-agent.test.ts`). Leave the owner for a person on the signed-in dossier.

### Ask and mail

Ask needs `XAI_API_KEY` on the deployment. It does not approve, propose, assign, email, or change the workbook. It refuses autonomous-vehicle and charging language framed for a broker.

Alert mail goes to app accounts through Resend. Brokers and sellers are not mailed. Agents do not send mail.

## Migrations

SQL files live in `db/migrations/` and sort by filename (`001_actions.sql` through `035_chatgpt_stage_guard.sql`). `lib/actions/migrate.ts` runs each pending file in its own transaction and records the filename in `schema_migrations`.

| Path | What it does |
| --- | --- |
| Local, or a preview database that is not the production host | `npm run db:migrate`, and the first request that needs the schema. `scripts/db-migrate.ts` exits when `DATABASE_URL` is unset. |
| Production app | Skips. A deploy does not migrate. |
| Production database | **Production migrations** (`.github/workflows/production-migrate.yml`), by hand, on `main`. Type `migrate-production`. For a single-file approval, enter its exact filename in `only_pending`. The workflow stops if another file is pending. The job sets `ALLOW_PRODUCTION_MIGRATE=1` and uses the GitHub secret `NEON_DATABASE_URL`. `scripts/production-migrate.ts` refuses any other caller. |
| Neon branch `preview` | **Preview migrations**. Type `migrate-preview`. Uses `NEON_API_KEY` and `NEON_PROJECT_ID`. It does not read the production connection string, and it refuses when the preview host is the production host. |

Pull-request jobs cannot migrate production. Workbook sync does not apply pending files. If `snapshots` is missing, the sync stops and names the Production migrations workflow.

Comments in several files, starting with `013_list_layouts.sql`, say a request must not apply that file on production. That matches the skip. The Production migrations workflow still applies them. Run preview before production when you want to see a new file on the copy first. A reset of the preview branch drops whatever was tried there.

Do not run the production workflow unless Jaideep has approved that migration.

Other confirm-gated jobs, all `workflow_dispatch` and dry-run by default: Reset preview database (`reset-preview-db`), Workbook mirror, Workbook protect (`protect-workbook-readonly`), Capture import (`import-production`), Close dropped proposals, Shadow diff. Previews and pull-request jobs cannot write production.

## Tools and access

| Tool | What it is for |
| --- | --- |
| GitHub `jaideepdhanoa/distributed-sites-map` | Code, Actions, secrets, and repository variables. Public. |
| Vercel, team `jaideepdhanoas-projects` | Hosting, crons, production and preview env. Preview per PR. Production on merge to `main`. |
| Neon, Vercel Marketplace | Postgres. Launch plan as of 24 Nov 2026. Branch `preview` for previews. |
| Google Sheets and Drive | Pipeline workbook and the Map sync inputs folder. Service account `sites-map-sync@sites-map-sync.iam.gserviceaccount.com`. |

The sync asks Google for `https://www.googleapis.com/auth/drive.readonly`. The mirror asks the same `GOOGLE_SERVICE_ACCOUNT_JSON` for `https://www.googleapis.com/auth/spreadsheets`. Viewer on the workbook is enough to export. Editor is what makes mirror writes succeed. There is no second credential.

Jaideep shares Drive access directly. Do not put Drive folder ids or links in the repo. The folder id the sync reads is the GitHub variable `MAP_SYNC_INPUTS_FOLDER_ID`. The sites folder id is the GitHub variable `TIMELINE_SITES_FOLDER_ID`, passed to the build as `GOOGLE_DRIVE_ROOT_FOLDER_ID`.

`node scripts/check-function-count.mjs` fails when a Vercel build produces more than 10 Node.js functions. Add a route in `lib/api/dispatch.ts` and `lib/api/handlers`. Do not add another `app/api/**/route.ts` unless that route needs its own file trace or its own `maxDuration`. Photo bytes stay on `app/api/data/photos/[id]`.

## Environment variables

Names only. Where they live, and what they are for. Never print a value. `.env.example` lists the local names with empty values.

Set in both Vercel Production and GitHub repository variables: `CHANGES_API_ENABLED`, `READ_STAGES_FROM_DB`, `READ_ACTIVITY_FROM_DB`, `READ_COMMS_FROM_DB`, `READ_SITES_FROM_DB`.

### Vercel

| Name | For |
| --- | --- |
| `AUTH_USERS` | Account list. Bcrypt hashes. Shared to Preview so preview can sign in. |
| `AUTH_SECRET` | Session cookie. Changing it signs everyone out. Do not rotate it. |
| `ACTION_ROLE_MAP` | Optional map of role label to queue access. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis. Login lockout. Required on Vercel. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Used when the `KV_REST_*` pair is unset. |
| `KV_URL`, `KV_REST_API_READ_ONLY_TOKEN`, `REDIS_URL` | Present from the integration. The app does not read these names. |
| `DATABASE_URL` | Neon pooled URL. The app reads this. Empty means the map stays read-only. |
| `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NO_SSL`, `DATABASE_URL_UNPOOLED`, `PGHOST`, `POSTGRES_HOST`, `PGHOST_UNPOOLED`, `PGUSER`, `POSTGRES_USER`, `PGPASSWORD`, `POSTGRES_PASSWORD`, `PGDATABASE`, `POSTGRES_DATABASE` | Neon integration aliases. Preview reset points the Preview copies at the `preview` branch. The app reads `DATABASE_URL`. |
| `DATABASE_SSL` | Set to `disable` to turn TLS off. Local only. |
| `NEON_PROJECT_ID` | Neon project id. Also a GitHub variable. Not a connection string. |
| `NEON_PRODUCTION_HOST` | Production endpoint hostname only. Compared, not printed. GitHub variable, copied onto Vercel Preview by the reset workflow. |
| `PREVIEW_DATABASE_BRANCH` | Vercel Preview. Plain marker `preview`. Writes stay closed until it is set. |
| `NEON_AUTH_BASE_URL`, `VITE_NEON_AUTH_URL` | Integration leftovers. The app does not call Neon Auth. |
| `RESEND_API_KEY`, `RESEND_EMAIL_DOMAIN` | Resend integration. Team alert mail. |
| `ALERT_FROM`, `ALERT_REPLY_TO`, `ALERT_EMAILS`, `ALERT_BATCH_MS` | Optional mail overrides. |
| `APP_URL` | Host for links in alert mail. Also a GitHub variable. |
| `SMTP_USER`, `SMTP_PASS` | Gmail fallback, only when `RESEND_API_KEY` is unset. Not the agent mail path. |
| `CRON_SECRET` | Bearer for cron routes and for the snapshot revalidate. Production only, and a GitHub secret with the same value. Do not rotate it. |
| `GITHUB_DISPATCH_TOKEN` | Fine-grained GitHub token. Vercel Cron uses it to start Workbook sync and Alert flush. Vercel only. |
| `SNAPSHOT_READ` | `off` ignores Neon and serves `data/generated`. |
| `AGENT_INBOX_SECRET` | Bearer for the agent feed. Not `CRON_SECRET`. |
| `AGENT_WRITE_TOKEN_INDIE`, `AGENT_WRITE_TOKEN_MUSE`, `AGENT_WRITE_TOKEN_CHATGPT` | Write bearers. Production only. Do not copy them to Preview. |
| `XAI_API_KEY` | Ask. Direct xAI key. |
| `ASK_MODEL`, `ASK_DAILY_LIMIT` | Optional Ask overrides. |
| `GMAIL_LINK_VIEWERS` | Optional allow-list for the Open in Gmail link. |
| `AI_GATEWAY_API_KEY` | `npm run search-backfill` off Vercel. Deployed functions use the project OIDC token. |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `ACTIVITY_SHEET`, `ACTIVITY_HEADER_ROW` | Optional build overrides. The sync workflow sets the folder id from `TIMELINE_SITES_FOLDER_ID`. |

`VERCEL_ENV` is set by the platform. Preview writes, preview mail, and preview Ask all branch on it. Do not set it yourself.

### GitHub secrets

| Name | For |
| --- | --- |
| `NEON_DATABASE_URL` | Production pooled URL for sync, mirror, and production migrate. Not a Vercel env. |
| `NEON_API_KEY` | Reset, preview migrate, and preview-branch cleanup. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Sheets and Drive for sync, mirror, and protect. |
| `CRON_SECRET` | Same value as Vercel. Snapshot revalidate and alert flush. |
| `RESEND_API_KEY` | Alert catch-up workflow. |
| `VERCEL_TOKEN` | Reset preview database, so it can point Preview env at the branch. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Browser tests against a protected preview. |
| `E2E_USERNAME`, `E2E_PASSWORD` | Browser tests. The jobs skip when these are empty. |
| `SYNC_GITHUB_TOKEN` | Optional. Sync PRs. The default is `github.token`. |
| `GITHUB_TOKEN` | Provided by Actions. |

### GitHub repository variables

| Name | For |
| --- | --- |
| `CHANGES_API_ENABLED`, `READ_STAGES_FROM_DB`, `READ_ACTIVITY_FROM_DB`, `READ_COMMS_FROM_DB`, `READ_SITES_FROM_DB` | Same names as Vercel. Mirror and drift read these. |
| `WORKBOOK_MIRROR_ENABLED` | `1` lets the mirror write on `main`. |
| `WORKBOOK_SYNC_OPEN_PR` | `true` also opens a sync pull request after a successful snapshot write. Unset means a successful write does not open one. |
| `MAP_SYNC_INPUTS_FOLDER_ID` | Drive folder of build inputs. No default. |
| `TIMELINE_SITES_FOLDER_ID` | Passed as `GOOGLE_DRIVE_ROOT_FOLDER_ID`. |
| `NEON_PROJECT_ID`, `NEON_PRODUCTION_HOST` | Preview migrate, reset, and cleanup. |
| `APP_URL` | Alert flush target. Defaults to the production host when unset. |
| `SNAPSHOT_REVALIDATE_URL` | Production cache refresh. |
| `RESEND_EMAIL_DOMAIN` | Alert catch-up. |
| `E2E_BASE_URL` | Optional. Browser tests against a preview. Unset means CI builds and starts the app on port 3456. |
| `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | Optional overrides for the reset workflow. |

Workflow-only flags, set by the workflow file rather than stored as env: `ALLOW_PRODUCTION_MIGRATE`, `ALLOW_PRODUCTION_CAPTURE_IMPORT`, `ALLOW_CLOSE_DROPPED_PROPOSALS`, `ALLOW_DRAIN_AGENT_FEED`, `CONFIRM`, `WORKBOOK_MIRROR_DRY_RUN`.

## Other agents

| Who | Owns |
| --- | --- |
| Muse | Broker comms, capture, and the related data entry. The workbook logs this agent as Torque. Write token actor is `muse`. |
| Indie | Schema, sync, mirror, verification, and code. Write token actor is `indie`. |
| ChatGPT / Codex | Code across that full scope, including schema, sync, and verification. The app attributes authorized capture and maintenance writes to `chatgpt`. 24 Nov 2026: Jaideep does not require an Indie review. Open the PR and merge it when CI is green. |

Data entry stays with the agent that owns the row. Muse still writes capture, P&L, and conflicts. Do not take a row someone else is writing.

Coordinate on the workbook Run Log and in the PR description. One writer per row. Record provenance: every change sends `source`. Capture-import rows keep a `provenance` line; the HTTP API does not set that field (`lib/changes/schema.ts`). After a write, use the returned id and version, and read the row back before the next edit. For an NDA that read is `GET /api/data/nda`.

The feed (`GET /api/agent/inbox`) accepts the three individual write credentials or the shared inbox credential. `CRON_SECRET` is not accepted. Muse reads the capture feed and writes drafts. ChatGPT can read both feeds, write drafts, and acknowledge rows. Posting, approving, rejecting, resolving, and assigning stay on the signed-in routes.

## Where the rest of the context lives

Jaideep shares Google Drive directly. Do not put Drive folder ids or links in this repo.

- The Agent Operating Manual, v1.4, on Google Drive.
- The Pipeline workbook tabs: Pipeline, Land Sites, Activity, Comms Log, Run Log, Rules & Decisions, Task Board.
- The R-### rules on Rules & Decisions. The code cites R-097 (drops), R-101 (timestamps), R-102 (P&L lines), and R-108 (land freeze). The sheet is the list.

In the repo:

| File | What it holds |
| --- | --- |
| `README.md` | Setup, env, sync, roles, alerts, the agent feed. |
| `DESIGN.md` | Controls, chips, phone and desktop. |
| `docs/agent-api.md` | `POST /api/changes` payloads. Figures in that file are fake. |
| `docs/nda-capture.md` | NDA fields and stage transitions. |
| `docs/preview-database.md` | Preview branch and the env split. Free-plan wording is stale. |
| `docs/scoring.md` | Scorecard weights. Stored scores stay the workbook numbers. |
| `config/scorecard.json` | Economics 40, Land 25, Power 15, Location 10, Deal 10. |

Ask has no tool for Rules & Decisions or Task Board. The sync does not publish those tabs.

## Hard rules

The repo is public. CI logs are public. Do not put broker text, Gmail ids, broker or seller names, emails, phone numbers, prices, or other private deal data in code, fixtures, commits, or logs. A failing privacy guard prints a short snippet of the field, so the text has to stay out before the push. Do not print or commit secrets, tokens, connection strings, or password hashes.

Do not touch production data, production migrations, or env vars unless Jaideep has explicitly approved that action. Jaideep edits Vercel secret env vars himself. Do not rotate `CRON_SECRET` or `AUTH_SECRET`. Reading a preview database is the safe place to try a migration.

Do not set Stage to Dropped, and do not let a capture path set it. R-097: suggest the drop, with a rationale. A human reviewer drops the row and records a reason. `assertStageActor` rejects an agent drop. Moving a row off Dropped also needs a reason. A suggested drop becomes a proposal. Stage changes when a person accepts it.

Brokers must never be told about autonomous vehicles or charging. Ask refuses that framing. Do not draft around it.

Do not send external email or messages. Do not call Resend or SMTP yourself. Team alerts are the app's path, to app accounts only.

R-108, land freeze: `lib/listLook.ts` sets the chip to `Land paused` and the note to the pause since 20 Nov 2026. No land sourcing or follow-up while the freeze is on.

R-101: send ISO-8601 times with a numeric zone offset. `parseZonedTimestamp` also accepts `Z`. The API stores the offset it was given.

When two sources disagree, log a `data_conflict`. Do not pick a value and drop the other. Muse writes that row. Both sources are stored, and `value_in_use` has to be one of them.

Agents do not set NDA owners. Do not bypass the actor check in `parseNda`.

Chips use short labels. `CHIP_LABEL_MAX` is 28. A chip does not join clauses with a middle dot. A stage chip is the stage name only. Longer text goes on the card or in the tooltip (`DESIGN.md`, `lib/chips.ts`).

The workbook is protected in intent. **Workbook protect** is shipped off. Dry run is the default. Apply needs `protect-workbook-readonly` with dry run off, on `main`, and only when Jaideep has asked. The writable tabs are Rules & Decisions and Run Log (`lib/changes/protect.ts`). Everything else is written through `POST /api/changes` or the signed-in site, and the mirror copies the database back. Do not edit mirrored cells. Do not add a script that writes the sheet.

The quarantined pipeline row stays untouched. The id in code is `PIPE-PHX-0006`. Do not write it, link to it, or include it. Row 10 on Pipeline and Land Sites stays untouched. Activity and Comms Log may use row 10, except a row for that quarantined site.

A UI change is walked on the desktop preview and the phone preview before merge. Put the screenshots in the PR. Crop the address bar. The Review screenshots workflow is a separate CI job. It does not replace those shots.

## Gotchas

`POST /repos/{owner}/{repo}/pulls/{n}/merge` can return 403 with a message about stacked PRs. Use `POST /repos/{owner}/{repo}/pulls/{n}/merge-async` and the same body (`merge_method: squash`).

`scripts/build_data.py` calls `guard_deal_text`. Internal wording in a deal name, next step, address, or source line fails the build and fails Workbook sync. The pattern is `_NOTE_INTERNAL`. It matches `muse`, `torque`, `indie`, and `grok`, and it matches `live` unless the word is hyphenated on both sides. `Live-Work` and `work-live` pass. `Live/Work`, `live listing`, and `checked live on site` fail. That hyphen exception landed in #178. After a merge that touches deal text or this guard, read the next Workbook sync run. A red sync does not publish a snapshot.

On 23 Nov 2026 Neon on the Free plan had an outage. The database is on the Launch plan now. Do not plan around the 1 GB Free-plan note in the sync workflow header.

`docs/preview-database.md` says preview used to share production's `DATABASE_URL`. Writes on a preview that still points at production return 503, `Preview is pointed at production`. Reset the preview branch before treating a preview as a safe write target.

GitHub's 15-minute schedule has run hours late. The Vercel cron is the one that starts the workflow on time. If a sync looks stuck, check the workflow run id, not a second manual export.

An unchanged generated hash skips the snapshot publish. With `WORKBOOK_MIRROR_ENABLED=1` the mirror still runs.

The universe gap gate fails the sync when a located LAS, PHX, or MIA deal has no `universe_id`. A red gate publishes nothing.

## Day-to-day

```bash
npm install
python3 -m pip install -r requirements.txt
npm run dev
```

CI uses Node 22 and Python 3.12. Local checks that match the pull-request jobs:

```bash
npm test
npm run test:timeline
node scripts/check_controls.mjs
python3 scripts/check_surface.py
python3 scripts/build_data.py --check
python3 scripts/build_data.py --gap-gate
```

`--check` rebuilds from `data/source/` when that folder is present, and otherwise checks the committed generated files. `--gap-gate` fails when a located LAS, PHX, or MIA deal has no universe row. `npm run build-data` needs the private source files. Do not commit `data/source/`.

Validate data also runs the Python files named in `.github/workflows/validate-data.yml` (`tests/test_*.py`, `scripts/test_changes.py`, `scripts/test_review_fixes.py`, and the `node --experimental-strip-types` script tests). Actions runs `npm test`, `npx tsx scripts/parity-site-types.ts`, and `npm run test:actions` after Playwright chromium is installed. Timeline runs `npm run test:timeline`.

`npm run test:e2e` needs a signed-in server. CI builds, starts `next start -p 3456`, and points Playwright at it, unless `E2E_BASE_URL` is set.

Before a UI merge, walk the preview on a desktop width and a phone width. Crop the address bar out of the screenshots you attach to the PR.

## Pull requests

Branch from `main`. Describe what changed, which flags or rows it touches, and how you checked it. No Indie review is required for now (Jaideep, 24 Nov 2026). Wait until these are green, then squash-merge:

- `validate`, `functions`, `e2e` (Validate data)
- `actions` (Actions)
- `timeline` (Timeline)
- `screenshots` (Review screenshots)
- commit status `Vercel`
- `Vercel Preview Comments`

Production deploys from the merge to `main`. Merging a docs or code PR is not approval to migrate production, edit env, or write the live workbook.
