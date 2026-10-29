import { createClient } from "@supabase/supabase-js";

const local = import.meta.env.VITE_LOCAL_API;
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured =
  !!local ||
  !!(
    url &&
    key &&
    !url.includes("YOUR_PROJECT") &&
    !key.includes("REPLACE_ME")
  );
export const isLocal = !!local;
let client, uid, token, channel;
export async function connect() {
  if (local) {
    token = localStorage.getItem("cambio-local-session") || crypto.randomUUID();
    localStorage.setItem("cambio-local-session", token);
    uid = token;
    return;
  }
  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  let session = data.session;
  if (!session) {
    const result = await client.auth.signInAnonymously();
    if (result.error) throw result.error;
    session = result.data.session;
  }
  uid = session.user.id;
}
export async function request(body) {
  let endpoint;
  if (local) endpoint = `${local}/game`;
  else {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session)
      throw new Error("Your session is missing. Reload to reconnect.");
    token = data.session.access_token;
    endpoint = `${url}/functions/v1/game`;
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(!local ? { apikey: key } : {}),
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    const e = new Error(result.message || "The table could not be reached.");
    e.code = result.code;
    throw e;
  }
  return result;
}
export function subscribe(code, onView, onConnection) {
  if (local) {
    const stream = new EventSource(
      `${local}/events?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`,
    );
    stream.onmessage = (e) => {
      onView(JSON.parse(e.data));
      onConnection(true);
    };
    stream.onopen = () => onConnection(true);
    stream.onerror = () => onConnection(false);
    return () => stream.close();
  }
  channel = client
    .channel(`table-${code}-${uid}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "cambio_views",
        filter: `user_id=eq.${uid}`,
      },
      (change) => {
        if (change.new.room_code === code) onView(change.new.payload);
      },
    )
    .subscribe((status) => onConnection(status === "SUBSCRIBED"));
  return () => {
    client.removeChannel(channel);
  };
}
