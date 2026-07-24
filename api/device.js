// Vercel Serverless Function — stores/deletes a per-DEVICE record in Upstash Redis.
//
// The device id is the client's anonymous session id (nq_sid in localStorage), used
// as the primary key. We keep the child's name, chosen guide, and stamps so their
// profile is on record. All keys stay under the shared "nq:" namespace.
//
//   POST { session, name, mascot, visited }  -> upsert nq:device:<session>
//   POST { session, action:"delete" }        -> remove the device's data entirely
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const P = "nq:";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST" }); return; }
  if (!redis) { res.status(200).json({ ok: false, note: "No database connected yet." }); return; }
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const session = (b.session || "").toString().slice(0, 60);
    if (!session) { res.status(400).json({ error: "missing session" }); return; }
    const key = P + "device:" + session;

    if (b.action === "delete") {
      const p = redis.pipeline();
      p.del(key);                         // their name / guide / stamps
      p.srem(P + "devices", session);     // the device registry
      p.srem(P + "sessions", session);    // the unique-visitors set
      await p.exec();
      res.status(200).json({ ok: true, deleted: true });
      return;
    }

    const name = (b.name || "").toString().slice(0, 40);
    const mascot = (b.mascot || "").toString().slice(0, 20);
    const visited = Array.isArray(b.visited)
      ? b.visited.filter((n) => Number.isInteger(n)).slice(0, 50)
      : [];
    const now = Date.now();

    const p = redis.pipeline();
    p.hset(key, { id: session, name, mascot, visited: JSON.stringify(visited), updated: now });
    p.hsetnx(key, "created", now);        // set once, on first sight
    p.sadd(P + "devices", session);
    await p.exec();

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
