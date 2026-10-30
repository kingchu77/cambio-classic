// Server-only rules. Never import this module into the frontend.
export class RuleError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const need = (test, code, message) => {
  if (!test) throw new RuleError(code, message);
};
const other = (p) => 1 - p;
const red = (c) => c.s === "♥" || c.s === "♦";
export const value = (c) =>
  c.r === 0 ? -2 : c.r === 13 && red(c) ? 0 : Math.min(c.r, 10);
export const ability = (c) =>
  c.r === 11
    ? "peek-own"
    : c.r === 12 && red(c)
      ? "peek-other"
      : c.r === 13 && !red(c)
        ? "blind-swap"
        : null;
export const face = (c) =>
  c.r === 0
    ? "Joker"
    : `${{ 1: "A", 11: "J", 12: "Q", 13: "K" }[c.r] || c.r}${c.s}`;
export function randomInt(n) {
  const limit = Math.floor(4294967296 / n) * n;
  const b = new Uint32Array(1);
  do {
    crypto.getRandomValues(b);
  } while (b[0] >= limit);
  return b[0] % n;
}
export function shuffled(cards) {
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function deck() {
  return shuffled(
    ["♠", "♥", "♦", "♣"]
      .flatMap((s) => Array.from({ length: 13 }, (_, i) => ({ r: i + 1, s })))
      .concat([
        { r: 0, s: "★" },
        { r: 0, s: "☆" },
      ]),
  );
}
const slot = (card, now = 0) => ({
  id: crypto.randomUUID(),
  card,
  penaltyUntil: now ? now + 4200 : 0,
});
export function createRoom(uid, target = 50) {
  need(
    Number.isInteger(target) && target >= 10 && target <= 500,
    "TARGET",
    "Choose a target from 10 to 500.",
  );
  return {
    players: [uid],
    target,
    phase: "waiting",
    round: 0,
    scores: [0, 0],
    hands: [[], []],
    deck: [],
    discard: [],
    turn: 0,
    drawn: null,
    caller: null,
    snap: null,
    transfer: null,
    action: null,
    initial: [[], []],
    ready: [false, false],
    nextReady: [false, false],
    result: null,
    motion: null,
    event: {
      id: crypto.randomUUID(),
      text: "Your private table is ready. Invite your partner.",
    },
    turnNumber: 0,
  };
}
function announce(g, text, now) {
  g.event = { id: crypto.randomUUID(), text, at: now };
}
export function startRound(g, now) {
  g.round++;
  g.deck = deck();
  g.hands = [[], []];
  for (let i = 0; i < 4; i++)
    for (let p = 0; p < 2; p++) g.hands[p].push(slot(g.deck.pop()));
  g.discard = [g.deck.pop()];
  g.turn = (g.round - 1) % 2;
  g.phase = "initial";
  g.drawn = null;
  g.caller = null;
  g.snap = null;
  g.action = null;
  g.transfer = null;
  g.initial = [[], []];
  g.ready = [false, false];
  g.nextReady = [false, false];
  g.result = null;
  g.motion = null;
  g.turnNumber = 0;
  announce(
    g,
    `Round ${g.round}. Privately peek at exactly two of your cards.`,
    now,
  );
}
function take(g) {
  if (!g.deck.length && g.discard.length > 1) {
    const top = g.discard.pop();
    g.deck = shuffled(g.discard);
    g.discard = [top];
  }
  need(g.deck.length, "DECK_EMPTY", "No cards remain to draw.");
  return g.deck.pop();
}
function find(g, p, id) {
  need(p === 0 || p === 1, "CARD", "Choose a card on the table.");
  const i = g.hands[p].findIndex((c) => c.id === id);
  need(i >= 0, "CARD_MOVED", "That card has moved. Choose again.");
  return i;
}
function settleRound(g, now) {
  const raw = g.hands.map((h) => h.reduce((n, c) => n + value(c.card), 0));
  const penalty = [0, 0];
  if (g.caller !== null && raw[g.caller] > raw[other(g.caller)])
    penalty[g.caller] = 10;
  const totals = raw.map((n, p) => n + penalty[p]);
  g.scores = g.scores.map((n, p) => n + totals[p]);
  const matchOver = g.scores.some((n) => n >= g.target);
  const winner = (a) => (a[0] === a[1] ? null : a[0] < a[1] ? 0 : 1);
  g.result = {
    raw,
    penalty,
    totals,
    winner: winner(totals),
    matchOver,
    matchWinner: matchOver ? winner(g.scores) : null,
    revealAt: now,
  };
  g.phase = "round-end";
  g.snap = null;
  g.action = null;
  g.transfer = null;
  g.drawn = null;
  announce(g, "Round complete. Cards on the table!", now);
}
function finish(g, now) {
  if (g.action || g.transfer) return;
  if (
    (g.caller !== null || g.hands.some((h) => h.length === 0)) &&
    g.snap &&
    !g.snap.winner &&
    now < g.snap.closesAt
  ) {
    g.phase = "settling";
    return;
  }
  if (g.caller !== null && g.turn !== g.caller) {
    settleRound(g, now);
    return;
  }
  // Empty hands finish the round once mandatory actions and the snap window finish.
  if (g.hands.some((h) => h.length === 0)) {
    settleRound(g, now);
    return;
  }
  g.turn = other(g.turn);
  g.turnNumber++;
  g.phase = "turn";
}
function completeImpossibleAbility(g) {
  if (!g.action || g.action.reveal || g.transfer) return;
  const { type, player } = g.action;
  const n =
    type === "peek-own"
      ? g.hands[player].length
      : type === "peek-other"
        ? g.hands[other(player)].length
        : g.hands.flat().length;
  if (n < (type === "blind-swap" ? 2 : 1)) g.action = null;
}
function played(g, card, p, now) {
  g.discard.push(card);
  g.drawn = null;
  g.snap = {
    id: crypto.randomUUID(),
    card,
    closesAt: now + 6000,
    winner: null,
    attempted: [],
  };
  const type = ability(card);
  // No legal targets means an ability is automatically complete.
  const targets =
    type === "peek-own"
      ? g.hands[p].length
      : type === "peek-other"
        ? g.hands[other(p)].length
        : g.hands.flat().length;
  g.action =
    type && targets >= (type === "blind-swap" ? 2 : 1)
      ? { type, player: p, reveal: null }
      : null;
  g.phase = g.action ? "ability" : "settling";
  announce(
    g,
    `Player ${p + 1} played ${face(card)}${g.action ? " · special ability" : ""}.`,
    now,
  );
  finish(g, now);
}
export function apply(input, uid, cmd, now = Date.now()) {
  const g = structuredClone(input),
    p = g.players.indexOf(uid),
    kind = cmd.type;
  if (kind === "join") {
    if (p >= 0) return g;
    need(
      g.players.length < 2,
      "ROOM_FULL",
      "This table already has two players.",
    );
    g.players.push(uid);
    startRound(g, now);
    return g;
  }
  need(p >= 0, "NOT_MEMBER", "You are not seated at this table.");
  if (kind === "sync") {
    if (g.phase === "settling") finish(g, now);
    return g;
  }
  if (kind === "initial-peek") {
    need(
      g.phase === "initial" && !g.ready[p],
      "PHASE",
      "Initial peeking has finished.",
    );
    find(g, p, cmd.card);
    need(
      !g.initial[p].includes(cmd.card) && g.initial[p].length < 2,
      "PEEK_LIMIT",
      "You may see exactly two different cards.",
    );
    g.initial[p].push(cmd.card);
    return g;
  }
  if (kind === "ready") {
    need(
      g.phase === "initial" && g.initial[p].length === 2,
      "PEEK_FIRST",
      "Peek at two cards first.",
    );
    g.ready[p] = true;
    if (g.ready.every(Boolean)) {
      g.initial = [[], []];
      g.phase = "turn";
      announce(g, "Both players are ready. Let’s play.", now);
    }
    return g;
  }
  if (kind === "next-round") {
    need(g.phase === "round-end", "PHASE", "Finish this round first.");
    const revealDuration = g.hands.flat().length * 260 + 400;
    need(
      now >= g.result.revealAt + revealDuration,
      "REVEALING",
      "Wait for the cards to finish revealing.",
    );
    g.nextReady[p] = true;
    if (g.nextReady.every(Boolean)) {
      if (g.result.matchOver) {
        g.scores = [0, 0];
        g.round = 0;
      }
      startRound(g, now);
    }
    return g;
  }
  need(
    !["waiting", "initial", "round-end"].includes(g.phase),
    "PHASE",
    "This round is not in play.",
  );
  if (kind === "transfer") {
    need(
      g.transfer?.player === p,
      "TRANSFER",
      "There is no card for you to transfer.",
    );
    const resume = g.transfer.resumePhase;
    const i = find(g, p, cmd.card),
      c = g.hands[p].splice(i, 1)[0];
    g.hands[other(p)].push(slot(c.card));
    g.transfer = null;
    completeImpossibleAbility(g);
    announce(g, `Player ${p + 1} passed a card face down.`, now);
    if (g.action) g.phase = "ability";
    else if (g.drawn) g.phase = "drawn";
    else if (resume === "turn") {
      g.phase = "turn";
      if (g.hands.some((h) => h.length === 0)) settleRound(g, now);
    } else finish(g, now);
    return g;
  }
  need(
    !g.transfer,
    "TRANSFER_FIRST",
    "Complete the face-down card transfer first.",
  );
  if (kind === "snap") {
    need(
      g.snap && cmd.event === g.snap.id,
      "SNAP_STALE",
      "That snap opportunity has passed.",
    );
    need(
      !g.snap.winner && now < g.snap.closesAt,
      "SNAP_CLOSED",
      "Another snap won, or the snap window closed.",
    );
    need(
      !g.snap.attempted.includes(p),
      "SNAP_TRIED",
      "One attempt per player per discard.",
    );
    const i = find(g, cmd.owner, cmd.card),
      candidate = g.hands[cmd.owner][i];
    need(
      cmd.owner === p || g.hands[p].length > 0,
      "NO_TRANSFER",
      "You need a card to pass for an opponent snap.",
    );
    g.snap.attempted.push(p);
    if (candidate.card.r === g.snap.card.r) {
      g.snap.winner = { player: p, at: now };
      g.discard.splice(
        g.discard.length - 1,
        0,
        g.hands[cmd.owner].splice(i, 1)[0].card,
      );
      if (cmd.owner !== p) {
        g.transfer = { player: p, resumePhase: g.phase };
        g.phase = "transfer";
      }
      completeImpossibleAbility(g);
      announce(
        g,
        `Player ${p + 1} won the snap${cmd.owner !== p ? " — choose a card to pass face down" : ""}!`,
        now,
      );
      if (!g.action && !g.transfer && !g.drawn && g.phase !== "turn")
        finish(g, now);
      else if (
        !g.action &&
        !g.transfer &&
        !g.drawn &&
        g.hands.some((h) => h.length === 0)
      )
        settleRound(g, now);
    } else {
      g.hands[p].push(slot(take(g), now));
      announce(g, `Player ${p + 1}: incorrect snap. +1 penalty card.`, now);
    }
    return g;
  }
  need(p === g.turn, "TURN", "It is your partner’s turn.");
  if (kind === "ability-peek") {
    need(
      g.phase === "ability" &&
        g.action &&
        !g.action.reveal &&
        ["peek-own", "peek-other"].includes(g.action.type),
      "ABILITY",
      "No peek is waiting.",
    );
    const owner = g.action.type === "peek-own" ? p : other(p);
    const i = find(g, owner, cmd.card);
    g.action.reveal = { owner, id: cmd.card, card: g.hands[owner][i].card };
    return g;
  }
  if (kind === "ability-done") {
    need(
      g.phase === "ability" && g.action?.reveal,
      "ABILITY",
      "Choose a card to peek at first.",
    );
    g.action = null;
    finish(g, now);
    return g;
  }
  if (kind === "ability-swap") {
    need(
      g.phase === "ability" && g.action?.type === "blind-swap",
      "ABILITY",
      "No blind swap is waiting.",
    );
    const i = find(g, cmd.a?.owner, cmd.a?.card),
      j = find(g, cmd.b?.owner, cmd.b?.card);
    need(cmd.a.card !== cmd.b.card, "CARD", "Choose two different cards.");
    const a = g.hands[cmd.a.owner][i],
      b = g.hands[cmd.b.owner][j];
    [a.card, b.card] = [b.card, a.card];
    g.motion = {
      id: crypto.randomUUID(),
      at: now,
      kind: "blind-swap",
      player: p,
      targets: [
        { owner: cmd.a.owner, card: a.id, index: i },
        { owner: cmd.b.owner, card: b.id, index: j },
      ],
    };
    g.action = null;
    announce(g, `Player ${p + 1} swapped two cards without looking.`, now);
    finish(g, now);
    return g;
  }
  if (kind === "call") {
    need(
      g.phase === "turn" && g.caller === null,
      "CALL",
      "Call Cambio at the start of your turn.",
    );
    need(
      !g.snap || g.snap.winner || now >= g.snap.closesAt,
      "SNAP_WAIT",
      "Give both players the snap window first.",
    );
    g.caller = p;
    g.snap = null;
    g.turn = other(p);
    g.turnNumber++;
    announce(
      g,
      `CAMBIO! Player ${other(p) + 1} has exactly one final turn.`,
      now,
    );
    return g;
  }
  if (kind === "draw") {
    need(g.phase === "turn", "PHASE", "Finish the current action first.");
    need(
      !g.snap || g.snap.winner || now >= g.snap.closesAt,
      "SNAP_WAIT",
      "Give both players the snap window first.",
    );
    const source = cmd.source;
    need(
      ["deck", "discard"].includes(source),
      "SOURCE",
      "Choose deck or discard.",
    );
    need(g.hands[p].length > 0, "EMPTY_HAND", "No cards remain in your hand.");
    if (source === "discard")
      need(g.discard.length, "DISCARD_EMPTY", "The discard pile is empty.");
    // Drawing closes the preceding public snap event. A drawn rank stays private.
    g.snap = null;
    g.drawn = {
      player: p,
      source,
      card: source === "deck" ? take(g) : g.discard.pop(),
    };
    g.phase = "drawn";
    announce(g, `Player ${p + 1} drew from the ${source}.`, now);
    return g;
  }
  if (kind === "discard" || kind === "swap" || kind === "snap-drawn") {
    need(
      g.phase === "drawn" && g.drawn?.player === p,
      "DRAW_FIRST",
      "Draw a card first.",
    );
    const drawn = g.drawn;
    if (kind === "swap") {
      const i = find(g, p, cmd.card),
        old = g.hands[p][i].card;
      g.hands[p][i].card = drawn.card;
      g.hands[p][i].penaltyUntil = 0;
      played(g, old, p, now);
      // Public movement only: never put either hidden card's face in this record.
      g.motion = {
        id: crypto.randomUUID(),
        at: now,
        kind: "draw-swap",
        player: p,
        source: drawn.source,
        targets: [{ owner: p, card: g.hands[p][i].id, index: i }],
      };
      return g;
    }
    need(
      drawn.source === "deck",
      "MUST_SWAP",
      "A card taken from the discard pile must be swapped into your hand.",
    );
    if (kind === "discard") {
      played(g, drawn.card, p, now);
      return g;
    }
    find(g, cmd.owner, cmd.card);
    // Explicit drawn snap deliberately plays the drawn card, including its ability.
    // The removed matching card never activates an ability.
    played(g, drawn.card, p, now);
    return apply(
      g,
      uid,
      { type: "snap", owner: cmd.owner, card: cmd.card, event: g.snap.id },
      now,
    );
  }
  throw new RuleError("ACTION", "Unknown game action.");
}
export function view(g, uid, version, code, now = Date.now()) {
  const me = g.players.indexOf(uid);
  need(me >= 0, "NOT_MEMBER", "You are not seated at this table.");
  return {
    code,
    version,
    me,
    phase: g.phase,
    round: g.round,
    target: g.target,
    turn: g.turn,
    scores: g.scores,
    players: g.players.map((_, p) => ({
      seat: p,
      ready: g.ready[p],
      nextReady: g.nextReady[p],
    })),
    hands: g.hands.map((h, p) =>
      h.map((s) => {
        const visible =
          g.phase === "round-end" ||
          (g.phase === "initial" &&
            p === me &&
            !g.ready[me] &&
            g.initial[me].includes(s.id)) ||
          (g.action?.player === me && g.action.reveal?.id === s.id);
        return {
          id: s.id,
          penaltyUntil: s.penaltyUntil,
          ...(visible ? { card: s.card } : {}),
        };
      }),
    ),
    initialCount: g.initial[me].length,
    drawn: g.drawn
      ? {
          player: g.drawn.player,
          source: g.drawn.source,
          ...(g.drawn.player === me ? { card: g.drawn.card } : {}),
        }
      : null,
    discard: g.discard.at(-1) || null,
    deckCount: g.deck.length,
    snap: g.snap
      ? {
          id: g.snap.id,
          card: g.snap.card,
          closesAt: g.snap.closesAt,
          winner: g.snap.winner,
          tried: g.snap.attempted.includes(me),
        }
      : null,
    action: g.action
      ? {
          type: g.action.type,
          player: g.action.player,
          revealed: !!g.action.reveal,
        }
      : null,
    transfer: g.transfer,
    caller: g.caller,
    result: g.result,
    event: g.event,
    motion: g.motion || null,
    serverNow: now,
  };
}
