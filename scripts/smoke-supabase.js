// Run only against your configured project after deployment.
// Creates two anonymous test users and one room, which expires normally.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const url = process.env.VITE_SUPABASE_URL,
  key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key)
  throw new Error(
    "Set the two PUBLIC Supabase environment values before running this smoke test.",
  );
const clients = [0, 1].map(() =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
);
const sessions = [];
for (const client of clients) {
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  sessions.push(data.session);
}
async function call(p, body) {
  const res = await fetch(`${url}/functions/v1/game`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessions[p].access_token}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, requestId: crypto.randomUUID() }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${json.code}: ${json.message}`);
  return json;
}
const first = await call(0, { op: "create", target: 50 }),
  code = first.code;
await call(1, { op: "join", code });
for (let p = 0; p < 2; p++) {
  let v = await call(p, { op: "action", code, action: { type: "sync" } });
  for (const card of v.hands[p].slice(0, 2))
    v = await call(p, {
      op: "action",
      code,
      version: v.version,
      action: { type: "initial-peek", card: card.id },
    });
  assert.equal(v.hands[p].filter((c) => c.card).length, 2);
  const other = await call(1 - p, {
    op: "action",
    code,
    action: { type: "sync" },
  });
  assert.ok(other.hands[p].every((c) => !c.card));
  await call(p, {
    op: "action",
    code,
    version: v.version,
    action: { type: "ready" },
  });
}
for (let p = 0; p < 2; p++) {
  const own = await clients[p]
    .from("cambio_views")
    .select("*")
    .eq("room_code", code);
  if (own.error) throw own.error;
  assert.equal(own.data.length, 1);
  assert.equal(own.data[0].user_id, sessions[p].user.id);
  const secret = await clients[p]
    .from("cambio_rooms")
    .select("state")
    .eq("code", code);
  assert.ok(secret.error, "Secret table must deny client reads");
}
const before = await call(0, { op: "action", code, action: { type: "sync" } });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    channel.unsubscribe();
    reject(
      new Error("Realtime projection was not delivered within 20 seconds."),
    );
  }, 20000);
  const channel = clients[1]
    .channel(`smoke-${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "cambio_views",
        filter: `user_id=eq.${sessions[1].user.id}`,
      },
      (change) => {
        if (change.new.room_code === code && change.new.payload.drawn) {
          try {
            assert.ok(!change.new.payload.drawn.card);
            clearTimeout(timer);
            channel.unsubscribe();
            resolve();
          } catch (e) {
            clearTimeout(timer);
            reject(e);
          }
        }
      },
    )
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        try {
          const drawn = await call(0, {
            op: "action",
            code,
            version: before.version,
            action: { type: "draw", source: "deck" },
          });
          assert.ok(drawn.drawn.card);
        } catch (e) {
          clearTimeout(timer);
          channel.unsubscribe();
          reject(e);
        }
      }
      if (status === "CHANNEL_ERROR") {
        clearTimeout(timer);
        channel.unsubscribe();
        reject(new Error("Realtime subscription failed."));
      }
    });
});
for (const client of clients) await client.removeAllChannels();
console.log(
  `PASS: live anonymous Auth, Edge Function, room joins, private peeks/draw, PostgreSQL RLS, and Realtime. Test room: ${code}`,
);
console.log(
  "Two anonymous test users and the expiring test room remain in your project.",
);
