// Vercel Serverless Function — the "start over" button behind the setup code.
//
//   POST { code, keepCards:true }   -> wipes scans/players/alerts, KEEPS your cards,
//                                      and puts the hunt back to Season 1
//   POST { code, keepCards:false }  -> wipes those AND the published cards
//
// Only ever touches keys under the "nq:" prefix, so a shared Upstash database keeps
// its other apps (becu:*, sparkle:*) intact. There is no GET — you can't do this by
// pasting a URL in a browser.
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const P = "nq:";
const CONFIG = P + "config";
// Set ADMIN_CODE in Vercel to something only you know; 8979 is the built-in default.
const ADMIN_CODE = process.env.ADMIN_CODE || "8979";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST" }); return; }
  if (!redis) { res.status(200).json({ ok: false, note: "No database connected yet." }); return; }
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if ((b.code || "").toString() !== ADMIN_CODE) { res.status(403).json({ error: "Wrong setup code." }); return; }
    const keepCards = b.keepCards !== false;

    // Read the cards first so we can put them back with the season reset to 1.
    const cfg = keepCards ? await redis.get(CONFIG) : null;

    let cursor = "0", deleted = 0;
    do {
      const [next, batch] = await redis.scan(cursor, { match: P + "*", count: 200 });
      cursor = next;
      const doomed = keepCards ? batch.filter((k) => k !== CONFIG) : batch;
      if (doomed.length) { await redis.del(...doomed); deleted += doomed.length; }
    } while (cursor !== "0");

    // Back to Season 1. Every phone notices the season changed on its next open and
    // clears its own stamps, so nobody is left holding stamps from the test run.
    let season = 1;
    if (keepCards && cfg && Array.isArray(cfg.stops)) {
      await redis.set(CONFIG, { ...cfg, season: 1, updated: Date.now() });
    }

    res.status(200).json({ ok: true, deleted, keptCards: !!(keepCards && cfg), season });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
