# Design

Read this before changing UI. The map, the list, and the review inbox share one control vocabulary. A control that misses it falls back to the browser default, which is how the Layers panel lost its styling.

## No browser-default controls

Every `button`, `select`, `checkbox`, `radio`, and text field uses a design-system class on the element itself. Do not ship a control whose color, border, radius, or checkbox glyph comes from the user agent. `appearance` is `none`. A gray button face (`rgb(239, 239, 239)` or `rgb(240, 240, 240)`) means the class is missing or does not paint the control.

## Three tiers

Use one primary action per view. The other actions are pills or links.

| Tier | Class | Look |
| --- | --- | --- |
| Primary | `primary` | Fill `#1e4636`, text `#fffdf8`, radius 999. One per view. |
| Secondary pill | `paper-btn` | Fill `#fffdf8`, 1px border `#d6cebe`, radius 999. |
| Text link | `text-link` | Color `#1e4636`, underline at 35% (`rgba(30, 70, 54, 0.35)`). Add ↗ when the link leaves the app. |

`tool` and `icon-btn` are the same secondary pill, used for map chrome and icon-only actions. `icon-btn` is 44px.

## Segmented control

An either/or pair, such as Streets / Satellite, is a segmented control. Not two separate pills, and not a `<select>`.

```tsx
<div className="segmented" role="group" aria-label="Basemap">
  <button type="button" className={`segmented ${on ? "on" : ""}`}>Satellite</button>
  <button type="button" className="segmented">Map</button>
</div>
```

The selected segment uses the state class `on` (fill `#1c1914`, text `#fffdf8`). `on` is only a state. It is not a control class by itself.

## Dismiss

A panel dismisses with one quiet round ✕: class `close`, 32px on desktop (44px on a phone), fill `#fffdf8`, 1px `#d6cebe`, `aria-label` for the name. Never a labeled Close button. Never a second dismiss control in the same panel. A click-outside backdrop is not a second visible dismiss.

## Checkbox, select, and text fields

A checkbox uses class `check`: 18px, box `#d6cebe` and fill `#fffdf8` when off, fill `#1e4636` with a `#fffdf8` check when on, `appearance: none`. That includes Compare, the column menu, and Layers. Labels are 14px. A count caption uses `layer-meta`: 12px, color `#6f675b` (`--ink-3`).

A `<select>` uses class `secondary`: fill `#fffdf8`, 1px `#d6cebe`, radius 999, and the custom chevron. Do not leave the native arrow.

A text field uses class `field`: fill `#fffdf8`, 1px `#d6cebe`, radius 8px, and the focus ring. Search keeps class `search`.

The desktop list sorts from the column header. That header is a `sort-header` button, so it is keyboard focusable and shows the focus ring. A click switches between ascending and descending. It does not clear the sort. Sort by and the direction sit in the list bar, and the choice stays in the URL. The header fits on one line. Drag a column name to reorder. Its options menu offers filtering, pinning, width and keyboard-accessible Move left and Move right. The resize edge stays at the right. Phone pipeline cards show the review priority, charging spaces and cost per charge with their basis. The stage chip is the stage name only. A missing open-land figure stays off that line. The shortlist heading names the market and funnel stage and gives the matching count. A stage shared by all shown rows appears once in the heading. Desktop shows summary figures alongside it. On a phone, Figures expands the evidence and coverage counts beneath the heading. Sort stays a `secondary` select. Select, export, and clear area sit in a More `paper-btn` menu so the toolbar stays one row. Search this area is not shown in list view.

Columns is a `paper-btn` that opens a menu. It is not a `<details>` triangle. In list view the sheet fills the width. Extra space goes to Site, Asking · source, Power, Traffic, and Cash flow. A saved column layout keeps its widths, and the last of those columns fills a pane that is still wider. Those cells wrap, the full value stays on the tooltip, and the comparison bar stays under the text. Measure and the other map controls stay on the map and hide while the list is open.

## Panel header

