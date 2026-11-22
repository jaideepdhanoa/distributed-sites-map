# Agent write API

`POST /api/changes` stores one batch. Send `Idempotency-Key`. Muse sends `Authorization: Bearer` with `AGENT_WRITE_TOKEN_MUSE`. A contributor or reviewer session can write a line. Indie cannot. The line is not mirrored to the workbook.

The figures in this file are fake. They are not a site, a broker package, or a stored deal.

## Links

A site link is `/?site=` plus the record id. The host is the request host.

| Id | Opens |
| --- | --- |
| `PIPE-{market}-{number}` | That Pipeline deal |
| `LAND-{market}-{number}` | That Land deal |
| `WB-{market}-{number}` | That Universe row. The map switches to Universe, uses the market in the id, and opens the card on that pin. If the row was promoted to a `PIPE-` id, the link opens that Pipeline deal instead. |

`PIPE-PHX-0006` is not served. An id that is not on file shows Site not found.

## P&L line

Rule R-102. A `pnl_line` change stores one captured profit-and-loss line. The first line for a period creates that period. The server does not sum lines, does not fill a month, and does not calculate EBITDA. Send only what the package states, what it normalizes, or what it estimates.

`amount` is a string with no decimals, one decimal, or two decimals, such as `"12345"`, `"12345.6"`, or `"12345.00"`. The text is stored as sent. Nothing is rounded. A JSON number, a comma, a symbol, or a third decimal place is rejected. `source_page` is a string, the page or sheet name, not a JSON number. `captured_at` is required. It is an ISO-8601 time with a numeric offset or `Z`, stored exactly.

`status` is `stated`, `reported`, `normalized`, or `estimated`. `stated` is an alias of `reported` and is stored as `reported`. `reported` still works. A normalized line is a second row for the same period and line. The statement shows stated lines by default. Each stated line carries a marker when a normalized amount is also on file, and the statement view can switch to the normalized lines.

A period is a month, a year, or a range when the package only gives a range. Identity is the site, the grain, `period_start`, and `period_end`. A partial year can sit beside the full year.

| Payload | Period |
| --- | --- |
| `grain: "monthly"`, `year`, `month` | That calendar month |
| `grain: "annual"`, `year` | 1 January through 31 December of `year` |
| `grain: "annual"`, `year`, `through_month` | 1 January through the last day of `through_month` |
| `grain: "annual"`, `year`, `period_end` | From `period_start` through that exact date. `period_end` is `YYYY-MM-DD`, after the start and before the full period ends. It is not combined with `through_month` |
| `grain: "annual"`, `year`, `start_month` | 12 months from the first of `start_month`. `year` is the calendar year of the first day |
| `grain: "annual"`, `year`, `start_month`, `through_month` | From `start_month` through `through_month`. When `through_month` is earlier in the calendar than `start_month`, the end is in the next year |
| `grain: "monthly"`, `year`, `month`, `missing: true` | That month was supposed to be in the package and is not. No `amount`, `line`, or `status` |

A 12-month period that does not start in January is labeled `FY` plus the calendar year of its last day. October 2025 through September 2026 is `FY2026`. The grid reads `columnLabel` from `lib/pnl/columns.ts`. An unmarked month stays blank. A month sent with `missing: true` is labeled Missing.

`business_type` is `car_wash` or `auto_service`. `line` is one of `revenue_wash`, `revenue_membership`, `revenue_retail`, `revenue_service`, `revenue_parts`, `revenue_other`, `revenue`, `cogs`, `labor`, `utilities`, `chemicals`, `occupancy`, `repairs`, `marketing`, `ga`, `other`, `ebitda`, `noi`, `addback_owner_pay`, `addback_personal`, `addback_one_time`, `addback_other`. `source_page` is a string. `source_href` is optional and must be an `https` URL. `captured_at` is required.

A validation error names the field. The JSON body is `{ "error": "Change 1: …", "field": "amount" }`.

