// Vercel Serverless Function — stores/deletes a per-DEVICE profile in Upstash Redis.
//
// Mirrors Sparkle Quest's layout: ONE hash `nq:profiles`, with one field per device
// (field = the device's anonymous id) and the value = a JSON blob of everything we
// keep for them (name, chosen guide, stamps, timestamps). All under the shared "nq:"
// namespace, so it sits alongside becu: / sparkle: without collisions.
//
//   POST { session, name, mascot, visited }  -> upsert nq:profiles[<session>]
//   POST { session, action:"delete" }        -> remove that device entirely
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const PROFILES = "nq:profiles";
const SESSIONS = "nq:sessions";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST" }); return; }
  if (!redis) { res.status(200).json({ ok: false, note: "No database connected yet." }); return; }
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const session = (b.session || "").toString().slice(0, 60);
    if (!session) { res.status(400).json({ error: "missing session" }); return; }

    if (b.action === "delete") {
      await redis.hdel(PROFILES, session);   // remove their JSON entry
      await redis.srem(SESSIONS, session);    // and drop them from unique-visitors
      res.status(200).json({ ok: true, deleted: true });
      return;
    }

    const name = (b.name || "").toString().slice(0, 40);
    const mascot = (b.mascot || "").toString().slice(0, 20);
    // Stamps are stop CODES (stable strings). Older clients sent numeric ids, so
    // both are accepted — a mixed record just reflects a device that hasn't
    // refreshed to the new front-end yet.
    const visited = Array.isArray(b.visited)
      ? b.visited
          .filter((v) => Number.isInteger(v) || (typeof v === "string" && /^[a-f0-9]{4,12}$/i.test(v)))
          .slice(0, 50)
      : [];
    const now = Date.now();

    // preserve the original "created" time if this device already has a record
    let created = now;
    try {
      const prev = await redis.hget(PROFILES, session);
      if (prev && typeof prev === "object" && prev.created) created = prev.created;
    } catch { /* ignore */ }

    // A prize under the retired photo-picker flow. New players never set this — their
    // prize is a real thing in a real box — but anyone mid-way through the old flow
    // keeps theirs rather than having it quietly dropped on the next sync.
    let prize = (b.prize || "").toString().slice(0, 40);
    if (!prize) { try { const p = await redis.hget(PROFILES, session); if (p && p.prize) prize = p.prize; } catch {} }

    const record = { id: session, name, mascot, visited, prize, created, updated: now };
    await redis.hset(PROFILES, { [session]: record }); // stored as one JSON value

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
