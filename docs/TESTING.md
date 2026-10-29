# Verification and acceptance

## Automated suites

Run from the project root:

```sh
npm ci
npm test
npx playwright install chromium webkit
npm run test:e2e
npm run build
npm audit
```

The browser command starts the disposable loopback backend automatically. If one is already running locally it reuses it. CI starts a fresh instance. Browser tests use separate contexts so the two seats have different anonymous local identities.

| Suite                    | What it verifies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Engine                   | 54-card deck/conservation; exact point values; no number abilities; private initial peeks; readiness; draw secrecy; turn validation; mandatory discard swap; automatic J/red Q/black K actions; required acknowledgement; blind swaps; own/opponent snaps; hidden penalties; explicit face-down transfer; no snapped-card action; drawn-card snap; empty-target deadlock prevention; six-second window; pre-draw snapping; Cambio final turn/strict penalty/ties; target equality; both-ready next round; deck recycling |
| Random match simulation  | Twenty complete matches make progress and conserve all 54 unique cards through draws, swaps, abilities, scoring; no hidden ranks in unauthorized projections                                                                                                                                                                                                                                                                                                                                                             |
| Multiplayer service      | Private create/join; room-full rejection; reconnect identity; create retry; duplicate draw idempotency; different concurrent draws; one winner from simultaneous correct snaps; no extra contention penalty; concurrent initial peeks/ready                                                                                                                                                                                                                                                                              |
| PostgreSQL/PGlite        | Runs the exact migration in PostgreSQL WASM, including publication statement; denied secret table reads; denied snapshot writes; denied RPC calls from authenticated role; distinct per-user RLS projections; stranger isolation; expiry; actual commit/duplicate/conflict and two-view updates; rate limiter                                                                                                                                                                                                            |
| Chromium + WebKit mobile | Two isolated iPhone-sized contexts create/join by invitation; exactly two own peeks and no opponent peeks; real-time turns; private draw; refresh resumes draw; special-card choice UI when drawn; Cambio final turn; card-by-card table reveal with scores and no modal; both-ready next round; selected target preserved; responsive width; rules dialog; reduced motion; invitation copy fallback                                                                                                                     |

Production Edge Function TypeScript can also be checked with `deno check supabase/functions/game/index.ts`. This checks actual Deno npm imports without deploying.

## Two physical iPhones: run after deployment

The automated WebKit build uses the WebKit engine with iPhone emulation. It does **not** replace testing Apple Safari on actual iOS devices. Live Supabase identity, hosted Realtime delivery, provider limits, and real network latency require your deployed project.

1. Open the GitHub Pages URL in Safari on A. Create a room with target 50. Share its invitation to B on a different network. Confirm each sees the other player arrive; a third browser is refused.
2. Peek at two cards on A. On B inspect A's hand: four backs. If inspecting network traffic, confirm the response and `cambio_views` projection contain no hidden ranks for A. Repeat in reverse. Ready both.
3. Draw on A: B sees a back for the private draw, and A sees its face below A's hand. Swap with an own card. Both see the replaced card on the discard. Next turn cannot draw during the snap window.
4. Take the discard on turn. Confirm **Discard drawn** and **Snap drawn match** are disabled. Swap selected completes the turn and plays the replaced card.
5. Play J, red Q, and black K as they arise. Confirm mandatory targets/acknowledgement and that the other player cannot draw early. Check the private peek appears only to the actor. Black K must exchange two chosen cards without revealing either.
6. On a known wrong rank, snap a face-down card. Confirm only the attempting hand grows by one; both see the brief glow and **+ PENALTY** badge, and neither receives its rank. Try again on that event: refused. The other player's attempt is still available.
7. Correctly snap an own card before drawing on your turn, and out of turn. Confirm a single removal. For an opponent snap, choose an own card to pass face down; no turn or ability can proceed before that transfer finishes. No rank is revealed during transfer.
8. Try nearly simultaneous correct snaps on the same event from both phones. Confirm one winner, no duplicated card removal, and a clear closed-window response for the loser. Repeat while the network is slow; server order is authoritative, not the phone clock.
9. Draw from deck, select a known matching face-down card, and use **Snap drawn match**. Both see the drawn card become public. If it is a J/red Q/black K, its action must still finish; the snapped card has no action. An incorrect match produces a penalty while still playing the draw.
10. Call Cambio at the start of a turn. Confirm no draw for the caller, exactly one opponent turn, all pending actions/snaps complete, sequential reveals on the table, adjacent scores, +10 only for a strictly beaten caller, and no result dialog. Ties have no penalty. Both request next round; starting player alternates. At target, compare match totals including same-round threshold crossings.
11. Refresh each phone during draw, ability peek, transfer, and round reveal. Reopen the same invitation in the same browser. Confirm the same seat/state and no duplicate move. Background Safari, briefly disable network, then return/reconnect; both should converge. The same browser's second tab should recover the same seat, not become player two.
12. Check small-screen portrait and landscape, Safari browser chrome/safe areas, VoiceOver card/button labels, 44px+ actions, and iOS Reduce Motion. Long penalty hands should wrap without horizontal page overflow.

## Test limitations and policy

The local transport exercises the same rules and request arbitration but does not invoke the hosted Supabase Auth/HTTP/Realtime adapter. SQL/RLS tests execute PostgreSQL locally; a deployed two-phone run is still required. No production credentials or actual iPhones were available during implementation. No claim of deployed availability should be inferred from a local passing build.

Test fixtures intentionally control server-side hidden state to exercise rare cases. There is no debug endpoint, seed override, or test hand inspection API in the production Edge Function. No automated suite sends an invitation to another person.
