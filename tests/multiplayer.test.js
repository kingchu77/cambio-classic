import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handle,
  MemoryRepository,
} from "../supabase/functions/_shared/service.js";
const id = () => crypto.randomUUID();
const ids = [id(), id(), id()];
async function setup() {
  const repo = new MemoryRepository();
  let now = 1000;
  const call = (p, body) =>
    handle(repo, ids[p], { requestId: id(), ...body }, () => now);
  let a = await call(0, { op: "create", target: 50 }),
    code = a.code;
  let b = await call(1, { op: "join", code });
  for (let p = 0; p < 2; p++) {
    let v = await call(p, { op: "action", code, action: { type: "sync" } });
    for (const c of v.hands[p].slice(0, 2))
      v = await call(p, {
        op: "action",
        code,
        version: v.version,
        action: { type: "initial-peek", card: c.id },
      });
    await call(p, {
      op: "action",
      code,
      version: v.version,
      action: { type: "ready" },
    });
  }
  const sync = (p) => call(p, { op: "action", code, action: { type: "sync" } });
  const action = async (p, action) => {
    const v = await sync(p);
    return call(p, { op: "action", code, version: v.version, action });
  };
  return { repo, code, call, sync, action, time: (n) => (now = n) };
}
test("create/join private room, 3rd player rejected, reconnect preserves same hidden seat", async () => {
  const { call, code, sync } = await setup();
  await assert.rejects(
    call(2, { op: "join", code }),
    (e) => e.code === "ROOM_FULL",
  );
  const old = await sync(1),
    reconnect = await call(1, { op: "join", code });
  assert.equal(reconnect.me, 1);
  assert.deepEqual(reconnect.hands, old.hands);
  assert.ok(reconnect.hands.flat().every((c) => !c.card));
  await assert.rejects(
    call(2, { op: "action", code, action: { type: "sync" } }),
    (e) => e.code === "NOT_MEMBER",
  );
});
test("create response retry reuses room and does not create another deck", async () => {
  const repo = new MemoryRepository(),
    requestId = id();
  const a = await handle(repo, ids[0], { op: "create", target: 25, requestId });
  const b = await handle(repo, ids[0], { op: "create", target: 25, requestId });
  assert.equal(a.code, b.code);
  assert.equal(repo.rooms.size, 1);
});
test("simultaneous draws spend exactly one card; idempotent replay shows current projection", async () => {
  const { sync, call, code, repo } = await setup();
  const v = await sync(0),
    requestId = id();
  const body = {
    op: "action",
    code,
    version: v.version,
    action: { type: "draw", source: "deck" },
    requestId,
  };
  const [a, b] = await Promise.all([call(0, body), call(0, body)]);
  assert.deepEqual(a.drawn, b.drawn);
  assert.equal((await repo.load(code)).state.deck.length, 44);
  const row = await repo.load(code);
  row.state.drawn.card = { r: 3, s: "♠" };
  repo.rooms.set(code, row);
  await call(0, {
    op: "action",
    code,
    version: a.version,
    action: { type: "discard" },
  });
  const replay = await call(0, body);
  assert.equal(replay.drawn, null);
  assert.ok(replay.hands.flat().every((c) => !c.card));
});
test("simultaneous different draw requests reject stale second action without turn skipping", async () => {
  const { sync, call, code, repo } = await setup();
  const v = await sync(0);
  const body = {
    op: "action",
    code,
    version: v.version,
    action: { type: "draw", source: "deck" },
  };
  const results = await Promise.allSettled([call(0, body), call(0, body)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    results.find((r) => r.status === "rejected").reason.code,
    "STALE",
  );
  assert.equal((await repo.load(code)).state.deck.length, 44);
});
test("near-simultaneous correct snaps have one atomic server winner", async () => {
  const { repo, code, action, call, sync, time } = await setup();
  let row = await repo.load(code);
  row.state.hands.forEach((h) => (h[0].card = { r: 4, s: "♠" }));
  row.state.deck.push({ r: 4, s: "♥" });
  repo.rooms.set(code, row);
  await action(0, { type: "draw", source: "deck" });
  const played = await action(0, { type: "discard" });
  time(1100);
  const attempts = [0, 1].map(async (p) => {
    const v = await sync(p);
    return call(p, {
      op: "action",
      code,
      version: played.version,
      action: {
        type: "snap",
        owner: p,
        card: v.hands[p][0].id,
        event: played.snap.id,
      },
    });
  });
  const results = await Promise.allSettled(attempts);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    results.find((r) => r.status === "rejected").reason.code,
    "SNAP_CLOSED",
  );
  row = await repo.load(code);
  assert.equal(row.state.hands.flat().length, 7);
  assert.ok(row.state.snap.winner);
});
test("losing snap does not cause a penalty; failed rank never enters either network view", async () => {
  const { repo, code, action, call, sync } = await setup();
  let row = await repo.load(code);
  row.state.hands[1][0].card = { r: 8, s: "♦" };
  row.state.deck.push({ r: 2, s: "♠" });
  repo.rooms.set(code, row);
  await action(0, { type: "draw", source: "deck" });
  const v = await action(0, { type: "discard" });
  const out = await call(1, {
    op: "action",
    code,
    action: {
      type: "snap",
      owner: 1,
      card: v.hands[1][0].id,
      event: v.snap.id,
    },
  });
  assert.equal(out.hands[1].length, 5);
  assert.ok(out.hands.flat().every((c) => !c.card));
  assert.ok((await sync(0)).hands.flat().every((c) => !c.card));
});
test("concurrent initial peeks/ready do not require an unnecessary retry", async () => {
  const repo = new MemoryRepository();
  const base = (p, b) => handle(repo, ids[p], { ...b, requestId: id() });
  const a = await base(0, { op: "create", target: 50 });
  const b = await base(1, { op: "join", code: a.code });
  await Promise.all(
    [0, 1].map(async (p) => {
      for (const slot of b.hands[p].slice(0, 2))
        await base(p, {
          op: "action",
          code: a.code,
          version: b.version,
          action: { type: "initial-peek", card: slot.id },
        });
      return base(p, {
        op: "action",
        code: a.code,
        version: b.version,
        action: { type: "ready" },
      });
    }),
  );
  assert.equal((await repo.load(a.code)).state.phase, "turn");
});
