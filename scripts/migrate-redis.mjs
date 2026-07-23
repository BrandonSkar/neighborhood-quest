// One-off helper to COPY all keys from one Upstash Redis DB to another,
// optionally adding a prefix so the data stays separated in a shared database.
//
// Use it to move Sparkle Quest off its paid DB onto the shared free DB:
//
//   1) cd into an empty folder and run:  npm init -y && npm i ioredis
//   2) copy this file there
//   3) grab both connection strings (rediss://...) from Upstash console or the
//      Vercel project's env (REDIS_URL / KV_URL) for each database
//   4) run (PowerShell):
//        $env:SRC_URL="rediss://default:PW@old-host:port"
//        $env:DST_URL="rediss://default:PW@free-host:port"
//        $env:PREFIX="sq:"          # namespace for the app you're moving (or "" for none)
//        node migrate-redis.mjs
//
// It preserves value TYPE and TTL (uses DUMP/RESTORE), and never deletes the source,
// so it is safe to re-run. It only writes keys under PREFIX, so it won't touch the
// bank app's data already living in the destination.

import Redis from "ioredis";

const SRC = process.env.SRC_URL;
const DST = process.env.DST_URL;
const PREFIX = process.env.PREFIX || "";

if (!SRC || !DST) { console.error("Set SRC_URL and DST_URL env vars."); process.exit(1); }

const src = new Redis(SRC, { maxRetriesPerRequest: 3, tls: {} });
const dst = new Redis(DST, { maxRetriesPerRequest: 3, tls: {} });

let cursor = "0", copied = 0, skipped = 0;
try {
  do {
    const [next, keys] = await src.scan(cursor, "COUNT", 200);
    cursor = next;
    for (const key of keys) {
      const newKey = PREFIX + key;
      if (PREFIX && key.startsWith(PREFIX)) { skipped++; continue; } // already namespaced
      const ttl = await src.pttl(key);                 // ms remaining, -1 = no expiry
      const dump = await src.dumpBuffer(key);           // binary-safe serialization
      if (!dump) { skipped++; continue; }
      await dst.restore(newKey, ttl > 0 ? ttl : 0, dump, "REPLACE");
      copied++;
      if (copied % 100 === 0) console.log("…copied", copied);
    }
  } while (cursor !== "0");
  console.log(`Done. Copied ${copied} keys${PREFIX ? ` under "${PREFIX}"` : ""}, skipped ${skipped}.`);
} catch (e) {
  console.error("Migration error:", e);
} finally {
  src.disconnect(); dst.disconnect();
}
