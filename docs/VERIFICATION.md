# Verification record

Verified locally on **28 October 2026** (America/Whitehorse).

| Check | Result |
| --- | --- |
| `npm test` | **30 passed**, including PostgreSQL migration/RLS and concurrency tests |
| `npm run test:e2e` | **4 passed**: full two-player game and lobby/accessibility checks in Chromium mobile and WebKit iPhone emulation |
| `npm run build` | **Passed**; static frontend generated in `dist/` |
| `deno check supabase/functions/game/index.ts` | **Passed** with Deno 2.9.6 |
| `npm audit` | **0 vulnerabilities** |
| Screenshots | Reviewed lobby and completed round; both hands revealed, adjacent scores, next-round control, no result modal |

The final browser run used a freshly started local backend with the shipped engine and completed all four checks in approximately 1 minute 55 seconds. The engine suite also simulates twenty complete random matches with card conservation and projection privacy assertions.

During validation, fixes included enforcing mandatory actions, preserving actions across snap transfers, safe concurrent initial peeks, snap timing before drawing, preventing empty-target ability deadlocks, avoiding stale updates after leaving a table, clearing timed penalty/reveal indicators, hiding empty notifications, and reducing the cost of the felt texture in WebKit.

Screenshots in [screenshots/](screenshots/) show the local test transport, which is visibly labelled. They are not evidence of a production deployment.

**Still requires account access:** creation/configuration of the GitHub repository and Supabase project, enabling anonymous sign-ins, hosted migration/function deployment, GitHub Pages publication, and a live two-iPhone smoke test. The GitHub and Supabase integrations have been requested for this handoff; no connection or production deployment is assumed until verified.

After deployment, `node scripts/smoke-supabase.js` uses the two public environment values to exercise live anonymous Auth, private peeks/draw, secret-table denial, RLS isolation, and Realtime delivery. It creates two anonymous test users and one expiring test room; it does not delete account data. This script has been syntax checked but cannot be run without a configured project. Follow the physical-device checklist in [TESTING.md](TESTING.md).
