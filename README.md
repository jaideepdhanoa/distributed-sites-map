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
| `CRON_SECRET` | for the digest | Bearer token Vercel Cron sends to the alert routes. It does not authenticate the agent feed. |
| `AGENT_INBOX_SECRET` | for the agent feed | Bearer token for `GET /api/agent/inbox`, the ack route, and recommendation writes. Separate from `CRON_SECRET`. |
| `XAI_API_KEY` | for Ask | Direct xAI key. Ask stays in the "isn't set up yet" state until this is set. Not an AI Gateway key. |
| `ASK_MODEL` | no | Ask model. Defaults to `grok-4.7`. |
| `ASK_DAILY_LIMIT` | no | Questions per person per Pacific day. Defaults to 40. Counted in Upstash Redis. |
| `GMAIL_LINK_VIEWERS` | no | Comma-separated usernames or mailboxes who may see an Open in Gmail link. When unset, `config/comms.json` is the list. |

Planned accounts, none created here: `jaideep` (admin), `cindel`, `ming`, `ricardo`, `yuka`, `muse`, `indie`. Admin only opens the accounts page. Everyone else sees the same map.

On Vercel, sign-in refuses to run if neither Redis pair is set. Locally, without Redis, lockout is skipped.

## Hobby plan

This project stays on the Vercel Hobby plan. Hobby allows at most 12 Serverless Functions per deployment. Vercel packs routes into a function until the traced files approach the size limit, then starts another function. `data/generated/photos` is large enough that tracing it into every route splits the deployment past 12, and a workbook sync then fails to deploy.

API handlers live in `lib/api/handlers` and are served by one catch-all, `app/api/[...route]/route.ts` (`runtime` nodejs, `maxDuration` 300, which covers the digest cron). Photo bytes stay on `app/api/data/photos/[id]` (`maxDuration` 60) so they are not copied into the other function. `outputFileTracingExcludes` drops the photo directory from routes that do not serve images. `outputFileTracingIncludes` adds the generated files and SQL migrations those routes read. The cron path stays `/api/alerts/digest`. The map worker stays a static route.

To add a route, register it in `lib/api/dispatch.ts` and put the handler under `lib/api/handlers`. Do not add another `app/api/**/route.ts` unless that route needs its own file trace or its own `maxDuration`. A separate route file is its own function once the trace no longer fits in an existing group. `node scripts/check-function-count.mjs` fails when a `vercel build` produces more than 10 Node.js functions, leaving room under the Hobby cap.

## Actions

Notes, suggestions, and saved views need Postgres. Without `DATABASE_URL` the map stays read-only and those controls stay hidden. The app never writes to the workbook or the Google Sheet, and it never edits `data/generated`. An accepted stage change is drawn over the generated stage so the map, the funnel counts, and the site card update immediately. Pending proposals are not drawn. When a later sync's stage matches, the decision is marked `applied` and the overlay stops. If that sync shows a different stage than the one the decision was made against and the one it approved, the workbook stage wins. The waiting note (`Moved to <stage> by <name>, waiting for workbook`) is on the site card for signed-in viewers, where names are already shown. Drop reasons stay on the activity line. The map pin takes the new stage color and does not add the name or the reason.

### Neon

1. In the Vercel project, add the Neon integration from the Marketplace (or create a Neon database and connect it). This repo does not provision the database.
2. Use the pooled connection string. Neon exposes it as `DATABASE_URL`. Do not commit that string.
3. Redeploy. The first notes, suggestions, or saved-view request applies `db/migrations`. From a machine that has the URL, `npm run db:migrate` does the same thing.
4. After a workbook sync rebuilds `data/generated`, run `npm run reconcile-suggestions`. The suggestions panel also checks on open. A suggestion becomes `applied` only when the generated data already matches the proposed value. An accepted stage move, drop, or bring-back is shown on the map until that match. The app does not write the new stage into the workbook.

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

More → Suggestions → Download CSV. A person applies those rows in the workbook. The columns are the record, the field, the current value, the proposed value, the reason, and the status (`open`, `accepted`, `rejected`, or `applied`).

