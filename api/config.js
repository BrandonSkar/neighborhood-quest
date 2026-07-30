// Vercel Serverless Function — the hider's published cards (the neighborhood setup).
//
//   GET                                   -> { season, stops, updated }  (stops:null before first publish)
//   GET ?code=8979&printed=1              -> the above + { printed:[codes ever printed] }
//   POST { code:"8979", stops, newHunt }  -> saves the cards, returns the new season
//   POST { code:"8979", print:9 }         -> mints 9 unused sticker codes for a print sheet
//
// Storage is ONE key `nq:config` in Upstash Redis (a JSON blob), under the shared
// "nq:" namespace so it sits alongside the scan/profile keys without collisions.
//
// `stops` is the lean editor shape: { name, emoji, code, ll:[lat,lng], park, quiz }. The
// front-end (data.js -> nqNormalizeStop) fleshes each one out with a generic kid
// mission. Publishing bumps the season by default so every player's stamps reset for
// the new hunt; send newHunt:false to just fix a pin without resetting anyone.
//
// A sticker exists as a CODE before it exists as a card: you print a sheet of blank
// stickers, then add the card once you've taped one somewhere you like. `nq:printed`
// remembers every code ever printed so a later sheet can never repeat one — a duplicate
// would send two different spots to the same stop.
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const CONFIG = "nq:config";
const PRINTED = "nq:printed";
// Gate for publishing. Set ADMIN_CODE in Vercel to use a private one instead.
const SETUP_CODE = process.env.ADMIN_CODE || "8979";

const HEX = "0123456789abcdef";
// Six hex characters, drawn one at a time. (`Math.random().toString(16).slice(2,8)`
// looks like the same thing but quietly returns a SHORT code now and then, e.g. 0.5.)
function randCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += HEX[Math.floor(Math.random() * 16)];
  return s;
}

// Hand out `n` codes that no card and no earlier sheet is already using, and remember
// them. A code is burned the moment it's printed, whether or not that sticker is ever
// taped to anything — paper is cheap, a clash in the field is not.
async function mintCodes(n) {
  const used = new Set();
  const cfg = await redis.get(CONFIG);
  if (cfg && Array.isArray(cfg.stops)) for (const s of cfg.stops) if (s && s.code) used.add(String(s.code).toLowerCase());
  try {
    const seen = await redis.smembers(PRINTED);
    if (Array.isArray(seen)) for (const c of seen) used.add(String(c).toLowerCase());
  } catch { /* set not created yet */ }

  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 200) {
    const c = randCode();
    if (used.has(c)) continue;
    used.add(c);
    out.push(c);
  }
  if (out.length) await redis.sadd(PRINTED, ...out);
  return out;
}

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
        ? s.code.toString().toLowerCase()
        : randCode();
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
      const out = cfg || { season: 1, stops: null };
      // The list of printed codes is for the hider's eyes only (it's how setup spots a
      // typo), so it rides along only when the setup code is on the URL.
      if (req.query && req.query.printed && (req.query.code || "") === SETUP_CODE) {
        let printed = [];
        try { printed = (await redis.smembers(PRINTED)) || []; } catch {}
        res.status(200).json({ ...out, printed });
        return;
      }
      res.status(200).json(out);
      return;
    }

    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if ((b.code || "").toString() !== SETUP_CODE) { res.status(403).json({ error: "Wrong setup code." }); return; }

      // A print run: no cards change hands, we just reserve codes for the paper.
      if (b.print !== undefined) {
        const n = Math.max(1, Math.min(24, Math.round(Number(b.print) || 0)));
        const codes = await mintCodes(n);
        if (!codes.length) { res.status(500).json({ error: "Couldn't mint any new codes — try again." }); return; }
        res.status(200).json({ ok: true, codes });
        return;
      }

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
