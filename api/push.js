// Vercel Serverless Function — which phones get the quest's alerts.
//
//   GET                                        -> { configured, publicKey }
//   GET ?code=8979                             -> ...plus { phones } (how many opted in)
//   POST { code, action:"subscribe",   sub }   -> this phone starts getting alerts
//   POST { code, action:"unsubscribe", endpoint } -> and stops
//
// To check it actually works, use the test button on setup-prize.html — that goes through
// /api/scan so it exercises every channel at once, not just this one.
//
// Subscribing is behind the setup code on purpose: alerts are for the grown-up who hid
// the stickers, not for whoever happens to open the game.
import { PUBLIC_KEY, pushReady, addPhone, dropPhone, countPhones } from "./_lib/push.js";

const SETUP_CODE = process.env.ADMIN_CODE || "8979";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      const out = { configured: pushReady(), publicKey: PUBLIC_KEY || null };
      if (((req.query && req.query.code) || "") === SETUP_CODE) out.phones = await countPhones();
      res.status(200).json(out);
      return;
    }
    if (req.method !== "POST") { res.status(405).json({ error: "Use GET or POST" }); return; }

    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if ((b.code || "").toString() !== SETUP_CODE) { res.status(403).json({ error: "Wrong setup code." }); return; }

    if (b.action === "subscribe") {
      if (!pushReady()) { res.status(200).json({ ok: false, error: "Alerts aren't set up on this project yet — see the README." }); return; }
      const ok = await addPhone(b.sub);
      if (!ok) { res.status(400).json({ error: "That doesn't look like a push subscription." }); return; }
      res.status(200).json({ ok: true, phones: await countPhones() });
      return;
    }
    if (b.action === "unsubscribe") {
      await dropPhone((b.endpoint || "").toString());
      res.status(200).json({ ok: true, phones: await countPhones() });
      return;
    }
    res.status(400).json({ error: "unknown action" });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