A panel header is a 12px caps eyebrow (class `eyebrow`) on the left and the quiet ✕ on the right. Group the rows under their own eyebrows. The Layers panel is the reference: Basemap, Sites, Context.

The collapsed Layers and Legend controls are secondary pills (`paper-btn`), not a second header.

## Focus and motion

`:focus-visible` is a 2px `#fffdf8` gap plus a 2px `#1e4636` ring (`outline` with `outline-offset: 2px` and a cream `box-shadow`). Buttons, selects, and text links move in 120ms ease-out. Honor `prefers-reduced-motion`.

## Explicit classes

Put the class on the control. Do not style it with `.parent > button`, `.parent button`, or a selector that assumes the control is a direct child.

That regression broke the Layers panel. `globals.css` used `.layers > button`. The header was wrapped in `.layers-bar`, the selector stopped matching, and the buttons fell back to the browser default. The class on the element is what survives a wrapper.

`on` and layout helpers such as `only-mobile` do not count. The control still needs a class from the allowlist.

## Desktop chrome

Do not put chrome in a `<details>` or `<summary>`. A closed `<details>` drops its children out of the accessibility tree even when CSS tries to show them, which is why the old Map tools summary rendered at about 2×2px and the desktop basemap switch was unreachable. The native disclosure triangle is a browser control. Use a button. A note thread that must stay a disclosure uses class `disclosure` or `act-thread`, and its summary hides the marker.

## Phone

- Tap targets are at least 44px. The quiet ✕ grows from 32px to 44px. The site hero's Street View, Aerial, and Photos pills are the exception: on a phone they are a compact frosted group on the picture, shorter than 44px, so the frame can be taller and the pills stay clear of the embed's zoom and the Terms row. Expand and the sources button stay 44px.
- Overlay sheets such as Layers open at the half snap (`max-height: 50vh`), with the same eyebrow and ✕ header. The site record keeps peek, half, and full; a link can name the snap. Ask is the exception: on a phone it opens at 90% of the viewport so the transcript has room, with the same quiet round ✕.
- A menu that belongs to a bar stacks above the sheet under it. The review filter menu uses this so it stays usable while the inbox sheet is open.

## Map

Streets is the default basemap. The choice is remembered in `localStorage` under `basemap` (`satellite` or `positron`). Street is the muted Positron style.

On desktop the switch is one segmented control under the zoom buttons, always visible while the map is the view. On a phone it is only at the top of the Layers sheet. List view hides the map controls, including Measure.

A first visit, and the saved market when none was chosen, fits the map to every site in Phoenix, Las Vegas, and Miami. The market switcher is All markets / Phoenix / Las Vegas / Miami. A shared link that names a site or a market still opens there, and choosing a site still flies to it.

Below national scale, nearby Pipeline and Universe pins share one green bubble (`#1e4636`) with a cream count and a cream stroke, plus a dark rim so it stays readable on satellite and on the map. Neighborhood bubbles show the count. National buttons show the market name and count. It stays on one line and under 28 characters. A click fits the bubble to the pins it holds. From city level, about zoom 10 and closer, the pins split back into their own colors and labels. A shared link to one site keeps that pin on its own. The bubbles stay above the phone sheet, and on a phone the bubble is at least 44px.

Pins, area strokes, and labels stay legible on imagery: cream edges, a dark halo, and a light service-area fill (about 10% on desktop, 6% on a phone) so the ground shows through. Area labels sit below the phone header. The floating controls are the zoom buttons, the basemap switch, Layers, Measure, and, when a site is selected, Draw available lots. Draw and Measure share a secondary tool group. The accent fill belongs to Open site record in the selected pin preview. Its tooltip is “Outline open land or parking a charger could use.” The record keeps a one-line lot summary whose link opens the same tool. While drawing, a floating toolbar offers Undo point, Cancel, and Finish. Escape cancels and discards the shape that is not finished yet. A finished lot’s popover has Edit and Delete; Delete asks before it removes the lot. On a phone the button stays in the map controls, and drawing uses the full map with the toolbar at the bottom. They stay inside the screen, clear of the zoom control.

