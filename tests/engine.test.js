import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apply,
  createRoom,
  view,
  value,
  ability,
  deck,
} from "../supabase/functions/_shared/engine.js";
const U = ["alice", "bob"];
const C = (r, s = "♠") => ({ r, s });
const S = (r, s = "♠") => ({
  id: crypto.randomUUID(),
  card: C(r, s),
  penaltyUntil: 0,
});
function fixture() {
  let g = apply(createRoom(U[0]), U[1], { type: "join" }, 1000);
  for (let p = 0; p < 2; p++) {
    for (const c of g.hands[p].slice(0, 2))
      g = apply(g, U[p], { type: "initial-peek", card: c.id }, 1000);
    g = apply(g, U[p], { type: "ready" }, 1000);
  }
  return g;
}
function drawPlay(g, c, now = 2000) {
  g.deck.push(c);
  g = apply(g, U[g.turn], { type: "draw", source: "deck" }, now);
  return apply(g, U[g.turn], { type: "discard" }, now);
}
const fails = (fn, code) => assert.throws(fn, (e) => e.code === code);

test("draw and discard swaps publish the same public movement to both seats without hidden faces", () => {
  for (const source of ["deck", "discard"]) {
    let g = fixture();
    g.hands[0][1].card = C(7);
    g[source === "deck" ? "deck" : "discard"].push(C(13, "♥"));
    const target = g.hands[0][1].id;
    g = apply(g, U[0], { type: "draw", source }, 2000);
    g = apply(g, U[0], { type: "swap", card: target }, 2100);
    const a = view(g, U[0], 10, "ABCDEFGHJK", 2100);
    const b = view(g, U[1], 10, "ABCDEFGHJK", 2100);
    assert.deepEqual(a.motion, b.motion);
    assert.deepEqual(a.motion, {
      id: g.motion.id, at: 2100, kind: "draw-swap", player: 0, source,
      targets: [{ owner: 0, card: target, index: 1 }],
    });
    assert.ok(a.motion.id);
    assert.ok(a.hands.flat().every((slot) => !slot.card));
    assert.ok(b.hands.flat().every((slot) => !slot.card));
    assert.deepEqual(b.discard, C(7));
    assert.deepEqual(apply(g, U[1], { type: "sync" }, 2200).motion, g.motion);
  }
});

test("Black King movement identifies both face-down slots and survives later announcements", () => {
  let g = fixture();
  g = drawPlay(g, C(13), 2000);
  const a = { owner: 0, card: g.hands[0][1].id };
  const b = { owner: 1, card: g.hands[1][2].id };
  g = apply(g, U[0], { type: "ability-swap", a, b }, 2100);
  const motion = structuredClone(g.motion);
  assert.deepEqual(motion, {
    id: motion.id, at: 2100, kind: "blind-swap", player: 0,
    targets: [{ ...a, index: 1 }, { ...b, index: 2 }],
  });
  for (const uid of U) {
    const projection = view(g, uid, 10, "ABCDEFGHJK", 2100);
    assert.deepEqual(projection.motion, motion);
    assert.ok(projection.hands.flat().every((slot) => !slot.card));
  }
  g = apply(g, U[1], { type: "draw", source: "deck" }, 9000);
  assert.deepEqual(g.motion, motion, "polling must still recover the last swap after another announcement");
});

