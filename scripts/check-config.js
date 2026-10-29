const url = process.env.VITE_SUPABASE_URL,
  key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (
  !url ||
  !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) ||
  !key ||
  key.includes("REPLACE_ME")
) {
  console.error(
    "Set repository Actions variables VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.",
  );
  process.exit(1);
}
if (!key.startsWith("sb_publishable_")) {
  console.error(
    "Use a modern sb_publishable_ frontend key. A backend secret must never be bundled.",
  );
  process.exit(1);
}
if (process.env.VITE_LOCAL_API) {
  console.error("Unset VITE_LOCAL_API for production.");
  process.exit(1);
}
console.log("Public frontend configuration is present.");