A pin tap opens a compact preview with its screening status, strongest available fact, next check, and a single action to open the full record. Closing returns to the original map extent. Direct record links open the full record. The map key expands on request. Compare keeps acquisition criteria visible when values match or evidence is missing. Highlight differences distinguishes unlike values from evidence gaps and incompatible bases. Show all measures adds supporting information. Saved comparisons load current figures. Download dated snapshot captures the figures displayed to the signed-in reviewer.

On desktop, the Map key, Nearby sites, Market context, Layers, Map tools, site preview and Spaces inspector each have a grip. Drag the grip to move the panel, or click it and choose a corner or Restore default position. Placement is a browser preference. Phone controls keep their sheet layout. Hide space details folds the Spaces inspector while keeping the footprint and edits available.

## Chips

A chip, pill, or badge is a short label on one line. More than one word is fine: `Outside service area`, `Near, 4.2 mi`, `Financial screen`. It is not a sentence, and it does not join clauses with a middle dot.

The label is at most 28 characters. It does not wrap, and it does not grow the chip. Longer text is a tooltip, a line on the site card, or a column. A stage chip is the stage name only. The reason, who proposed it, who approved it, and the time sit in the tooltip and on the card. The Drop reason column keeps the reason.

This is a design-review requirement. A chip that holds a sentence is the wrong design.

A list cell follows the same rule. The cash flow cell is the amount and the figure name on one line (`$102,517 EBITDA`). Package status and the source sit in the cell title and on the card. A phone list fact does not start a wrapped line with a middle dot.

## One home for each control

- A floating control is a pill on the map. Do not put a card behind a single button.
- A single choice is a segmented control on one row. If it will not fit, use a secondary select. Do not wrap pills onto a second row.
- On/off switches and single choices never share one chip row.
- A control has one home. A new entry point replaces the old one.
- Map chrome is zoom, the basemap switch, Layers, Measure, and Draw available lots when a site is selected. Anything else goes in Layers or More.
- A filter shows as an active-filter chip and changes the counts, or it does not ship.

## CI guards

`scripts/check_controls.mjs` runs in the validate job. It scans every `.tsx` file under `components/` and `app/`. It fails when a `<button>`, `<select>`, `<details>`, `<summary>`, or an `<input>` of type checkbox, radio, number, text, search, or password has no allowlisted class. An untyped `<input>` counts as text. A `className` ternary has to put an allowlisted class on every branch. `on` does not count. A class on the allowlist still has to paint the control: `menu-item` and `action` carry their own background and border, because a class with no rules leaves the browser button face. That is why the phone list passed the old lint. The buttons had `menu-item`, the checkboxes and `<details>` were not scanned, and `menu-item` did not set a background.

Playwright opens Layers at 1280×800, checks that the ✕ is cream rather than the browser button face, checks that a checked checkbox is `#1e4636`, and checks that the basemap control is larger than 20×20 and that the choice survives reload. At 390×800 it opens List, Columns, Compare, and Layers and fails if a visible button, select, or checkbox still has `appearance: auto`, the button face `rgb(239, 239, 239)` or `rgb(240, 240, 240)`, or `accent-color: auto` with no class. The review screenshots job writes a crop of the open Layers panel.

### Allowlist

Adding a class means updating this list and `scripts/check_controls.mjs` in the same change. Keep it small.

Core: `primary`, `paper-btn`, `text-link`, `tool`, `icon-btn`, `close`, `segmented`, `secondary`, `action`, `check`, `field`, `search`, `sort-header`.

Existing component classes: `review-launch`, `avatar`, `phone-step`, `backdrop`, `sub`, `aside`, `chip`, `menu-item`, `funnel-step`, `overlay-chip`, `search-hit`, `list-row`, `removable`, `sheet-grab`, `sheet-step`, `review-row`, `review-step`, `review-count`, `review-more`, `review-exit`, `compare-go`, `fin-tile`, `photo-shot`, `hero-still`, `hero-info`, `hero-expand`, `photo-more`, `propose`, `disclosure`, `act-thread`.