- A JSON number for `amount`: `amount must be a string such as "12345", "12345.6", or "12345.00", not a number`
- A formatted amount, or three or more decimal places: `amount must be a string such as "12345", "12345.6", or "12345.00", with at most two decimal places and no commas or symbols`
- A JSON number for `source_page`: `source_page must be a string`
- A missing `captured_at`: `captured_at is required`

### Stated line

`stated` is stored as `reported`.

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
        "status": "stated",
        "source_document": "Sample package",
        "source_page": "Sheet 2024",
        "captured_at": "2026-03-01T15:00:00-07:00"
      }
    }
  ]
}
```

### Reported line

Same row as `stated`. An update sends the `PL-` id and the `version` from the previous response.

```json
{
  "entity_type": "pnl_line",
  "site_id": "PIPE-LAS-9001",
  "entity_id": "PL-000001",
  "expected_version": 1,
  "source": "Sample package",
  "payload": {
    "grain": "annual",
    "year": 2024,
    "business_type": "car_wash",
    "line": "revenue",
    "amount": "1000000",
    "status": "reported",
    "source_document": "Sample package",
    "source_page": "Sheet 2024",
    "captured_at": "2026-03-01T15:00:00-07:00"
  }
}
```

### Normalized line

This does not replace the stated line. Both are kept.

```json
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
    "amount": "450000",
    "status": "normalized",
    "source_document": "Sample package",
    "source_page": "Normalized sheet",
    "captured_at": "2026-03-01T15:00:00-07:00"
  }
}
```

### Estimated line

```json
{
  "entity_type": "pnl_line",
  "site_id": "PIPE-LAS-9001",
  "expected_version": 0,
  "source": "Sample notes",
  "payload": {
    "grain": "annual",
    "year": 2024,
    "business_type": "car_wash",
    "line": "addback_owner_pay",
    "amount": "80000",
    "status": "estimated",
    "source_document": "Sample notes",
    "source_page": "Note 2",
    "captured_at": "2026-03-01T15:00:00-07:00"
  }
}
```

### Month

```json
{
  "entity_type": "pnl_line",
  "site_id": "PIPE-LAS-9001",
  "expected_version": 0,
  "source": "Sample package",
  "payload": {
    "grain": "monthly",
    "year": 2024,
    "month": 1,
    "business_type": "car_wash",
    "line": "revenue",
    "amount": "80000",
    "status": "stated",
    "source_document": "Sample package",
    "source_page": "Jan",
    "captured_at": "2026-03-01T15:00:00-07:00"
  }
}
```

### Calendar year

`period_start` is `2026-01-01` and `period_end` is `2026-12-31`. The column label is `2026`.

```json
{
  "entity_type": "pnl_line",
  "site_id": "PIPE-LAS-9001",
  "expected_version": 0,
  "source": "Sample package",
  "payload": {
    "grain": "annual",
    "year": 2026,
    "business_type": "car_wash",
    "line": "revenue",
    "amount": "1000000",
    "status": "stated",
    "source_document": "Sample package",
    "source_page": "FY2026",
    "captured_at": "2026-03-01T15:00:00-07:00"
  }
}
```

### Range, January through April

This coexists with the full year above. `period_start` is `2026-01-01` and `period_end` is `2026-04-30`. The column label is `Jan–Apr 2026`.

```json
{
  "entity_type": "pnl_line",
  "site_id": "PIPE-LAS-9001",
  "expected_version": 0,
  "source": "Sample package",
  "payload": {
    "grain": "annual",
    "year": 2026,
    "through_month": 4,
    "business_type": "car_wash",
    "line": "revenue",
    "amount": "300000",
    "status": "stated",
    "source_document": "Sample package",
    "source_page": "Jan-Apr",
    "captured_at": "2026-03-01T15:00:00-07:00"
  }
}
```

### Range, January through July

`period_end` is `2026-07-31`. The column label is `Jan–Jul 2026`.

```json
{
  "entity_type": "pnl_line",
  "site_id": "PIPE-LAS-9001",
  "expected_version": 0,
  "source": "Sample package",
  "payload": {
    "grain": "annual",
    "year": 2026,
    "through_month": 7,
    "business_type": "car_wash",
    "line": "revenue",
    "amount": "600000",
    "status": "stated",
    "source_document": "Sample package",
    "source_page": "Jan-Jul",
    "captured_at": "2026-03-01T15:00:00-07:00"
  }
}
```

### Mid-month partial

A seller statement that stops on a day inside a month sends `period_end`. `period_start` is still the first of `year` and `start_month`. This period coexists with the full year and with a month-end range. The column label is `Jan 1 - Jun 14 2026`.

```json
{
  "entity_type": "pnl_line",
  "site_id": "PIPE-LAS-9001",
  "expected_version": 0,
  "source": "Sample package",
  "payload": {
    "grain": "annual",
    "year": 2026,
    "period_end": "2026-06-14",
    "business_type": "car_wash",
    "line": "revenue",
    "amount": "400000",
    "status": "stated",
    "source_document": "Sample package",
    "source_page": "Seller statement",
    "captured_at": "2026-03-01T15:00:00-07:00"
  }
}
```

### Fiscal year

October 2025 through September 2026. `period_start` is `2025-10-01` and `period_end` is `2026-09-30`. The column label is `FY2026`.

```json
{
  "entity_type": "pnl_line",
  "site_id": "PIPE-LAS-9001",
  "expected_version": 0,
  "source": "Sample package",
  "payload": {
    "grain": "annual",
    "year": 2025,
    "start_month": 10,
    "business_type": "car_wash",
    "line": "revenue",
    "amount": "900000",
    "status": "stated",
    "source_document": "Sample package",
    "source_page": "FY Oct",
    "captured_at": "2026-03-01T15:00:00-07:00"
  }
}
```

### Missing month

No amount. The month column says Missing. A month that was never sent stays blank.

```json
{
  "entity_type": "pnl_line",
  "site_id": "PIPE-LAS-9001",
  "expected_version": 0,
  "source": "Sample package",
  "payload": {
    "grain": "monthly",
    "year": 2024,
    "month": 2,
    "business_type": "car_wash",
    "missing": true,
    "source_document": "Sample package",
    "source_page": "Month index",
    "captured_at": "2026-03-01T15:00:00-07:00"
  }
}
```

### Retract

An agent cannot delete a line. Muse, the owner of the lines, can retract one through `POST /api/changes`. Send the line id, the version from the previous response, a required `reason`, and `at`, an ISO-8601 time with a numeric offset or `Z`. The row stays, including the captured amount. The change log keeps the event with the reason, the actor, and that exact time. A retracted line is left out of the statement and its totals. A reviewer cannot retract a line.

```json
{
  "entity_type": "pnl_line",
  "site_id": "PIPE-LAS-9001",
  "entity_id": "PL-000001",
  "expected_version": 1,
  "source": "Sample correction",
  "payload": {
    "retract": true,
    "reason": "Duplicate sample line",
    "at": "2026-03-01T15:00:00-07:00"
  }
}
```

Tables: `pnl_periods` and `pnl_lines`, created in `db/migrations/014_pnl.sql` and extended in `db/migrations/018_pnl_basis.sql` and `db/migrations/019_pnl_retract.sql`. Production does not apply those files until the Production migrations workflow runs.

### Data conflict

When two sources disagree about one site field or one P&L line for the same period, log a conflict instead of picking one quietly. Muse writes it through `POST /api/changes`. Send exactly two sources. Each source has a string `value`, a `document`, and a `page`. `value_in_use` must be one of those two values. `status` is `open`, `asked_broker`, or `resolved`. A resolved conflict needs `resolution_note`. `at` is required and must be an ISO-8601 time with a numeric offset or `Z`. A bad timestamp is rejected. The row keeps `created_by`, `updated_by`, and both times. Each write appends an event. A second open conflict for the same site, field, and period is rejected so the first record is updated. Signed-in financials show a marker on the matching P&L cell. The popover lists both sources and the status. The site's open loops gain one entry, and the morning brief counts open conflicts. Neither of those surfaces includes the source values.

```json
{
  "entity_type": "data_conflict",
  "site_id": "PIPE-LAS-9001",
  "expected_version": 0,
  "source": "Sample notes",
  "payload": {
    "subject": "pnl_line",
    "field": "ebitda",
    "period": "2026-01-01/2026-06-14",
    "sources": [
      { "value": "100000", "document": "Sample package", "page": "1" },
      { "value": "90000", "document": "Sample notes", "page": "2" }
    ],
    "value_in_use": "100000",
    "status": "open",
    "at": "2026-03-01T15:00:00-07:00"
  }
}
```

Table: `data_conflicts` in `db/migrations/021_data_conflicts.sql`. `020` is reserved. Production does not apply this file until the Production migrations workflow runs.

## Power rating

Power points are 15 of the score. The workbook formula looks up a share on `Assumptions!A88:B98` and multiplies by the power weight in `Assumptions!B79`. The shares stay Strong 100% (15), OK 60% (9), Weak 20% (3), and Unknown 50% (7.5).

Do not send a power grade. `Power rating` was removed. Typed layers are the source: `cap_a_*` through `cap_d_*` on a site fact, with `source`, `as_of`, and `confidence` of `Estimated`, `Claimed`, or `Verified`. The server derives `Strong`, `OK`, `Weak`, or `Unknown` and stores `power_rating` and `power_rating_reason`. A fact key named `power_rating` is rejected.

The rubric is in `docs/scoring.md`. Layer A, the substation and high-voltage distance, does not change the points. Phoenix and Miami cap at OK. A blank or incomplete service stays Unknown, which is still 7.5 points. A sourced 3-phase service rates OK with no size threshold. A blank hosting cell stays missing. A stored 0 counts as a reading.

### Comment

A comment is a note on the site discussion, anchored to one target. The same row is the cell thread, the line thread, or the lot thread, and the reply on the discussion tab. There is no second copy.

`anchor.type` is `pnl_cell`, `pnl_line`, or `space`. A cell sends `line` and `period`. A line sends `line` and no period. `line` is a chart-of-accounts code, or `total-revenue`, `total-costs`, `ebitda`, or `margin` for the computed rows. A lot sends `space_id`. The server stores the lot's type label. `tag` is `investigate`, `ask_broker`, `normalize`, `explained`, or `verified`. A new thread defaults to `investigate` when `tag` is omitted. `mentions` are account ids. `at` is required and must be an ISO-8601 time with a numeric offset or `Z`. A bad timestamp is rejected. The row keeps that exact time.

A reply sends `parent_id` of the thread and no anchor. Replies stay one level deep. An update sends the record id and the version from the previous response. It can change `body`, `tag`, `mentions`, or `resolved`. `resolved: true` closes the thread. `resolved: false` reopens it. Resolve and reopen need a reviewer. A contributor can comment and reply. A viewer cannot. The old note routes refuse an anchored thread so the write stays on `POST /api/changes`.

`ask_broker` does not send anything. The read shows one suggested question for Jaideep to review. That question is built from the anchor. It does not mention EV charging, AVs, walk-away, max price, savings, or offers, and it is not stored as a comms row.

Signed-in financials show a marker on a cell or line with an open thread. A marked lot shows a marker. The discussion shows a chip such as `on P&L, COGS, Mar 2026` or `on lot, Excess parking`. The chip opens the grid at that cell, or flies the map to that lot with its popover open. On a phone the thread opens as a bottom sheet. Open threads are open loops and a morning-brief count. Those surfaces name the anchor and the tag. They do not include the comment text. A signed-out request does not receive the financials thread.

```json
{
  "entity_type": "comment",
  "site_id": "PIPE-LAS-9001",
  "expected_version": 0,
  "source": "Sample notes",
  "payload": {
    "anchor": { "type": "pnl_cell", "line": "ga", "period": "2023" },
    "body": "The sample line needs a second look.",
    "tag": "investigate",
    "mentions": [],
    "at": "2026-03-01T15:00:00-07:00"
  }
}
```

Table: `notes`, extended in `db/migrations/022_anchored_comments.sql`. A preview database that is not production applies this file when the comment is posted. Production does not apply this file until the Production migrations workflow runs.

## Stage move on a package receipt

An agent token may make one stage change. The site must already be `1 Desk screen`, and the only destination is `2 Financial screen`. Every other agent stage write is `403`, including `Dropped`. A reviewer still accepts a stage through the proposal. This path does not create or accept a proposal.

The payload cites the package receipt:

- `document` is a Drive file id or a file name. A 16-character hex Gmail id is rejected.
- `received_at` is an exact ISO-8601 time with a numeric offset or `Z`. It is stored as sent.
- `comms_id` is the receipt's `CM-` id, or `email_date` is the source email's `YYYY-MM-DD` label. Send at least one. Neither is a Gmail id.

The server writes `site_stages` with decision source `agent` and event source `Agent stage decision`. It also records an activity whose summary is `Moved to Financial screen on package receipt`, with the citation on `source_link`. That line is in the agent feed and in the morning brief.

```json
{
  "entity_type": "stage",
  "site_id": "PIPE-LAS-9001",
  "expected_version": 1,
  "source": "Sample package",
  "payload": {
    "stage": "2 Financial screen",
    "market": "LAS",
    "receipt": {
      "document": "sample-package.pdf",
      "received_at": "2026-03-01T15:04:00-07:00",
      "comms_id": "CM-9001"
    }
  }
}
```

The same move can cite the email date instead of a comms id:

```json
{
  "document": "sample-drive-file",
  "received_at": "2026-03-01T15:04:00-07:00",
  "email_date": "2026-03-01"
}
```

A move with no receipt is `400`. A move to any other stage is `403` with `An agent can only move a site from Desk screen to Financial screen.` A drop is `403` with `An agent cannot set Stage to Dropped.`

## Trade area

Muse and Indie may write these nine facts on a site. Send them in `facts` or at the top level. `trade_area_checked` is not one of them. The mirror derives it: any non-empty `trade_*` value copies `Yes` into Trade-area checked. Do not post `trade_area_checked`.

| Key | Unit |
| --- | --- |
| `trade_aadt` | vehicles per day, nearest count |
| `trade_aadt_road` | road name. Needs `sources.trade_aadt_road`. |
| `trade_aadt_m` | meters from the site to that road segment |
| `trade_aadt_max` | vehicles per day, highest count within 800 m |
| `trade_population` | people within 3 miles |
| `trade_growth` | fraction. `0.0119` means 1.19%. |
| `trade_income` | dollars, median household income within 3 miles |
| `trade_washes_1mi` | wash count within 1 mile |
| `trade_washes_3mi` | wash count within 3 miles |

A numeric trade fact needs `sources.<field>`. Source text is capped at 200 characters.

## One-pass site create

On create, an agent omits `site_id`. For `kind` `pipeline` or `land`, the server mints the next `PIPE-{MKT}-NNNN` or `LAND-{MKT}-NNNN` and, in the same transaction, the next Universe id `WB-{MKT}-NNNN`. `market` is `PHX`, `LAS`, or `MIA`. The numbers stay above ids already stored and above the workbook counters those sheets report. `PIPE-PHX-0006` is never minted. A census shop with no listing uses `kind` `universe` instead. That create is below.

`listing_id` is an `L-` id on a pipeline or land create. The same listing id returns the same site id and universe id. A different body for that listing id is `409`. The batch `Idempotency-Key` still replays the whole response when the body is unchanged. A pipeline or land create without an `L-` id is `400`.

On this create, the agent may set `name`, `address`, `market`, `category`, `apn`, `lat`, `lng`, `listing_url`, `broker`, and `service_area_class`. Each one that is sent needs `sources.<field>`. `category` is a map business type. `Quick lube` is accepted beside `Car wash`. `service_area_class` is an R-099 class: `inside`, `near_0_5`, `near_5_10`, `outside`, or blank for unclassified. The labels `Inside`, `Near 0-5`, `Near 5-10`, `Outside`, and `Unclassified` are accepted and stored as those tokens. A Quick lube listing (`kind` `pipeline` with an `L-` id) also writes the Universe row and opens at Desk screen. A Quick lube address that matches an existing site or Universe row is `409`. Muse stays create-only for `address`, `apn`, `lat`, `lng`, and `segment`. Indie may update `address`, `apn`, `lat`, and `lng` on a site that already exists, and each one still needs `sources.<field>`. When that update replaces a non-empty value, the server keeps the new value and records a conflict row with both values and both sources. Indie may also set `segment`. `segment_group`, when sent, has to be the same group. Both are stored as one label, and the mirror copies that label to the Segment cell. The group has to be one of the known segment groups (`car wash`, `quick lube`, `auto service`, `auto repair`, `general auto repair`, `tire and lube`, `tire and light auto service`, `gas station`, `gas station and c-store`, `c-store`, `convenience store`, `land`, `land only`, `vacant`, `entitled`, `yard or lot`, `storage`, `other`). Send `sources.segment`. A group that is not on that list is `Segment must be one of the known segment groups.` When the update replaces a non-empty segment, the server keeps the new label and records a conflict row with both labels and both sources. Folder, photos, land evidence, typed power, check statuses, and financial claims are still rejected on a new row. On an existing row, Indie may set `folder_url` to a `https://drive.google.com` folder link or a bare folder id.

