// Vercel Serverless Function — the "start over" button behind the setup code.
//
//   POST { code, keepCards:true }   -> wipes scans/players/alerts, KEEPS your cards
//   POST { code, keepCards:false }  -> wipes those AND the published cards
//   POST { code, clearMissing:true} -> forgets missing-sticker reports, nothing else
//
// Only ever touches keys under the "nq:" prefix, so a shared Upstash database keeps
// its other apps (becu:*, sparkle:*) intact. There is no GET — you can't do this by
// pasting a URL in a browser.
//
// WHAT THIS CANNOT DO: reach the kids' phones. Their stamps live in their own browser
// storage and there are no seasons any more to invalidate them with, so this clears
// YOUR records — the dashboard, the tallies, the alert cooldowns — and nothing else. A
// child clears their own with "Delete my data" on the home screen.
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const P = "nq:";
const CONFIG = P + "config";
const RECENT = P + "recent";
const MISSING = P + "missing:byStop";
// Set ADMIN_CODE in Vercel to something only you know; 8979 is the built-in default.
const ADMIN_CODE = process.env.ADMIN_CODE || "8979";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST" }); return; }
  if (!redis) { res.status(200).json({ ok: false, note: "No database connected yet." }); return; }
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if ((b.code || "").toString() !== ADMIN_CODE) { res.status(403).json({ error: "Wrong setup code." }); return; }
    // ---- the small, surgical one ----
    // A tap on "Sticker Missing?" while testing leaves a permanent 🙈 against that stop
    // and a row on the activity feed, and there was no way to take one back short of
    // wiping everything. This clears the missing tally and drops those rows, and
    // touches nothing else.
    //
    // It does NOT un-find anything: a sticker_missing also stamped a real find at the
    // time, because the phone confirmed the child was standing there. That stays.
    if (b.clearMissing) {
      const rows = (await redis.lrange(RECENT, 0, -1)) || [];
      const keep = rows.filter((r) => {
        try {
          const o = typeof r === "string" ? JSON.parse(r) : r;
          return !o || (o.event !== "sticker_missing" && o.event !== "sticker_report");
        } catch { return true; }        // unreadable row: leave it alone rather than eat it
      });
      const pipe = redis.pipeline();
      pipe.del(MISSING);
      pipe.del(RECENT);
      // rpush in the order read, so the newest stays at index 0 the way lpush left it
      if (keep.length) pipe.rpush(RECENT, ...keep.map((r) => (typeof r === "string" ? r : JSON.stringify(r))));
      await pipe.exec();
      res.status(200).json({ ok: true, clearedMissing: true, removed: rows.length - keep.length, kept: keep.length });
      return;
    }

    const keepCards = b.keepCards !== false;

    // Read the cards first, so a scan that sweeps the whole namespace can put them back.
    const cfg = keepCards ? await redis.get(CONFIG) : null;

    let cursor = "0", deleted = 0;
    do {
      const [next, batch] = await redis.scan(cursor, { match: P + "*", count: 200 });
      cursor = next;
      // "keep my cards" keeps the whole SETUP: the published stops and the prize you
      // photographed. Only the players' side of the house gets cleared.
      const doomed = keepCards ? batch.filter((k) => k !== CONFIG && !k.startsWith(P + "prize")) : batch;
      if (doomed.length) { await redis.del(...doomed); deleted += doomed.length; }
    } while (cursor !== "0");

    if (keepCards && cfg && Array.isArray(cfg.stops)) {
      await redis.set(CONFIG, { ...cfg, updated: Date.now() });
    }

    res.status(200).json({ ok: true, deleted, keptCards: !!(keepCards && cfg) });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
