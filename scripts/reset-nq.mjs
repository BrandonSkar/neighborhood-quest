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

const redis = new Redis({ url, token });
let cursor = "0", total = 0;
try {
  do {
    const [next, batch] = await redis.scan(cursor, { match: "nq:*", count: 200 });
    cursor = next;
    if (batch.length) {
      await redis.del(...batch);
      total += batch.length;
      batch.forEach((k) => console.log("deleted", k));
    }
  } while (cursor !== "0");
  console.log(`\nDone. Deleted ${total} nq:* key(s). becu:* and sparkle:* untouched.`);
} catch (e) {
  console.error("Error:", e);
  process.exit(1);
}
