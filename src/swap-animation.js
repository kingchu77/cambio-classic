// Public movement journal only. Private draws and transfers always travel face down.
export const SWAP_NOTE_MS = 6500;
let room = "", seen = new Set(), queue = [], playing = null;
let currentView = null, renderCard, notice = null, noticeUntil = 0, timer;
const rect = (element) => {
  if (!element) return null;
  const box = element.getBoundingClientRect();
  return { left: box.left + scrollX, top: box.top + scrollY, width: box.width, height: box.height };
};
const handCard = (location) => document.querySelector(`[data-owner="${location.owner}"][data-card="${CSS.escape(location.card || "")}"]`);
function elementAt(location) {
  if (location.zone === "hand") return handCard(location);
  if (location.zone === "drawn") return document.querySelector(".drawn-area .card");
  return document.querySelector(location.zone === "deck" ? "#deck" : "#take-discard .card");
}
function position(location) {
  const exact = rect(elementAt(location));
  if (exact) return exact;
  const style = getComputedStyle(document.documentElement);
  const width = parseFloat(style.getPropertyValue("--card-w"));
  const height = parseFloat(style.getPropertyValue("--card-h"));
  const hand = document.querySelector(location.owner === currentView?.me ? ".mine .cards" : ".partner .cards");
  const anchor = location.zone === "hand" ? hand : document.querySelector(".drawn-area");
  const box = rect(anchor) || rect(document.querySelector(".piles"));
  if (!box) return null;
  const neighbour = location.zone === "hand" ? rect(hand?.querySelectorAll(".card")[Math.min(location.index || 0, hand.children.length - 1)]) : null;
  return neighbour || { left: box.left + (box.width - width) / 2, top: box.top, width, height };
}
const slotName = (location, me) => `${location.owner === me ? "Your" : "Partner’s"} card ${location.index + 1}`;
export function swapLabel(event, me) {
  const moves = event.moves, first = moves[0];
  switch (event.kind) {
    case "deal": return "Cards dealt face down · Remember two cards";
    case "draw": return `${event.source === "discard" ? "Discard pile" : "Draw pile"} → ${event.player === me ? "Your" : "Partner’s"} draw`;
    case "discard": return `${event.player === me ? "Your" : "Partner’s"} draw → Discard pile`;
    case "draw-swap": return `${event.source === "deck" ? "Draw pile" : "Discard pile"} → ${slotName(first.to, me)} · Replaced card → discard`;
    case "blind-swap": return `Face-down swap: ${slotName(first.from, me)} ↔ ${slotName(first.to, me)}`;
    case "snap": return `${slotName(first.from, me)} → Discard pile · Snap`;
    case "transfer": return `${slotName(first.from, me)} → ${slotName(first.to, me)} · Face-down transfer`;
    case "penalty": return `Draw pile → ${slotName(first.to, me)} · Penalty`;
    case "recycle": return "Discard pile → Draw pile · Reshuffled face down";
    default: return "Card moved";
  }
}
export function captureSwap(previous, next) {
  if (room !== next.code) {
    clearSwapAnimation();
    room = next.code;
    try { seen = new Set(JSON.parse(sessionStorage.getItem(`cambio-movements-${room}`) || "[]")); }
    catch { seen = new Set(); }
  }
  const events = next.movements || [];
  const fresh = events.filter((event) => !seen.has(event.id) && next.serverNow - event.at < 15000 &&
    (previous || (event.kind === "deal" && next.phase === "initial")));
  for (const event of events) seen.add(event.id);
  seen = new Set([...seen].slice(-64));
  try { sessionStorage.setItem(`cambio-movements-${room}`, JSON.stringify([...seen])); } catch { /* Optional replay protection. */ }
  const before = new Map([...document.querySelectorAll(".cards .card")].map((card) => [card.dataset.card, rect(card)]));
  return fresh.map((event, index) => ({ event,
    from: event.moves.map((move) => position(move.from)),
    before: index === fresh.length - 1 ? before : new Map(),
  }));
}
function masks() {
  document.querySelectorAll(".swap-in-flight, .swap-target").forEach((card) => card.classList.remove("swap-in-flight", "swap-target"));
  // Keep the final snapshot from visually teleporting cards ahead of queued flights.
  for (const job of [...(playing ? [playing] : []), ...queue]) {
    for (const move of job.event.moves) {
      if (move.to.zone !== "deck") elementAt(move.to)?.classList.add("swap-in-flight");
    }
  }
  for (const id of playing?.reflow || []) document.querySelector(`[data-card="${CSS.escape(id)}"]`)?.classList.add("swap-in-flight");
  const event = playing?.event || (Date.now() < noticeUntil ? notice : null);
  for (const move of event?.moves || []) if (move.to.zone === "hand") handCard(move.to)?.classList.add("swap-target");
}
export function syncSwapTargets(view, time) {
  currentView = view;
  masks();
  const element = document.querySelector("#movement-note");
  if (!element || !view) return;
  const last = view.movements?.at(-1);
  const event = playing?.event || (Date.now() < noticeUntil ? notice : null) || (last && time - last.at < SWAP_NOTE_MS ? last : null);
  element.hidden = !event;
  element.textContent = event ? swapLabel(event, view.me) : "";
  element.dataset.swapId = event?.id || "";
  element.dataset.kind = event?.kind || "";
  element.dataset.source = event?.source || "face-down";
}
export function clearSwapAnimation() {
  clearTimeout(timer);
  playing?.overlay?.remove();
  queue = []; playing = null; notice = null; noticeUntil = 0;
  document.querySelectorAll(".swap-in-flight, .swap-target").forEach((card) => card.classList.remove("swap-in-flight", "swap-target"));
}
function pump() {
  if (playing || !queue.length) return;
  const job = queue.shift(), event = job.event;
  notice = event; noticeUntil = Date.now() + 3200;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    syncSwapTargets(currentView, currentView?.serverNow || Date.now());
    pump();
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "swap-overlay";
  overlay.dataset.swapId = event.id;
  overlay.dataset.kind = event.kind;
  overlay.style.height = `${document.documentElement.scrollHeight}px`;
  overlay.setAttribute("aria-hidden", "true");
  document.body.append(overlay);
  playing = { ...job, overlay, reflow: [] };
  const duration = ["draw-swap", "blind-swap"].includes(event.kind) ? 700 : 430;
  let total = duration;
  const back = '<span class="card back"><span class="back-mark">♠</span></span>';
  const fly = (from, to, face, arc = 24, delay = 0, reflow = false) => {
    if (!from || !to) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = face ? renderCard(face) : back;
    const card = wrapper.firstElementChild;
    card.classList.add("swap-flight");
    if (reflow) card.dataset.reflow = "true";
    Object.assign(card.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
    overlay.append(card);
    const x = to.left - from.left, y = to.top - from.top, distance = Math.hypot(x, y) || 1;
    card.animate([
      { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
      { transform: `translate(${x / 2 - y / distance * arc}px,${y / 2 + x / distance * arc}px) rotate(${arc > 0 ? 6 : -6}deg)`, opacity: 1, offset: .5 },
      { transform: `translate(${x}px,${y}px) rotate(0deg)`, opacity: 1, offset: .94 },
      { transform: `translate(${x}px,${y}px) rotate(0deg)`, opacity: 0 },
    ], { duration, delay, easing: "cubic-bezier(.22,.65,.3,1)", fill: "both" });
    total = Math.max(total, duration + delay);
  };
  const affected = new Set(event.moves.flatMap((move) => [move.from.card, move.to.card]));
  event.moves.forEach((move, index) => fly(job.from[index] || position(move.from), position(move.to), move.face,
    event.kind === "blind-swap" ? 30 : index % 2 ? -24 : 24,
    event.kind === "deal" ? index * 65 : event.kind === "recycle" ? index * 10 : 0));
  for (const [id, from] of job.before) {
    if (affected.has(id)) continue;
    const element = document.querySelector(`[data-card="${CSS.escape(id)}"]`), to = rect(element);
    if (to && Math.hypot(to.left - from.left, to.top - from.top) > 2) {
      playing.reflow.push(id);
      fly(from, to, null, 0, 0, true);
    }
  }
  syncSwapTargets(currentView, currentView?.serverNow || Date.now());
  timer = setTimeout(() => {
    overlay.remove(); playing = null;
    syncSwapTargets(currentView, currentView?.serverNow || Date.now());
    pump();
  }, total);
}
export function playSwap(jobs, publicCard, time) {
  renderCard = publicCard;
  queue.push(...(jobs || []));
  pump();
  syncSwapTargets(currentView, time);
}
