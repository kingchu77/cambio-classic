import { apply, createRoom, view, RuleError } from "./engine.js";

export const validCode = (code) =>
  typeof code === "string" && /^[A-HJ-NP-Z2-9]{10}$/.test(code);
export function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    crypto.getRandomValues(new Uint8Array(10)),
    (n) => alphabet[n % 32],
  ).join("");
}
// Repository commits atomically compare versions, record request IDs, and update
// the two RLS-protected snapshots. A failed CAS is retried against fresh state.
export async function handle(repo, uid, body, clock = Date.now) {
  if (!body || typeof body !== "object")
    throw new RuleError("REQUEST", "Invalid request.");
  const { op, requestId } = body;
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId))
    throw new RuleError("REQUEST", "A unique request ID is required.");
  if (op === "create") {
    // A lost create response is safe to retry with the same identity/request ID.
    const prior = await repo.created(uid, requestId);
    if (prior)
      return view(prior.state, uid, prior.version, prior.code, clock());
    const state = createRoom(uid, body.target);
    for (let n = 0; n < 5; n++) {
      const code = roomCode(),
        now = clock();
      const row = await repo.create({
        code,
        state,
        creator: uid,
        requestId,
        now,
        views: [{ uid, payload: view(state, uid, 1, code, now) }],
      });
      if (row) return view(row.state, uid, row.version, row.code, clock());
    }
    throw new RuleError("RETRY", "Please try creating a table again.");
  }
  if (!validCode(body.code))
    throw new RuleError("CODE", "Enter the 10-character room code.");
  for (let attempt = 0; attempt < 10; attempt++) {
    const row = await repo.load(body.code);
    if (!row)
      throw new RuleError(
        "ROOM_MISSING",
        "This room does not exist or has expired.",
      );
    const now = clock();
    if (await repo.received(row.code, uid, requestId))
      return view(row.state, uid, row.version, row.code, now);
    const member = row.state.players.includes(uid);
    if (!member && op !== "join")
      throw new RuleError("NOT_MEMBER", "Join this room first.");
    const cmd = op === "join" ? { type: "join" } : body.action;
    if (op !== "join" && op !== "action")
      throw new RuleError("REQUEST", "Unknown request.");
    if (!cmd || typeof cmd.type !== "string")
      throw new RuleError("REQUEST", "Choose a game action.");
    // Snaps arbitrate against the current event, independently of unrelated peeks.
    // All ordinary turn actions must refer to the exact state the player saw.
    if (
      !["snap", "sync", "initial-peek", "ready", "next-round"].includes(
        cmd.type,
      ) &&
      op !== "join" &&
      body.version !== row.version
    )
      throw new RuleError(
        "STALE",
        "The table changed. Your view has been refreshed; try again.",
      );
    const next = apply(row.state, uid, cmd, now);
    if (JSON.stringify(next) === JSON.stringify(row.state))
      return view(next, uid, row.version, row.code, now);
    const views = next.players.map((id) => ({
      uid: id,
      payload: view(next, id, row.version + 1, row.code, now),
    }));
    const result = await repo.commit({
      code: row.code,
      version: row.version,
      state: next,
      uid,
      requestId,
      views,
      now,
    });
    if (result === "ok") return view(next, uid, row.version + 1, row.code, now);
    // Duplicate response must be projected from current state, never replayed secrets.
    if (result === "duplicate") {
      const current = await repo.load(row.code);
      return view(current.state, uid, current.version, row.code, clock());
    }
  }
  throw new RuleError("BUSY", "The table is busy. Please try again.");
}

export class MemoryRepository {
  constructor() {
    this.rooms = new Map();
    this.receipts = new Set();
  }
  async created(uid, id) {
    return structuredClone(
      [...this.rooms.values()].find(
        (r) => r.creator === uid && r.requestId === id,
      ) || null,
    );
  }
  async create(r) {
    const prior = await this.created(r.creator, r.requestId);
    if (prior) return prior;
    if (this.rooms.has(r.code)) return null;
    const row = { ...r, version: 1 };
    this.rooms.set(r.code, structuredClone(row));
    return row;
  }
  async load(code) {
    return structuredClone(this.rooms.get(code) || null);
  }
  async received(code, uid, id) {
    return this.receipts.has(`${code}:${uid}:${id}`);
  }
  async commit(c) {
    const key = `${c.code}:${c.uid}:${c.requestId}`;
    if (this.receipts.has(key)) return "duplicate";
    const row = this.rooms.get(c.code);
    if (row.version !== c.version) return "conflict";
    this.rooms.set(
      c.code,
      structuredClone({
        ...row,
        state: c.state,
        version: c.version + 1,
        views: c.views,
      }),
    );
    this.receipts.add(key);
    return "ok";
  }
}
