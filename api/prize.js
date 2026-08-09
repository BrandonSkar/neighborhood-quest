// Vercel Serverless Function — the real-world prize a child unlocks by finding stops.
//
//   GET                           -> { enabled, need, prizes:[{id,label}], place:{text,img}, updated }
//   GET ?img=<id>                 -> that picture as bytes (immutable: safe to cache forever)
//   POST { code, config }         -> save the prize setup
//   POST { code, img:{id,data} }  -> save ONE picture
//   POST { code, drop:"<id>" }    -> delete a picture
//
// Pictures are shrunk to ~900 px JPEG in the browser before they ever get here, so each
// one is tens of kilobytes. They're stored one-per-key (`nq:prizeimg:<id>`) and uploaded
// one-per-request, so no single write has to carry all five — Upstash caps request size,
// and a phone on park wifi is not the place to find that out.
//
// The metadata blob holds no image data, so the kids' app can read it on every open for
// almost nothing and only pull the pictures when a prize is actually in reach.
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const PRIZE = "nq:prize";
const IMG = "nq:prizeimg:";
const SETUP_CODE = process.env.ADMIN_CODE || "8979";

const MAX_IMG = 1_200_000;                 // ~1.2 MB of data URI, generous for a 900px JPEG
const okId = (v) => /^[a-z0-9]{4,20}$/.test((v || "").toString());

const EMPTY = { enabled: false, need: 4, prizes: [], place: { text: "", img: "" }, updated: 0 };

function sanitize(c) {
  if (!c || typeof c !== "object") return { ...EMPTY };
  const prizes = (Array.isArray(c.prizes) ? c.prizes : [])
    .filter((p) => p && okId(p.id))
    .slice(0, 6)
    .map((p) => ({ id: p.id.toString(), label: (p.label || "").toString().slice(0, 40).trim() }));
  const placeImg = c.place && okId(c.place.img) ? c.place.img.toString() : "";
  return {
    enabled: !!c.enabled,
    // how many treasures before the prize appears; 1..40
    need: Math.max(1, Math.min(40, Math.round(Number(c.need) || 4))),
    prizes,
    place: { text: ((c.place && c.place.text) || "").toString().slice(0, 300).trim(), img: placeImg },
    updated: Date.now(),
  };
}

export default async function handler(req, res) {
  if (!redis) {
    if (req.method === "GET") { res.status(200).json({ ...EMPTY, note: "No database connected yet." }); return; }
    res.status(200).json({ ok: false, note: "No database connected yet." });
    return;
  }
  try {
    if (req.method === "GET") {
      const want = ((req.query && req.query.img) || "").toString();
      if (want) {
        if (!okId(want)) { res.status(400).json({ error: "bad id" }); return; }
        const raw = await redis.get(IMG + want);
        if (!raw) { res.status(404).json({ error: "no such picture" }); return; }
        const m = /^data:([a-z/+.-]+);base64,(.+)$/i.exec(raw.toString());
        if (!m) { res.status(500).json({ error: "picture is corrupt" }); return; }
        // the id changes whenever a new picture is uploaded, so this can cache forever
        res.setHeader("Content-Type", m[1]);
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.status(200).send(Buffer.from(m[2], "base64"));
        return;
      }
      const cfg = await redis.get(PRIZE);
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(cfg || EMPTY);
      return;
    }

    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if ((b.code || "").toString() !== SETUP_CODE) { res.status(403).json({ error: "Wrong setup code." }); return; }

      if (b.img) {
        const id = (b.img.id || "").toString();
        const data = (b.img.data || "").toString();
        if (!okId(id)) { res.status(400).json({ error: "bad picture id" }); return; }
        if (!/^data:image\/(jpeg|png|webp);base64,/.test(data)) { res.status(400).json({ error: "That isn't a picture we can store." }); return; }
        if (data.length > MAX_IMG) { res.status(413).json({ error: "That picture is too big even after shrinking." }); return; }
        await redis.set(IMG + id, data);
        res.status(200).json({ ok: true, id, bytes: data.length });
        return;
      }

      if (b.drop) {
        const id = (b.drop || "").toString();
        if (!okId(id)) { res.status(400).json({ error: "bad picture id" }); return; }
        await redis.del(IMG + id);
        res.status(200).json({ ok: true, dropped: id });
        return;
      }

      const cfg = sanitize(b.config);
      await redis.set(PRIZE, cfg);
      res.status(200).json({ ok: true, config: cfg });
      return;
    }

    res.status(405).json({ error: "Use GET or POST" });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
