# Distributed Sites frontend rollout

The decision this work supports is whether a site merits further diligence and who should act next. The starting point for a desktop reviewer is a filtered shortlist. On a phone it can be a map pin, a shared record or a comment on one financial figure. A round-trip through any of these views should keep the reviewer’s place.

| Phase | Build | Acceptance walkthrough |
| --- | --- | --- |
| A · Correctness | Comparison matrix, P&L basis and period, confirmed review changes, retryable writes | Compare two unlike records, open a historical comment, then interrupt and retry a proposal. Reconcile the saved result. |
| B · Screening | Shortlist summary, column controls and financial preset, phone cards, search, clearer text | From one market, screen five sites and select two. Repeat with a one-row and an empty result. |
| C · Handoff | Return to shortlist, unplaced records, decision-first detail, NDA prioritization and scoped Ask | Leave a filtered list, identify who owns the next action, then return to the same rows. |
| D · Recovery and release | Independent optional loads, keyboard and network regression cases, preview walkthrough | Delay optional data, reject search once and retry. Exercise the working build at laptop and phone widths before promotion. |

## Acceptance checklist

The IDs match the two frontend reviews. These are observable acceptance criteria for release and subsequent usability testing. A passing build alone does not demonstrate comprehension or screen-reader usability.

| Finding | Shipped behavior in this branch | What to check |
| --- | --- | --- |
| R1 · Return to work | Review and NDA navigation retain the originating query, list selection, scroll and last active cell. | Close and use browser Back from a filtered, scrolled list. Confirm selection and focus. |
| R1 · Laptop fit | Header controls can wrap and table actions fit within a horizontal scroll surface. | At 1280 and 1366 pixels, find search, filters and list actions without page-wide scrolling. |
| R1 · Compare | One table aligns each measure across selected sites, with sticky labels and explicit missing values. | Compare unequal records, read a single measure across all columns, then remove one. |
| R1 · Phone card density | Cards prioritize the next step, with fewer simultaneous chips. | Identify the site and next action on a narrow phone. Open the record for supporting evidence. |
| R1 · Missing imagery | Available photos and aerials take priority, with a compact fallback when imagery is absent. | Check records with a gallery, an aerial only, and no imagery. A failed remote panorama can be opened in Maps. |
| 01 · Counts | The summary identifies matching sites and shows the number contributing figures. | Reconcile filtered rows against the shortlist total after a market or column filter. |
| 02 · Search entrance | The header search opens the same palette as its keyboard shortcut. | Open by pointer, touch and shortcut. Escape returns to the opening control. |
| 03 · Listing vs broker | Source links and the broker filter have distinct actions. | Open the listing, then filter by broker. Browser Back restores the prior URL. |
| 04 · Column controls | Column menus expose pin, move and width controls, alongside pointer drag handles. | Sort a column, reposition it with the keyboard, then resize by pointer. |
| 05 · Peer rankings | A single eligible value gets no peer ranking. | Filter from several values to one and verify that the rank disappears. |
| 06 · Land coverage | The acreage total distinguishes empty, unknown and recorded values and shows coverage. | Compare zero matches, recorded zero, all missing and mixed coverage. |
| 07 · Map layers | Mobile layer controls take precedence over map badges and the legend. | At 390 × 844 and a shorter height, reach and operate the final toggle. |
| 08 · Record resolution | Unscreened listings participate in record lookup. Missing-record feedback waits for the relevant data. | Open valid pipeline and unscreened links, a delayed link, and a nonexistent link. |
| 09 · Missing locations | The map count opens the unplaced records in the current scope. | Match the displayed count to the drawer and return to the same map. |
| 10 · Record hierarchy | List and Review lead with decision evidence. Imagery is available through a disclosure. | Find the recorded next action on a photo-rich record; compare entry from Map. |
| 11 · Phone facts | Cards name listing status and the acreage measure. | Read the card aloud and confirm the facts make sense without table headings. |
| 12 · Compare limit | The action and tray identify the two-to-four-site range and the removal path. | Select one, two, four and five rows. Replace one site and keep the other three. |
| 13 · Financial summaries | Asking coverage and the market land-comparable basis are separate. The financial column preset groups revenue, cash flow and next step. | Change the shortlist and inspect the source and coverage of each figure. |
| 14 · P&L basis | Both layouts expose stated and normalized figures when available. | Compare the same adjusted line and period on desktop and phone. |
| 15 · Linked financial comments | The phone follows the linked period and line. Closing the thread returns focus to the evidence. | Open a monthly cell, a missing month and an annual line; dismiss the thread. |
| 16 · Proposal language | The bulk action is labelled Propose drop and submits for review. | Confirm the stage persists until an authorized reviewer acts. |
| 17 · Mark and undo | The queue uses the confirmed response, with pending and error feedback. | Reject Mark and Undo separately, reload, and retry. Counts should reconcile. |
| 18 · Partial bulk success | Outcomes identify the remaining sites; keyed retries reuse the original result. | Fail the middle write, retry, and count one created object per target. |
| 19 · NDA ownership | Court, owner and active/closed status filter independently. Empty filters can be cleared. | Select an unassigned agreement in our court and check the cross-filter counts. |
| 20 · NDA urgency | Due-date groups separate overdue, today, upcoming, undated and closed. Longest wait and missing action are alternative views. | Give the longest-waiting record no deadline and a newer record an overdue date. |
| 21 · Ask scope | A shortlist of up to 20 IDs is passed to the answer service with role-filtered site facts. Larger lists identify portfolio scope. | Compare the scope shown for a site, a small shortlist and a larger list. Open a cited source. |
| 22 · Text contrast | A darker secondary text color carries addresses, sources and financial captions. | Inspect computed foreground/background colors and read at 200% zoom. |
| 23 · Keyboard search | Hits use native button activation and the dialog retains keyboard focus. | Test arrow/Enter, Tab/Space, pointer and Escape. Confirm one navigation per activation. |
| 24 · Selection labels | Selection controls include site identity and address where available. | Distinguish two same-name records using only announced checkbox labels. |
| 25 · Loading order | The core workspace can render while optional layers, listings and activity continue loading. | Delay or fail one optional request. Use List, then retry and recover the missing source. |
| 26 · Partial search | Search names pending, incomplete and empty result states. Local matches remain usable during a failure. | Reject full search once and retry the same text. Confirm no-matches appears only after completion. |
| 27 · Interrupted proposals | Failed submissions retain the draft and use a stable save reference for retries. | Disconnect after sending, reconnect and confirm one saved proposal with the original text. |

## Release and measurement

Run the repository checks and review the desktop and mobile screenshots on the candidate commit. The two synthetic screening captures in the screenshot workflow exercise the NDA filters and search recovery without including live counterparty details. Use the preview for keyboard focus, scroll restoration and readable layout. Keep review actions and injected failures in an isolated test database.

For the first team walkthrough, give reviewers the same five-site shortlist. Observe whether they can identify which records have figures, explain the comparison basis, identify the next owner, and return to their selection unaided. Record task completion, elapsed time, backtracks, and any mistaken reading of the financial basis. Compare these observations with a baseline before claiming a speed or comprehension improvement.
