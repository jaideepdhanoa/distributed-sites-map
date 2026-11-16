<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI

Read `DESIGN.md` before changing components, `app/globals.css`, or any button, select, checkbox, or radio. Use the control classes there. A new control class belongs in both `DESIGN.md` and `scripts/check_controls.mjs`.

## Workbook

The Pipeline workbook is a read-only mirror. Neon is the record. Write stage, activity, comms, and site changes through `POST /api/changes` or the signed-in site. Do not edit mirrored cells, and do not add a script that writes the sheet. The workbook mirror is the only writer. It overwrites a hand edit with the database value and reports counts and hashed ids.

The quarantined pipeline row and row 10 on Pipeline and Land Sites stay untouched. Do not write, link, or include that row. Rules & Decisions and Run Log stay writable. Workbook protect is shipped off: dry run is the default, and apply needs the confirm phrase `protect-workbook-readonly` plus dry run turned off. Do not run that apply against the live workbook unless Jaideep has asked for it.

The scheduled sync reports workbook drift and does not copy sheet edits into the database. Confirm-gated comms repairs can still copy date or summary text into the database. They do not write the sheet.
