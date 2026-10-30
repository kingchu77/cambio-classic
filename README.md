# Cambio Classic

A real two-human-player card game: a green felt table, private invitations, anonymous seats, real-time state, private peeks, snap races, special cards, cumulative scores, and sequential on-table round reveals. Static frontend on **GitHub Pages**, authoritative backend on **Supabase**.

**Live game:** [Play Cambio Classic](https://kingchu77.github.io/cambio-classic/). The frontend is published on GitHub Pages and the authoritative backend is deployed to Supabase. Create a private table and share its invitation with your partner.

## Try it now, without accounts

Requires Node.js 22+ and npm.

```sh
npm ci
npm run dev:local
```

Open **http://127.0.0.1:5173/**, create a private table, then open its invitation in another browser or a private browsing window. Use separate browser identities; two ordinary tabs share the same seat. Both people play the complete rules engine. State disappears when this local server restarts. This server listens only on your computer: a localhost invitation will not work on another phone.

## Get a URL you can send to your girlfriend

1. Create a Supabase project and enable **anonymous sign-ins** in Authentication → Sign In / Providers. No emails or passwords are needed for players.
2. Deploy the included database migration and `game` Edge Function. See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for dashboard, CLI, and GitHub workflow instructions.
3. Put this project at the **root** of a GitHub repository whose default deployment branch is `main`.
4. Set the repository's two **Actions variables** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. These are public frontend values. Never use a service-role key here.
5. In Settings → Pages choose **GitHub Actions**, then push to `main` or run the **GitHub Pages** workflow.
6. Open the Pages URL shown by the workflow, create a private table, tap **Share invitation**, and send that link. She opens it in Safari; you each peek at two cards and press **Hide cards & ready**.

Keep using the same Safari browser profile to recover your seat after a refresh. Losing website storage or switching browser profiles loses the anonymous identity; create a new room in that case. **Leave** returns to the lobby without erasing your identity; you can rejoin the old invitation later.

## Rules and decisions

The supplied `CODEX_TASK.md` is retained in `reference/`. The ZIP contained only `index.html`; a separate source README was not present in the supplied archive. The original HTML is preserved as text for reference.

- Four face-down cards each; choose exactly two private initial peeks. Both must hide/ready before play. The starting player alternates by round.
- A = 1; numbers = face value; **J, Q, and black K = 10**; red K = 0; Joker = −2. Court-card values not completely specified in the handoff retain the prototype's 10-point defaults. These are the only point-value assumptions. Numbered cards have no abilities.
- On your turn draw from the deck and discard or exchange with one own card. Taking the face-up discard **requires** exchanging it with an own card. The replaced card is played face up and activates its action, if any.
- Both players see swap animations: a card travels from its source pile into the chosen slot while the replaced card moves to the discard. Black King swaps move two face-down cards between their slots. A brief label and glow identify the affected positions. Hidden faces stay private; reduced-motion mode keeps the labels and highlights.
- J: peek at an own card. Red Q: peek at an opponent card. Black K: swap any two distinct cards, including two in one hand, without looking. Complete mandatory actions before the next turn. Peeks stay visible only until acknowledged. If no legal ability targets remain, the action completes automatically.
- Each deliberate discard creates a **six-second public snap event**. Both players get one attempt, including the next player's direct card taps before drawing. The next player gets the turn immediately, but draws and Cambio calls wait for the window to expire or a correct snap to win. Initial setup discard is not snappable.
- Snap any matching **rank**, regardless of suit/colour. First correct **database commit** wins. A failed attempt adds one unseen penalty card; it does not consume the other player's opportunity. A contention loser receives a closed-window message and no penalty. Snapped cards are buried below the visible discard and never activate abilities or create recursive snap events.
- Snapping your own card removes it. Snapping an opponent card removes it, then requires you to choose one own card to pass face down. This freezes other actions until completion. The transferred slot gets a new opaque identifier, so its old identifier cannot disclose its identity. No legal own card means an opponent snap is unavailable.
- **Drawn-card snap ambiguity:** a deck draw stays private until played. After drawing, select any face-down card and press **Snap drawn match**. This atomically plays the drawn card and attempts that match. The deliberately played card's action still applies; the removed card's action does not. An unsuccessful attempt still plays the draw and gives a penalty. Other players cannot snap against an unrevealed private draw. Discard pickups cannot use this shortcut.
- After a snap, any pending action still must complete. An empty hand ends the round once outstanding actions, transfers, and the final snap window are resolved.
- Calling Cambio is an entire start-of-turn action, with no draw. The other player gets exactly one final turn, including mandatory abilities and snapping. Caller adds 10 only when their raw card sum is strictly higher; equal raw sums have no penalty. Lowest round total wins.
- Accumulate round totals, including negatives. Default target = 50; choose 25/50/100/200/500 in the lobby (server supports any integer 10–500). When either total reaches target the match ends: lower total wins, including when both crossed target; equal totals draw.
- Round-end cards reveal on the table in seat order using server timestamps. Scores sit beside each hand; there is no result modal. Both players must request the next round/new match. Refreshes resume the reveal timeline.
- Exhausted stock is reshuffled from buried discards, retaining the face-up top. In the extreme case no recyclable stock remains, deck draws/penalties are rejected; a discard swap or Cambio remains available. No card is fabricated.

## Development and verification

```sh
npm test                         # engine + concurrency + actual PostgreSQL/RLS tests
npx playwright install chromium webkit
npm run test:e2e                  # two isolated mobile browsers, Chromium and WebKit
npm run build                    # GitHub Pages assets in dist/
npm audit
```

For the real backend in local frontend development, copy `.env.example` to `.env.local`, fill in the two public values, leave `VITE_LOCAL_API` unset, then run `npm run dev`. A local Supabase stack is also supported; see deployment instructions. The browser suite deliberately uses the disposable local transport, while PostgreSQL tests run the exact production migration in PGlite.

See [TESTING.md](docs/TESTING.md) for coverage and the two-real-iPhones acceptance checklist, and [ARCHITECTURE.md](docs/ARCHITECTURE.md) for privacy and concurrency design.

## Project map

| Location                                | Purpose                                                         |
| --------------------------------------- | --------------------------------------------------------------- |
| `src/`                                  | Responsive static frontend and Supabase Auth/Realtime transport |
| `supabase/functions/_shared/engine.js`  | Server-only pure game rules and per-player projections          |
| `supabase/functions/_shared/service.js` | Request validation, retries, idempotency, version arbitration   |
| `supabase/functions/game/index.ts`      | Verified anonymous auth, rate limits, repository adapter        |
| `supabase/migrations/`                  | Tables, RLS, private snapshots, atomic commit functions         |
| `scripts/local-server.js`               | Loopback-only in-memory test backend with live SSE updates      |
| `tests/`                                | Engine, concurrent multiplayer, SQL/RLS, mobile browser tests   |
| `.github/workflows/`                    | CI, Pages deployment, manual backend deployment                 |

## Remaining deployment checks

GitHub Pages, live Supabase anonymous Auth, the game function, private projections/RLS, and hosted Realtime delivery were verified on 2026-10-30. See [LIVE-DEPLOYMENT.md](docs/LIVE-DEPLOYMENT.md) for the deployment record. Physical iPhone Safari on separate networks remains a manual acceptance check. There is no AI player or offline single-player mode. Rooms expire after seven days without a state-changing action; sessions use persistent browser storage. Supabase plan limits/pausing and authentication abuse controls should be checked before sharing widely.
