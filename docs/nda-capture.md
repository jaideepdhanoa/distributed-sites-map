# NDA capture

Muse, Indie and ChatGPT capture an NDA with `POST /api/changes` and their agent bearer token. The same call reads back with `GET /api/data/nda`. A human reviewer uses the same payload. Unknown payload fields are refused.

The change `source` is required. `payload.at` is an ISO-8601 time with a numeric offset. `payload.source_ref` names the message the fields came from. `expected_version` is the NDA's current version, or `0` when the overlay row does not exist yet. A stage or status write includes `note`.

## Fields an email can set

| Field | When to set it |
| --- | --- |
| `stage` | See the transitions below. |
| `court` | `us` when we owe the next move, `them` when they do, `seller` when the seller's side does, `none` when nobody is in court. |
| `court_detail` | A short place name such as `signer` or `legal`. |
| `court_since` | The time the court changed. Use the email's sent time. |
| `owner` | Set by a person in the signed-in dossier. Omit on agent writes. |
| `next_step` | The next concrete action the email asks for. |
| `next_step_due` | `YYYY-MM-DD` when the email gives a date. |
| `document_url` | An `https` link to the form. |
| `document_kind` | `docusign`, `clm`, `drive`, `email`, or `other`. |
| `contact_name`, `contact_email`, `contact_phone` | The person on the thread. |
| `gmail_thread_ids` | Thread ids already on the message. Do not invent one. |
| `covered_refs` | `PIPE-` and `LAND-` ids, or a short scope line when no row exists. |

## Field limits

The API accepts up to 400 characters in `note` and 200 in `source_ref`. Aim for about 200 characters in a note so it reads easily in the dossier. Each entry in `gmail_thread_ids` and `covered_refs` must contain 1–80 characters after trimming.

Put phone numbers in `contact_phone` (up to 40 characters). If the API detects a phone number in another text field or list entry, it returns HTTP 400, including for `note`, `next_step`, `court_detail`, and `source_ref`.

Agents without repository access can find the capture instructions in Workflow 12 of the Agent Operating Manual.

## Stage transitions

| Email event | `stage` | `court` |
| --- | --- | --- |
| They ask for an NDA | `requested` | `us` |
| We send our form | `our_form_sent` | `them` |
| Their form arrives | `their_form_received` | `us` |
| Redline is with them | `redline_with_them` | `them` |
| Redline is back with us | `redline_with_us` | `us` |
| It is with our legal | `with_moove_legal` | `us` |
| It is out for signature | `routing_for_signature` | `them` |
| They have signed | `counterparty_signed` | `us` |
| Fully signed | `executed` | `none` |
| Financials asked | `financials_requested` | `them` |
| Financials received | `financials_received` | `us` |
| Parked | `deferred` | `none` |
| They decline | `declined` | `none` |
| Not needed | `not_required` | `none` |
| Lapsed | `expired` | `none` |

Days in court are computed from `court_since`. Do not copy a day count from a sheet.

## Example

```json
{
  "changes": [
    {
      "entity_type": "nda",
      "site_id": "NDA-901",
      "expected_version": 0,
      "source": "email",
      "payload": {
        "action": "edit",
        "stage": "our_form_sent",
        "court": "them",
        "court_detail": "signer",
        "court_since": "2026-11-23T18:00:00-08:00",
        "next_step": "Wait for a reply.",
        "next_step_due": "2026-11-30",
        "document_url": "https://example.com/sample-doc",
        "document_kind": "docusign",
        "contact_name": "Sample Person",
        "contact_email": "person@example.com",
        "gmail_thread_ids": ["threadsample01"],
        "covered_refs": ["PIPE-PHX-9101", "Confidential sample listing"],
        "note": "Our form went out.",
        "source_ref": "sample-message",
        "at": "2026-11-23T18:00:00-08:00"
      }
    }
  ]
}
```

## Clearing a field

Leave a field out of the payload to keep the value already stored. To blank a dossier field, put it in the payload as `null`. A text field also clears with `""`. `gmail_thread_ids` and `covered_refs` clear with `[]` or `null`. That applies to `document_url`, `document_kind`, `contact_name`, `contact_email`, `contact_phone`, `next_step`, `next_step_due`, `court`, `court_detail`, `court_since`, `owner`, `waiting_on`, `status`, and those two lists.

`stage` cannot be cleared. `null` or `""` for `stage` is rejected. A clear uses the same `source`, `payload.source_ref`, and `payload.at` as any other write. It bumps the version and records a history line such as `Cleared document link`. The dossier and its activity show that line.

```json
{
  "changes": [
    {
      "entity_type": "nda",
      "site_id": "NDA-901",
      "expected_version": 1,
      "source": "email",
      "payload": {
        "action": "edit",
        "document_url": null,
        "gmail_thread_ids": [],
        "source_ref": "sample-message",
        "at": "2026-11-23T18:04:00-08:00"
      }
    }
  ]
}
```

A comment on that agreement is a separate change with `entity_type` `comment`, `site_id` `NDA-901`, and `anchor.type` `nda`.

Read the queue back with `GET /api/data/nda` and the same bearer token. The register text stays visible beside the suggested stage. When the register's last action is older than the saved record, the dossier shows a conflict note and does not hide either date.
