import { createClient } from "npm:@supabase/supabase-js@2.108.1";
import { handle } from "../_shared/service.js";
import { RuleError } from "../_shared/engine.js";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
function checked({ data, error }: { data: any; error: any }) {
  if (error) throw error;
  return data;
}
const repository = {
  async created(uid: string, id: string) {
    return checked(
      await admin
        .from("cambio_rooms")
        .select("*")
        .eq("creator", uid)
        .eq("create_request", id)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle(),
    );
  },
  async load(code: string) {
    return checked(
      await admin
        .from("cambio_rooms")
        .select("*")
        .eq("code", code)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle(),
    );
  },
  async create(r: any) {
    const code = checked(
      await admin.rpc("cambio_create", {
        p_code: r.code,
        p_uid: r.creator,
        p_request: r.requestId,
        p_state: r.state,
        p_view: r.views[0].payload,
      }),
    );
    return code ? this.load(code) : null;
  },
  async received(code: string, uid: string, id: string) {
    return !!checked(
      await admin
        .from("cambio_receipts")
        .select("request_id")
        .eq("room_code", code)
        .eq("user_id", uid)
        .eq("request_id", id)
        .maybeSingle(),
    );
  },
  async commit(c: any) {
    return checked(
      await admin.rpc("cambio_commit", {
        p_code: c.code,
        p_version: c.version,
        p_state: c.state,
        p_uid: c.uid,
        p_request: c.requestId,
        p_views: c.views,
      }),
    );
  },
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST")
    return new Response(
      JSON.stringify({ code: "METHOD", message: "POST required." }),
      { status: 405, headers },
    );
  try {
    const token = req.headers
      .get("Authorization")
      ?.match(/^Bearer (.+)$/i)?.[1];
    if (!token)
      return new Response(
        JSON.stringify({
          code: "AUTH",
          message: "Your session is missing. Reload to reconnect.",
        }),
        { status: 401, headers },
      );
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user)
      return new Response(
        JSON.stringify({
          code: "AUTH",
          message: "Your session expired. Reload to reconnect.",
        }),
        { status: 401, headers },
      );
    const raw = await req.text();
    if (raw.length > 8192) throw new RuleError("REQUEST", "Request too large.");
    const body = JSON.parse(raw),
      now = Date.now();
    const bucket =
      body.op === "create" ? "create" : body.op === "join" ? "join" : "action";
    const duration = bucket === "create" ? 3600000 : 60000;
    const allowed = checked(
      await admin.rpc("cambio_rate", {
        p_uid: data.user.id,
        p_bucket: bucket,
        p_window: Math.floor(now / duration),
        p_limit: bucket === "create" ? 5 : bucket === "join" ? 30 : 240,
      }),
    );
    if (!allowed)
      return new Response(
        JSON.stringify({
          code: "RATE",
          message: "Too many requests. Give the table a moment.",
        }),
        { status: 429, headers },
      );
    const result = await handle(repository, data.user.id, body);
    return new Response(JSON.stringify(result), { headers });
  } catch (e) {
    const known = e instanceof RuleError;
    if (!known)
      console.error(
        "game request failed",
        e instanceof Error ? e.message : "unknown",
      );
    return new Response(
      JSON.stringify({
        code: known ? e.code : "SERVER",
        message: known
          ? e.message
          : "Could not reach the table. Please try again.",
      }),
      { status: known ? 409 : 500, headers },
    );
  }
});
