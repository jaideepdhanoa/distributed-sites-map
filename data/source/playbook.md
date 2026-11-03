# Universe Playbook — Building & Validating a Site Universe

**Moove Distributed Sites · Institutional memory of the Nov 2026 three-market run (LAS / PHX / MIA)** **Written Nov 3, 2026, from the project record: `BRIEF.md`, `CENSUS-MERGE-SUMMARY.md`, `screening/`, `grok-compare/COMPARISON.md`, `adjudication/` (verdicts, round-2 verdicts, verification memos), `licences/NOTES.md`.**

This is the method that survived contact with three counties, two independent agent teams, and 65 contested parcels adjudicated down to county records. Follow it and you will skip roughly a month of errors we already paid for. Where this playbook names a site, that site is the tuition — the mistake was made there, on the record, so it never has to be made again.

---

## 1\. Purpose & when to use

Use this playbook whenever Moove opens:

- **A new city** — a new service area where no validated universe exists yet, or  
- **A new business category** — quick lube, tire, auto repair, small gas/c-store — inside a market whose car-wash universe already exists (the census-first directive, R-060, mirrors the same process per category, one category at a time).

The deliverable is never "a list of businesses." It is a **parcel-keyed universe** in which every surviving candidate carries: a county-verified parcel identity, a measured amount of usable spare land on land the business actually controls, a dated operating-status finding, and an evidence trail a second team can re-run. Anything less is a lead list, and lead lists are what this process exists to replace.

**Division of labour.** The workbook (Pipeline workbook, Universe tab) is the shared display and the system of record for decisions. Local files are the computable record — every count in the workbook must be reproducible from a local CSV. The workbook's owner is Jaideep; agents may change it only on his direction. External actions (broker contact, NDAs, proof of funds, offers) are gated separately (R-006 approval before contact; offers also need Cindel's approval) and are **not** part of universe building — a validated universe authorizes nothing by itself.

**Two axes, never conflated.** Every row carries both:

- **Archetype** (business category): car wash today; quick lube / tire / repair / gas-c-store next.  
- **Site class** (physical form): **Core** (the business is the property, own parcel) / **Gas-attached** (wash pad sharing a fuel/c-store parcel) / **Embedded** (a unit inside another business or building — suite, condo folio, mobile detailer).

Class predicts failure mode: core sites fail on land, gas-attached sites fail on control and circulation, embedded sites mostly fail on everything. Report every count decomposed by class. A headline that mixes them (Miami's "588 in-polygon" was 296 gas-attached \+ 170 embedded \+ 122 core) is a false headline.

## 2\. The pipeline at a glance

Run the stages in this order — cheapest and most discriminating first. Never skip ahead: land work on a site that fails geography is wasted, and adjudication on a site that fails operating status is wasted twice.

| \# | Stage | What it does | Nov 2026 reference numbers |
| :---- | :---- | :---- | :---- |
| 0 | **Census** | Enumerate every candidate in the county/market from the source stack (§3) | 784 parcel-verified base rows |
| 1 | **Merge \+ dedupe** | Union all sources, normalize identity, dedupe to sites, quarantine the unverifiable (§4) | 1,701 rows → \~1,640 sites |
| 2 | **Service-area screen** | Point-in-polygon against the authoritative geometry (§5) | 1,279 in area (rows) |
| 3 | **Land screen** | Aerial review with parcel boundaries; usable spare measured on the controlled parcel (§§6–7) | 92 land fits (of 1,279) — the formula pre-screen said 383 |
| 4 | **Tenure screen** | Owner vs tenant; recorded-lease check on finalists (§6) | removed \~0 at first pass by design — it is a finalist screen, not a bulk screen |
| 5 | **Power proxy** | Substation/HV distance class only — never a capacity claim (§6) | 78 of 92 land fits passed proxy |
| 6 | **Zoning / flood / UST** | Commercial zoning, FEMA flood, state tank records incl. the 75 m neighbour rule (§6) | only 5 of one team's finalists passed the full combined layer |
| 7 | **Listings match** | Match live listings against the universe; listed ∩ fit \= outreach path, unlisted ∩ fit \= off-market queue | 58 listings → 51 matched; 1 genuine census miss found |
| 8 | **Adjudication** | Every candidate-grade disagreement between independent reviews settled from county records (§8) | 73 sites adjudicated across three rounds |
| 9 | **Reconciliation** | Frames reconciled, corrected numbers conceded in writing, final tally published (§10) | PASS 10 / MAYBE 21 / dead 32 / unresolved 2 (§13) |

**Funnel discipline (non-negotiable):**

1. **Report every stage count, every time**, decomposed by market × class. A funnel quoted only at the top and bottom hides where it leaks.  
2. **Rows ≠ sites.** Until dedupe is done and stated, every count is a row count and must be labelled as one. The single most expensive confusion of the round was quoting a row count (1,279) against a site count (1,236) and inventing a geography dispute to explain the gap — the gap was duplicates (§5).  
3. **Counts carry their layer.** Every quoted number states its class composition, its confidence floor, and its geography (in-polygon vs county-wide). "1,701" is a census union, not a count of operating washes; say so every time it is used.  
4. **A stage that removes \~nothing is reported as such, not silently dropped** — tenure at first pass removed zero rows *because the evidence standard was set correctly* (§6); that is a finding, not a failure.  
5. **Provisional layers are labelled provisional** in the data itself (`land_verdict_provisional`, basis strings), never just in prose around them.

## 3\. Census building — the source stack

Build in this priority order. Each source nominates; the parcel layer adjudicates (§4). Do not let any single source define the universe — each one has a stratum it cannot see.

### 3.1 County parcel land-use codes (the spine — where they exist)

Query the county's own parcel service for the category's land-use codes, then take the **union** with a spatial join of point sources (below), because codes and reality diverge in both directions.

- **Maricopa County (PHX) — codes exist and work.** PUC **1750–1755** ("CAR/TRUCK WASH" variants). Filter on `'%WASH%'`, not `'%CAR WASH%'` (the narrower string misses variants). Result: 308 coded parcels county-wide, 261 on ≥0.5 ac. Source: the county's own server, `gis.maricopa.gov/arcgis/rest/services/IndividualService/Parcel/MapServer/1` (full attributes, no republish needed); the assessor's `gis.mcassessor.maricopa.gov` MaricopaDynamicQueryService carries the same codes. **But codes ≠ operating washes:** OSM found 425 deduped sites; 196 operating washes sit under non-wash codes (111 of them convenience-store/fuel parcels), and 85 coded parcels have no OSM feature (closed, converted, or code lag). Coded ∪ spatial-join union \= 504 verified parcels \+ 3 OSM-only \= 507 rows.  
- **Clark County (LAS) — no wash code exists.** Washes hide across 11 land-use codes (largest buckets: 358 Retail, 42 washes; 370 Automotive, 36; 375 Service Stations, 29; the 370+375 pool alone is 1,378 mostly-non-wash parcels). A code query is therefore useless as a numerator — the method is a **spatial join**: OSM/licence points → parcels. That join verified 137 wash-hosting parcels county-wide. Parcel attributes came via the City of Las Vegas GIS republish (`CC_PARCELS_SHP` FeatureServer, services1.arcgis.com/F1v0ufATbBQScMtY, layer 1); the county's own services publish geometry/APN/acreage only. **Quirk: `LOTSQFT` is zeroed in that republish — use `ASSR_ACRES`.**  
- **Miami-Dade (MIA) — no wash code exists.** Verified washes sit in 2626 Service Station–Automotive (52 of 85), 2719, 2611, … Spatial join against `MD_LandInformation` layer 26 (PaParcel): 85 verified wash parcels \+ 1 OSM-only.  
- **Broward (MIA) — unverified code claims; use the state cadastral join.** A USECODE 1801 "Car Wash" count was claimed in two mutually contradictory versions (62 county-wide / 49 ≥0.5 ac in one message; 112 / 71 in a manual section). Neither reproduces: `gis.broward.org` does not resolve, and BCPA's reachable `NEW_PROPERTY_CODE '1801'` is a *generic commercial* code (264 records, samples are office parcels). Verified floor instead: **53 wash parcels (50 ≥0.5 ac) via the FDOR statewide cadastral spatial join**. Rule: when a claimed code count cannot be reproduced from a reachable endpoint, strike it and rest on the verified floor (§10).  
- **For a new county, first answer three questions before pulling anything:** Does the parcel layer carry a category code at all? Is the assessor's *live record* reachable separately from hosted extracts (it matters later — §8)? Is there a state-wide cadastral republish (Florida's FDOR layer saved Broward)?