Optional Quick lube facts live in `facts`, or at the top level of the same payload. Top-level keys are lifted into `facts` the same way `acreage` is accepted beside the nested bag. They are `open_land_sqft`, `open_land_basis`, `parcel_acres`, `parcel_match`, `land_acres_basis`, `source_line`, `source_kind`, `asking_price_source`, and the trade-area facts in the Trade area section. A numeric fact still needs `sources.<field>`. `trade_aadt_road` needs `sources.trade_aadt_road` as well. Each source value is at most 200 characters. A longer one is `Source text is too long (200 characters max).` A field name the API does not know is `That field is not accepted.` A blank fact stays unknown. `brand_type` is `Independent`, `Local chain`, or `National chain`. `owner_verdict` is `Same`, `Different`, or `Unknown`. Counts are `bay_count`, `lift_count`, `lot_sqft`, and `outside_sqft`. Notes are `brand_note` and `outside_note`. `owner_of_record` is the name on the deed. `listing_source` cites the listed status. `source_tag` is the citation for the row and does not need its own source. Depot distance stays `miles_to_depot`. Wash cash flow does not score a Quick lube site.

The create still opens at `1 Desk screen` and records a `Site added` capture activity. The mirror appends the new Pipeline or Land Sites row and the Universe row. It does not copy the guarded fields. On an existing Pipeline or Land Sites row, a stored `universe_id` copies into Universe ID when that cell is empty or different, the same way a stored APN copies. If that column is missing, the mirror adds the Universe ID header and then copies the id. The data check and the gap gate join a deal to a counted Universe row by that id first, then by street or APN. A different street number does not break a row that already has its Universe id.