## Definition of done for UI changes

- [ ] No button, select, checkbox, radio, or text field uses the browser default.
- [ ] Each control has a class from the allowlist, on the element itself.
- [ ] A new class was added to this file and to `scripts/check_controls.mjs`.
- [ ] A panel has one quiet ✕ and no labeled Close.
- [ ] Desktop chrome is not a closed `<details>`.
- [ ] Phone targets are at least 44px, a new overlay sheet opens at the half snap, and its menu stacks above the sheet.
- [ ] Focus shows the cream gap and the `#1e4636` ring.
- [ ] Streets is the first-visit default, and pins stay legible on it.
- [ ] The Layers Playwright check and the Layers screenshot crop still cover the panel when that panel changed.

## Acquisition workspace

The pine navigation bar links directly to the all-market acquisition shortlist alongside Explore, Pipeline, My work and Review. Keyboard search reaches the same ranked list. Map and List switch how the current pipeline filters are displayed. My work reads assignments, unresolved evidence threads and NDA deadlines from their existing systems. Team gaps include unassigned findings. The record separates site fit, economics, diligence and activity, with source links returning to the originating comparison.

### Market map and parcel preview

Start a new browser on Streets. Restore the last explicit basemap. At national scale, label markets with their mapped count and leave room for the open scope sheet. At city scale, show filtered acquisition records and a key for the current workspace. Count contextual layers separately from the shortlist. The missing-location link opens the exact records behind its count.

A selected pin's preview leads with a sourced spatial fact where available, the next check, and its evidence action. Keep the site record, comparison and satellite view reachable. Parcel tools groups Draw and Measure on a phone. A rendering failure opens the same shortlist with Retry map. Keep URL filters and the selected record across retry.

At city zoom, Nearby sites follows the visible map and orders matching records by distance from its center. Its phone sheet starts collapsed in one map summary with coverage and the map key. A row and its pin open the same parcel preview and preserve the same return camera. Spaces is in Map tools. Opening it starts with the filtered pipeline sites. Browse all analyzed sites expands the catalog. Main map restores the market, filters, selection and camera from entry.

The map record keeps the site name, address, deal stage and section navigation above the scrolling content. Overview contains the recommendation, charging feasibility, a compact site snapshot and source disclosures. Site fit owns layouts, imagery and parcel tools. Market owns trade-area evidence. Financials owns statements and purchase support. Diligence owns stage actions, proposals and threads. Activity owns the dated history. Lead with one recommendation and the immediate action or condition for reconsideration. Show the owner, review date and deal stage separately. Keep charging spaces and cost per charge visible. Put dated workbook next steps in Activity when a current acquisition review exists.

Saved comparisons place the decision beside its source figures. Keep the original value, basis and reporting period legible when a current figure changes. Link each citation to the underlying record and any matching evidence follow-up.

Decisions to revisit links directly to one changed citation. Show its original and current figures, the source, and the owner’s review action alongside the decision rationale. Keep and Revise create dated records. Nearby rows show one parcel fact and highlight its map position on hover or keyboard focus. The ring lets pointer events reach the map.

### Power on the map

Power view is a signed-in map layer. Filter property-service evidence independently of utility estimates. A pin's Power tab shows the actual readings with their sources, the forecast year, distance from the pin to mapped infrastructure, and the shared follow-up. Preserve recorded zeroes. A known distance can exist without matching geometry. Framing the grid is reversible and keeps the site selected.

### Market context

Market context is a map mode beside Layers. It replaces the five Area data switches. One measure colors the filtered shortlist using fixed bands, with gray for missing and an explicit reading count on clusters. Sites in view uses the same mapped records, supports numeric sorting and opens the ordinary pin preview. On a phone the list starts collapsed. Workbook nearest-segment traffic, the 800 m maximum and linked census readings retain their separate sources. Wash totals within one and three miles are cumulative. Mapped census locations have their own count and radius. Market context in the record and Compare reads the same measures and units.