### 3.2 Business-licence layers (the stratum OSM misses)

Licences found an entire stratum the point sources missed (e.g., Wash N Go Sahara, Las Vegas, existed in no other source). Adopt licence pulls into your *own* build — never import another team's licence-derived rows as a one-off.

- **City of Las Vegas** — `BusinessLicenses` FeatureServer (services1.arcgis.com/F1v0ufATbBQScMtY, layer 0). Car washes \= **NAICS 811192** (categories A45/C02, "General License"). Pull NAICS ∪ name-WASH: 1,205 unique licences → live statuses deduped by parcel (PRCLID) → 547 parcels → 103 on commercial land-use codes → **82 new candidates**. The layer carries history — filter to live statuses or you will census the dead.  
- **Clark County (unincorporated)** — `BusinessLicense/BusinessLicenseData` FeatureServer layer 1 (maps.clarkcountynv.gov). **The server is flaky; build retries in from the start.** Filter on credential descriptions ("Auto Wash/Detailing" \+ "Auto Wash/Detailing – Other Services" \= 490 records) → live (Licensed / Pending / Temporary / Delinquent) deduped \= 413 parcels → 137 commercial → **94 new**. Combined Las Vegas licence yield: **176 candidate parcels** beyond the parcel/OSM census.  
- **Miami-Dade LBT** — `BusinessTracker` MapServer layer 0 "LocalBusinessTax" (gisweb.miamidade.gov; 194,512 records, current-year cycle). Categories are too coarse to filter ("SERVICE BUSINESS"; NAICS unpopulated), so: **name patterns \+ `ACCSTATUS = Active` \+ folio join**. 406 name hits → 307 relevant → 285 active → 250 deduped sites. **132 records carry no folio** — recover them by spatial join on their coordinates, and **pass `outSR=4326` or the geometry returns in state-plane feet and every point-in-polygon test silently fails** (first run scored 0/132 for exactly this reason). Yield: 200 new candidates county-wide, \~118 commercial-plausible.  
- **Broward BTR — portal-only.** Records live in a per-receipt portal (broward.county-taxes.com). There is no bulk source. **Treat as unavailable; never backfill from receipt fragments** — that stratum produced the ghost rows of §3.4.  
- **Phoenix — no licence layer exists.** Arizona does not licence car washes as a general category and there is no public TPT registry. The functional equivalents are the parcel codes, Overture, AllThePlaces, and chain locators. In a new market, establish *early* whether the category is licensed at all; if it isn't, say so in the build notes and lean on codes \+ points.  
- **Jurisdiction matters.** City and county licence systems diverge in coverage and status. Charleston Car Wash, Las Vegas: the *city* licence (authoritative inside city limits) reads Active at **1961** E Charleston Blvd; another team's read carried it as low-confidence/lapsed at *1901*. Pull both jurisdictions where both exist, and let the jurisdiction the parcel sits in govern.

**Licence discipline (absolute):**