test("54-card deck, two jokers; scoring and abilities exactly follow confirmed rules", () => {
  const d = deck();
  assert.equal(d.length, 54);
  assert.equal(d.filter((c) => c.r === 0).length, 2);
  assert.equal(new Set(d.map((c) => `${c.r}:${c.s}`)).size, 54);
  assert.deepEqual(
    [
      value(C(1)),
      value(C(10)),
      value(C(11)),
      value(C(12)),
      value(C(13)),
      value(C(13, "♥")),
      value(C(0)),
    ],
    [1, 10, 10, 10, 10, 0, -2],
  );
  for (let r = 1; r <= 10; r++) assert.equal(ability(C(r, "♥")), null);
  assert.equal(ability(C(11)), "peek-own");
  assert.equal(ability(C(12, "♦")), "peek-other");
  assert.equal(ability(C(12)), null);
  assert.equal(ability(C(13)), "blind-swap");
  assert.equal(ability(C(13, "♥")), null);
});
test("four cards each, exactly two private initial peeks, hides at ready", () => {
  let g = apply(createRoom(U[0]), U[1], { type: "join" }, 1000);
  assert.deepEqual(
    g.hands.map((h) => h.length),
    [4, 4],
  );
  for (const c of g.hands[0].slice(0, 2))
    g = apply(g, U[0], { type: "initial-peek", card: c.id });
  fails(
    () => apply(g, U[0], { type: "initial-peek", card: g.hands[0][2].id }),
    "PEEK_LIMIT",
  );
  assert.equal(
    view(g, U[0], 1, "ABCDEFGHJK").hands[0].filter((c) => c.card).length,
    2,
  );
  assert.equal(
    view(g, U[1], 1, "ABCDEFGHJK")
      .hands.flat()
      .filter((c) => c.card).length,
    0,
  );
  g = apply(g, U[0], { type: "ready" });
  assert.equal(
    view(g, U[0], 1, "ABCDEFGHJK")
      .hands.flat()
      .filter((c) => c.card).length,
    0,
  );
  fails(() => apply(g, U[1], { type: "ready" }), "PEEK_FIRST");
});
test("draw remains private, wrong turn and double-draw rejected; no mutation on failure", () => {
  let g = fixture();
  fails(() => apply(g, U[1], { type: "draw", source: "deck" }), "TURN");
  g = apply(g, U[0], { type: "draw", source: "deck" });
  const before = JSON.stringify(g);
  assert.ok(view(g, U[0], 1, "ABCDEFGHJK").drawn.card);
  assert.ok(!view(g, U[1], 1, "ABCDEFGHJK").drawn.card);
  assert.ok(!("deck" in view(g, U[0], 1, "ABCDEFGHJK")));
  fails(() => apply(g, U[0], { type: "draw", source: "deck" }), "PHASE");
  assert.equal(JSON.stringify(g), before);
});
test("discard pickup must swap into own hand and replaced special activates", () => {
  let g = fixture();
  g.discard = [C(3)];
  g.hands[0][0].card = C(11);
  const id = g.hands[0][0].id;
  g = apply(g, U[0], { type: "draw", source: "discard" }, 2000);
  fails(() => apply(g, U[0], { type: "discard" }, 2000), "MUST_SWAP");
  fails(
    () => apply(g, U[0], { type: "snap-drawn", owner: 0, card: id }, 2000),
    "MUST_SWAP",
  );
  g = apply(g, U[0], { type: "swap", card: id }, 2000);
  assert.equal(g.hands[0][0].card.r, 3);
  assert.equal(g.action.type, "peek-own");
  assert.equal(g.discard.at(-1).r, 11);
});
for (const [card, type, owner] of [
  [C(11), "peek-own", 0],
  [C(12, "♥"), "peek-other", 1],
])
  test(`${type} auto-activates, remains private, must be completed`, () => {
    let g = drawPlay(fixture(), card);
    assert.equal(g.phase, "ability");
    assert.equal(g.action.type, type);
    fails(() => apply(g, U[1], { type: "draw", source: "deck" }, 9000), "TURN");
    fails(
      () => apply(g, U[0], { type: "draw", source: "deck" }, 9000),
      "PHASE",
    );
    fails(() => apply(g, U[0], { type: "ability-done" }, 9000), "ABILITY");
    g = apply(
      g,
      U[0],
      { type: "ability-peek", card: g.hands[owner][0].id },
      9000,
    );
    assert.equal(
      view(g, U[0], 1, "ABCDEFGHJK").hands[owner].filter((s) => s.card).length,
      1,
    );
    assert.equal(
      view(g, U[1], 1, "ABCDEFGHJK")
        .hands.flat()
        .filter((s) => s.card).length,
      0,
    );
    g = apply(g, U[0], { type: "ability-done" }, 9000);
    assert.equal(g.turn, 1);
    assert.equal(g.action, null);
  });
