# Sites

Private map of the site-sourcing universe for Phoenix, Las Vegas, and Miami. It is login-gated. Nothing in `data/generated` is served from `/public`.

## Setup

```bash
npm install
python3 -m pip install -r requirements.txt
npm run build-data
npm run dev
```

`npm run build` produces a production build. Do not put passwords, hashes, or API tokens in the repo.

## Environment variables

Set these in Vercel (Production, and Preview if agents sign in there). Env changes apply on the next deployment.

| Variable | Required | Purpose |
|---|---|---|
| `AUTH_USERS` | yes | JSON list of accounts. Each object is `{"u":"jaideep","h":"<bcrypt>","role":"admin"}` or `"role":"user"`. |
| `AUTH_SECRET` | yes | Signs the session cookie. A long random string. Changing it signs everyone out. |
| `KV_REST_API_URL` | yes on Vercel | Upstash Redis from the Marketplace integration. Used for login lockout. |
| `KV_REST_API_TOKEN` | yes on Vercel | Pair to the URL above. |
| `UPSTASH_REDIS_REST_URL` | alternative | Used if `KV_REST_API_URL` is unset. |
| `UPSTASH_REDIS_REST_TOKEN` | alternative | Pair to the Upstash URL. |
| `ESRI_API_KEY` | no | Keyed Esri World Imagery. Without it the map uses the public World Imagery tiles. Still attribute Esri. |

Planned accounts, none of them created in this repo: `jaideep` (admin), `cindel`, `ming`, `ricardo`, `yuka`, `muse`, `indie`. Admin only opens the accounts page. Everyone sees the same map.

On Vercel, login refuses to run if neither Redis pair is set, so lockout cannot be skipped in production. Locally, without Redis, lockout is skipped.

Also set a Vercel Firewall rate limit on `POST /api/login` if you want the per-IP layer. That is configured in the Vercel dashboard, not in this repo.

## Add a user

```bash
npm run add-user -- cindel
```

The script prints a password once and a JSON object. Paste that object into `AUTH_USERS` and redeploy. Give the person the password by a separate channel. To remove someone, delete their object and redeploy. To hash a password you already chose:

```bash
npm run hash-password -- 'the-password'
```

## Regenerate the data

Drop updated source files in `data/source/` (same names the script already reads). New county verdicts go in `data/source/incoming/` as `.csv` or `.xlsx` with a header row. Useful columns: `site_id` or `market` + `apn`, `adjudicated_verdict` (`PASS`, `MAYBE`, `FAIL`, `NOT_A_WASH`, `UNRESOLVED`), `spare_ac_own`, `spare_ac_same_owner_adjoining`, `parcel_evidence`, `operating_evidence`, `confidence`, `notes`, `reviewer`, `retrieved_at`, and optional `land_tier` (`L10` or `L4`). Then:

```bash
npm run build-data
```

Verdict rows are append-only in `data/verdicts/verdicts.csv`. A changed verdict is a new row that supersedes the old one. Ids for pipeline-only and land-only rows are remembered in `data/id_registry.json` and are not reused.

`npm run validate-data` rebuilds in memory and checks the committed files. The same check runs on pull requests.

## What the map shows

The default view is in-area L10 and L4 sites that are not eliminated, plus a separate held group for L10/L4 sites that sit only in the Las Vegas 200/300 rings. L10 is the screening tab value `FIT_10`. L4 is `FIT_4`. Verification is a badge: county-checked, or aerial only and pending. Grid proxy (Strong / OK / Weak) is a sort signal, not a funnel stage and not a filter. Asking price is shown with its source. Walk-away and target prices are not exported.

Land-only rows from the workbook stay behind a toggle that starts off. Depot pins are the 13 rows in `depots.csv`, with status and confidence. Low confidence is a hollow pin. Every pin says status provisional.

## Counts from this data drop

| Step | Count |
|---|---|
| Census rows | 1,701 (LAS 428 / PHX 561 / MIA 712) |
| Unique sites | 1,643 (1,645 records; two same-parcel pairs counted once) |
| In service area | 1,041 (LAS 182 / PHX 251 / MIA 608) |
| Land tier L10 | 25, all 25 county-checked |
| Land tier L4 | 44, of which 3 are county-checked and 41 are aerial only |
| Eliminated, not a wash, in area | 7 |
| Held L10/L4 (200/300 rings only) | 18 (5 L10, 13 L4) |
| Candidates (in-area L10/L4, not eliminated, not a tenure FAIL) | 67 |
| Of which listed | 5 |
| Of which contacted | 0 |

Muse's in-area reference, shown on the map and not used as the count, is 1,043 (LV 179 / PHX 254 / MIA 610).

The brief expected about 48 L4 sites. This export has 44 inside the operative area. The screening tab has 61 `FIT_4` rows: 57 joined to a site record, 44 of those are in the operative area, 13 are in the Las Vegas 200/300 rings, and 4 did not join a site. 44 + 4 = 48. L10 matches the expected 25, and all 25 are county-checked. Three of the in-area L4 sites are county-checked.

Contacted is 0 because the Pipeline tab only has stage 0 (Off-market target), stage 1 (Desk screen), and Dropped. The stage is still shown.

County-checked in-area land fits split as PASS 6, MAYBE 11, FAIL 10, NOT_A_WASH 1, UNRESOLVED 0. One of those FAILs is a tenure fail (a landlord-controlled pad) and is removed from the candidate view. The other county-checked sites in the reconciliation file that are not L10 or L4 stay visible when you step back.

Pipeline tab has 78 rows, not the older note of 79 (49 off-market, 18 desk screen, 11 dropped).

## Not in this version

- The universe CSV does not use `FIT_10` / `FIT_4`. Those codes are on the workbook screening tab, which is what the build reads. Its `power_proxy` values are Strong, OK, Weak, and Unknown. The universe file's coarser `favourable` / `weak` field is not relabeled as Strong or OK.
- Nightly pull from the live workbook is not wired. Replace the files in `data/source` and rerun the build.
- Broward parcel geometry did not resolve. Clark, Maricopa, and Miami-Dade outlines were fetched for county-checked sites (61 parcels). Same-owner adjoining polygons are not in the source files.
- The 75–250 m review band and edge-band distances were not recomputed. Two same-parcel pairs are flagged: LAS-V2-249 with LAS-U878, and LAS-V2-226 with LAS-U97.
- Human verdict write-back, PDF export, and outreach text are not in this version. The current view exports to CSV.
- Aerial photos are not in the repo. The map uses live imagery.
- PHX-U644 and PHX-U646 are outside the service area on this screen. The plan noted the screening tab had marked two Phoenix rows the other way.

## Login behavior

Sessions last 7 days in an httpOnly cookie. Every page and every `/api` route checks it, and each data route checks again. Five wrong passwords for one known username in 15 minutes lock that username for 15 minutes. The failure message does not say whether the username exists, except once the lockout message applies.