```json
{
  "entity_type": "site",
  "expected_version": 0,
  "source": "Sample listing",
  "payload": {
    "kind": "pipeline",
    "market": "PHX",
    "listing_id": "L-9001",
    "name": "Sample Wash",
    "category": "Car wash",
    "listing_url": "https://example.com/listing/9001",
    "broker": "Sample Broker",
    "sources": {
      "name": "Sample listing",
      "market": "Sample listing",
      "category": "Sample listing",
      "listing_url": "Sample listing",
      "broker": "Sample listing"
    }
  }
}
```

The response result for that change includes the minted ids:

```json
{
  "entity_type": "site",
  "entity_id": "PIPE-PHX-0001",
  "site_id": "PIPE-PHX-0001",
  "universe_id": "WB-PHX-0001",
  "listing_id": "L-9001",
  "version": 1
}
```

A human create still sends the site id. This mint path is the agent create.

### Universe census create

A census shop is a Universe row. It is not a Pipeline site. Send `kind` `universe` and omit `site_id` and `listing_id`. The server mints only `WB-{MKT}-NNNN`. It writes `universe_rows` with the quick-lube facts and sources. It does not write `sites`, `site_mints`, a `PIPE-` id, or a Desk screen stage.

`category` is `Quick lube`. Car wash uses this same create once that category is opened. `market` is `PHX`, `LAS`, or `MIA`. `address` is required. A blank address is `400` with `A universe row needs an address.` Each identity field and each quick-lube fact that is sent needs `sources.<field>`, the same as a listing create. `service_area_class` is the R-099 class. The Universe step counts the row. The in-area step counts it when that class is inside the current reach. The row is absent from the Pipeline list and from Pipeline step totals.

