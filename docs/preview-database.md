# Preview database

Vercel Preview used to read the same `DATABASE_URL` as Production. A preview walk, migration, or backfill could change production data. Preview now has one long-lived Neon branch named `preview`. That branch is a copy of production at the last reset. It can drift. It is not a second production database, and it is not one branch per pull request.

Neon stays on the free plan. One extra branch and one compute endpoint that scales to zero stay inside that plan. Do not create `preview/<pull request>` branches. The cleanup workflow still deletes a branch with that name when a pull request closes, and it never deletes the branch named `preview`.

## Reset

On GitHub, open **Reset preview database**, choose the branch you want the workflow to run from, and type `reset-preview-db`.

The workflow:

1. Finds the production Neon branch (the default branch, or the branch named `main` or `production`).
2. Creates the branch named `preview` from it, or resets that branch to the production head when it already exists. It does not keep the old preview copy under another name.
3. Reads the pooled and direct connection strings for that branch.
4. Sets those strings, and the host, role, and database fields, on the Vercel **Preview** target only.
5. Sets `NEON_PRODUCTION_HOST` on Preview to the production hostname only, and sets `PREVIEW_DATABASE_BRANCH` to `preview`. Both are Preview-only and neither is a secret.
6. Redeploys the latest ready preview, when one exists, so the new values are picked up.

Production and Development are not written. If a variable is shared by Production and Preview, Preview is removed from that shared variable and a separate Preview value is created. The production value stays where it is.

If the preview host matches `NEON_PRODUCTION_HOST`, the workflow stops and does not change Vercel.

A reset replaces whatever is on the preview branch. Notes, stages, and migrations tried on preview since the last reset are gone. Production is unchanged.

## Migrate preview first

**Preview migrations** applies `db/migrations` to the branch named `preview`. Type `migrate-preview`. It does not read `NEON_DATABASE_URL` and it refuses to run when the preview host is the production host.

Use it to try a new migration, including files such as `015` through `018`, on the preview copy. Production still changes only through **Production migrations** and the phrase `migrate-production`.

Run a reset before a preview migration when you want a fresh copy. Run the preview migration before the production one when you want to see the migration on preview first. The preview copy can drift again as soon as someone writes through a preview deployment.

## Runtime check

On `VERCEL_ENV=preview`, writes are refused until the reset workflow has set `PREVIEW_DATABASE_BRANCH` to `preview` on that deployment. Missing that marker is treated as production, including when `NEON_PRODUCTION_HOST` is unset. Write routes return 503 with `Preview is pointed at production`. That includes `POST /api/changes` and every other POST, PUT, PATCH, or DELETE, plus the digest and flush jobs. The banner is rendered on each request, not at build time, and shows the same text. Reads stay available.

A marked deployment is still refused when `DATABASE_URL`'s host matches `NEON_PRODUCTION_HOST` or the host of `NEON_DATABASE_URL`. The pooler host and the direct host count as the same. The reset workflow writes `NEON_PRODUCTION_HOST` onto Preview so that comparison can run. Until the marker is set, a preview that still has the production URL cannot write.

## Env split

Checked against the Vercel project. Names only.