test("black King swaps any two distinct slots, reveals nothing", () => {
  let g = drawPlay(fixture(), C(13)),
    a = g.hands[0][0],
    b = g.hands[0][1];
  const cards = [a.card, b.card];
  fails(
    () =>
      apply(
        g,
        U[0],
        {
          type: "ability-swap",
          a: { owner: 0, card: a.id },
          b: { owner: 0, card: a.id },
        },
        9000,
      ),
    "CARD",
  );
  g = apply(
    g,
    U[0],
    {
      type: "ability-swap",
      a: { owner: 0, card: a.id },
      b: { owner: 0, card: b.id },
    },
    9000,
  );
  assert.deepEqual(
    g.hands[0].slice(0, 2).map((s) => s.card),
    cards.reverse(),
  );
  assert.equal(
    view(g, U[0], 1, "ABCDEFGHJK")
      .hands.flat()
      .filter((s) => s.card).length,
    0,
  );
  assert.equal(g.turn, 1);
});
test("own snap removes one card, only one winner, special snapped card never activates", () => {
  let g = fixture();
  g.hands[1][0].card = C(12, "♥");
  g = drawPlay(g, C(12));
  g = apply(
    g,
    U[1],
    { type: "snap", owner: 1, card: g.hands[1][0].id, event: g.snap.id },
    2100,
  );
  assert.equal(g.hands[1].length, 3);
  assert.equal(g.action, null);
  assert.equal(g.turn, 1);
  fails(
    () =>
      apply(
        g,
        U[0],
        { type: "snap", owner: 0, card: g.hands[0][0].id, event: g.snap.id },
        2101,
      ),
    "SNAP_CLOSED",
  );
});
test("wrong snap is private penalty with visible badge; each player has one attempt", () => {
  let g = fixture();
  g.hands[1][0].card = C(3);
  g = drawPlay(g, C(4));
  g = apply(
    g,
    U[1],
    { type: "snap", owner: 1, card: g.hands[1][0].id, event: g.snap.id },
    2100,
  );
  assert.equal(g.hands[1].length, 5);
  assert.equal(g.hands[1][4].penaltyUntil, 6300);
  assert.equal(g.snap.winner, null);
  assert.ok(!view(g, U[1], 2, "ABCDEFGHJK").hands[1][4].card);
  fails(
    () =>
      apply(
        g,
        U[1],
        { type: "snap", owner: 1, card: g.hands[1][0].id, event: g.snap.id },
        2200,
      ),
    "SNAP_TRIED",
  );
});
test("opponent snap requires explicit face-down transfer, no peek or card tracking", () => {
  let g = fixture();
  g.hands[0][0].card = C(5);
  g = drawPlay(g, C(5));
  g = apply(
    g,
    U[1],
    { type: "snap", owner: 0, card: g.hands[0][0].id, event: g.snap.id },
    2100,
  );
  assert.equal(g.phase, "transfer");
  fails(
    () => apply(g, U[0], { type: "draw", source: "deck" }, 2100),
    "TRANSFER_FIRST",
  );
  const pass = g.hands[1][0],
    oldId = pass.id;
  g = apply(g, U[1], { type: "transfer", card: oldId }, 2200);
  assert.deepEqual(
    g.hands.map((h) => h.length),
    [4, 3],
  );
  assert.deepEqual(g.hands[0].at(-1).card, pass.card);
  assert.notEqual(g.hands[0].at(-1).id, oldId);
  assert.equal(g.turn, 1);
  for (const uid of U)
    assert.equal(
      view(g, uid, 1, "ABCDEFGHJK")
        .hands.flat()
        .filter((s) => s.card).length,
      0,
    );
});
test("ability survives snap and transfer and still blocks turn", () => {
  let g = fixture();
  g.hands[0][0].card = C(11);
  g = drawPlay(g, C(11));
  g = apply(
    g,
    U[1],
    { type: "snap", owner: 0, card: g.hands[0][0].id, event: g.snap.id },
    2100,
  );
  g = apply(g, U[1], { type: "transfer", card: g.hands[1][0].id }, 2200);
  assert.equal(g.phase, "ability");
  assert.equal(g.turn, 0);
  g = apply(g, U[0], { type: "ability-peek", card: g.hands[0][0].id }, 2300);
  g = apply(g, U[0], { type: "ability-done" }, 2400);
  assert.equal(g.turn, 1);
});
test("drawn snap plays drawn special and removed special does not add an ability", () => {
  let g = fixture();
  g.hands[0][0].card = C(11);
  g.deck.push(C(11, "♦"));
  g = apply(g, U[0], { type: "draw", source: "deck" }, 2000);
  g = apply(
    g,
    U[0],
    { type: "snap-drawn", owner: 0, card: g.hands[0][0].id },
    2100,
  );
  assert.equal(g.hands[0].length, 3);
  assert.equal(g.action.type, "peek-own");
  assert.equal(g.snap.winner.player, 0);
});
test("next player can snap before drawing; six-second window blocks draws and calls", () => {
  let g = fixture();
  g.hands[1][0].card = C(6);
  g = drawPlay(g, C(6));
  assert.equal(g.phase, "turn");
  assert.equal(g.turn, 1);
  fails(
    () => apply(g, U[1], { type: "draw", source: "deck" }, 7999),
    "SNAP_WAIT",
  );
  fails(() => apply(g, U[1], { type: "call" }, 7999), "SNAP_WAIT");
  const ownSnap = apply(
    g,
    U[1],
    { type: "snap", owner: 1, card: g.hands[1][0].id, event: g.snap.id },
    2200,
  );
  assert.equal(ownSnap.hands[1].length, 3);
  assert.equal(ownSnap.turn, 1);
  const event = g.snap.id;
  g = apply(g, U[0], { type: "sync" }, 8000);
  assert.equal(g.turn, 1);
  fails(
    () =>
      apply(
        g,
        U[1],
        { type: "snap", owner: 1, card: g.hands[1][0].id, event },
        8000,
      ),
    "SNAP_CLOSED",
  );
  g = apply(g, U[1], { type: "draw", source: "deck" }, 8100);
  assert.equal(g.snap, null);
});
for (const [a, b, expectedPenalty] of [
  [20, 10, 10],
  [10, 20, 0],
  [10, 10, 0],
])
  test(`Cambio ${a}:${b} has correct final-turn scoring`, () => {
    let g = fixture();
    g.hands = [
      [S(a / 2), S(a / 2)],
      [S(b / 2), S(b / 2)],
    ];
    g = apply(g, U[0], { type: "call" }, 2000);
    assert.equal(g.turn, 1);
    fails(() => apply(g, U[1], { type: "call" }, 2000), "CALL");
    g = drawPlay(g, C(2), 3000);
    assert.equal(g.phase, "settling");
    g = apply(g, U[1], { type: "sync" }, 9000);
    assert.equal(g.phase, "round-end");
    assert.equal(g.result.penalty[0], expectedPenalty);
    assert.deepEqual(g.result.raw, [a, b]);
    assert.deepEqual(g.scores, [a + expectedPenalty, b]);
    assert.ok(
      view(g, U[0], 4, "ABCDEFGHJK")
        .hands.flat()
        .every((s) => s.card),
    );
  });
