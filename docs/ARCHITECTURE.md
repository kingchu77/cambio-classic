# Architecture and privacy

## Data flow

```text
iPhone Safari (static GitHub Pages)
  ├─ Supabase anonymous Auth → persisted user JWT
  ├─ POST /functions/v1/game → auth.getUser(JWT) → per-UID rate limit
  │    → private room load → pure rules engine → atomic PostgreSQL commit
  │    → only this user's projection in response
  ├─ Authenticated Realtime → only own cambio_views rows (RLS)
  └─ 1.5-second visible-page sync → repair/reconnect and final-window advancement
```

The frontend never shuffles, validates hidden ranks, decides a snap winner, or calculates authoritative scores. It sends actions referencing opaque card **slots**, plus a unique request ID. Client timestamps and client-supplied identities are ignored.

## Tables and roles

`cambio_rooms` contains the complete deck, hands, discard history, actions, scores, and version. Neither `anon` nor `authenticated` has table privileges or RLS policies on it. It is not published to Realtime. `cambio_receipts` records committed request IDs; `cambio_limits` implements per-UID fixed-window rate limits. These are also inaccessible to clients.

`cambio_views` has one row per `(room_code, user_id)`, updated in the same transaction as room state. Authenticated users have **SELECT only**, restricted by `auth.uid() = user_id` and expiry. Anonymous Supabase sign-ins still have the authenticated role and a unique verified UID. Service-only RPC functions have their default PUBLIC execution privilege revoked.

Visible card data includes only initial chosen own cards until ready, the actor's private draw, a mandatory ability peek for its actor, public discard/snap rank, and full hands at round end. Counts, positions, penalty animation deadlines, action type, and scores are public game information. A failed snap never returns the tested hidden card identity. Slot IDs do not encode suit/rank. Transfers create fresh slot IDs; swaps exchange contents while retaining positions.

Like every memory card game, a player may record cards they legitimately saw. The server cannot erase human memory, screenshots, or a local developer-tools history. It prevents access to cards a player has not legitimately been allowed to see.

## Atomicity, ordering, retries

Every changing action computes a proposed state and both projections from one room version. `cambio_commit` locks the room row, checks the request receipt and expected version, then writes state, increments the version, inserts the receipt, and updates both projections in **one PostgreSQL transaction**.

Concurrent different actions cannot overwrite one another: a stale compare-and-swap fails. Snaps retry the pure validation against the latest version using the same event ID. The first valid committed snap becomes the winner. Later contenders receive `SNAP_CLOSED`; they get no penalty. A failed rank attempt commits its penalty and per-player attempted marker atomically. Server processing time is recorded for information; **database commit order**, not a timestamp tie-break or client arrival claim, is authoritative.

Ordinary turn actions require the snapshot version the player saw. A stale action refreshes and requires another tap. Initial peeks, ready votes, next-round votes, and sync can safely revalidate against current state because their effects commute across players. Snap requests identify the public discard event and do not fail just because an unrelated private peek changed a version.

Retried network requests retain the same request ID. A duplicate never replays an old response containing a peek: it returns a projection of current state. Create requests are unique by creator/request ID, preventing duplicate rooms after a lost response. The browser serializes its own changing actions and ignores out-of-order snapshots. Multiple tabs sharing an anonymous seat still cannot double-draw because the database arbitrates them.

## Timing and recovery

Snap windows last six seconds from a deliberate play. The next player is identified immediately but cannot draw/call until the deadline or a winner. Mandatory abilities may overlap this window and must complete. Opponent snaps pause all choices for the face-down transfer; the turn/action resumes afterward. If the snap removes the last legal ability target, the impossible action completes instead of deadlocking.

The final turn waits for the final snap event before scoring. An absolute server timestamp starts the on-table reveal sequence. Both phones use that same schedule and adjust to server time on responses; a late reconnect skips already elapsed delays. Reduced-motion users see the revealed cards immediately, while next-round voting still waits for the shared reveal deadline.

No timer process owns a room. A `sync` request advances a pending final-window deadline. Realtime delivers commits immediately, and polling repairs missed notifications. Background iPhone Safari tabs may suspend WebSockets/requests; returning to the foreground syncs authoritative state. A lost phone never silently forfeits or gets an AI replacement.

## Operational boundaries

Room codes have 50 bits of cryptographic randomness and no room directory exists. Only the two seats can access a room once joined. Codes are bearer invitations to a vacant seat; share them privately. A third UID cannot join a full room. Per-UID limits reduce accidental floods; Supabase's project-wide Auth abuse/rate-limit controls remain relevant if this becomes a public service.

Rooms have seven-day inactivity expiry. Access tokens are stored by Supabase Auth in Safari's origin storage and refreshed by the SDK. No email recovery or cross-device seat recovery is provided. Browser storage deletion means a new anonymous UID and requires a new table. Backend secrets stay in Supabase's environment and GitHub deployment secrets only.

`scripts/local-server.js` uses the same rules/service but in-memory storage, loopback-only HTTP, a local random browser token, and per-player SSE. It is a development harness, not an alternative production authentication system. The production build does not include the server rules, local repository, or that transport unless `VITE_LOCAL_API` was explicitly set; the Pages pipeline rejects local transport configuration.
