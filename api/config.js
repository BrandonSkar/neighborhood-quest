// Vercel Serverless Function — the hider's published cards (the neighborhood setup).
//
//   GET                                     -> { sections, stops, updated }  (stops:null before first publish)
//   POST { code:"8979", stops, sections }   -> saves the cards
//   POST { code:"8979", print:9 }           -> 9 sticker codes for a print sheet
//
// Storage is ONE key `nq:config` in Upstash Redis (a JSON blob), under the shared
// "nq:" namespace so it sits alongside the scan/profile keys without collisions.
//
// `stops` is the lean editor shape:
//   { name, emoji, code, ll:[lat,lng], park, section, role, hint, hintImg, quiz }
// and `sections` is [{ id, name, emoji }]. The front-end (data.js -> nqNormalizeStop)
// fleshes each card out with a generic kid mission.
//
// PUBLISHING NEVER RESETS ANYONE. There are no seasons: a stamp is keyed by the
// sticker's code, so adding a sticker to a park somebody already finished just puts one
// more pin on their map. Nothing already found is ever taken away.
//
// A sticker exists as a CODE before it exists as a card: you print a sheet of blank
// stickers, then add the card once you've taped one somewhere you like. What must never
// clash is the PUBLISHED set — two live cards on one code would send kids to one spot for
// both. Paper that's still blank doesn't matter, so a fresh sheet only dodges the codes
// that are actually on cards (and, obviously, itself).
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const CONFIG = "nq:config";
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

// Hand out `n` codes: none of them used by a published card, and none of them repeated
// on the sheet itself. Nothing is reserved — an unplaced sticker is just paper, and if a
// later sheet happens to reprint a code that was never published, no harm is done.
async function mintCodes(n) {
  const used = new Set();
  const cfg = await redis.get(CONFIG);
  if (cfg && Array.isArray(cfg.stops)) for (const s of cfg.stops) if (s && s.code) used.add(String(s.code).toLowerCase());

  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 200) {
    const c = randCode();
    if (used.has(c)) continue;
    used.add(c);
    out.push(c);
  }
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

// The areas a hunt is split into. An id is generated from the name if the editor didn't
// send one, so a section is addressable by something stable while it gets renamed.
const okSectionId = (v) => /^[a-z0-9][a-z0-9_-]{0,30}$/.test((v || "").toString());
function sanitizeSections(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const s of arr.slice(0, 12)) {
    if (!s || !okSectionId(s.id)) continue;
    const id = s.id.toString();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: (s.name || "").toString().slice(0, 40).trim() || "Somewhere fun",
      emoji: (s.emoji || "📍").toString().slice(0, 8),
    });
  }
  return out;
}

const ROLES = ["start", "stop", "chest"];
const okImgId = (v) => /^[a-z0-9]{4,20}$/.test((v || "").toString());

function sanitizeStops(arr, sections) {
  if (!Array.isArray(arr)) return [];
  const real = new Set((sections || []).map((s) => s.id));
  // One start and one chest per area. If the editor somehow sends two, the first wins
  // and the rest become plain stops — better a stop too many than an area that can
  // never be cleared because it's waiting on two different chests.
  const claimed = new Set();
  return arr
    .slice(0, 60)
    .map((s) => {
      const ll =
        Array.isArray(s.ll) && s.ll.length === 2 && s.ll.every((n) => typeof n === "number" && isFinite(n))
          ? [s.ll[0], s.ll[1]]
          : null;
      const code = /^[a-f0-9]{4,12}$/i.test((s.code || "").toString())
        ? s.code.toString().toLowerCase()
        : randCode();
      const section = real.has((s.section || "").toString()) ? s.section.toString() : null;
      let role = ROLES.includes(s.role) ? s.role : "stop";
      if (!section) role = "stop";                       // a loose card gates nothing
      if (role !== "stop") {
        const key = section + ":" + role;
        if (claimed.has(key)) role = "stop"; else claimed.add(key);
      }
      return {
        name: (s.name || "").toString().slice(0, 60),
        emoji: (s.emoji || "📍").toString().slice(0, 8),
        code,
        ll,
        park: !!s.park,
        section,
        role,
        // "behind the big tree" — the last ten metres a GPS pin can't manage
        hint: (s.hint || "").toString().slice(0, 200).trim(),
        hintImg: okImgId(s.hintImg) ? s.hintImg.toString() : "",
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
    if (req.method === "GET") { res.status(200).json({ sections: [], stops: null, note: "No database connected yet." }); return; }
    res.status(200).json({ ok: false, note: "No database connected yet." });
    return;
  }
  try {
    if (req.method === "GET") {
      const cfg = await redis.get(CONFIG);
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(cfg || { sections: [], stops: null });
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

      const sections = sanitizeSections(b.sections);
      const stops = sanitizeStops(b.stops, sections);
      if (!stops.length) { res.status(400).json({ error: "Add at least one card first." }); return; }

      const cfg = { sections, stops, updated: Date.now() };
      await redis.set(CONFIG, cfg);
      res.status(200).json({ ok: true, count: stops.length, areas: sections.length });
      return;
    }

    res.status(405).json({ error: "Use GET or POST" });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
