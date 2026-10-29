import "./style.css";
import { configured, isLocal, connect, request, subscribe } from "./api.js";

const root = document.querySelector("#app");
let state = null,
  busy = false,
  connected = false,
  selected = [],
  error = "",
  unsub = null,
  polling = false,
  offset = 0,
  seenEvent = "",
  snapMode = false;
const roomFromURL =
  new URL(location.href).searchParams.get("room")?.toUpperCase() || "";
const savedRoom = localStorage.getItem("cambio-room") || "";
let inputCode = /^[A-HJ-NP-Z2-9]{10}$/.test(roomFromURL)
  ? roomFromURL
  : savedRoom;
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const face = (c) =>
  c.r === 0
    ? "★"
    : `${{ 1: "A", 11: "J", 12: "Q", 13: "K" }[c.r] || c.r}${c.s}`;
const now = () => Date.now() + offset;
function status() {
  const s = state,
    mine = s.turn === s.me;
  if (s.phase === "waiting")
    return "A table for two. Send the invitation to your partner.";
  if (s.phase === "initial")
    return s.players[s.me].ready
      ? "Cards hidden. Waiting for your partner to be ready."
      : `Remember two cards. Tap to peek (${s.initialCount}/2), then hide them to begin.`;
  if (s.transfer)
    return s.transfer.player === s.me
      ? "Snap won! Tap one of your cards to pass it face down."
      : "Your partner is choosing a card to pass face down.";
  if (s.phase === "ability") {
    if (!mine) return "Your partner must finish their special ability.";
    if (s.action.revealed)
      return "Remember this card, then tap “Hide & finish ability”.";
    return s.action.type === "peek-own"
      ? "Jack · Tap one of your own cards to peek."
      : s.action.type === "peek-other"
        ? "Red Queen · Tap one of your partner’s cards to peek."
        : "Black King · Select any two cards, then swap without looking.";
  }
  if (s.phase === "settling")
    return "Snap window open. Tap a matching card before the next turn.";
  if (s.phase === "round-end") return "Cards on the table. Lowest score wins.";
  if (s.phase === "drawn")
    return mine
      ? "Keep it? Select your own card to swap, discard it, or select a match to snap."
      : "Your partner is deciding. Their drawn card stays private.";
  return mine
    ? `${s.caller !== null ? "Your final turn. " : ""}Draw a card, take the discard, or call Cambio. Tap a matching card to snap.`
    : "Your partner’s turn. Tap a matching card to snap when a card is played.";
}
function cardHTML(slot, owner, index, globalIndex) {
  const s = state,
    picked = selected.some((x) => x.card === slot.id),
    c = slot.card;
  const penalty = slot.penaltyUntil > now();
  const delay =
    s.phase === "round-end"
      ? Math.max(0, s.result.revealAt + globalIndex * 260 - now())
      : 0;
  return `<button class="card ${c ? (["♥", "♦"].includes(c.s) ? "red" : "") : "back"} ${picked ? "selected" : ""} ${penalty ? "penalty-new" : ""} ${s.phase === "round-end" ? "revealed" : ""}" data-card="${slot.id}" data-owner="${owner}" data-penalty-until="${slot.penaltyUntil || 0}" data-reveal-at="${s.phase === "round-end" ? s.result.revealAt + globalIndex * 260 : 0}" aria-label="${escape(`${owner === s.me ? "Your" : "Partner"} card ${index + 1}${c ? `: ${face(c)}` : ", face down"}`)}" aria-pressed="${picked}" style="--reveal-delay:${delay}ms" ${busy || s.phase === "round-end" ? "disabled" : ""}>
    ${c ? `<span class="corner">${escape(face(c))}</span><span class="suit">${escape(c.r === 0 ? "★" : c.s)}</span><span class="corner bottom">${escape(face(c))}</span>${s.phase === "round-end" && delay > 0 ? '<span class="reveal-cover"><span class="back-mark">♠</span></span>' : ""}` : '<span class="back-mark" aria-hidden="true">♠</span>'}
    ${penalty ? '<span class="penalty-badge">+ PENALTY</span>' : ""}
  </button>`;
}
function publicCard(c, extra = "") {
  return `<span class="card face ${c && ["♥", "♦"].includes(c.s) ? "red" : ""} ${extra}">${c ? `<span class="corner">${escape(face(c))}</span><span class="suit">${escape(c.r === 0 ? "★" : c.s)}</span><span class="corner bottom">${escape(face(c))}</span>` : "—"}</span>`;
}
function hand(owner) {
  const s = state,
    mine = owner === s.me,
    result = s.result;
  const score = result
    ? `Round ${result.raw[owner]}${result.penalty[owner] ? " + 10 Cambio" : ""} = ${result.totals[owner]}`
    : `${s.hands[owner].length} cards`;
  const before = owner === 0 ? 0 : s.hands[0].length;
  return `<section class="hand ${mine ? "mine" : "partner"}" aria-label="${mine ? "Your cards" : "Partner cards"}">
    <div class="hand-heading"><span>${mine ? "You" : "Your partner"} ${s.turn === owner && !["initial", "waiting", "round-end"].includes(s.phase) ? '<i class="turn-chip">TURN</i>' : ""}${s.caller === owner ? '<i class="turn-chip called">CAMBIO</i>' : ""}</span><span class="score">${s.scores[owner]} <small>pts</small></span></div>
    <div class="cards">${s.hands[owner].map((slot, i) => cardHTML(slot, owner, i, before + i)).join("") || '<div class="empty-hand">No cards · looking good</div>'}</div>
    <div class="hand-meta">${escape(score)}</div></section>`;
}
function actionButton(id, text, enabled, extra = "") {
  return `<button id="${id}" class="button ${extra}" ${enabled && !busy ? "" : "disabled"}>${text}</button>`;
}
function controls() {
  const s = state,
    mine = s.turn === s.me,
    picked = selected[0];
  if (s.phase === "initial")
    return actionButton(
      "ready",
      s.players[s.me].ready ? "Waiting for partner…" : "Hide cards & ready",
      s.initialCount === 2 && !s.players[s.me].ready,
      "full gold",
    );
  if (s.phase === "round-end") {
    const ready = s.players[s.me].nextReady;
    const done = now() >= s.result.revealAt + s.hands.flat().length * 260 + 400;
    return actionButton(
      "next",
      ready
        ? "Waiting for partner…"
        : s.result.matchOver
          ? "Play a new match"
          : "Next round",
      !ready && done,
      "full gold",
    );
  }
  if (s.transfer)
    return '<p class="instruction full">Face-down transfer · no peeking</p>';
  if (s.phase === "ability" && mine) {
    if (s.action.revealed)
      return actionButton(
        "ability-done",
        "Hide & finish ability",
        true,
        "full gold",
      );
    return (
      (s.action.type === "blind-swap"
        ? actionButton(
            "ability-swap",
            "Swap these two cards",
            selected.length === 2,
            "gold",
          )
        : "") +
      actionButton(
        "snap-mode",
        snapMode ? "Return to ability" : "Try a snap",
        !!activeSnap(),
        "outline",
      )
    );
  }
  if (s.phase === "drawn" && mine)
    return [
      actionButton(
        "discard",
        "Discard drawn",
        s.drawn.source === "deck",
        "gold",
      ),
      actionButton("swap", "Swap selected", picked?.owner === s.me, "gold"),
      actionButton(
        "snap-drawn",
        "Snap drawn match",
        !!picked && s.drawn.source === "deck",
        "outline full",
      ),
    ].join("");
  return actionButton(
    "call",
    "Call Cambio",
    mine && s.phase === "turn" && s.caller === null,
    "cambio full",
  );
}
function activeSnap() {
  const snap = state?.snap;
  return snap && !snap.winner && !snap.tried && now() < snap.closesAt
    ? snap
    : null;
}
function resultHTML() {
  const s = state,
    r = s.result;
  if (!r) return "";
  const w = r.matchOver ? r.matchWinner : r.winner;
  return `<section class="result" aria-live="polite"><span class="eyebrow">${r.matchOver ? "MATCH COMPLETE" : `ROUND ${s.round} COMPLETE`}</span><h2>${w === null ? "A perfect tie." : w === s.me ? "You take this one." : "Your partner takes this one."}</h2><p>${r.matchOver ? `Match totals: ${s.scores[s.me]} · ${s.scores[1 - s.me]}` : "A little memory. A little nerve. Another round?"}</p></section>`;
}
function shell(content) {
  return `<main class="table"><header class="masthead"><a class="brand" href="${escape(location.pathname)}" aria-label="Cambio Classic home">CAMBIO<span>CLASSIC EDITION</span></a><div class="header-actions">${state ? '<button class="small-button" id="leave" aria-label="Leave table">Leave</button>' : ""}<button class="small-button" id="rules-open" aria-label="Game rules">How to play</button></div></header>${isLocal ? '<div class="dev-banner">LOCAL TEST TABLE · stays on this computer</div>' : ""}${content}<footer>A little memory. A little nerve. <span>♠ ♥ ♣ ♦</span></footer></main><div class="toast ${error ? "visible" : ""}" role="alert">${escape(error)}</div>`;
}
function render() {
  const s = state;
  if (!s) {
    root.innerHTML =
      shell(`<section class="welcome"><div class="ornament">✦</div><p class="eyebrow">YOUR PRIVATE CARD TABLE</p><h1>Two players.<br>One good evening.</h1><p class="intro">Remember your cards. Trust your instincts.<br>Play together, wherever you are.</p><div class="welcome-cards"><span class="card back tilted"><span class="back-mark">♠</span></span>${publicCard({ r: 13, s: "♥" })}</div></section>
      ${!configured ? '<div class="setup-note"><strong>The table needs its backend.</strong><p>Set the two public Supabase values in your environment and deploy the included backend. See README.md for the complete setup. For a private local test, run <code>npm run dev:local</code>.</p></div>' : ""}
      <form id="create-form" class="lobby-form"><label class="target-label">Match target <select id="target"><option>25</option><option selected>50</option><option>100</option><option>200</option><option>500</option></select><span>points · lowest wins</span></label>${actionButton("create", "Create a private table", configured, "gold full")}</form>
      <div class="divider"><span>or pull up a chair</span></div><form id="join-form" class="lobby-form join"><label for="room-code">ROOM CODE</label><div class="join-row"><input id="room-code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD EFGH JK" maxlength="14" value="${escape(inputCode)}" required><button class="button outline" ${busy || !configured ? "disabled" : ""}>Join table</button></div></form><p class="privacy-note">Just you two. No names, emails, or accounts to create.</p>`);
    document.querySelector("#create-form").onsubmit = (e) => {
      e.preventDefault();
      enter("create");
    };
    document.querySelector("#join-form").onsubmit = (e) => {
      e.preventDefault();
      inputCode = document
        .querySelector("#room-code")
        .value.toUpperCase()
        .replace(/[\s-]/g, "");
      enter("join");
    };
  } else if (s.phase === "waiting") {
    root.innerHTML = shell(
      `<div class="room-bar"><span>PRIVATE TABLE</span><span class="connection">${connected ? "● Connected" : "◌ Reconnecting"}</span></div><section class="waiting"><div class="ornament">♠</div><p class="eyebrow">PULL UP A CHAIR</p><h1>Your table is ready.</h1><p>Send the invitation to your favourite opponent.</p><div class="room-code">${s.code.slice(0, 4)} ${s.code.slice(4, 8)} ${s.code.slice(8)}</div><p class="privacy-note">Keep the room code between you two.</p><div class="actions">${actionButton("invite", "Share invitation", true, "gold full")}${actionButton("copy", "Copy invitation link", true, "outline full")}</div><p class="waiting-note">Waiting for your partner to join…</p></section>`,
    );
  } else {
    const mine = s.turn === s.me,
      canDraw =
        mine &&
        s.phase === "turn" &&
        (!s.snap || s.snap.winner || now() >= s.snap.closesAt);
    root.innerHTML =
      shell(`<div class="room-bar"><span>ROUND ${s.round} <b>·</b> TARGET ${s.target}</span><button class="room-link" id="copy">${s.code} ↗</button><span class="connection">${connected ? "● Live" : "◌ Syncing"}</span></div>
      ${hand(1 - s.me)}<section class="piles" aria-label="Draw piles"><div class="pile"><button id="deck" class="card back deck" aria-label="Draw from deck" ${canDraw && !busy ? "" : "disabled"}><span class="back-mark">♠</span></button><span>DECK <small>${s.deckCount}</small></span></div><div class="table-stamp">C<span>♣</span></div><div class="pile"><button id="take-discard" class="pile-button" aria-label="Take top discard and swap into your hand" ${canDraw && s.discard && !busy ? "" : "disabled"}>${publicCard(s.discard)}</button><span>DISCARD</span></div></section>
      <div class="snap-line" id="snap-line"></div>${hand(s.me)}
      <section class="drawn-area" aria-label="Drawn card">${s.drawn ? `<div class="drawn-stack">${s.drawn.card ? publicCard(s.drawn.card, "drawn-card") : '<span class="card back"><span class="back-mark">♠</span></span>'}<span>${s.drawn.player === s.me ? `YOUR DRAW · ${s.drawn.source === "discard" ? "MUST SWAP" : "PRIVATE"}` : "PARTNER’S PRIVATE DRAW"}</span></div>` : ""}</section>
      <p id="status" class="status" role="status" aria-live="polite">${escape(status())}</p><p class="event" aria-live="polite">${escape(s.event?.text)}</p>${resultHTML()}<div class="actions">${controls()}</div>
      <p class="hint">${s.phase === "drawn" && mine ? "Select any face-down card, then “Snap drawn match” to play your draw and attempt a match." : s.phase === "ability" && mine ? "Finish the special ability to release the turn." : "Tap a matching face-down card to snap. One attempt each per discard."}</p>`);
    document
      .querySelectorAll("[data-card]")
      .forEach(
        (el) =>
          (el.onclick = () =>
            choose(Number(el.dataset.owner), el.dataset.card)),
      );
    bind("deck", () => act({ type: "draw", source: "deck" }));
    bind("take-discard", () => act({ type: "draw", source: "discard" }));
    bind("ready", () => act({ type: "ready" }));
    bind("call", () => act({ type: "call" }));
    bind("discard", () => act({ type: "discard" }));
    bind("swap", () => act({ type: "swap", card: selected[0]?.card }));
    bind("snap-drawn", () => act({ type: "snap-drawn", ...selected[0] }));
    bind("ability-done", () => act({ type: "ability-done" }));
    bind("ability-swap", () =>
      act({ type: "ability-swap", a: selected[0], b: selected[1] }),
    );
    bind("next", () => act({ type: "next-round" }));
    bind("snap-mode", () => {
      snapMode = !snapMode;
      selected = [];
      render();
    });
    updateClock();
  }
  bind("rules-open", showRules);
  bind("copy", copyInvite);
  bind("invite", shareInvite);
  bind("leave", leave);
}
function leave() {
  unsub?.();
  unsub = null;
  state = null;
  selected = [];
  inputCode = "";
  connected = false;
  error = "";
  localStorage.removeItem("cambio-room");
  const url = new URL(location.href);
  url.searchParams.delete("room");
  history.replaceState(null, "", url);
  render();
}
function bind(id, fn) {
  const el = document.getElementById(id);
  if (el) el.onclick = fn;
}
function choose(owner, card) {
  if (busy) return;
  const s = state;
  if (s.phase === "initial") {
    if (
      owner === s.me &&
      !s.players[s.me].ready &&
      s.initialCount < 2 &&
      !s.hands[owner].find((x) => x.id === card).card
    )
      act({ type: "initial-peek", card });
    return;
  }
  if (s.transfer) {
    if (s.transfer.player === s.me && owner === s.me)
      act({ type: "transfer", card });
    return;
  }
  if (s.phase === "ability" && s.turn === s.me && !snapMode) {
    if (s.action.revealed) return;
    if (s.action.type === "blind-swap") {
      const old = selected.findIndex((x) => x.card === card);
      if (old >= 0) selected.splice(old, 1);
      else selected = [...selected.slice(-1), { owner, card }];
      render();
    } else if (owner === (s.action.type === "peek-own" ? s.me : 1 - s.me))
      act({ type: "ability-peek", card });
    return;
  }
  if (s.phase === "drawn" && s.turn === s.me) {
    selected = [{ owner, card }];
    render();
    return;
  }
  if (activeSnap()) act({ type: "snap", owner, card, event: s.snap.id });
  else toast("No open snap. Wait for a newly played card.");
}
function accept(next) {
  if (state && (next.code !== state.code || next.version < state.version))
    return;
  offset = next.serverNow - Date.now();
  if (state && next.version === state.version) {
    state.serverNow = next.serverNow;
    updateClock();
    return;
  }
  const old = state;
  state = next;
  if (
    !old ||
    old.phase !== next.phase ||
    old.turn !== next.turn ||
    old.drawn?.card !== next.drawn?.card
  )
    selected = [];
  selected = selected.filter((x) =>
    next.hands[x.owner].some((c) => c.id === x.card),
  );
  if (old?.action?.type !== next.action?.type) snapMode = false;
  if (seenEvent !== next.event?.id) seenEvent = next.event?.id;
  render();
}
async function enter(op) {
  if (busy) return;
  const target = Number(document.querySelector("#target")?.value || 50);
  busy = true;
  error = "";
  render();
  const requestId = crypto.randomUUID();
  try {
    if (!sessionReady) await readySession();
    const next = await retryRequest({ op, code: inputCode, target, requestId });
    state = null;
    accept(next);
    localStorage.setItem("cambio-room", next.code);
    const link = new URL(location.href);
    link.searchParams.set("room", next.code);
    history.replaceState(null, "", link);
    unsub?.();
    unsub = subscribe(
      next.code,
      (update) => {
        if (state?.code === update.code) accept(update);
      },
      (live) => {
        connected = live;
        updateConnection();
      },
    );
    // Close the subscription handshake gap with a fresh snapshot.
    await refresh();
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
    render();
  }
}
async function retryRequest(body) {
  try {
    return await request(body);
  } catch (e) {
    if (e instanceof TypeError) return request(body); // Same request ID; idempotent after a lost response.
    throw e;
  }
}
async function act(action) {
  if (busy || !state) return;
  busy = true;
  error = "";
  render();
  try {
    accept(
      await retryRequest({
        op: "action",
        code: state.code,
        version: state.version,
        action,
        requestId: crypto.randomUUID(),
      }),
    );
    selected = [];
  } catch (e) {
    toast(e.message);
    await refresh();
  } finally {
    busy = false;
    render();
  }
}
async function refresh() {
  if (!state || polling || !navigator.onLine) return;
  const code = state.code;
  polling = true;
  try {
    const next = await request({
      op: "action",
      code,
      action: { type: "sync" },
      requestId: crypto.randomUUID(),
    });
    if (state?.code === code) accept(next);
  } catch (e) {
    connected = false;
    updateConnection();
    if (e.code === "AUTH" || e.code === "ROOM_MISSING") toast(e.message);
  } finally {
    polling = false;
  }
}
function updateConnection() {
  document
    .querySelectorAll(".connection")
    .forEach(
      (el) => (el.textContent = connected ? "● Live" : "◌ Reconnecting"),
    );
}
function updateClock() {
  const el = document.getElementById("snap-line");
  if (!el || !state) return;
  document.querySelectorAll(".penalty-new").forEach((card) => {
    if (now() >= Number(card.dataset.penaltyUntil)) {
      card.classList.remove("penalty-new");
      card.querySelector(".penalty-badge")?.remove();
    }
  });
  document.querySelectorAll(".reveal-cover").forEach((cover) => {
    if (now() >= Number(cover.parentElement.dataset.revealAt)) cover.remove();
  });
  const snap = state.snap;
  el.textContent = state.transfer
    ? "SNAP WON · PASS A CARD FACE DOWN"
    : snap?.winner
      ? `SNAP · ${snap.winner.player === state.me ? "YOU" : "PARTNER"} WON`
      : activeSnap()
        ? `SNAP ${face(snap.card)} · ${Math.max(0, Math.ceil((snap.closesAt - now()) / 1000))}s`
        : snap?.tried && now() < snap.closesAt
          ? "ATTEMPT USED · WAIT FOR THE NEXT CARD"
          : "♠  MEMORY IS EVERYTHING  ♠";
  if (state.phase === "round-end") {
    const el = document.getElementById("next");
    if (
      el &&
      !state.players[state.me].nextReady &&
      !busy &&
      now() >= state.result.revealAt + state.hands.flat().length * 260 + 400
    )
      el.disabled = false;
  }
  if (state.phase === "turn" && state.turn === state.me) {
    const allowed =
      !busy &&
      (!state.snap || !!state.snap.winner || now() >= state.snap.closesAt);
    const deck = document.getElementById("deck"),
      discard = document.getElementById("take-discard"),
      call = document.getElementById("call");
    if (deck) deck.disabled = !allowed;
    if (discard) discard.disabled = !allowed || !state.discard;
    if (call) call.disabled = !allowed || state.caller !== null;
  }
}
function inviteURL() {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("room", state.code);
  url.hash = "";
  return url.href;
}
async function copyInvite() {
  try {
    await navigator.clipboard.writeText(inviteURL());
    toast("Invitation copied. Send it to your partner.");
  } catch {
    showLink();
  }
}
async function shareInvite() {
  if (navigator.share) {
    try {
      await navigator.share({
        title: "Our Cambio table",
        text: "Pull up a chair. Let’s play Cambio.",
        url: inviteURL(),
      });
    } catch (e) {
      if (e.name !== "AbortError") showLink();
    }
  } else copyInvite();
}
function showLink() {
  showDialog(
    "Your invitation",
    `<p>Copy this link and send it to your partner.</p><input class="invite-input" readonly value="${escape(inviteURL())}" aria-label="Invitation link">`,
  );
  document.querySelector(".invite-input").select();
}
function toast(message) {
  error = message;
  const el = document.querySelector(".toast");
  if (el) {
    el.textContent = message;
    el.classList.add("visible");
  }
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    error = "";
    document.querySelector(".toast")?.classList.remove("visible");
  }, 6500);
}
function showDialog(title, content) {
  document.querySelector("dialog")?.remove();
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `<button class="close" aria-label="Close">×</button><p class="eyebrow">CAMBIO CLASSIC</p><h2>${title}</h2>${content}`;
  document.body.append(dialog);
  dialog.querySelector(".close").onclick = () => dialog.close();
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}
function showRules() {
  showDialog(
    "A little memory. A little nerve.",
    `<p>Start with four face-down cards. Privately peek at two, then hide them. Lowest score wins.</p><p><strong>Your turn:</strong> draw from the deck and discard or swap with your own card. Taking the discard means you must swap. Or call Cambio before drawing: your partner gets one final turn.</p><p><strong>Specials:</strong> J peeks at your card. Red Q peeks at a partner card. Black K swaps any two without looking. Finish the ability before play continues.</p><p><strong>Snap:</strong> after a card is played, tap any matching-rank card within six seconds. One attempt each; first correct server commit wins. A wrong snap adds a hidden penalty card. Snapping a partner card means passing one of yours face down. After drawing, select a card and press “Snap drawn match” to play your draw and attempt a snap against it. Its special ability still applies; the removed card’s ability does not.</p><p><strong>Points:</strong> A = 1, 2–10 = face value, J/Q/black K = 10, red K = 0, Joker = −2. Numbers have no abilities. A beaten Cambio caller adds 10; ties add no penalty. Scores accumulate. At the target, lower total wins.</p><p>Your browser remembers your seat. Use the same browser to reconnect. Keep the room code private.</p>`,
  );
}
let sessionReady = false,
  sessionPromise;
async function readySession() {
  if (!sessionPromise)
    sessionPromise = connect()
      .then(() => {
        sessionReady = true;
      })
      .catch((e) => {
        sessionPromise = null;
        throw e;
      });
  return sessionPromise;
}
render();
if (configured)
  readySession()
    .then(() => {
      if (inputCode) enter("join");
    })
    .catch((e) => toast(e.message));
setInterval(() => {
  updateClock();
  if (state && !busy && document.visibilityState === "visible") refresh();
}, 1500);
setInterval(updateClock, 250);
addEventListener("online", refresh);
addEventListener("offline", () => {
  connected = false;
  updateConnection();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});
