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

Contacted is 0 because the pipeline only has stage 0, stage 1, and Dropped. The step stays on screen.

## Not in this version

- No nightly pull from the live workbook.
- Broward parcel geometry did not resolve. Clark, Maricopa, and Miami-Dade returned 61 wash parcels. Adjoining parcel outlines are not in the inputs.
- The 75–250 m review band was not recomputed. Two same-parcel pairs are counted once.
- No write-back of a human call, and no PDF export. The current view exports to CSV.
- The map loads sites, areas, depots, parcels, and the funnel on separate routes, and loads one site's full record when you select it.
