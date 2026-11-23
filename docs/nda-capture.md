# NDA capture

Muse and Indie write an NDA with `POST /api/changes` and their agent bearer token. The same call reads back with `GET /api/data/nda`. A human reviewer uses the same payload. Unknown payload fields are refused.

The change `source` is required. `payload.at` is an ISO-8601 time with a numeric offset. `payload.source_ref` names the message the fields came from. `expected_version` is the NDA's current version, or `0` when the overlay row does not exist yet. A stage or status write includes `note`.

## Fields an email can set

| Field | When to set it |
| --- | --- |
| `stage` | See the transitions below. |
| `court` | `us` when we owe the next move, `them` when they do, `seller` when the seller's side does, `none` when nobody is in court. |
| `court_detail` | A short place name such as `signer` or `legal`. |
| `court_since` | The time the court changed. Use the email's sent time. |
| `owner` | The account id the thread assigns. |
| `next_step` | The next concrete action the email asks for. |
| `next_step_due` | `YYYY-MM-DD` when the email gives a date. |
| `document_url` | An `https` link to the form. |
| `document_kind` | `docusign`, `clm`, `drive`, `email`, or `other`. |
| `contact_name`, `contact_email`, `contact_phone` | The person on the thread. |
| `gmail_thread_ids` | Thread ids already on the message. Do not invent one. |
| `covered_refs` | `PIPE-` and `LAND-` ids, or a short scope line when no row exists. |

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
        "owner": "sample-owner",
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

## Limits

The API refuses a `note` over 400 characters and a `source_ref` over 200. Keep the note to about 200 characters so it reads in the dossier. Each `gmail_thread_ids` and `covered_refs` entry is at most 80 characters.

Text that contains a phone number is refused with a `400` and `That text is not allowed on the map.` The check runs on every text field except `contact_phone`, including `note`, `next_step`, `court_detail`, `source_ref` and each `covered_refs` entry. Put a number only in `contact_phone`.

Agents without this repo use Workflow 12 of the Agent Operating Manual. It carries the same rules.

A comment on that agreement is a separate change with `entity_type` `comment`, `site_id` `NDA-901`, and `anchor.type` `nda`.

Read the queue back with `GET /api/data/nda` and the same bearer token. The register text stays visible beside the suggested stage. When the register's last action is older than the saved record, the dossier shows a conflict note and does not hide either date.
