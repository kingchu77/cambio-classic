# Codex handoff: Cambio Classic — online two-player iPhone game

## Goal
Convert the supplied `index.html` **local demo** into a working, mobile-first, real-time two-human-player web game for two iPhones, hosted as static frontend on **GitHub Pages** with a secure multiplayer backend (Supabase is a suggested choice). Build and test it, with reproducible instructions to deploy. Preserve the classic casino green felt, wood/gold aesthetic and current UI interactions where compatible with multiplayer. The current source is a prototype, not verified as production-correct. Refactor as needed.

## Gameplay rules confirmed by user
- Two players, initially four face-down cards each. Each privately sees exactly two own cards at the start of a round.
- Goal: lowest value. Ace = 1; numbered cards have face value and **no abilities**; Jack = peek at one of own cards; red Queen = peek at an opponent card; red King = zero points; black King = swap any two cards without looking; Joker = -2 points. Existing prototype assumes black Queen = 10 and other court cards = 10; flag any unspecified point values rather than silently changing.
- On turn either call Cambio as entire turn (no draw), or draw a card and decide to discard it or swap it with a face-down own card; replaced card is discarded face up.
- Also allow taking top face-up discard card on turn, to **swap into a card in own hand** (do not simply re-discard the same collected card).
- When a special *action* card is deliberately played/discarded, trigger its ability automatically and **require completion** before next player's draw/turn. A special card removed via snapping does NOT trigger its own ability. Red Kings/Jokers have point effects but no action.
- Speed snap: upon a newly played/discarded face-up card, players may try to snap one matching-rank face-down card, either their own or their opponent's. Only one winning snap attempt per discard event; incorrect attempt causes the attempting player to draw an additional face-down penalty card; newly received penalty cards should pulse/glow visibly with a `+ PENALTY` badge briefly.
- Correct snap of one's own card removes that card. Correct snap of the *opponent's* card removes it and transfers one card from snapper's own hand to the opponent **without allowing a peek**. Preserve the memory component. Ensure match validation doesn't reveal hidden card identity to the snapper.
- During opponent's turn, tapping a card should attempt a snap directly. During own turn, **before drawing**, tapping an own card should attempt snap directly. After drawing, player can select a face-down card and press a dedicated snap control to snap against the relevant newly revealed card; ensure drawn-card and discard-pile snapping rules are coherently implemented (clarify any ambiguous edge case in README).
- Calling Cambio at start of turn ends that turn, other player gets exactly one final turn, then reveal cards. If caller's card sum is greater than opponent's, caller gets +10 points; if equal, round is a draw and no penalty. Lowest round total wins the round. Both players' card totals accumulate over rounds. First player to reach configurable target score (default 50) loses, unless both meet/exceed target in same round, in which case lower total wins; exact equality is a match draw.
- End of round should **not use a result modal**: flip/reveal all cards per player sequentially on the table, showing scores beside each player's cards, then next-round button. Drawn card should display **below player's cards and above action buttons**. Deck should look like a real face-down playing card.

## Multiplayer, reliability and deployment
1. Allow create and join private rooms using a room code and/or shareable URL. Only two players per room; handle reconnects and refreshes. Avoid real names or accounts if possible; use securely scoped anonymous identity/session tokens.
2. Server-authoritative deck shuffle, hands, discard stack, draw/swap, ability resolution, snap arbitration, and scoring. Do NOT expose opponent's hidden ranks/suits in frontend network payloads. Do not place secret backend keys in the GitHub Pages code. Use permissions / RLS / server-side functions, not client-only trust.
3. Handle snaps with server timestamp/order arbitration and clear contention response, latency considerations, idempotency and race prevention. Ensure no turn skip or double-spend due to simultaneous actions.
4. Provide working local dev setup, environment variable template (public vs secret clearly separated), schema/migrations/functions if using Supabase, deployment instructions for GitHub Pages and backend, and a test plan.
5. Check and fix bugs in existing demo; particularly action phase, snapped special timing, draws from discard pile, AI-only assumptions, and end-round scores. Add automated tests for game engine and key multiplayer flows where feasible. Accessibility: tappable mobile cards, announcements, reduced motion support.
6. Keep GitHub Pages as static frontend; backend runs separately. Deliver an actual playable project, not a UI-only mockup. Report what is working, what needs user-supplied credentials/setup, and any unverified behavior.

## Suggested acceptance tests
- Two different browsers/phones join same room; private initial peeks remain confidential.
- Real-time turn actions sync to both; reconnect recovers same state.
- Abilities auto-activate and must finish before next draw.
- Both pre-draw own-turn taps and out-of-turn taps snap correctly; penalty animation and +1 card on failure.
- Two near-simultaneous snaps yield a single server-side winner.
- Caller gets one final opponent turn; +10 only when truly beaten; draws handle ties; match threshold behaves as specified.
- Card-by-card end-of-round flips and adjacent score display; next round works.

## Ask user only for true blockers
Where existing rules remain ambiguous, implement a reasonable documented default and make it configurable if practical. Ask for GitHub/Supabase project credentials only when necessary for deployment; never request password or secret in chat. Preserve users' time by implementing as much as possible before asking follow-ups.
