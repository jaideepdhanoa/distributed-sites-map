# Agent write API

`POST /api/changes` stores one batch. Send `Idempotency-Key`. Muse sends `Authorization: Bearer` with `AGENT_WRITE_TOKEN_MUSE`. A contributor or reviewer session can write a line. Indie cannot. The line is not mirrored to the workbook.

The figures in this file are fake. They are not a site, a broker package, or a stored deal.

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

Signed-in financials show a marker on a cell or line with an open thread. A marked lot shows a marker. The discussion shows a chip such as `on P&L, G&A 2023` or `on lot, Excess parking`. The chip opens the grid at that cell, or flies the map to that lot with its popover open. On a phone the thread opens as a bottom sheet. Open threads are open loops and a morning-brief count. Those surfaces name the anchor and the tag. They do not include the comment text. A signed-out request does not receive the financials thread.

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

## One-pass site create

On create, an agent omits `site_id`. The server mints the next `PIPE-{MKT}-NNNN` or `LAND-{MKT}-NNNN` and, in the same transaction, the next Universe id `WB-{MKT}-NNNN`. `kind` is `pipeline` or `land`. `market` is `PHX`, `LAS`, or `MIA`. The numbers stay above ids already stored and above the workbook counters those sheets report. `PIPE-PHX-0006` is never minted.

`listing_id` is an `L-` id. The same listing id returns the same site id and universe id. A different body for that listing id is `409`. The batch `Idempotency-Key` still replays the whole response when the body is unchanged.

On this create, the agent may set `name`, `address`, `market`, `category`, `apn`, `lat`, `lng`, `listing_url`, and `broker`. Each one that is sent needs `sources.<field>`. After create, those identity fields stay owner-locked. Folder, photos, land evidence, typed power, check statuses, and financial claims are still rejected on a new row.

The create still opens at `1 Desk screen` and records a `Site added` capture activity. The mirror appends the new Pipeline or Land Sites row and the Universe row. It does not copy the guarded fields.

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

Tables: `site_mints` and `universe_rows` in `db/migrations/025_site_mint.sql`. Production does not apply this file until the Production migrations workflow runs.
