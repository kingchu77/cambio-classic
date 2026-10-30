# Deployment: GitHub Pages + Supabase

## What you need to do in your accounts

You control the Supabase project and GitHub repository. Create/select them, sign in locally when prompted, enable anonymous sign-ins, and supply **public configuration** to GitHub. Never paste passwords, personal access tokens, database passwords, or service-role keys into chat. The backend receives its service-role key from Supabase's built-in environment.

Use a new dedicated Supabase project, or review the additive migration before applying it to an existing one. No existing tables are dropped or changed. The application adds four `cambio_*` tables and three service-only RPC functions.

## 1. Prepare Supabase

Create a project at [Supabase](https://supabase.com/dashboard). Choose a region reasonably close to the two players. In Authentication → Sign In / Providers enable **Allow anonymous sign-ins**. Under Authentication URL Configuration set your eventual GitHub Pages URL as Site URL. This game does not use email redirects.

From the project's Connect/API Keys UI obtain:

| Value                                               | Where it belongs                              | Confidential?          |
| --------------------------------------------------- | --------------------------------------------- | ---------------------- |
| Project URL, e.g. `https://PROJECT_REF.supabase.co` | `VITE_SUPABASE_URL`                           | Public                 |
| Modern `sb_publishable_…` key                       | `VITE_SUPABASE_PUBLISHABLE_KEY`               | Public                 |
| Project reference                                   | CLI link or `SUPABASE_PROJECT_REF`            | Public                 |
| Access token / database password                    | Local CLI login or GitHub environment secrets | Secret                 |
| Service-role key                                    | Supabase built-in Edge Function env only      | Secret; never frontend |

### Recommended: CLI deployment

Run from the project root. `supabase login` opens your browser; linking may prompt for your database password. Enter secrets only into the local CLI/browser prompt.

```sh
npm ci
npm test
npx supabase@2.122.0 login
npx supabase@2.122.0 link --project-ref YOUR_PROJECT_REF
npx supabase@2.122.0 db push
npx supabase@2.122.0 functions deploy game --project-ref YOUR_PROJECT_REF
```

Do **not** run `db reset --linked` against a hosted project. `db push` applies the included migration. The function deployment reads `verify_jwt = false` in `supabase/config.toml`: the handler itself calls `auth.getUser(bearerToken)` on **every** request before touching data, supporting modern publishable keys. It never accepts a user ID supplied by the frontend.

The deployed function URL is `https://YOUR_PROJECT_REF.supabase.co/functions/v1/game`. Its intended client is the game. A GET request returns HTTP 405; a POST without a valid session returns 401. Do not make it a public data endpoint or add client grants to the secret tables/RPCs.

### Alternative: GitHub manual backend workflow

Create GitHub environment **supabase-production**. Add environment secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`. Add repository Actions variable `SUPABASE_PROJECT_REF`. The access token is generated in Supabase account settings and entered directly into GitHub's secret UI. Run **Deploy Supabase backend** from Actions. This applies migrations and deploys the function. It does not enable anonymous sign-ins; do that in the Supabase dashboard.

### Dashboard SQL option

The complete migration can also be run once in Supabase SQL Editor. The Edge Function still needs a CLI deployment because it imports the two `_shared` modules. Avoid rerunning the initial SQL manually; subsequent changes belong in new numbered migrations.

The migration adds `cambio_views` to the `supabase_realtime` publication. Confirm it is enabled in Database → Replication / Publications. Publish **only** the projection table, never `cambio_rooms` or receipts.

## 2. Configure the real frontend locally

Copy `.env.example` to `.env.local` and fill in:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
```

Leave `VITE_LOCAL_API` unset. Run `npm run dev`, open the displayed local URL in two separate browsers, create/join, peek, and take turns. This uses the actual Supabase backend, with persistent rooms and real authenticated sessions.

## 3. Publish GitHub Pages

Create an empty GitHub repository (for example `cambio-classic`). Put this project's files at its root, including dotfiles. GitHub Desktop can publish the local folder, or use ordinary Git. Keep `.env.local`, `node_modules`, and `test-results` ignored. Do not upload the surrounding Codex workspace.

In repository **Settings → Secrets and variables → Actions → Variables**, add exactly:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

They are public build-time configuration; GitHub secrets are not needed for Pages. In **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**. The deployment branch in the workflow is `main`; adjust it if you intentionally use another branch.

Push to `main`, or run **GitHub Pages** manually from Actions. The workflow installs pinned dependencies, runs rules/database tests, validates public configuration, builds, and publishes only `dist/`. It refuses an unset or non-publishable frontend key.

The URL will usually be `https://YOUR_GITHUB_USER.github.io/cambio-classic/`. Use the exact URL emitted by the workflow. The Vite base is `./`, so project subpaths work; invitation URLs use `?room=CODE` and need no special SPA rewrite. Refreshes work on GitHub Pages because the path stays at `index.html`'s directory.

## 4. Play across two iPhones

Open the Pages URL in Safari on phone A, create a table, and use **Share invitation**. Send that URL yourself. Phone B opens it in Safari, automatically joins, and both choose two initial cards and hide them. Use the same browser profile to reconnect; avoid clearing Safari website data during a match.

Complete the acceptance checklist in [TESTING.md](TESTING.md), once over Wi-Fi/mobile data on different networks. Physical-device Safari and the hosted services cannot be certified by the local test harness.

For an automated live-backend smoke check, export the two public environment values and run `node scripts/smoke-supabase.js`. This creates two anonymous test users and one expiring test room, validates private projections/RLS, and checks an actual Realtime update. It does not require or accept a service-role key.

To run the four mobile-browser tests against an already deployed frontend, set `CAMBIO_LIVE_URL` to its complete URL (including the repository subpath), then run `npm run test:e2e`. This bypasses the local test server and exercises the frontend's configured hosted backend. For example, in PowerShell:

```powershell
$env:CAMBIO_LIVE_URL = 'https://kingchu77.github.io/cambio-classic/'
npm run test:e2e
```

Live tests create anonymous test seats and expiring rooms. They use no admin keys. The migration filename matches the version recorded during the initial hosted deployment, so subsequent CLI deployments will not attempt to apply the same schema twice.

## Local Supabase stack (optional)

Requires Docker and the Supabase CLI. Run `npx supabase@2.122.0 start`, then `npx supabase@2.122.0 functions serve game` in another terminal. Use the local API URL and anonymous public API key printed by the CLI in `.env.local`. `npm run dev` accepts the local CLI's legacy anonymous key for local development; the production configuration checker requires a modern publishable key. Local config enables anonymous sign-ins. The CLI applies local migrations on startup. Never put the local service-role key in the frontend.

## Operations and recovery

- The Realtime subscription is scoped to the authenticated user's `cambio_views` row. Polling every 1.5 seconds repairs missed updates and advances expired final-turn windows; hidden tabs pause polling. There is no required always-running timer worker.
- Anonymous browser tokens persist locally and refresh through Supabase Auth. Changing devices/storage cannot recover a seat; start another room. Seats cannot be silently replaced by a stranger holding an old invite.
- Rooms expire seven days after the last state change. Optionally schedule `delete from public.cambio_rooms where expires_at < now();` in Supabase; child snapshots/receipts cascade. Do not delete active anonymous users. Provider-wide abuse protection can be configured in Supabase; CAPTCHA is not implemented in this frontend, so enabling mandatory CAPTCHA requires adding its token flow first.
- Actions are limited per authenticated UID: 5 creates/hour, 30 joins/minute, 240 game requests/minute. This is suitable for a private two-person game; it is not a complete defence against mass anonymous account creation.
- A disconnected player pauses mandatory choices; there are no AI substitutions or forced forfeits. Reopening the same invitation in the same browser resumes.
- Check plan quotas and project status if Auth/functions return errors. If Realtime is unavailable, polling still updates both players. Choose a nearby backend region for snap responsiveness; canonical order is database commit order, not phone timestamps.
- To update: push frontend changes to `main`; deploy changed migrations/functions through the CLI or manual backend workflow. Preserve backward compatibility for open rooms or finish the current match before a rules/schema upgrade.

Official references: [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous), [Edge Function authorization](https://supabase.com/docs/guides/functions/auth-headers), [Realtime and RLS](https://supabase.com/docs/guides/realtime/authorization), [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