test("match thresholds, both exceed target, equality is draw, next round needs both players", () => {
  let g = fixture();
  g.scores = [45, 45];
  g.hands = [[S(5)], [S(5)]];
  g = apply(g, U[0], { type: "call" }, 2000);
  g = drawPlay(g, C(3), 3000);
  g = apply(g, U[0], { type: "sync" }, 9000);
  assert.equal(g.result.matchOver, true);
  assert.equal(g.result.matchWinner, null);
  fails(() => apply(g, U[0], { type: "next-round" }, 9000), "REVEALING");
  g = apply(g, U[0], { type: "next-round" }, 12000);
  assert.equal(g.phase, "round-end");
  g = apply(g, U[1], { type: "next-round" }, 12000);
  assert.equal(g.phase, "initial");
  assert.deepEqual(g.scores, [0, 0]);
});
test("recycles buried discards while preserving the face-up top", () => {
  let g = fixture();
  g.deck = [];
  g.discard = [C(2), C(3), C(4)];
  g = apply(g, U[0], { type: "draw", source: "deck" }, 2000);
  assert.deepEqual(g.discard, [C(4)]);
  assert.equal(g.deck.length, 1);
  assert.ok([2, 3].includes(g.drawn.card.r));
});
test("untrusted actions never reveal ranks on a failed snap or unknown card", () => {
  let g = drawPlay(fixture(), C(7));
  const before = JSON.stringify(g);
  fails(
    () =>
      apply(
        g,
        U[1],
        { type: "snap", owner: 0, card: "guessed", event: g.snap.id },
        2100,
      ),
    "CARD_MOVED",
  );
  assert.equal(JSON.stringify(g), before);
  fails(() => view(g, "eve", 1, "ABCDEFGHJK"), "NOT_MEMBER");
  fails(() => apply(g, "eve", { type: "join" }, 2100), "ROOM_FULL");
});
test("snapping away the last legal ability target cannot deadlock a round", () => {
  let g = fixture();
  g.hands[0] = [S(11)];
  g.deck.push(C(11));
  g = apply(g, U[0], { type: "draw", source: "deck" }, 2000);
  g = apply(
    g,
    U[0],
    { type: "snap-drawn", owner: 0, card: g.hands[0][0].id },
    2100,
  );
  assert.equal(g.action, null);
  assert.equal(g.phase, "round-end");
  assert.equal(g.result.raw[0], 0);
});
test("opponent snap restores a legal Jack target through mandatory transfer", () => {
  let g = fixture();
  g.hands[0] = [S(11)];
  g = drawPlay(g, C(11));
  g = apply(
    g,
    U[1],
    { type: "snap", owner: 0, card: g.hands[0][0].id, event: g.snap.id },
    2100,
  );
  assert.equal(g.action.type, "peek-own");
  g = apply(g, U[1], { type: "transfer", card: g.hands[1][0].id }, 2200);
  assert.equal(g.phase, "ability");
  assert.equal(g.hands[0].length, 1);
  g = apply(g, U[0], { type: "ability-peek", card: g.hands[0][0].id }, 2300);
  g = apply(g, U[0], { type: "ability-done" }, 2400);
  assert.equal(g.turn, 1);
  assert.equal(g.phase, "turn");
});
test("random complete matches preserve all 54 cards and progress through every legal phase", () => {
  for (let game = 0; game < 20; game++) {
    let g = fixture(),
      time = 10000;
    for (let step = 0; step < 100; step++) {
      const cards = [
        ...g.deck,
        ...g.discard,
        ...g.hands.flat().map((s) => s.card),
        ...(g.drawn ? [g.drawn.card] : []),
      ];
      assert.equal(cards.length, 54);
      assert.equal(new Set(cards.map((c) => `${c.r}:${c.s}`)).size, 54);
      for (const uid of U) {
        const v = view(g, uid, 1, "ABCDEFGHJK", time);
        if (!["initial", "round-end"].includes(g.phase) && !g.action?.reveal)
          assert.ok(v.hands.flat().every((s) => !s.card));
      }
      if (g.phase === "round-end") break;
      time += 8000;
      const uid = U[g.turn];
      if (g.phase === "settling") {
        g = apply(g, uid, { type: "sync" }, time);
        continue;
      }
      if (g.action) {
        if (g.action.type === "blind-swap") {
          const all = g.hands.flatMap((h, owner) =>
            h.map((s) => ({ owner, card: s.id })),
          );
          g = apply(
            g,
            uid,
            { type: "ability-swap", a: all[0], b: all[1] },
            time,
          );
        } else {
          const owner = g.action.type === "peek-own" ? g.turn : 1 - g.turn;
          g = apply(
            g,
            uid,
            { type: "ability-peek", card: g.hands[owner][0].id },
            time,
          );
          g = apply(g, uid, { type: "ability-done" }, time);
        }
        continue;
      }
      if (g.phase === "drawn")
        g = apply(
          g,
          uid,
          Math.random() < 0.5
            ? { type: "discard" }
            : { type: "swap", card: g.hands[g.turn][0].id },
          time,
        );
      else if (step > 30 && g.caller === null)
        g = apply(g, uid, { type: "call" }, time);
      else g = apply(g, uid, { type: "draw", source: "deck" }, time);
    }
    assert.equal(g.phase, "round-end");
  }
});
