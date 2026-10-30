import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("real PostgreSQL migration: RLS isolation, denied writes/RPC, atomic version and receipt updates", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      create publication supabase_realtime;`);
    const migration = await readFile(
      new URL(
        "../supabase/migrations/20261030195519_cambio.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(migration);
    const a = crypto.randomUUID(),
      b = crypto.randomUUID(),
      eve = crypto.randomUUID();
    for (const uid of [a, b, eve])
      await db.query("insert into auth.users values($1)", [uid]);
    const code = "ABCDEFGHJK";
    await db.query("select public.cambio_create($1,$2,$3,$4,$5)", [
      code,
      a,
      "create-request-0001",
      JSON.stringify({ players: [a] }),
      JSON.stringify({ version: 1, secret: "alice-only" }),
    ]);
    await db.query(
      "insert into public.cambio_views(room_code,user_id,payload) values($1,$2,$3)",
      [code, b, JSON.stringify({ secret: "bob-only" })],
    );
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${a}';`);
    const alice = await db.query("select payload from public.cambio_views");
    assert.equal(alice.rows.length, 1);
    assert.equal(alice.rows[0].payload.secret, "alice-only");
    await assert.rejects(
      db.query("select state from public.cambio_rooms"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("update public.cambio_views set payload='{}'"),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        "select public.cambio_commit('ABCDEFGHJK',1,'{}',$1,'cheat-request-0001','[]')",
        [a],
      ),
      /permission denied/,
    );
    await db.exec(`set request.jwt.claim.sub='${b}';`);
    assert.equal(
      (await db.query("select payload from public.cambio_views")).rows[0]
        .payload.secret,
      "bob-only",
    );
    await db.exec(`set request.jwt.claim.sub='${eve}';`);
    assert.equal(
      (await db.query("select * from public.cambio_views")).rows.length,
      0,
    );
    await db.exec("reset role; set role service_role;");
    const args = [
      code,
      1,
      JSON.stringify({ players: [a, b], phase: "turn" }),
      a,
      "move-request-0001",
      JSON.stringify([
        { uid: a, payload: { version: 2 } },
        { uid: b, payload: { version: 2 } },
      ]),
    ];
    const commit = await db.query(
      "select public.cambio_commit($1,$2,$3,$4,$5,$6) as result",
      args,
    );
    assert.equal(commit.rows[0].result, "ok");
    assert.equal(
      (
        await db.query(
          "select public.cambio_commit($1,$2,$3,$4,$5,$6) as result",
          args,
        )
      ).rows[0].result,
      "duplicate",
    );
    args[4] = "move-request-0002";
    assert.equal(
      (
        await db.query(
          "select public.cambio_commit($1,$2,$3,$4,$5,$6) as result",
          args,
        )
      ).rows[0].result,
      "conflict",
    );
    assert.equal(
      (await db.query("select count(*)::int as n from public.cambio_receipts"))
        .rows[0].n,
      1,
    );
    assert.ok(
      (await db.query("select payload from public.cambio_views")).rows.every(
        (r) => r.payload.version === 2,
      ),
    );
    assert.equal(
      (await db.query("select public.cambio_rate($1,'join',1,1) as ok", [a]))
        .rows[0].ok,
      true,
    );
    assert.equal(
      (await db.query("select public.cambio_rate($1,'join',1,1) as ok", [a]))
        .rows[0].ok,
      false,
    );
    await db.exec("reset role;");
    await db.query(
      "update public.cambio_views set expires_at=now()-interval '1 second'",
    );
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${a}';`);
    assert.equal(
      (await db.query("select * from public.cambio_views")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
