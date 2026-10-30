# Live deployment

Deployed on 2026-10-30.

- Play: https://kingchu77.github.io/cambio-classic/
- Source: https://github.com/kingchu77/cambio-classic
- Supabase project: `cambio-classic` (`irknxnpecamtehwfyzxp`), `us-east-1`.
- Dashboard: https://supabase.com/dashboard/project/irknxnpecamtehwfyzxp
- Game function: https://irknxnpecamtehwfyzxp.supabase.co/functions/v1/game
- Initial migration: `20261030195519_cambio.sql`; this matches the hosted migration history.

Anonymous sign-ins are enabled. Authentication Site URL is the GitHub Pages URL. GitHub Actions variables supply the public Supabase URL and modern publishable key. No service-role key is included in the frontend or repository.

The `game` function verifies every bearer token with Supabase Auth. Its platform `verify_jwt` setting is disabled to match the supplied configuration; authentication remains enforced by the handler. GET returns 405, unauthenticated POST returns 401, and CORS preflight succeeds.

All four application tables have RLS enabled. Clients can select only their own live `cambio_views` rows; secret state, receipts, rate limits, and privileged RPCs are restricted to the server. Only `cambio_views` is published through Realtime. Security advisors reported no warnings or errors; informational missing-policy notices on the three server-only tables reflect their intended deny-all client behavior.

Verification passed: all 30 rules/database tests, the production backend smoke test (anonymous login, joins, private peeks/draw, RLS, and actual Realtime delivery), and all four mobile-browser tests against the live GitHub Pages URL in Chromium and WebKit. The browser checks include a complete round, private draws, refresh/reconnect, final-turn scoring, table reveals, and starting the next round. Physical phones were not used. The first Realtime smoke attempt during cold service initialization timed out; the subsequent check passed once replication initialized. The frontend also polls to recover missed updates.

Live tests leave anonymous test users and rooms that expire normally. Physical iPhones on separate networks still require the acceptance checklist in TESTING.md. Future frontend pushes to `main` publish through GitHub Actions; backend changes must be deployed separately using DEPLOYMENT.md.
