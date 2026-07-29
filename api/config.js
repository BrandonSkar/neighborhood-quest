// Vercel Serverless Function — the hider's published cards (the neighborhood setup).
//
//   GET                                   -> { season, stops, updated }  (stops:null before first publish)
//   POST { code:"8979", stops, newHunt }  -> saves the cards, returns the new season
//
// Storage is ONE key `nq:config` in Upstash Redis (a JSON blob), under the shared
// "nq:" namespace so it sits alongside the scan/profile keys without collisions.
//
// `stops` is the lean editor shape: { name, emoji, code, ll:[lat,lng], park, quiz }. The
// front-end (data.js -> nqNormalizeStop) fleshes each one out with a generic kid
// mission. Publishing bumps the season by default so every player's stamps reset for
// the new hunt; send newHunt:false to just fix a pin without resetting anyone.
//
// A stop may be a blank placeholder — a printed sticker's code with no name or pin yet.
// Those are stored as-is and hidden from the game until they're given a spot.
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const CONFIG = "nq:config";
// Gate for publishing. Set ADMIN_CODE in Vercel to use a private one instead.
const SETUP_CODE = process.env.ADMIN_CODE || "8979";

// One question, up to three answers, one right. Half-filled means no quiz.
function sanitizeQuiz(q) {
  if (!q || typeof q !== "object") return null;
  const question = (q.q || "").toString().slice(0, 140).trim();
  const choices = (Array.isArray(q.choices) ? q.choices : [])
    .map((c) => (c || "").toString().slice(0, 60).trim())
    .filter(Boolean)
    .slice(0, 3);
  if (!question || choices.length < 2) return null;
  const correct = Number.isInteger(q.correct) && q.correct >= 0 && q.correct < choices.length ? q.correct : 0;
  return { q: question, choices, correct };
}

function sanitizeStops(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice(0, 40)
    .map((s) => {
      const ll =
        Array.isArray(s.ll) && s.ll.length === 2 && s.ll.every((n) => typeof n === "number" && isFinite(n))
          ? [s.ll[0], s.ll[1]]
          : null;
      const code = /^[a-f0-9]{4,12}$/i.test((s.code || "").toString())
        ? s.code.toString()
        : Math.random().toString(16).slice(2, 8);
      return {
        name: (s.name || "").toString().slice(0, 60),
        emoji: (s.emoji || "📍").toString().slice(0, 8),
        code,
        ll,
        park: !!s.park,
        quiz: sanitizeQuiz(s.quiz),
      };
    });
  // Cards with no name or pin are KEPT. A freshly printed sticker is a real card with
  // nothing but a code, and that code has to survive until you're standing at the spot
  // you want it at — possibly on a different device from the one that printed it. The
  // game filters these out (data.js) so kids only ever see stops that exist.
}

export default async function handler(req, res) {
  if (!redis) {
    // No DB yet: GET returns "no cards" so the app uses its built-in defaults.
    if (req.method === "GET") { res.status(200).json({ season: 1, stops: null, note: "No database connected yet." }); return; }
    res.status(200).json({ ok: false, note: "No database connected yet." });
    return;
  }
  try {
    if (req.method === "GET") {
      const cfg = await redis.get(CONFIG);
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(cfg || { season: 1, stops: null });
      return;
    }

    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if ((b.code || "").toString() !== SETUP_CODE) { res.status(403).json({ error: "Wrong setup code." }); return; }

      const stops = sanitizeStops(b.stops);
      if (!stops.length) { res.status(400).json({ error: "Add at least one card first." }); return; }

      const prev = (await redis.get(CONFIG)) || { season: 1 };
      const bumpSeason = b.newHunt !== false; // default: start a fresh hunt (resets stamps)
      const season = bumpSeason ? ((Number.isInteger(prev.season) ? prev.season : 1) + 1) : (prev.season || 1);

      const cfg = { season, stops, updated: Date.now() };
      await redis.set(CONFIG, cfg);
      res.status(200).json({ ok: true, season, count: stops.length, newHunt: bumpSeason });
      return;
    }

    res.status(405).json({ error: "Use GET or POST" });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