Approved next steps have their own download on that panel. Columns are the site id (the permanent id when the record has one), the target date, the title, the owner, when it was approved, and when it was marked done. Approving a work item does not change the stage and does not write the workbook. Approving a stage move, drop, or bring-back updates the stage on the map until the workbook sync catches up. It still does not write the workbook. A later approval leaves the earlier one in the history on the card.

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

Instant mail goes only to the person involved:

- an open next-step proposal or document request waiting for their approval
- an @mention
- a reply on a thread they wrote or were mentioned in
- a flag or an assignment to them

A burst for one person is held until it has been quiet for about five minutes, then sent as one email. The person who took the action is not mailed about it.

The daily digest runs from a Vercel Cron at `0 15 * * *` UTC. That hour is 7:00 AM PST. On the Hobby plan the job is only promised to start sometime during that hour, and during daylight time it is 8:00 AM Pacific. The handler treats the America/Los_Angeles calendar day as the send day, and it sends at most one digest per person per day. It covers other notes and proposals on sites the person follows, plus the count waiting in their Review queue. Nothing is sent when there is nothing to report.

Pending instant mail is flushed by the Alert flush GitHub Actions workflow, scheduled every five minutes, which POSTs to `/api/alerts/flush` on `APP_URL` (the repository variable, defaulting to `https://distributedsites.com`). GitHub may start that job later than the mark. The flush is idempotent, so a late or repeated run does not send the same delivery twice. Set the same `CRON_SECRET` as a GitHub Actions secret and as a Vercel environment variable. The workflow sends it as `Authorization: Bearer <CRON_SECRET>`. If the GitHub secret is missing, the workflow logs that and skips instead of failing.

A link opens the same place as the agent feed, on `APP_URL` when that host is not a preview, otherwise `https://distributedsites.com`. Notes, replies, and mentions open Discussion. Proposals and assignments open the proposal. Flags open Review. A portfolio row opens the home map. Preview hosts are not used. The message shows the site name as a text link or a button, not a raw URL, plus the type, a short note, and the author. It does not include a package link or a financial figure. A phone number is left out of the note.

Only app accounts are mailed. Add an optional `email` on that person's `AUTH_USERS` object, or set `ALERT_EMAILS` so the password hash does not have to be rebuilt:

```json
{"cindel":"cindel.pena@moove.io","jaideep":"jaideep@dhanoa.in"}
```

`cindel` should be `cindel.pena@moove.io`. `jaideep` should be `jaideep@dhanoa.in`. An address that is not mapped to an app account is not used. Brokers and sellers are not mailed.

The account menu opens a settings sheet. Each of approvals, mentions, replies, flags, and assignments can be Instant, Digest, or Off. The daily digest can be on or off. A reviewer starts with instant approvals, mentions, flags, and assignments, and the digest on. A contributor starts with instant mentions, flags, and assignments, and the digest on. A viewer starts with mentions only, and the digest off. Replies follow mentions for a reviewer or contributor, and stay off for a viewer.

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

The service account needs Viewer on the Pipeline workbook and on Map sync inputs. That is enough for the Open site folder link: each sync copies column AE onto the deal and onto the universe site the panel opens. It does not need access to the program root. The workflow never writes to Drive or the Sheet, and it never merges its pull request.

Materials counts need one more share. `2 Sites` (`TIMELINE_SITES_FOLDER_ID`, `1_oIqMjBJqOj-WApM7xOUz1EWydW3Fydk`) must be shared with `sites-map-sync@sites-map-sync.iam.gserviceaccount.com` as Viewer, and each site folder must inherit that access. A site folder set to limited access stays invisible. The card link still ships from column AE. The sync comment's "Matched folders" counts only folders that account listed under 2 Sites. "Sheet folder links" counts column AE. Those two numbers differ when the account cannot see a folder.

`python scripts/build_data.py --check` rebuilds from the export when `data/source` is present and fails if a Pipeline or Land Sites row has a Folder URL that the generated deal or linked site dropped.