1. **Names nominate, parcels adjudicate.** A licence is a claim about a business name at an address; the parcel join \+ land-use code decides whether it is a site.  
2. **Live statuses only.** Operating evidence \= Licensed / Active / Pending / Temporary (city set: Active / Issued / Collection / PreCollect / Delinquent). Anything lapsed- or delinquent-*only* is **quarantined — flagged in-row, excluded from operating counts, never silently deleted** (it may be a land lead). The Nov round quarantined 4 rows lapsed in every read (Detailers of Las Vegas, Wash Up LLC, The Collection Auto Spa, WOW 1925 E Sunset) — and note Wash Up LLC still received a *pass* in one team's review because the quarantine didn't travel with the row. Quarantine status is a column, not a comment.  
3. **Quarantine cuts both ways — check before you bury.** Two quarantined rows (Mon Carwash, 3550 Cambridge St; Daniela's Car Wash, 4760 S Pecos Rd) held live *Pending* county licences and were rescued into the universe with a first-priority verification flag.  
4. **Expect noise classes and classify them at merge:** laundromats (name pulls), dog washes, window washing, pressure washing, dealership-embedded detail, home-based detailers (the parcel test kills most of these: 423 of 547 city licence parcels sat on residential/other parcels and fell out on land use — the parcel adjudication is the noise filter).  
5. Licence self-reported fields (e.g., Clark's `USER_LandUse`) are unreliable — adjudicate land use from the county parcel layer, never from the licence row.

### 3.3 Point sources: OSM, directories, chain locators

- **OpenStreetMap** is the recall backbone where codes fail (139 wash points in Clark County; 425 deduped sites in Maricopa). Treat OSM tags as nominations: an OSM `car_wash=yes` tag was the *only* evidence for Golden Market's wash (§9) — and was, in the end, true but unverifiable from imagery alone.  
- Add **Overture Maps Places, AllThePlaces, Google Places/Yelp directories, and chain locator pages** (each chain's own locations page doubles later as top-tier operating evidence — §9). Location pages beat aggregators at every stage of this pipeline.  
- Directories and aggregators are the *least* reliable layer (stale closures, §9). Use them for recall, never for verdicts.

### 3.4 Licence ghosts and fragment rows

Indie's v1 census carried 10 Broward rows (their rows 563–572) with **blank names, fragment addresses ("1", "17"), all low-confidence lapsed-licence sourced**: 9 matched nothing anywhere; two were internal duplicate pairs (73 m apart with consecutive folios; 107 m apart, both address "1"). These are **licence ghosts** — artifacts of fragmentary tax-receipt data, not businesses. Exclude outright and log the exclusion. Signature to scan for in any new build: blank/fragment identity fields \+ lapsed-only status \+ no parcel corroboration. A related tail pattern — a final row with names "1", address "1" sourced from an owner-name search — persisted into v2; scan the tail of every imported file, not just its head.

### 3.5 Prove recall with a holdout

Build a **holdout set** of known-operating sites in the category (web sample \+ sites the business already knows) *before* merging, and score each census version against it. Nov round: 83 known washes; the second team's census improved 55/83 (v1) → **78/83 (v2)** — a real, verified improvement, largest in Miami. Without the holdout, "we found more" is unfalsifiable. **Capture-recapture population estimates are not a substitute** — the Miami estimate (2,024) was unstable by its own author's assessment; do not cite one.

### 3.6 The census is never complete — plan the audit

The listings match (stage 7\) found a genuine operating wash in *no* census source (Lake Mead Car Wash, 1450 E Lake Mead Pkwy, Henderson). And the round's \#1 off-market target, **3045 N Lamb Blvd**, appears in **no source at all** — not OSM, not either team's census, not either licence jurisdiction. Rules: (a) treat listings as a census audit, and feed every miss back as a row with provenance; (b) a target attested by zero sources is a *parcel lead, not an operating wash* — ground-truth it before any approach is designed.

## 4\. Identity & joins — where counts go to die

More wrong numbers in Nov 2026 came from identity errors than from every other cause combined. Get this section right and most of §§5 and 10 become boring.

### 4.1 The normalization rule

**One join key, everywhere: strip all non-alphanumerics, uppercase, strip leading zeros.** Apply it to every APN/folio on both sides of every join, no exceptions.

- Miami-Dade folios arrive zero-padded (13-digit) in one source and unpadded (12-digit) in another; without zero-stripping, most true pairs read as misses. A prefix pass on un-normalized data recovered only a handful and hid the rest.  
- Phoenix APNs carry dashes in sheet data; Clark parcel IDs are undashed 11-digit (`PARCEL` \= the licence layer's `PRCLID` — same key, different costume).  
- The same bug lives inside a single county's products (MD layer 26 stores `FOLIO` undashed while LBT records carry it padded).

### 4.2 Join order and the review band

Match in this order: **(1) normalized APN → (2) ≤75 m proximity → (3) address.** Pairs landing at **75–250 m are a manual-review band**: flag them in-row ("REVIEW BAND"), never silently merge them and never silently double-count them. The Nov merge carried 38 flagged band rows into the universe explicitly; the other team resolved 341 band pairs (70 merged) in its own dedupe. Big parcels legitimately generate band pairs (a point placed elsewhere on the same large parcel sat 101–205 m from its twin in six Las Vegas rows) — the band is where a human, or a parcel polygon, decides.

### 4.3 Rows ≠ sites — the duplicate lesson

The merged universe held **1,701 rows but only \~1,640 sites**. Inside the in-area set alone, **59 duplicate rows** by the other team's site-level count, **91** by 100 m coordinate clustering — same order, same conclusion: roughly 5–7% of rows were second copies. Known duplicate shapes:

- **Same site, two APNs:** QC Car Wash (NW 27th Ave) twice; Sun Devil (McClintock) twice under different APNs; Quick Quack, Las Vegas, double-counted on two APNs 74 m apart.  
- **Same parcel, two rows:** 10465 and 10521 S Rainbow Blvd are *one* station on *one* parcel (APN 17627823002\) carried as two universe rows and, for a while, scored as two different stations by both teams.  
- **Same APN, two "sites":** Maricopa APN 16636003K appeared on two sites 12.4 km apart — one is simply wrong. A normalized-APN collision at distance is a data error to resolve, not a merge to perform.  
- **Adjacent folios, one corner:** a site can be captured under its neighbour's folio via a side-street address (the 1870 SR 7 / 1890 NW 40th Ave corner) — hold such rows; parcel geometry at adjudication sorts them.

**Rule: dedupe before any cross-team or cross-stage comparison, and state the denominator (rows or sites) next to every count.** §5 shows what happens when you don't.

### 4.4 Suites, embedded rows, and parcel inheritance

- **Suite/embedded records inherit the parent parcel's verdict.** Nine suite records in the Nov screen took their parent parcel's aerial verdict rather than a fabricated one of their own. A suite tenant has no land of its own; do not let it generate an independent land verdict.  
- **The master-parcel trap:** licence rows are often suite tenants on large multi-tenant parcels, and any formula that credits "parcel spare" credits the *whole parcel's* spare to the tenant. This was the single biggest distortion in the provisional screen — the provisional Las Vegas core land-PASS list was dominated by suite licensees (auto-glass, wrap, detailing tenants at suite addresses). Embedded rows get their land from the parcel they sit in, assessed once, at the parcel.  
- **Centre parcels inflate lot size.** A station inside a shopping-centre parcel "has" a 6.78-ac lot on paper (Terrible's Decatur). Lot size from the county record is the *parcel's*, not the pad's; §6 handles what that means for spare.

### 4.5 Coordinates are a deliverable, not a detail

160 of 1,701 rows arrived without lat/lon. Recovery paths, in order: APN join to a sourced twin (59), licence x/y converted from state plane (37), batch geocoder (51). **13 rows were never recovered** and are `Unknown` at every spatial stage — invisible to geography, land, and power screens. Track the no-coordinate count as a funnel line of its own; a row with no point is a row that silently passes nothing and fails nothing. Depot-distance cross-checks against another team's figures should show median \|Δ\| ≈ 0.007 mi (98.5% within 0.05 mi); outliers are point-*placement* differences — flag them, never average them away.

## 5\. Geography — the service area is a fact, not an estimate

### 5.1 Get the authoritative polygons first

The service area is defined by the ODD owner's geometry — in Nov 2026, Jesse DaSilva's My Maps files, supplied as **KMZ** and parsed to `kmz/geometry.json`. Know the shape of your market's geometry before you screen:

- **LAS:** nested rings — `Vegas_core_~50 ⊂ vegas_100 ⊂ vegas_200 ⊂ vegas_300`; the outer ring (300) *is* the service area. 3 depots.  
- **PHX:** a single polygon, `phx_2026_v5`. 6 depots.  
- **MIA:** a **union** of six polygons (Polygon 1, Launch ODD, Ft Lauderdale, Highland Lakes, Fontainebleau, Extended ODD). One ring ("Extended ODD") is stored as a *closed LineString* — treat it as a polygon or you silently lose that whole sub-area. 4 depots.

**Exclude future geography.** The MIA KMZ also carries a "Mid-2027 Northern ODD Boundary" — a 2-point line, not an area. Future boundaries, expansion sketches, and depot wish-lists stay out of the screen until they are adopted polygons.

### 5.2 The cost of reconstructed geometry

Before the KMZ arrived, the screen ran on polygons *reconstructed* as concave hulls of the other team's in-area points. When true geometry replaced them, **40 rows changed classification** (3 In, 37 Out — 35 of them Phoenix, where the hull overshot `phx_2026_v5`). Two warnings travel with this:

- A reconstructed hull's **self-agreement is 100% by construction and proves nothing**. The honest test is leave-one-out (≈93% here) — and even that flatters edges.  
- Sites within a few hundred metres of a reconstructed edge are provisional. Keep a **2-mile Edge band** for reporting, and never let an Edge site's fate rest on hull geometry (4210 W Glendale Ave sat "Edge" for weeks; true geometry put it 8.5 mi from the nearest depot — out, decisively, on geometry alone).

**Order of operations: obtain the true polygons before the land stage.** Aerial review is the expensive stage; spending it on 37 out-of-area sites is the tax for screening on estimates.

### 5.3 Validating a geometry claim — the 1,219 / 8 / 0 test

When two teams' in-area counts differ, do **not** compare totals and argue. Compare **membership, site by site**:

1. Dedupe both sets to sites (§4).  
2. Join the two site sets on identity (normalized APN \+ proximity \+ address).  
3. Tabulate the four cells: both-in, both-out, A-in/B-out, B-in/A-out.

Nov result on 1,227 APN-joinable shared sites: **1,219 both-in, 8 flips one way, 0 the other** — two polygon sets that agree on 99.3% of sites are *materially the same geography*, whatever their provenance. The in-area totals differed (1,279 vs 1,236) for a non-geography reason: duplicates (§4.3). **Verdict rule: membership agreement on shared sites is the only admissible evidence in a geography dispute.**

### 5.4 The artifact that must never recur

The first comparison joined on APN *after one side had deduped*. Dedupe survivors carry different APNs than the rows they absorbed, so 57 Torque in-area rows appeared to have "no counterpart — 45 of them core," and an entire "they used older polygons and missed our sites" theory was built on it. It was false; the correction is §10's worked example. **Never run an APN join against a deduped set and interpret non-matches as absences.** Join on the site identity (all member row IDs / APNs of the cluster), or don't join at all.

### 5.5 Boundary cases

Expect a handful of true boundary flips (8 in Nov: mostly embedded suites and two Phoenix sites). Handle them as their own line in the funnel ("in area, \+2 boundary cases" is an honest way to report them), resolve them against the authoritative polygon, and move on — boundary cases are noise, not signal, and never worth a cross-team dispute.

## 6\. Screening stages & standards

### 6.1 The unified verdict scale (use exactly this)

Every land/operating verdict in every market, from every reviewer, uses one scale. Two scales in one funnel was a structural cause of the Nov disagreement (the teams' top bands overlapped by only 9 sites).

| Verdict | Definition |
| :---- | :---- |
| **PASS** | Operating business (§9 evidence) **and ≥0.25 ac of usable spare on the business's own parcel** (§6.2), no stage-6 blocker |
| **MAYBE** | 0.15–0.25 ac usable spare on the own parcel; **or** ≥0.25 ac reachable only via verified same-owner adjoining parcels (§8.4); **or** PASS-grade land with a material caveat (tenure, flood, in-use land) |
| **FAIL** | Operating business, but usable spare \<0.15 ac, or the credited spare belongs to someone else, or a stage-6 blocker kills it |
| **NOT\_A\_WASH** | (category verdict generally: **NOT\_A\_BUSINESS**) No operating business of the category at the site — closed, converted, vacant, wrong business, or no business at all |
| **UNRESOLVED** | The available records cannot settle a load-bearing fact. The verdict must name exactly what is missing (§6.5) |

Threshold arithmetic to internalize: **0.25 ac \= 10,890 sq ft; 0.15 ac \= 6,534 sq ft.** The 10-stall standard (10 stalls ≈ the project's land test; land check runs at 450 sq ft/stall all-in, minimum 4 stalls) maps to the 0.25-ac line. A "FIT\_10 ≥10,000 sq ft" floor is 0.23 ac — *below* the line; half of a "4,000 sq ft and up" band is below the MAYBE floor entirely. Mixed floors inside one funnel silently manufacture disagreement. Pick the scale above and convert everything into it at intake.

### 6.2 What counts as spare — and what never does

**Spare \= open, usable land the operation does not need:** surplus paving, vacant dirt inside the parcel, parking demonstrably beyond operational need.

**Never spare (operational or committed land), however empty it looks from above:**

- Tunnel, wash bays, **vacuum and drying aprons** (Clean Freak, 1702 N 44th St, PHX — the "field" was the vacuum/drying apron; FAIL at 0.10 ac true spare)  
- **Queue lanes, entrance drives, pay-kiosk circulation**  
- **Working forecourts** — Wash Tubb (13849 N 32nd St, PHX): both reviews credited the forecourt; true usable spare 0.21–0.24 ac → MAYBE. Davie Self Serve: the credited 0.31 ac "open paving" is the apron the bays open onto; true spare 0.19 ac fragmented → MAYBE  
- **Occupied working yards** — Global Truck (8112 S Valley View, LAS): the "spare" yard is a full truck/vehicle storage yard in active use  
- **Shared shopping-centre parking** — 4530 W 12th Ave, Hialeah: the "spare" is the centre's common parking, not wash-controlled land; Nexus Way (LAS) round-1 split the same error differently (see §8.3)  
- **Landscaping** — S Rainbow Blvd (LAS): the "unpaved pad" is planted xeriscape frontage; landscaping is committed land  
- **Land in active other use** — the MAX site (20780 NW 27th Ave, MIA) holds a *lined, maintained soccer pitch* inside its folio (0.43 ac). The land is real and it is the wash's; it is also evidently used by someone for something. Record it as PASS-grade land **with an in-use caveat** and let a human decide usability — do not quietly count it as vacant, and do not quietly zero it either

The pattern underneath all of these: **aerial emptiness is not spare.** Spare is a conclusion about the operation's needs, drawn from the imagery *and* the format of the business, not a pixel class.

### 6.3 Tenure — a finalist screen with a positive-evidence standard

- **First pass is a flag, not a filter.** Infer tenure from owner-name matching (operator entity vs owner of record), but code **"no match" as Unknown, never as tenant-risk.** In Nov, 1,034 rows had no name match; treating absence of a match as evidence of a lease would have gutted the funnel on no evidence. Result under the correct standard: tenure OK 195 / Unknown 1,505 / Tenant-risk 1 — the stage removed \~zero rows at first pass, *by design*.  
- **Positive evidence only** promotes a row to tenant-risk: a recorded lease, an NNN investment listing, a landlord-centre structure. The fresh-listings gates used this correctly — NNN ground-lease sales (tenant owns the business, landlord owns the land) are tenure-fails for acquisition regardless of land.  
- **Finalists get the recorded-lease check.** Read what the recorder actually holds before assuming the interesting land is available: 4210 W Glendale Ave's *only* lease recording is a Memorandum of Lease covering the **whole parcel** — the target northern land was inside the lease, which (with true geometry) closed the site.  
- **Which parcel holds the spare decides the tenure read.** BLISS Tropicana (LAS) FAILs on tenure: operating wash, but a tenant pad in a landlord-controlled centre — the spare is the landlord's other pads. Terrible's Decatur PASSes *with a caveat*: the spare dirt is inside the station's own APN, even though that APN is a landlord-owned centre parcel — pad control still runs through the centre owner, so the caveat travels with the PASS. Same centre-parcel shape, opposite verdicts; the difference is which parcel the spare sits on. Always ask that question explicitly.  
- **Operator ≠ landowner is normal** (Wash Tubb's landowner of record is a development LLC, not the operator; the Green Light wash folio and land folio sit in different entities). Record both names on every candidate row; a two-party assembly is a deal structure, not a screen failure — but it must be *visible* in the row, not discovered in diligence.

### 6.4 Power — a proxy, labelled as one

Power screening at universe scale is **substation/HV distance only** (Overpass-derived elements; class Strong / OK / Weak). It ranks; it does not certify. Typical existing service is \~500 kW against a 1.7 MW requirement for 10 stalls — distance says nothing about deliverable capacity, and **no power column in the universe may be phrased as a capacity statement.** House rules:

- Label the basis per row — the two teams' "OK" classes were built on different thresholds (substation ≤1.0 mi or HV line ≤1,000 ft vs substation ≤1.5 mi). Unlabelled, they compare as if identical; they aren't.  
- Where real utility data exists, use it **for finalists only** (Las Vegas: NV Energy DRP map — the only market with real public power data this round; elsewhere proxies until NDA-stage diligence).  
- Power is deliberately late in the funnel: it removed only 1 of 31 FIT\_10-standard finalists (30 survived). Its discriminating power is low at proxy level; don't let it veto land-stage work, and don't present proxy-passed counts as power-cleared counts.

### 6.5 Flood, UST, zoning — the environmental layer

One team's funnel had flood but **no UST stage**; that asymmetry alone hid the round's most consequential flag. Run all three on every finalist:

- **Flood (FEMA NFHL).** Point queries classify the site point; for finalists, sample the parcel (Davie Self Serve: 47/47 grid samples Zone AE — parcel-wide SFHA, coastal floodplain; the land verdict is MAYBE *and* any build carries flood-compliant construction \+ insurance). Verify flood values at the **record level** — a spreadsheet grid read briefly "showed" Green Light as AE/SFHA=T; the cell-level value is Zone X, SFHA=F. (See §11: grids lie; records don't.)  
- **UST / tanks (state programme records).** In Florida: FDEP **PCTS** (discharges) \+ **STCM** (facility) layers, with the facility's document file in DepNexus/OCULUS as corroboration. Measure the 75 m rule as **facility point → parcel polygon boundary** (not point-to-point). Then apply the two lessons of Green Light:  
  1. **The flag may be the neighbour's.** Green Light's own facility (FDEP 8502654, "Sonny's Car Wash \#008", point inside the wash folio) has one discharge, closed, SRCR effective 2003-06-04. The *open* discharge within 75 m belongs to the Sunshine station across the road (FDEP 8502246, \~39 m, status WORK UNDERWAY / RA). Attribute every flag to its facility of record before it touches a verdict.  
  2. **Read dates by kind.** 1988 was a *discharge* year (misread as a closure); 2003 was the *closure* (SRCR); 2011 was a batch of *invoice-audit* documents (misread as cleanup completion). Discharge date, status-effective date, and document dates are three different facts. A UST flag is a **diligence item, not a kill**: of 230 flagged rows in one dataset, most releases were already No Further Action. What kills is an *open release on the site's own parcel* — establish that specifically.  
- **Zoning.** Confirm commercial/auto-use zoning for finalists from the county record. (The strictest combined layer this round — land \+ tenure \+ power \+ not-SFHA \+ no open UST within 75 m \+ commercial zoning \+ lot ≥0.5 ac — passed exactly **5 sites** across three markets. Quote combined-layer counts only with the layer spelled out.)

### 6.6 UNRESOLVED is a verdict, not a shrug

Use UNRESOLVED when records genuinely cannot settle a load-bearing fact, and **write what is missing** in the row: 2401 E Van Buren (PHX) — station active, *no current source confirms a wash* (a 2014 flyer is the only wash evidence); land would pass if one operates. 4910 S Maryland Pkwy (LAS) — caught mid-redevelopment; needs current status \+ the as-built plan. Both are street-level tasks. An honest UNRESOLVED with a named missing fact is worth more than a forced PASS/FAIL — and it is the only verdict class allowed to survive the final tally.

## 7\. Aerial review — the render is the verdict

### 7.1 Render spec (per site)

- Esri World Imagery `/export`, **1024×1024**, red crosshair on the site point, **50 m scale bar**.  
- Half-extent **120 m** default; **170 m** for lots ≥2 ac; **240 m** for lots ≥4 ac.  
- **The parcel boundary is drawn on the render** — the wash's own parcel in one colour, **verified same-owner adjoining parcels** in a second, everything else unmarked. A 0.25-ac reference square on the render calibrates the eye.  
- Verdict fields per site: verdict (on the §6.1 scale), est. spare (sq ft/ac), pad location, blockers, confidence.

### 7.2 The single biggest lesson: no boundary, no verdict

The round ran a controlled experiment by accident. One review (Torque) read **every** in-area site at full depth but with **no parcel lines** — spare judged by eye around a crosshair. The other (v3) rendered parcel outlines but read most sites quickly. On the 1,221 sites in-area under both geographies, 3-band agreement was **44%**; top-band overlap was 9 sites of \~43. Adjudication then showed the no-boundary review's characteristic error in bulk: **spare credited on adjoining parcels and working yards** — Cobblestone Baseline, WOW N. Pecos, Super Bubble Tropicana, Busy Bee, Splash and Dash, Global Truck were all top-band calls whose land belonged to someone else or to the operation (§8). County parcel records were the single largest correction source in the entire exercise (off-parcel or third-party spare credited by one or both reviews in \~20 cases).

**Rule, absolute: no land verdict above MAYBE is issued from a render without the county parcel boundary on it.** Depth of read cannot substitute for the boundary; the boundary cannot substitute for depth (§7.3). Finalists get both.

### 7.3 Blind review, and the quick-pass trap

- **Reviewers are blind to the other team's verdicts.** Record the other verdict only as a comparison field; disagreements get flagged, not averaged. Anchoring is how two reviews become one wrong review.  
- **Quick passes are triage, never verdicts.** The v3 quick stratum — 783 gas/embedded sites read exception-only from contact sheets, default-fail at low confidence — produced **both** failure directions: generous false passes (0.3-ac "passes" on fully built pads) *and* false fails, and its agreement rate (42%) trailed its own full-review subset (54%). Gas-attached and embedded sites are precisely where land control is subtlest; they are the last stratum that should be read quickly. Any site a quick pass promotes to candidate grade gets a full boundary render before it counts.

### 7.4 Formula screens are triage only (\~4× overcount)

The formula land screen (lot − building footprint, with per-type operating-need reservations) passed **383** sites; the aerial land stage passed **92**. A \~4× overcount, concentrated in gas/embedded strata (core held up: 46 provisional → 47 real). Two formula-specific failure modes:

- **Master-parcel crediting** (§4.4): the formula assigns parcel spare to whoever's row it is, tenant or not.  
- **Absurd outputs are artifacts until proven otherwise.** Any spare \>5 ac is a parcel-join artifact (a 158.8-ac "spare" on a Scottsdale parcel; a 69.4-ac HOA parcel in Miami) — quarantine and eyeball it, don't rank it.  
- Fixed per-type operating-need reservations (e.g., 1.6 ac reserved for an express wash) distort in the opposite direction and were retired mid-round in favour of lot − 1.15× footprint as the triage formula. Whatever formula you use, label its output `provisional` in the data, and let aerial-with-boundary verdicts own the land stage.

### 7.5 Imagery vintage — the photograph is a date, not a truth

Esri imagery is undated per tile. Three vintage traps, all hit this round:

- **Under construction reads as not-a-wash.** MAX NW 27th (MIA): the tunnel stood on fresh concrete pre-opening; the review read NOT\_A\_WASH at capture; the wash has since opened. Wash N Go Sahara (LAS) likewise reads as a construction site in imagery but opened late Oct 2026\. Danny's, 12010 N Tatum (PHX): construction site, no operating wash *yet*.  
- **Mid-redevelopment reads as ambiguity** (Maryland Pkwy, §6.6).  
- **Closed reads as operating.** Imagery of Sun Devil and Bubbles Rainbow shows intact washes; both had closed (dated closure evidence, §9). The lot does not announce its own death.

**Rule: every aerial verdict that turns on operating status is paired with dated operating evidence (§9), and every NOT\_A\_WASH verdict carries an imagery-vintage caveat in its notes.** The aerial stage decides *land*; the evidence stage decides *operating*; neither impersonates the other.

### 7.6 Human-review packs

Ship the imagery so a human can audit the machines: per-market **contact sheets** (all in-area sites \+ a fits-only sheet), a manifest **index.csv**, the merged verdict CSV, the summary, and full-resolution ZIPs **split to ≤\~75 MB per part** (Drive grant limits, §11). Nov pack: Drive folder "Aerial Review — Nov 2026". If a reviewer can't click from a verdict row to the image that produced it, the pack is wrong.

## 8\. Adjudication protocol — settling disagreements from primary records

When two competent reviews disagree at candidate grade, the disagreement is almost never about judgement. It is about a fact one side didn't have — usually a parcel boundary, an owner string, or a status record. Adjudication retrieves that fact. **Do not** resolve disagreements by discussion, seniority, averaging, or re-reading the same imagery louder.

### 8.1 Trigger and scope

Adjudicate every **candidate-grade disagreement**: either side's top band (PASS-grade) against the other side's negative, below-band, or cannot-tell — plus any pair whose *combination* would change a decision (a listed site, a Pipeline site, a site someone is about to contact). Nov scope: 57 such disagreements, \+ 5 supplements that surfaced *during* reconciliation (four sites both sides had "agreed" on until one side revised, plus one site's environmental/operator questions), \+ a verification round on counter-claims (§8.6), \+ a final round on 4 never-checked agreed sites and 3 residual disputes. Expect the scope to grow exactly like that; budget for it.

### 8.2 County sources per market (the adjudication stack)

| Market | Parcel geometry \+ attributes | Owner / deed truth |
| :---- | :---- | :---- |
| Las Vegas (Clark Co.) | Assessor **LandApp GIS** (parcel geometry; compute acreage from polygons where the county's CALC field is null) | Assessor **ParcelDetail** records per APN and per adjoining parcel |
| Phoenix (Maricopa Co.) | `gis.maricopa.gov` **IndividualService/Parcel** MapServer (full attributes: APN, owner, PUC code, lot) | Same service \+ assessor records |
| Miami-Dade | **MD\_LandInformation** MapServer layer 26 (PaParcel — folio, owner, lot size) | Miami-Dade PA records |
| Broward | **BCPA live property record** (web.bcpa.net) — deed date, instrument (CIN), owner, legal description, assessed land size | BCPA live record is the deed source; FL statewide cadastral (FDOR) for geometry cross-check |

**Live records control over hosted extracts.** BCPA's hosted AGOL tax-roll extracts are stale snapshots — they still showed Green Light's wash folio under its 2014 owner while the live record showed the Dec 2025 deed. Any hosted/cached county layer is a finding aid; the live record is the evidence. Note each source's retrieval date in the verdict row.

### 8.3 Grid probes, never single points

To assign a disputed piece of ground to its parcel, probe a **grid** (5 m cells) across the whole disputed area against county geometry, and cross-check with a **polygon intersection** of the traced area against the parcel polygons. The two methods should agree within \~20%; investigate when they don't.

Why: **2025 N Lamb Blvd (LAS).** There are *two* dirt areas north of the station. Single-point probes sampled the far field (Dirt B — CAB Properties', 1.40 ac inside APN 14019603004\) and concluded "own lot fully built, spare 0.05 ac → FAIL." The grid showed the dirt *directly north of the station, between the vacuum row and the church*, is inside the wash's own parcel: **0.40 ac by grid, 0.476 ac by polygon intersection** (APN 14019603011). Verdict reversed to PASS. Each side had probed a different dirt area and both were "right" about the one they probed.

The mirror error: **MAX NW 27th (MIA)** — point queries covered the pad and the southern parcel and never probed the western field at all; county geometry put a 0.43-ac field inside the wash folio (§7.5). **Rule: probe the whole disputed area on a grid; a probe pattern that doesn't cover the asset is a conclusion waiting to be reversed.**

### 8.4 Same-owner adjoining land — the MAYBE tier's raw material

Spare on a **same-owner adjoining parcel** is real value and a different thing from own-parcel spare. Handle it exactly like this:

1. Verify the owner string **on the county record for both parcels** — assemblages hide everywhere: Durango (BECKER EQUITIES), Wash N Go Lake Mead (BROWN DAVID R, three parcels), Fort Apache (AAA LAND INVESTMENT field to the north), Nexus Way (TOMO NORTHGATE four-parcel assemblage).  
2. **State the split in the verdict, always**: `spare_ac_own` and `spare_ac_same_owner_adjoining` are separate columns (§8.5). Never merge them into one number — the merged number is how a 0.09-own site acquires a 0.41-ac reputation.  
3. Splits get re-measured when challenged: Nexus Way's round-1 split (0.15 own / 0.12 adjoining) was wrong in *both* directions; the round-2 grid put it at **0.09 own / 0.32 adjoining** — verdict (MAYBE) unchanged, numbers replaced.  
4. **Affiliated ≠ same owner.** Entities that look related but are distinct on the record do not count without evidence: BMS PARTNERS LLC ≠ BMS CARWASH LLC (Davie — not counted); EL CAR WASH LAVENDER LLC (wash folio) ≠ GREEN LIGHT CAR WASH INC (land folio) — a two-party assembly, flagged as such. Owner-string equality on county records is the standard; corporate-registry affiliation is a lead for diligence, not a screen input.

### 8.5 Legal descriptions beat GIS polygons

County GIS boundaries are drawings; legal descriptions are the title. When they conflict, the conflict itself is the finding:

**Green Light (1890 NW 40th Ave, Lauderhill).** BCPA's live record assesses the wash folio at **48,631 sq ft (1.116 ac)** and its legal description includes a \~250 ft × \~50 ft strip along the site's south side. The BCPA *GIS layer* draws the folio at **36,152 sq ft (0.83 ac)** and gives the strip to the south folio — whose live-record size is short by the same \~12,480 sq ft. Equal-and-opposite deltas \= the GIS boundary is drawn one strip (\~50 ft) too far north. The first adjudication quoted the 1.116-ac size but measured spare on the 0.83-ac polygon and reported "0 own." Triangulated three ways — metes-and-bounds shoelace from both folios' legal descriptions (**0.283 ac**), live-record land-size arithmetic (**0.286 ac**), GIS offset geometry (**0.287 ac**) — the strip is the wash folio's, it is a finished unused concrete apron in imagery, and the site passes on its own land. When GIS and legal description conflict: (a) compute both, (b) let the legal description \+ live record control, (c) carry a **boundary-survey caveat** on the row if the site advances — a survey/title commitment is the final word, and the row should say so.

The companion failure is **folio identity**: Euro Car Wash Sweetwater's input folio (…010) was a *different owner's* vacant 1.33-ac lot; the wash sits on folio …029 (0.357 ac). A PASS had been measured, carefully, on a stranger's land. Before measuring anything, prove the site point falls inside the wash's folio — proximity is not identity.

### 8.6 The evidence citation standard (every verdict row, no exceptions)

Adjudication output is a CSV with this schema (see `adjudication/verdicts-*.csv`, `verdicts-round2-*.csv`):

`market, name, address, apn, adjudicated_verdict, spare_ac_own, spare_ac_same_owner_adjoining, operating_evidence, parcel_evidence, confidence, notes`

- **parcel\_evidence** cites the county source, the parcel/folio ID, owner of record, and lot size — for the wash parcel *and* any adjoining parcel the verdict touches.  
- **operating\_evidence** cites the dated source that establishes operating status (§9) — source and date, not "looks open."  
- **notes** say what each prior review got wrong or right, so the correction is auditable ("v3's 0.8-ac pass credited the north dirt; county geometry shows it is a third party's vacant parcel").  
- A verdict without both evidence strings is a draft, not a verdict.

### 8.7 The verification round — counter-claims get the same treatment

Reconciliation does not end at adjudication. The other team will return with counter-claims ("your FAIL is wrong, the dirt is in-parcel"; "the deed was December, not August"; "the tank record is closed"). **Verify each counter-claim from primary records with the same protocol** — never defend your number because it's yours. Nov's verification round moved three verdicts (Lamb FAIL→PASS, MAX MAYBE→PASS-grade, Green Light flagged-PASS→clean-PASS) and corrected two of the *counter-claimant's* numbers in passing (closure was 2003, not 2011; the Lamb figure was 0.4–0.48 ac, not 0.8). Both directions of correction are the product. The workstream is closed only when every contested site carries a verdict neither side can move without new primary evidence — Nov's residual UNRESOLVEDs (2) are sites where the missing evidence is physical (a street-level look), not documentary.

## 9\. Operating-status verification — is there a business there at all?

A third of the in-area census — **416 of 1,279 rows — showed no operating wash** on aerial review. Operating status is a separate evidentiary question from land, with its own hierarchy. Apply it in this order; stop at the highest tier that answers:

| Tier | Source | Nov examples |
| :---- | :---- | :---- |
| 1 | **Live county/city licence query** (status field, queried today) | Golden Market (below); Terrible's Decatur (licence 2008946.081-121, "Licensed," live query Nov 3\) |
| 2 | **Operator's official location page** | El Car Wash's own site lists Lauderhill → Green Light's operator settled; Blue Beacon and Quick Quack location pages confirmed active sites; Circle K's store page confirmed the wash at 3989 W Ray |
| 3 | **Current listings/reviews with dates** | Google "Active / Open Now," review dates within the current year, **hiring posts** (Blue Beacon attendant postings, Nov 2026\) |
| 4 | **Corporate/registry records** | Sunbiz: EL CAR WASH LAVENDER LLC (filed Aug 2025, active, CEO named) — establishes entities and takeovers, *not* deed dates (§13) |
| 5 | **Aggregators / directories** | Weakest. Yellow Pages showed Sun Devil "open 24 hours" while it was permanently closed. Use for recall only, never to override tiers 1–4 |

**Closure detection — the signals that worked:** Yelp "CLOSED" markers and closure-describing reviews (Sun Devil: Yelp closed, updated Jun–Jul 2026, reviews describing disrepair; Bubbles Rainbow: a May 2026 review mourning "a car wash that closed"); independent place-status records ("Permanently Closed" ×2 for Sun Devil; MapQuest for Terrible's \#379, Eastern Ave); the predecessor's own listing flipping to Permanently Closed after a takeover (Greenlight, post–El Car Wash); **entity death** (Bob's Car Wash, 2310 E Lake Mead: operating entity *revoked* at the Secretary of State, licence expired 2012 — and its parcel is a Denny's); licence-status death (Orellana: county licence only "Pending," parcel re-coded restaurant — a conversion announced by two records at once).

**The Golden Market lesson (3585 N Lamb Blvd, LAS).** Imagery shows a store and a fuel canopy — no tunnel, no bays, no vacuum row — and the first adjudication called NOT\_A\_WASH on that basis. Grok held UNRESOLVED. The live county licence query settled it: the site holds an **active "Auto Wash/Detailing – Other Services" licence**, corroborated by a current fuel-directory wash amenity and 2023–24 customer reviews of buying washes at the pumps. A **compact station-attached wash can be invisible in nadir imagery** — no separate structure exists to see. Imagery absence is not business absence. (The site then FAILed on land, 0.10 ac — the operating question and the land question are different questions, and both reviews had fused them.)

The inverse also occurs: **amenity lists can kill a phantom.** TA Travel Center, Dean Martin Dr (LAS) was passed for 2.0 ac on lot size — but the operator's own amenity records list no truck wash at that centre at all; the exit's truck wash is a *separate parcel* (Global Truck). When a site is claimed from a map tag, check the operator's own amenity list before the parcel work starts.

**Operator identity is a records question, not a reporting question.** Green Light's operator was "unconfirmed" for weeks (a business-tax record under an El Car Wash company vs the Green Light name on the land). It was settled in one pass by: the operator's official locations page (lists the address) \+ Sunbiz (the LLC, its filing, its CEO) \+ the BTR name \+ the deed. Assemble those four before declaring any operator unknown.

## 10\. Cross-team reconciliation practice

Two independent teams *will* produce two funnels. That is the point of having two. The reconciliation method that converged in Nov — after an initial round of tally-versus-tally messaging that converged nothing — is:

1. **Compare on a shared set.** Intersect the two site sets properly (§5.3 membership test; §4 identity rules). Disagreements outside the shared set are denominator differences until proven otherwise.  
2. **Publish a candidate-disagreement list** — a file, with rows, not a narrative. (Nov: `grok-compare/candidate-disagreements.csv`, 57 rows, each side's verdict and measurement side by side.)  
3. **Adjudicate from primary records** (§8), supplements included as they surface.  
4. **Verify counter-claims identically** (§8.7).  
5. **Publish the final tally with both frames stated** and the arithmetic that maps one to the other (Nov: Torque's 66-site basis vs Grok's 65-site dedup basis — same sites, one denominator difference, shown explicitly). If a reader can't reconcile your two numbers from your own document, you haven't finished.

**Standing rules of engagement:**

- **Never debate tallies.** A count is a claim about rows; recompute it from rows or withdraw it. Prose summaries drift from their own data — this round produced *three* versions of one recall tally (a document's "70," a message's "55," a grid transcription's "51") while the underlying CSV said 55→78 all along. Where two counts conflict, **do not average them: strike the unverifiable one and rest on the verified floor** (the Broward floor of 53 stood precisely because the rival figures — 62/49 vs 112/71 — could not be reproduced from any reachable endpoint).  
- **Claims need deposit.** "We've wired up county data for four counties" was unverifiable in the shared folder — no dataset, no script, no doc — so the build proceeded on our own pulls. Part of the claim later turned out to be real (a manual section documenting genuine Maricopa/Clark/Miami-Dade services) and part stayed unverifiable (the Broward numbers, annotated UNVERIFIED in that manual). The rule that handles both outcomes: **work counts when it is deposited in the shared system of record and reproduces; until then it is a claim.**  
- **Concede fast, in writing, with the corrected number.** Two concessions in `COMPARISON.md` are the model:  
  - *The geography correction:* "Grok is right and I was wrong" — the in-area gap was duplicates, not polygons; the "57 missed sites" claim was an APN-join artifact; the memo was edited to carry the correction where the error had been published.  
  - *The double-count:* a headline tally announced "9 parcel-verified PASSes"; the correct figure was **8** — Green Light was one of the original six PASSes, and its verification cleared a flag rather than adding a site. **A status change is not an addition.** Recount additions as (new to the tier), not (mentioned in the update). A concession with the corrected number costs an afternoon; defending a wrong number costs the tally's credibility everywhere else. The other team conceded symmetrically (its quick-pass false passes/fails, its own 2011 date) — concede-first is contagious, and the shared record ends up right, which is the only scoreboard that matters.  
- **Say the scoreboard plainly.** On the contested 62, both reviews' top bands were roughly half wrong. Publishing that sentence is what makes the surviving PASS list believable.

## 11\. Data-handling rules

1. **Files over grids.** Bulk data moves as CSV/XLSX uploaded to the shared folder — never as values read off a spreadsheet grid. Grid reads corrupted at least four readings this round (the recall tallies; the Charleston address, 1901 vs the correct 1961; a one-digit APN error on Alta Dr, 13834301003 vs 13934301003; Green Light's flood zone). In every disputed case the *file* matched the primary source. If a number matters, it is recomputed from rows; a grid is a display, not a data channel. Reading a single cell's value via its formula bar is the acceptable exception — that is how the Green Light flood misread was resolved.  
2. **Drive downloads do not land on this VM.** CSV exports and KML downloads from Drive fail *silently* — the browser reports success and no file arrives. Routes that work: the user uploads the file (zip) directly; pulls via public APIs to local disk; the browser file-grant mechanism for moving specific files into the browser. **Grant limits observed:** single files up to \~103 MB accepted; \~148 MB total per grant OK; a 222 MB single file and a ~~325 MB batch rejected. Split bulk imagery ZIPs to ≤~~75 MB parts. Also: re-grant after editing a file — a grant pinned to an earlier version failed once with a size mismatch. (The KMZ geometry arrived only via Jaideep's own upload; plan geometry acquisition accordingly.)  
3. **Keep a local mirror of everything.** The local tree (`screening/`, `adjudication/`, `licences/`, `kmz/geometry.json`, the merge manifests) is the computable record. If it only exists in the workbook, it doesn't exist for analysis.  
4. **Workbook protocol.** The workbook has concurrent authors (the other team works in it live). **Claim before work** (Task Board) so two agents don't take the same task; **Run Log is append-only** — read it bottom-up each session, corrections are *new rows, never edits* (completing a blank stub row is the one noted exception); **re-read a tab immediately before writing to it**; Dashboard/Scorecard/Snapshots change only on Jaideep's explicit direction (he owns the workbook — R-062 as superseded). Long-running local processes launched via plain shell exec can be killed between turns — daemonize anything that must survive.  
5. **External-action rules still bind during universe work** (they shaped this round's listing stage): R-006 written go-ahead before any contact (with whatever scoped exceptions Jaideep grants in writing, e.g. a send-on-sight authorization for one fresh-scan round, inside its gates); R-007 written channels only; R-008 outreach Tue–Thu before 2 PM PT; R-012 never sign a broker's NDA; proof of funds only under an executed NDA. A validated universe changes none of these.

## 12\. Failure-mode checklist

Run this list against any new universe before its numbers are quoted. Every item happened in Nov 2026; the teaching site is named so you can find the file.

**Census & identity**

- [ ] Fragment/blank "ghost" rows counted as businesses — Broward tail rows 563–572 (blank names, addresses "1"/"17", lapsed-only)  
- [ ] Lapsed-licence rows counted as operating — 36 low-conf rows quarantined; Wash Up LLC still drew a PASS elsewhere  
- [ ] A converted business carried as current — Carwash Orellana (licence "Pending" \+ parcel re-coded restaurant)  
- [ ] Folio zero-padding / dashes breaking joins — Miami-Dade 13- vs 12-digit folios; dashed PHX APNs  
- [ ] Same APN on two distant sites trusted as a match — Maricopa 16636003K, sites 12.4 km apart  
- [ ] Duplicate sites inflating the count — QC Car Wash ×2; Sun Devil ×2 APNs; S Rainbow one parcel, two rows, two "stations"  
- [ ] Target attested by zero sources treated as an operating business — 3045 N Lamb Blvd  
- [ ] Census assumed complete — Lake Mead Car Wash (Henderson) existed in no census source; listings found it

**Geography**

- [ ] Screening on reconstructed/hull geometry — 40 rows misclassified (35 PHX) vs true KMZ polygons  
- [ ] Future geometry screened as current — MIA Mid-2027 boundary line in the KMZ (excluded)  
- [ ] Row count compared against site count and explained as geography — 1,279 vs 1,236; the gap was 59–91 duplicate rows  
- [ ] APN join run against a deduped set; non-matches read as absences — the "57 missing / 45 core" artifact  
- [ ] Closed-LineString ring in a KMZ dropped, silently losing a sub-area — MIA Extended ODD

**Land measurement**

- [ ] Aerial verdict issued without parcel boundaries — Cobblestone Baseline, WOW N. Pecos, Busy Bee, Splash and Dash, Super Bubble Tropicana, Global Truck (spare was a neighbour's parcel or a working yard in every case)  
- [ ] Formula screen quoted as a land result — 383 formula passes vs 92 aerial fits (\~4×)  
- [ ] Working forecourt/apron counted as spare — Wash Tubb; Davie Self Serve; Clean Freak (vacuum/drying apron)  
- [ ] Shared centre parking counted as the tenant's spare — 4530 W 12th Ave, Hialeah  
- [ ] Landlord's pads credited to a tenant — BLISS Tropicana (contrast Decatur: spare inside the station's own APN \= PASS with caveat)  
- [ ] Landscaping counted as spare — S Rainbow xeriscape frontage  
- [ ] Lot-size formula "spare" on a giant parcel — TA Dean Martin (12-ac truck stop, "2.0 ac"); Craig Rd centre parcel ("1.0 ac" on 4.3 ac of shared retail)  
- [ ] Spare \>5 ac accepted at face value — 158.8-ac Scottsdale and 69.4-ac HOA parcel-join artifacts  
- [ ] In-use land counted as vacant spare — MAX NW 27th soccer pitch (real land, active recreational use — caveat, don't zero, don't silently count)  
- [ ] Master-parcel spare credited to a suite tenant — provisional LAS land list dominated by suite licensees  
- [ ] Wrong folio measured — Euro Sweetwater: PASS measured on a different owner's vacant lot (input folio ≠ wash folio)  
- [ ] Neighbour-folio capture — 1870 SR 7 row (side-street address, same corner, different folio)

**Adjudication method**

- [ ] Single-point probes on a multi-area dispute — 2025 N Lamb: Dirt A (in-parcel, 0.40–0.48 ac) vs Dirt B (third party's, 1.40 ac)  
- [ ] Probe pattern that never covers the asset — MAX western field unprobed until the verification round  
- [ ] GIS polygon trusted over the legal description — Green Light strip (\~50 ft mis-draw; 0.283/0.286/0.287 ac triangulation)  
- [ ] Stale hosted extract trusted over the live record — BCPA AGOL tax-roll showed the 2014 owner; live record showed the 2025 deed  
- [ ] Same-owner splits merged into one number, or un-re-measured when challenged — Nexus Way 0.15/0.12 → 0.09/0.32  
- [ ] Affiliated entities counted as same owner — BMS Partners ≢ BMS Carwash (Davie)

**Operating status & environment**

- [ ] Land graded for a business that had closed — Sun Devil (closed mid-2026); Bubbles Rainbow (closed; land would pass — it is a *land-site* candidate, a different pipeline); Terrible's \#379  
- [ ] Entity death missed — Bob's, 2310 E Lake Mead (revoked entity, licence expired 2012, parcel is a Denny's)  
- [ ] Under-construction read as permanently not-a-business — MAX (pre-opening imagery); Wash N Go Sahara (opened late Oct 2026\)  
- [ ] Station-attached wash declared absent from imagery — Golden Market (active county licence settled it)  
- [ ] Phantom facility accepted from a map tag without the operator's amenity list — TA Dean Martin (no truck wash exists there)  
- [ ] Land without a business passed — Clean & Shine Amigo (mobile detailer, residential RS20 parcel); Scrub-a-Dub Davie (vacant folio); 900 E Germann (vacant 6.83 ac, "2.0-ac PASS")  
- [ ] Neighbour's open tank release attributed to the site — Sunshine \#826's open discharge vs Green Light's own closed record  
- [ ] Date kinds confused — discharge year 1988 ≠ closure 2003 ≠ invoice-audit batch 2011  
- [ ] Entity-registration date reported as the deed date — Aug 2025 Sunbiz filing vs Dec 5, 2025 deed (CIN 120583615\)  
- [ ] Flood zone taken from a grid display — Green Light "AE" misread; cell-level value is X / SFHA=F (Davie's AE, by contrast, verified parcel-wide by grid sampling)

**Process & tallies**

- [ ] Summary/prose figures quoted without recomputation from rows — recall tallies 70 vs 55 vs 51 (file: 55→78); Broward 62/49 vs 112/71 (floor: 53\)  
- [ ] A status change announced as an addition — "9 verified PASSes" double-counted Green Light; correct: 8  
- [ ] Tenure inferred from a missing name match — 1,034 "no match" rows are Unknown, not tenant-risk  
- [ ] Zeroed attribute field trusted — Clark `LOTSQFT` \= 0 in the republish; use `ASSR_ACRES`  
- [ ] State-plane coordinates silently zeroing a spatial join — Miami-Dade no-folio join, first run 0/132 (missing `outSR=4326`)  
- [ ] Power proxy phrased as capacity — substation distance is a ranking, never a capacity statement; label the threshold basis per row

## 13\. Worked example — the Nov 2026 three-market run, in numbers

The reference funnel shape for one full pass (car washes; LAS \+ PHX \+ MIA). Use it to sanity-check a new market's funnel: your ratios will differ, but a stage that behaves wildly differently from its analogue here is a question to answer, not a number to ship.

**Build & screen**

| Stage | Count | Notes |
| :---- | :---- | :---- |
| Torque parcel-verified base (county-wide) | 784 | LAS 138 / PHX 507 / MIA 139 |
| \+ Second-team census adds (Indie v2) | \+765 | after diff vs base; 38 review-band rows flagged in-row |
| \+ Licence-layer adds (own pulls) | \+152 | LAS 77 / MIA 75; 2 more rescued from quarantine |
| − Quarantined (lapsed in every read) | 4 | excluded from operating counts, retained as leads |
| **Merged universe** | **1,701 rows** | a census union — not an operating count |
| Deduped sites | \~1,640 | 59–91 duplicate rows inside the in-area set alone |
| In service area (true KMZ polygons) | **1,279 rows** | LAS 386 / PHX 259 / MIA 634; 409 out; 13 unknown (no coordinates) |
| Aerial verdicts, in area | FIT\_10 31 · FIT\_4 61 · MARGINAL \~175 · NO\_FIT \~376 · NOT\_A\_WASH \~416 · CANNOT\_TELL 211 | \+9 suite records inheriting parent-parcel verdicts; \~33% show no operating wash |
| Land fits (aerial) | **92** | the formula pre-screen had passed 383 — \~4× overcount |
| FIT\_10-standard funnel | 31 land → 31 tenure → **30 power-proxy OK+** | LAS 13 / PHX 11 / MIA 6 |
| FIT\_4+FIT\_10 combined, through power | **78** | core-only 40; of the 78: 5 listed, 3 already in Pipeline |
| Listings match | 58 listings → 51 matched (46 distinct rows) | 1 review-band, 6 no-match incl. 1 genuine census miss |

**Two-review comparison (the honest baseline)**

|  | Torque review | Grok/Indie v3 |
| :---- | :---- | :---- |
| Universe | 1,701 rows | 1,644 sites (deduped; later stated 1,640) |
| In area | 1,279 (KMZ) | 1,236 (v2 polygons — membership test: materially identical, §5.3) |
| Reviewed | 1,279, all full-depth, no boundaries | 1,177 rendered (394 full \+ 783 quick), boundaries drawn |
| Top band | FIT\_10: 31 | PASS (≥0.25 ac): 45 |
| Agreement on shared sites | 3-band 44% (full-review subset 54%, quick subset 42%); top-band overlap 9 |  |

**Adjudication & reconciliation**

| Round | Scope | Outcome |
| :---- | :---- | :---- |
| Adjudication | 57 disagreements \+ 5 supplements \= 62 | PASS 6 / MAYBE 21 / FAIL 20 / NOT\_A\_WASH 12 / UNRESOLVED 2 |
| Verification (counter-claims) | Green Light (deed/UST/spare), 2025 N Lamb, MAX NW 27th | Lamb FAIL→PASS; MAX MAYBE→PASS-grade (in-use caveat); Green Light → clean PASS. Post-round: PASS 8 / MAYBE 21 / FAIL 19 / NOT\_A\_WASH 12 / UNRESOLVED 2 (dead 31\) |
| Round 2 (never-checked \+ residuals) | Blue Beacon, Terrible's Decatur, Wash Tubb, Davie \+ Nexus, S Rainbow, Golden Market | Blue Beacon PASS 1.5 ac; Decatur PASS 0.95 ac (tenure caveat); Wash Tubb → MAYBE; Davie → MAYBE (Zone AE parcel-wide); Nexus MAYBE (split corrected); S Rainbow → FAIL; Golden Market → FAIL on land (operating wash confirmed) |
| **Closing tally (65 parcels)** | contested 62 \+ 4 formerly unchecked | **PASS 10 / MAYBE 21 / FAIL 21 / NOT\_A\_WASH 11 / UNRESOLVED 2 — dead 32** |
| Other team's frame (65 deduped sites) | their reconciliation | 12 own-parcel / 9 adjoining-only / 9 maybe / 3 unresolved / 32 dead — reconciles with the above (their 12 \= 8 verified PASS \+ 4 then-unchecked; adjoining-9 ⊂ MAYBE 21\) |

**The 10 verified PASSes** (the list a principal can be shown): Blue Beacon, 2932 Losee Rd, LAS (1.5 ac own) · Terrible's \#397, 6525 S Decatur Blvd, LAS (0.95 own, tenure caveat) · Terrible's \#390, 3616 Las Vegas Blvd N, LAS (0.30 own) · Terrible's \#196, 2025 N Lamb Blvd, LAS (0.40–0.48 own) · Mr. Z's, 4320 E McDowell Rd, PHX (\~1.2 own) · 1857 W Southern Ave, PHX (0.38 own) · Quick Quack, 1601 N 21st Pl, PHX (0.32 own) · Arizona Ave / Poseidon, 1196 N Arizona Ave, PHX (0.30 own) · Green Light, 1890 NW 40th Ave, MIA (0.29 own; neighbour-discharge \+ boundary-survey notes) · Chevron/MAX, 20780 NW 27th Ave, MIA (\~0.68 open on-folio; in-use soccer-pitch caveat).

**The 2 UNRESOLVED** (records exhausted; street-level only): 2401 E Van Buren St, PHX (wash unproven) · 4910 S Maryland Pkwy, LAS (mid-redevelopment).

**What the shape teaches:** expect \~75% of a raw census to die before the land stage (out of area \+ not operating); expect the land stage to kill \~90% of what remains; expect two competent independent reviews to agree on barely half of the contested top band, and county records to overturn roughly half of *each* side's contested calls — off-parcel spare credits (\~20 cases) being the largest single correction class. A funnel that doesn't look roughly like this — a land pass rate far above \~7% of in-area rows, a cross-review agreement far above \~90% — has probably skipped a stage. Find out which one before the numbers travel.