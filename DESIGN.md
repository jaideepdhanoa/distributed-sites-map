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

An either/or pair, such as Satellite / Map, is a segmented control. Not two separate pills, and not a `<select>`.

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

A checkbox uses class `check`: 18px, box `#d6cebe` and fill `#fffdf8` when off, fill `#1e4636` with a `#fffdf8` check when on, `appearance: none`. That includes Compare, the column menu, and Layers. Labels are 14px. A count caption uses `layer-meta`: 12px, color `#8a8273` (`--ink-3`).

A `<select>` uses class `secondary`: fill `#fffdf8`, 1px `#d6cebe`, radius 999, and the custom chevron. Do not leave the native arrow.

A text field uses class `field`: fill `#fffdf8`, 1px `#d6cebe`, radius 8px, and the focus ring. Search keeps class `search`.

The desktop list sorts from the column header. That header is a `sort-header` button, so it is keyboard focusable and shows the focus ring. The phone pipeline list also has a Sort `secondary` select, because the table headers are not on screen. Each phone row has a Show on map `text-link`.

Columns is a `paper-btn` that opens a menu. It is not a `<details>` triangle.

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

- Tap targets are at least 44px. The quiet ✕ grows from 32px to 44px.
- Overlay sheets such as Layers open at the half snap (`max-height: 50vh`), with the same eyebrow and ✕ header. The site record keeps peek, half, and full; a link can name the snap.
- A menu that belongs to a bar stacks above the sheet under it. The review filter menu uses this so it stays usable while the inbox sheet is open.

## Map

Satellite is the default basemap. The choice is remembered in `localStorage` under `basemap` (`satellite` or `positron`). Street is the muted Positron style.

On desktop the switch is the segmented control at the top of the Layers panel. On a phone it stays inside Map tools.

Pins, area strokes, and labels stay legible on imagery: cream edges, a dark halo, and a light service-area fill (about 10% on desktop, 6% on a phone) so the ground shows through. Area labels sit below the phone header. Map tools stays inside the screen, clear of the zoom control.

## CI guards

`scripts/check_controls.mjs` runs in the validate job. It scans every `.tsx` file under `components/` and `app/`. It fails when a `<button>`, `<select>`, `<details>`, `<summary>`, or an `<input>` of type checkbox, radio, number, text, search, or password has no allowlisted class. An untyped `<input>` counts as text. A `className` ternary has to put an allowlisted class on every branch. `on` does not count. A class on the allowlist still has to paint the control: `menu-item` and `action` carry their own background and border, because a class with no rules leaves the browser button face. That is why the phone list passed the old lint. The buttons had `menu-item`, the checkboxes and `<details>` were not scanned, and `menu-item` did not set a background.

Playwright opens Layers at 1280×800, checks that the ✕ is cream rather than the browser button face, checks that a checked checkbox is `#1e4636`, and checks that the basemap control is larger than 20×20 and that the choice survives reload. At 390×800 it opens List, Columns, Compare, and Layers and fails if a visible button, select, or checkbox still has `appearance: auto`, the button face `rgb(239, 239, 239)` or `rgb(240, 240, 240)`, or `accent-color: auto` with no class. The review screenshots job writes a crop of the open Layers panel.

### Allowlist

Adding a class means updating this list and `scripts/check_controls.mjs` in the same change. Keep it small.

Core: `primary`, `paper-btn`, `text-link`, `tool`, `icon-btn`, `close`, `segmented`, `secondary`, `action`, `check`, `field`, `search`, `sort-header`.

Existing component classes: `review-launch`, `avatar`, `phone-step`, `backdrop`, `sub`, `aside`, `chip`, `menu-item`, `funnel-step`, `overlay-chip`, `search-hit`, `list-row`, `removable`, `sheet-grab`, `sheet-step`, `review-row`, `review-step`, `review-count`, `review-more`, `review-exit`, `compare-go`, `fin-tile`, `photo-shot`, `hero-still`, `hero-info`, `photo-more`, `propose`, `disclosure`, `act-thread`.

## Definition of done for UI changes

- [ ] No button, select, checkbox, radio, or text field uses the browser default.
- [ ] Each control has a class from the allowlist, on the element itself.
- [ ] A new class was added to this file and to `scripts/check_controls.mjs`.
- [ ] A panel has one quiet ✕ and no labeled Close.
- [ ] Desktop chrome is not a closed `<details>`.
- [ ] Phone targets are at least 44px, a new overlay sheet opens at the half snap, and its menu stacks above the sheet.
- [ ] Focus shows the cream gap and the `#1e4636` ring.
- [ ] Satellite is still the default, and pins stay legible on it.
- [ ] The Layers Playwright check and the Layers screenshot crop still cover the panel when that panel changed.
