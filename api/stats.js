// Vercel Serverless Function — returns aggregate scan stats from Upstash Redis.
// Reads only keys under the "nq:" namespace, so it ignores the other apps sharing
// this database.
//
// The dashboard is yours, not the neighbourhood's: this needs ?code=<setup code>, so
// the URL on its own gives a stranger nothing. Set ADMIN_CODE in Vercel to change it
// from the built-in 8979.
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const P = "nq:";
const ADMIN_CODE = process.env.ADMIN_CODE || "8979";

export default async function handler(req, res) {
  const code = ((req.query && req.query.code) || "").toString();
  if (code !== ADMIN_CODE) { res.status(403).json({ error: "Wrong setup code." }); return; }
  if (!redis) { res.status(200).json({ connected: false }); return; }
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [total, completions, todayN, uniq, byStop, missingByStop, mascots, recentRaw, profilesRaw] = await Promise.all([
      redis.get(P + "scans:total"),
      redis.get(P + "completions"),
      redis.get(P + "scans:day:" + today),
      redis.scard(P + "sessions"),
      redis.hgetall(P + "scans:byStop"),
      redis.hgetall(P + "missing:byStop"),
      redis.hgetall(P + "mascots"),
      redis.lrange(P + "recent", 0, 49),
      redis.hgetall(P + "profiles"),
    ]);

    const players = Object.values(profilesRaw || {})
      .map((v) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } })
      .filter((p) => p && p.id)
      .map((p) => ({
        id: p.id, name: p.name || "", mascot: p.mascot || "",
        found: Array.isArray(p.visited) ? p.visited.length : 0,
        // which sticker codes, so the dashboard can say WHICH parks they've been round
        codes: Array.isArray(p.visited) ? p.visited.filter((v) => typeof v === "string") : [],
        prize: p.prize || "", updated: p.updated || 0,
      }))
      .sort((a, b) => (b.updated || 0) - (a.updated || 0));

    // Union of both hashes: a stop can be reported missing without ever being scanned
    // (a report from off-site isn't a find), and it still needs to show up here.
    const miss = missingByStop || {};
    const scanned = byStop || {};
    const perStop = [...new Set([...Object.keys(scanned), ...Object.keys(miss)])]
      .map((stop_id) => ({ stop_id: +stop_id, n: +(scanned[stop_id] || 0), missing: +(miss[stop_id] || 0) }))
      .sort((a, b) => a.stop_id - b.stop_id);
    const mascotArr = Object.entries(mascots || {})
      .map(([mascot, n]) => ({ mascot, n: +n }))
      .sort((a, b) => b.n - a.n);
    // "Opened the app" is not activity — it is the app booting. Every phone that still
    // has the hunt on its home screen fires one, so left in they bury the actual finds
    // (and put whoever just glanced at it back on top of the list). Dropped here as well
    // as at the source, so the ones already logged disappear too.
    //
    // ts stays a NUMBER all the way to the browser: scan.js stores Date.now(), and
    // handing the dashboard an ISO string instead made its "3m ago" arithmetic NaN.
    const recent = (recentRaw || [])
      .map((r) => { try { return typeof r === "string" ? JSON.parse(r) : r; } catch { return null; } })
      .filter((r) => r && r.event !== "home")
      .slice(0, 25)
      .map((r) => ({ ts: Number(r.ts) || Date.parse(r.ts) || 0, stop_id: r.stop, event: r.event, mascot: r.mascot }));

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      connected: true,
      scans: Number(total || 0),
      uniqueVisitors: Number(uniq || 0),
      completions: Number(completions || 0),
      today: Number(todayN || 0),
      playerCount: players.length,
      perStop, mascots: mascotArr, recent, players,
    });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
