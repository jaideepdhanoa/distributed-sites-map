<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Start here

Distributed Sites is the private team map at `distributedsites.com` (public GitHub repo `jaideepdhanoa/distributed-sites-map`). Neon is the record. The Pipeline workbook is a mirror. Code, schema, sync, and verification are shared; Muse still owns broker comms and capture. ChatGPT has its own app bearer with both the capture and verification permissions. Events record `chatgpt`. Full guide: `docs/agent-onboarding.md`.

As of 24 Nov 2026 Jaideep does not require an Indie review. Open a PR, get the checks below green, and squash-merge it yourself. Production data and Vercel secret env vars still need Jaideep's explicit approval.

## Install, run, test

CI uses Node 22 and Python 3.12. `data/source/` is gitignored and is not in the clone. `npm run dev` serves the committed `data/generated` files. Sign-in needs a local gitignored `.env`. Do not invent or commit secrets.

```bash
npm install
python3 -m pip install -r requirements.txt
npm run dev
npm test
npm run test:timeline
node scripts/check_controls.mjs
python3 scripts/check_surface.py
python3 scripts/build_data.py --check
python3 scripts/build_data.py --gap-gate
```

`npm run build-data` needs the private source files. `npm run test:actions` installs nothing by itself; CI runs it after `npx playwright install --with-deps chromium`, and Playwright starts `e2e/server.ts`. `npm run db:migrate` applies pending `db/migrations` only when `DATABASE_URL` is not production.

## CI that must be green

On a pull request, from the rollup on #178:

| Check | Workflow |
| --- | --- |
| `validate`, `functions`, `e2e` | Validate data |
| `actions` | Actions (`npm test`, `npx tsx scripts/parity-site-types.ts`, `npm run test:actions`) |
| `timeline` | Timeline |
| `screenshots` | Review screenshots |
| commit status `Vercel` | Preview deployment |
| `Vercel Preview Comments` | Vercel |

`e2e` and `screenshots` skip the browser when `E2E_USERNAME` and `E2E_PASSWORD` are unset, and the job still succeeds. `functions` runs `npx vercel build` and `node scripts/check-function-count.mjs` (fail above 10 Node functions). Neon preview cleanup runs when the PR closes. It is not a merge gate.

## Pull requests

Branch from `main`. Write the PR so another agent can see what changed and which rows or flags it touches. Vercel deploys a preview per PR and production on merge to `main`. The commit status context is `Vercel`.

Squash-merge after the checks above are green. History uses that shape (`(#NNN)` on the subject). If `POST /repos/{owner}/{repo}/pulls/{n}/merge` returns 403 and the message is about stacked PRs, call `POST /repos/{owner}/{repo}/pulls/{n}/merge-async` with the same squash body.

A UI change is walked on the desktop preview and the phone preview before merge. Put those screenshots in the PR and crop the address bar. After a merge that touches the build or `guard_deal_text`, read the next Workbook sync run.

## Hard rules

The repo is public. Broker text, Gmail ids, broker names, emails, phones, prices, and other private data stay out of code, fixtures, commits, and CI logs. Never print or commit a secret or token.

Do not touch production data or env vars unless Jaideep has explicitly approved that action. Jaideep edits Vercel secret env vars. Do not rotate `CRON_SECRET` or `AUTH_SECRET`.

Do not set Stage to Dropped. R-097: suggest a drop with a rationale. A human reviewer drops it and records a reason. The server rejects an agent drop.

Brokers are never told about autonomous vehicles or charging. Do not send external email or messages.

Land freeze R-108: the chip is `Land paused`. No land sourcing or follow-up while it is on.

Timestamps are ISO-8601 with a numeric offset (R-101). A disagreement is logged, not silently chosen. One writer per row. Send `source`, keep the `Idempotency-Key`, and read the row back after a write.

Agents do not set NDA owners and do not bypass the NDA actor check in `parseNda`. Chips are short labels (`lib/chips.ts`, 28 characters, stage name only).

The workbook mirror is the only writer of mirrored cells. Rules & Decisions and Run Log stay directly writable. Everything else goes through `POST /api/changes` or the signed-in site.

## UI

Read `DESIGN.md` before changing components, `app/globals.css`, or any button, select, checkbox, or radio. Use the control classes there. A new control class belongs in both `DESIGN.md` and `scripts/check_controls.mjs`.

## Workbook

The Pipeline workbook is a read-only mirror. Neon is the record. Write stage, activity, comms, and site changes through `POST /api/changes` or the signed-in site. Do not edit mirrored cells, and do not add a script that writes the sheet. The workbook mirror is the only writer. It overwrites a hand edit with the database value and reports counts and hashed ids.

The quarantined pipeline row and row 10 on Pipeline and Land Sites stay untouched. Do not write, link, or include that row. Rules & Decisions and Run Log stay writable. Workbook protect is shipped off: dry run is the default, and apply needs the confirm phrase `protect-workbook-readonly` plus dry run turned off. Do not run that apply against the live workbook unless Jaideep has asked for it.

The scheduled sync reports workbook drift and does not copy sheet edits into the database. Confirm-gated comms repairs can still copy date or summary text into the database. They do not write the sheet.
