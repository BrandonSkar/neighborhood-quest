// DANGER: deletes ALL "nq:*" keys (scans, sessions, profiles, everything) so the
// Neighborhood Quest data starts clean. It ONLY touches nq:* — becu:* and sparkle:*
// are left alone. Use before launch, or to wipe stats between seasons.
//
// Run it (the Daily Learning Game folder already has @upstash/redis installed, or
// `npm i @upstash/redis` in any folder):
//
//   PowerShell:
//     $env:NQ_URL="https://<main-db>.upstash.io"     # REST URL of main-db
//     $env:NQ_TOKEN="<main-db REST token>"
//     node reset-nq.mjs
import { Redis } from "@upstash/redis";

const url = process.env.NQ_URL || process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.NQ_TOKEN || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) { console.error("Set NQ_URL and NQ_TOKEN (the main-db REST url + token)."); process.exit(1); }

// nq:config holds the hider's PUBLISHED cards (names + exact GPS pins). Wiping it
// would silently revert every phone to the built-in default stops, so it's kept by
// default. Pass --with-config to blow that away too and start from scratch.
const keepConfig = !process.argv.includes("--with-config");

const redis = new Redis({ url, token });
let cursor = "0", total = 0, kept = 0;
try {
  do {
    const [next, batch] = await redis.scan(cursor, { match: "nq:*", count: 200 });
    cursor = next;
    const doomed = keepConfig ? batch.filter((k) => k !== "nq:config") : batch;
    kept += batch.length - doomed.length;
    if (doomed.length) {
      await redis.del(...doomed);
      total += doomed.length;
      doomed.forEach((k) => console.log("deleted", k));
    }
  } while (cursor !== "0");
  console.log(`\nDone. Deleted ${total} nq:* key(s). becu:* and sparkle:* untouched.`);
  if (kept) console.log("Kept nq:config (your published cards). Use --with-config to delete it too.");
} catch (e) {
  console.error("Error:", e);
  process.exit(1);
}
