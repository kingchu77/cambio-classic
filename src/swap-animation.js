// Movement is public; these effects never receive a hidden card face.
const FLIGHT_MS = 1050;
export const SWAP_NOTE_MS = 6500;
let playing = null;
let highlightTimer;

const cardElement = (target) =>
  document.querySelector(
    `[data-owner="${target.owner}"][data-card="${CSS.escape(target.card)}"]`,
  );
const rect = (element) => {
  if (!element) return;
  const box = element.getBoundingClientRect();
  // Anchor flights to the table, including when mobile scroll anchoring moves
  // the viewport as the drawn-card controls disappear.
  return { left: box.left + window.scrollX, top: box.top + window.scrollY, width: box.width, height: box.height };
};

export function swapLabel(motion, me) {
  const slot = (target) =>
    `${target.owner === me ? "Your" : "Partner’s"} card ${target.index + 1}`;
  return motion.kind === "blind-swap"
    ? `Face-down swap: ${slot(motion.targets[0])} ↔ ${slot(motion.targets[1])}`
    : `${motion.source === "deck" ? "Draw pile" : "Discard pile"} → ${slot(motion.targets[0])} · Replaced card → discard`;
}

export function captureSwap(previous, next) {
  const motion = next.motion;
  // Reconnects do not replay old swaps; repeated polls share the same motion ID.
  if (
    !previous || previous.code !== next.code || previous.round !== next.round ||
    !motion || motion.id === previous.motion?.id ||
    next.serverNow - motion.at > SWAP_NOTE_MS
  ) return null;
  return {
    motion,
    from: motion.targets.map((target) => rect(cardElement(target))),
    source: rect(document.querySelector(motion.source === "discard" ? "#take-discard .card" : "#deck")),
    discarded: next.discard,
  };
}

export function syncSwapTargets(motion, time) {
  document.querySelectorAll(".swap-target, .swap-in-flight").forEach((element) =>
    element.classList.remove("swap-target", "swap-in-flight"),
  );
  if (!motion || time - motion.at > 3200) return;
  for (const target of motion.targets) {
    const element = cardElement(target);
    element?.classList.add("swap-target");
    if (playing?.id === motion.id) element?.classList.add("swap-in-flight");
  }
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => syncSwapTargets(null, time), Math.max(0, 3200 - (time - motion.at)));
}

export function clearSwapAnimation() {
  playing?.overlay.remove();
  playing = null;
  clearTimeout(highlightTimer);
  document.querySelectorAll(".swap-in-flight, .swap-target").forEach((element) =>
    element.classList.remove("swap-in-flight", "swap-target"),
  );
}

export function playSwap(job, publicCard, time) {
  if (!job) return;
  clearSwapAnimation();
  const { motion } = job;
  syncSwapTargets(motion, time);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const destinations = motion.targets.map((target) => rect(cardElement(target)));
  if (destinations.some((destination) => !destination)) return;
  const overlay = document.createElement("div");
  overlay.className = "swap-overlay";
  overlay.dataset.swapId = motion.id;
  overlay.dataset.kind = motion.kind;
  overlay.style.height = `${document.documentElement.scrollHeight}px`;
  overlay.setAttribute("aria-hidden", "true");
  document.body.append(overlay);
  playing = { id: motion.id, overlay };
  syncSwapTargets(motion, time);

  const fly = (from, to, contents, arc) => {
    if (!from || !to) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = contents;
    const card = wrap.firstElementChild;
    card.classList.add("swap-flight");
    Object.assign(card.style, {
      left: `${from.left}px`, top: `${from.top}px`,
      width: `${from.width}px`, height: `${from.height}px`,
    });
    overlay.append(card);
    const x = to.left - from.left, y = to.top - from.top;
    const distance = Math.hypot(x, y) || 1;
    const midpointX = x / 2 - y / distance * arc;
    const midpointY = y / 2 + x / distance * arc;
    card.animate([
      { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
      { transform: `translate(${midpointX}px, ${midpointY}px) rotate(${arc > 0 ? 7 : -7}deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${x}px, ${y}px) rotate(0deg)`, opacity: 1, offset: 0.9 },
      { transform: `translate(${x}px, ${y}px) rotate(0deg)`, opacity: 0 },
    ], { duration: FLIGHT_MS, easing: "cubic-bezier(.22,.65,.3,1)", fill: "forwards" });
  };
  const back = '<span class="card back"><span class="back-mark">♠</span></span>';
  if (motion.kind === "blind-swap") {
    fly(job.from[0] || destinations[0], destinations[1], back, 32);
    fly(job.from[1] || destinations[1], destinations[0], back, 32);
  } else {
    fly(job.source, destinations[0], back, 26);
    // Only the card now publicly on the discard pile may be shown face up.
    fly(job.from[0] || destinations[0], rect(document.querySelector("#take-discard .card")), publicCard(job.discarded), -26);
  }
  setTimeout(() => {
    overlay.remove();
    if (playing?.id === motion.id) {
      playing = null;
      document.querySelectorAll(".swap-in-flight").forEach((element) => element.classList.remove("swap-in-flight"));
    }
  }, FLIGHT_MS);
}
