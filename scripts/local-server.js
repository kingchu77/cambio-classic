// Loopback-only, disposable test backend. Production uses Supabase Auth/RLS/RPC.
import http from "node:http";
import { createServer as createViteServer } from "vite";
import {
  handle,
  MemoryRepository,
} from "../supabase/functions/_shared/service.js";
import { view, RuleError } from "../supabase/functions/_shared/engine.js";

process.env.VITE_LOCAL_API = "http://127.0.0.1:8787";
const repo = new MemoryRepository(),
  streams = new Set();
const headers = {
  "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const validToken = (t) => typeof t === "string" && /^[a-f0-9-]{36}$/.test(t);
const api = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:8787");
  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/events") {
    const code = url.searchParams.get("code"),
      uid = url.searchParams.get("token");
    const row = await repo.load(code);
    if (!validToken(uid) || !row?.state.players.includes(uid)) {
      res.writeHead(403, headers);
      res.end();
      return;
    }
    res.writeHead(200, {
      ...headers,
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
    });
    const stream = { res, code, uid };
    streams.add(stream);
    res.write(
      `data: ${JSON.stringify(view(row.state, uid, row.version, code))}\n\n`,
    );
    const timer = setInterval(() => res.write(": heartbeat\n\n"), 15000);
    req.on("close", () => {
      streams.delete(stream);
      clearInterval(timer);
    });
    return;
  }
  if (req.method !== "POST" || url.pathname !== "/game") {
    res.writeHead(404, headers);
    res.end();
    return;
  }
  try {
    const uid = req.headers.authorization?.replace(/^Bearer /, "");
    if (!validToken(uid))
      throw new RuleError("AUTH", "Local test identity required.");
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 8192) throw new Error("Too large");
    }
    const result = await handle(repo, uid, JSON.parse(raw));
    res.writeHead(200, { ...headers, "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    const row = await repo.load(result.code);
    for (const stream of streams)
      if (stream.code === result.code && row.state.players.includes(stream.uid))
        stream.res.write(
          `data: ${JSON.stringify(view(row.state, stream.uid, row.version, row.code))}\n\n`,
        );
  } catch (e) {
    res.writeHead(e instanceof RuleError ? 409 : 500, {
      ...headers,
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify({ code: e.code || "SERVER", message: e.message }));
  }
});
api.listen(8787, "127.0.0.1");
const vite = await createViteServer();
await vite.listen();
vite.printUrls();
console.log(
  "Disposable test backend: http://127.0.0.1:8787 (no Supabase credentials needed)",
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    for (const s of streams) s.res.end();
    api.close();
    await vite.close();
    process.exit(0);
  });
