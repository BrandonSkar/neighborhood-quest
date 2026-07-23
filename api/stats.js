// Vercel Serverless Function — returns aggregate scan stats from Upstash Redis.
// Reads only keys under the "nq:" namespace, so it ignores the other apps sharing
// this database. Same JSON shape as before, so stats.html needs no changes.
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const P = "nq:";

export default async function handler(req, res) {
  if (!redis) { res.status(200).json({ connected: false }); return; }
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [total, completions, todayN, uniq, byStop, mascots, recentRaw] = await Promise.all([
      redis.get(P + "scans:total"),
      redis.get(P + "completions"),
      redis.get(P + "scans:day:" + today),
      redis.scard(P + "sessions"),
      redis.hgetall(P + "scans:byStop"),
      redis.hgetall(P + "mascots"),
      redis.lrange(P + "recent", 0, 24),
    ]);

    const perStop = Object.entries(byStop || {})
      .map(([stop_id, n]) => ({ stop_id: +stop_id, n: +n }))
      .sort((a, b) => a.stop_id - b.stop_id);
    const mascotArr = Object.entries(mascots || {})
      .map(([mascot, n]) => ({ mascot, n: +n }))
      .sort((a, b) => b.n - a.n);
    const recent = (recentRaw || [])
      .map((r) => { try { return typeof r === "string" ? JSON.parse(r) : r; } catch { return null; } })
      .filter(Boolean)
      .map((r) => ({ ts: new Date(r.ts).toISOString(), stop_id: r.stop, event: r.event, mascot: r.mascot }));

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      connected: true,
      scans: Number(total || 0),
      uniqueVisitors: Number(uniq || 0),
      completions: Number(completions || 0),
      today: Number(todayN || 0),
      perStop, mascots: mascotArr, recent,
    });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