### Universe gap

Universe stays a strict superset of every Pipeline or Land deal that already has a location in LAS, PHX, or MIA. The map links that deal to a counted Universe row by parcel or a unique street. The market is the deal's city field. Workbook sync reads the Sheet and opens a pull request. It leaves the Sheet unchanged.

`python scripts/build_data.py --gap-gate` prints every located LAS, PHX, and MIA deal id that has no `universe_id`. The check fails when that count is above zero. Inside those three markets there is no exception list. A located deal in another market, including SNA, is listed in the sync pull request and does not fail the check. `python scripts/build_data.py --check` runs the same gate. Pull requests run both steps. Workbook sync puts the LAS, PHX, and MIA ids in the pull request body and the drift comment, then runs the gate. A red gate leaves the pull request open and unmerged.

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

`kind` is `note`, `reply`, `mention`, `suggestion` (with `subtype` for the proposal type, such as `stage_move`), `flag`, `decision`, `ask_gap`, `proposal_ready`, or `proposal_overtaken`. `status` is `new`, `picked`, `done`, or `superseded`. A newer event on the same thread marks older open rows `superseded`. Skip those.

On `suggestion`, `decision`, `proposal_ready`, and `proposal_overtaken` rows, four fields describe the proposal as it stands now:

- `current_stage` is the site's stage on the map.
- `proposal_outcome` is the live proposal status: `open`, `agreed_waiting`, `ready`, `accepted`, `rejected`, `overtaken`, or `applied`. `proposal_status` stays the status recorded on that event.
- `open_blockers` lists blockers that are still open. Each has `id`, `kind` (`document_request`, `checklist`, or `hold`), `label`, `party`, `asked_on`, and `follow_up_on`.
- `stale` is true when the site's stage changed after the proposal was made. Older proposals with no stored stage are not marked stale.

Other kinds send `current_stage` and `proposal_outcome` as null, `open_blockers` as `[]`, and `stale` as false.

`proposal_ready` is written once, when every blocker linked to an agreed proposal has closed. It does not set `workbook_stage`. `proposal_overtaken` is written once, with the reason, when a proposal is closed because events made it moot. Both use the idempotency key `kind:ref_id`, where `ref_id` is the proposal id.

The idempotency key is `kind:ref_id`. Posting the same event twice does not create a second row.

`site_url` is an absolute link to that row on the map. The host is the request host (`x-forwarded-host`, then `Host`). When the request has no host, the link uses `APP_URL`, or `https://distributedsites.com` when that is unset. Notes, replies, and mentions open Discussion (`/?site=ID&panel=discussion`). Suggestions, decisions, `proposal_ready`, and `proposal_overtaken` open the proposal on that site (`/?site=ID&panel=proposal`). Flags open Review on that site (`/?view=review&site=ID`). An `ask_gap` for one site opens that site. `site_id` `portfolio` opens the home map (`/`).

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

A stage change that Jaideep approves — a move between stages, a drop, or a bring-back — adds a `decision` row with `workbook_stage: true` and `stage` set to the approved stage. The text includes `Approved stage: <stage>. Write this stage on the workbook Stage column.` That is the signal to write the workbook Stage column. The app does not write the workbook, and it does not ask again. Accepting while the proposal is still waiting on blockers is refused. Closing a proposal as overtaken records the reason and adds one `proposal_overtaken` row. Reject stays for a real finding.

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

- The workbook sync opens a pull request every four hours when the data changed. It does not merge, and it does not write back to the Sheet.
- Parcel outlines are drawn for Clark, Maricopa, Miami-Dade, and Broward. A folio or parcel number is tried first, then the pin. Broward uses the County Property Appraiser parcel layer. Same-owner adjoining outlines are drawn where the site record has adjoining spare land.
- The 75–250 m review band was not recomputed. Two same-parcel pairs are counted once.
- No write-back of a human call, and no PDF export. The current view exports to CSV.
- The map loads sites, areas, depots, parcels, and the funnel on separate routes, and loads one site's full record when you select it.