| Variable | Where it is set | Decision |
|---|---|---|
| `DATABASE_URL` | Production and Preview, one shared variable | Split. Preview gets the pooled URL of the branch named `preview`. |
| `POSTGRES_URL` | Production and Preview | Split the same way. The app reads `DATABASE_URL`. This alias must not keep the production URL. |
| `POSTGRES_PRISMA_URL` | Production and Preview | Split the same way. |
| `POSTGRES_URL_NON_POOLING` | Production and Preview | Preview gets the direct URL. |
| `POSTGRES_URL_NO_SSL` | Production and Preview | Preview gets the direct URL with `sslmode=disable`. |
| `DATABASE_URL_UNPOOLED` | Production and Preview | Preview gets the direct URL. |
| `PGHOST` | Production and Preview | Preview gets the pooled preview host. |
| `POSTGRES_HOST` | Production and Preview | Same as `PGHOST`. |
| `PGHOST_UNPOOLED` | Production and Preview | Preview gets the direct preview host. |
| `PGUSER` | Production and Preview | Preview-only role name from the preview URL. |
| `POSTGRES_USER` | Production and Preview | Same as `PGUSER`. |
| `PGPASSWORD` | Production and Preview | Preview-only password. Never printed. |
| `POSTGRES_PASSWORD` | Production and Preview | Same as `PGPASSWORD`. |
| `PGDATABASE` | Production and Preview | Preview-only database name. |
| `POSTGRES_DATABASE` | Production and Preview | Same as `PGDATABASE`. |
| `NEON_PROJECT_ID` | Production and Preview, and a GitHub variable | Same Neon project. Leave shared. Not a connection string. |
| `NEON_AUTH_BASE_URL` | Production and Preview | The app does not call Neon Auth. Leave shared. |
| `VITE_NEON_AUTH_URL` | Production and Preview | The app does not read it. Leave shared. |
| `NEON_PRODUCTION_HOST` | GitHub variable, then Vercel Preview | Hostname only. The reset workflow copies it to the Preview target. Compared, not printed. |
| `PREVIEW_DATABASE_BRANCH` | Vercel Preview, set by the reset workflow | Plain value `preview`. Preview writes stay closed until this is set. |
| `NEON_DATABASE_URL` | GitHub secret | Production pooled URL. Not set on Vercel. Preview migration does not use it. |
| `RESEND_API_KEY` | Production and Preview | Shared by the integration. Outbound mail is off when `VERCEL_ENV` is set and is not `production`. |
| `RESEND_EMAIL_DOMAIN` | Production and Preview | Shared. Unused while preview mail is off. |
| `XAI_API_KEY` | Production and Preview | Shared. Ask does not call xAI when `VERCEL_ENV` is `preview` or `development`. |
| `AGENT_INBOX_SECRET` | Production and Preview | Shared so preview can exercise the feed against the preview database. Writes are refused when the host is production. |
| `KV_URL` | Production and Preview | Shared Upstash. The app does not read this name. |
| `KV_REST_API_URL` | Production and Preview | Shared. Preview lockout and Ask keys are prefixed with `preview:` so they do not hit production keys. |
| `KV_REST_API_TOKEN` | Production and Preview | Shared with the URL above. The prefix is the guard. A second Redis store is not created. |
| `KV_REST_API_READ_ONLY_TOKEN` | Production and Preview | The app does not read this name. Leave shared. |
| `REDIS_URL` | Production and Preview | The app does not read this name. Leave shared. |
| `AUTH_USERS` | Production and Preview | Shared so preview can sign in. Not a production write. |
| `AUTH_SECRET` | Production and Preview | Shared. The session cookie is host-scoped. |
| `CHANGES_API_ENABLED` | Production only | Stays off Preview. Preview turns writes on by itself. The host check is the backstop. |
| `READ_STAGES_FROM_DB` | Production only | Stays production only. |
| `READ_ACTIVITY_FROM_DB` | Production only | Stays production only. |
| `READ_COMMS_FROM_DB` | Production only | Stays production only. |
| `READ_SITES_FROM_DB` | Production only | Stays production only. |
| `AGENT_WRITE_TOKEN_INDIE` | Production only | Must not be copied to Preview. |
| `AGENT_WRITE_TOKEN_MUSE` | Production only | Must not be copied to Preview. |
| `CRON_SECRET` | Production only, and a GitHub secret | Stays off Preview. Digest and flush refuse to run when `VERCEL_ENV` is not `production`. Vercel cron runs on production deployments. |
| `WORKBOOK_MIRROR_ENABLED` | GitHub variable | Off for any `VERCEL_ENV`, including when the variable is `1`. The mirror also refuses every Vercel environment. Previews do not write the workbook. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | GitHub secret | Not a Vercel env. Mirror and protect refuse to run when `VERCEL_ENV` is set. |
| `SYNC_GITHUB_TOKEN` | GitHub secret | Not a Vercel env. The sync script exits when `VERCEL_ENV` is `preview` or `development`. Preview deployments do not dispatch it. |
| `NEON_API_KEY` | GitHub secret | Used by the reset, preview migration, and cleanup workflows. Not a Vercel env. |
| `SNAPSHOT_REVALIDATE_URL` | GitHub variable | Production cache refresh only. The script exits on a Vercel preview. |
| `APP_URL` | GitHub variable | Alert links. Preview does not send mail. |

`SMTP_USER` and `SMTP_PASS` are not set on the Vercel project. If they are present on a preview, mail still does not send, because both Resend and SMTP are off outside production.

## Secrets the workflows need

Already used by other workflows: secret `NEON_API_KEY`, variables `NEON_PROJECT_ID` and `NEON_PRODUCTION_HOST`.

Reset also needs secret `VERCEL_TOKEN`. That name is not used by any other workflow. Optional variables `VERCEL_PROJECT_ID` and `VERCEL_TEAM_ID` override the project and team ids already written in `.github/workflows/validate-data.yml`. They do not have to be created.

The workflows mask the API key, the Vercel token, and the connection strings. They do not print them.