Idempotency is the market plus the normalized address. The same body returns the same Universe id, including a retry with a new `Idempotency-Key`. A different body for that address is `409` with `This address was already used for a different universe row.` An address that already belongs to a site is `409` with `This address matches an existing site.` The batch `Idempotency-Key` still replays the whole response when the body is unchanged.

This create does not promote the row into Pipeline. A Pipeline site still comes from the existing `kind` `pipeline` or `land` create, which requires an `L-` listing id.

```json
{
  "entity_type": "site",
  "expected_version": 0,
  "source": "Sample map",
  "payload": {
    "kind": "universe",
    "market": "PHX",
    "name": "Sample Lube",
    "address": "910 Placeholder Lane",
    "category": "Quick lube",
    "service_area_class": "Near 0-5",
    "facts": {
      "brand_type": "Independent",
      "bay_count": 4,
      "owner_verdict": "Unknown",
      "source_tag": "Sample map, Nov 20, 2026"
    },
    "sources": {
      "name": "Sample map",
      "market": "Sample map",
      "address": "Sample map",
      "category": "Sample map",
      "service_area_class": "Sample map",
      "brand_type": "Sample map",
      "bay_count": "Sample map",
      "owner_verdict": "Sample map"
    }
  }
}
```

The response result has the Universe id and no Pipeline id:

```json
{
  "entity_type": "site",
  "entity_id": "WB-PHX-0001",
  "site_id": "",
  "universe_id": "WB-PHX-0001",
  "version": 1
}
```

### Comms relink

An agent can attach an existing comms row whose site id is blank or an `L-` listing id to the new site. Send the comms id, the new site id, the version, and `relink_from` equal to the current value (`""` or the `L-` id). The row stores `relinked_from` and `relinked_by`. A row that already has a `PIPE-` or `LAND-` id is not moved.

```json
{
  "entity_type": "comms",
  "site_id": "PIPE-PHX-0001",
  "entity_id": "CM-9001",
  "expected_version": 1,
  "source": "Sample listing",
  "payload": {
    "direction": "in",
    "relink_from": "L-9001"
  }
}
```

Tables: `site_mints` and `universe_rows` in `db/migrations/025_site_mint.sql`. Census facts and the address key are in `db/migrations/026_universe_census.sql`. Production does not apply these files until the Production migrations workflow runs.
