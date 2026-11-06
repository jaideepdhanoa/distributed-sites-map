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

Planned accounts, none created here: `jaideep` (admin), `cindel`, `ming`, `ricardo`, `yuka`, `muse`, `indie`. Admin only opens the accounts page. Everyone else sees the same map.

On Vercel, sign-in refuses to run if neither Redis pair is set. Locally, without Redis, lockout is skipped.

## Actions

Notes, suggestions, and saved views need Postgres. Without `DATABASE_URL` the map stays read-only and those controls stay hidden. The app never writes a stage, and it never writes to the workbook or the Google Sheet.

### Neon

1. In the Vercel project, add the Neon integration from the Marketplace (or create a Neon database and connect it). This repo does not provision the database.
2. Use the pooled connection string. Neon exposes it as `DATABASE_URL`. Do not commit that string.
3. Redeploy. The first notes, suggestions, or saved-view request applies `db/migrations`. From a machine that has the URL, `npm run db:migrate` does the same thing.
4. After a workbook sync rebuilds `data/generated`, run `npm run reconcile-suggestions`. The suggestions panel also checks on open. A suggestion becomes `applied` only when the generated data already matches the proposed value. Accepting a suggestion does not change what the map shows.

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

Approved next steps have their own download on that panel. Columns are the site id (the permanent id when the record has one), the target date, the title, the owner, when it was approved, and when it was marked done. Approving a next step does not change the stage and does not write the workbook. A later approval leaves the earlier one in the history on the card.

The owner of a next step, or a reviewer, can mark it Done. That is recorded in the audit log and in the done-at column. A contributor who is not the owner cannot mark it done.

### Review queue

Queue sits next to Map and List. It lists pipeline sites with something new since you last marked that site reviewed. The first time through, every active pipeline site is shown as new, and Mark all reviewed clears that baseline. Build changes are stored in `data/generated/queue_changes.json`. Notes, replies, and next-step decisions are stored in the database. There is no email.

Typing @ in a note, a reply, or a next-step title opens the account list. The chosen account is stored as an id and shown as a chip. That person gets a Mentioned you item at the top of their queue. Marking the site reviewed, or opening the thread, clears it. The Mentions filter shows only those items.

The next-step owner is the assignment. Assigned to me lists open and approved steps you own, with their target dates.

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

The Universe bar counts Pipeline and Land deals in the city with an outbound email or call on file. Dropped deals stay out of that count. The current split is the `contacted` stage in `data/generated/funnel.json`.

## Activity timeline

Each site and deal card has an Activity section: one link to the site folder, a count and latest date for each materials category, a last-touched date, and the activity lines marked Map. When the workbook Folder column has a link, that same link also sits with Open in Google Maps and the listing, under the address. The app does not write the workbook or Drive, and it does not read file contents.

`config/timeline.json` holds the names. `ui.showActivityLines` defaults to true. Set it to false to keep the folder link, the counts and the last-touched date, and hide the lines. `GOOGLE_DRIVE_ROOT_FOLDER_ID` overrides `drive.rootFolderId`. `ACTIVITY_SHEET` and `ACTIVITY_HEADER_ROW` override the activity tab.

### Site ID

Pipeline and Land Sites gain a `Site ID` column (column CK). Values look like `PIPE-PHX-0001` and `LAND-PHX-0036`. When that cell is present and well formed, it is the deal id and the id on `linked_deal_id`. A blank or unusable cell falls back to an existing registry id, then to the row position. A prefix that does not match the tab, or a duplicate id, stops the build. Until the column exists, ids stay on row order.

### Activity tab

Header on row 1. The map reads Event ID, Date, Site ID, Type, Summary and Visibility. It does not read Source link, File link, Logged by, Direction, Counterparty role or Outcome. Only rows whose Visibility is `Map` are shipped, and only for `listing`, `brochure`, `om`, `financials`, `photos`, `legal`, `doc`, `visit` and `stage`. A blank summary uses a fixed line. A summary that fails the wording check, or contains a price mark, is dropped.

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

## Not in this version

- The workbook sync opens a pull request every four hours when the data changed. It does not merge, and it does not write back to the Sheet.
- Parcel outlines are drawn for Clark, Maricopa, Miami-Dade, and Broward. A folio or parcel number is tried first, then the pin. Broward uses the County Property Appraiser parcel layer. Same-owner adjoining outlines are drawn where the site record has adjoining spare land.
- The 75–250 m review band was not recomputed. Two same-parcel pairs are counted once.
- No write-back of a human call, and no PDF export. The current view exports to CSV.
- The map loads sites, areas, depots, parcels, and the funnel on separate routes, and loads one site's full record when you select it.
