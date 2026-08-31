// Vercel Serverless Function — what the kids thought, for the hider's eyes only.
//
//   POST { session, name, vote, comment, code, stop, area }  -> store one answer
//   GET  ?code=<setup code>                                  -> read them back
//
// Asked once, right after a child opens a chest — the one moment they're definitely
// pleased and definitely standing still. A thumb, and anything they feel like typing.
//
// WHO CAN READ IT: only whoever knows the setup code. Reading needs ?code=, the same
// gate stats.js uses, so the URL on its own gives a stranger nothing. Nothing written
// here is ever shown to another player — that promise is made to the child in the app
// ("Only the person who hid the treasures will see this") and this endpoint is the
// whole of what keeps it.
//
// Stored under the shared "nq:" namespace as a capped list, newest first:
//   nq:feedback        the last 200 answers (JSON per entry)
//   nq:feedback:votes  a running 👍/👎 tally that survives the list rolling over
import { Redis } from "@upstash/redis";
import { notify } from "./_lib/notify.js";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const P = "nq:";
const LIST = P + "feedback";
const VOTES = P + "feedback:votes";
const KEEP = 200;                       // plenty for a neighborhood, and a bounded key
const ADMIN_CODE = process.env.ADMIN_CODE || "8979";

// One comment per device per hour. A child who enjoys the button shouldn't be able to
// fill the list — or the grown-up's lock screen — with two hundred entries.
const COOLDOWN_S = 60 * 60;

export default async function handler(req, res) {
  if (!redis) {
    if (req.method === "GET") { res.status(200).json({ connected: false, items: [], votes: { up: 0, down: 0 } }); return; }
    res.status(200).json({ ok: false, note: "No database connected yet." });
    return;
  }
  try {
    if (req.method === "GET") {
      const code = ((req.query && req.query.code) || "").toString();
      if (code !== ADMIN_CODE) { res.status(403).json({ error: "Wrong setup code." }); return; }
      const [raw, votes] = await Promise.all([redis.lrange(LIST, 0, KEEP - 1), redis.hgetall(VOTES)]);
      const items = (raw || [])
        .map((v) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } })
        .filter(Boolean);
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({
        connected: true,
        items,
        votes: { up: Number((votes || {}).up) || 0, down: Number((votes || {}).down) || 0 },
      });
      return;
    }

    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const session = (b.session || "").toString().slice(0, 40);
      const vote = b.vote === "up" || b.vote === "down" ? b.vote : "";
      const comment = (b.comment || "").toString().slice(0, 300).trim();
      if (!vote && !comment) { res.status(400).json({ error: "Nothing to save." }); return; }

      if (session) {
        const claimed = await redis.set(P + "fb:seen:" + session, Date.now(), { nx: true, ex: COOLDOWN_S });
        if (!claimed) { res.status(200).json({ ok: true, note: "already heard from this device recently" }); return; }
      }

      const entry = {
        ts: Date.now(),
        name: (b.name || "").toString().slice(0, 20),
        vote,
        comment,
        stop: (b.stop || "").toString().slice(0, 60),
        area: (b.area || "").toString().slice(0, 40),
        code: (b.code || "").toString().slice(0, 12),
      };

      const p = redis.pipeline();
      p.lpush(LIST, JSON.stringify(entry));
      p.ltrim(LIST, 0, KEEP - 1);
      if (vote) p.hincrby(VOTES, vote, 1);
      await p.exec();

      // Tell the grown-up. This is the good news of the whole project — somebody walked
      // round the neighborhood and had something to say about it — so it goes out on
      // every channel that's set up, and a failure here never fails the save.
      const who = entry.name || "A player";
      const thumb = vote === "up" ? "👍" : vote === "down" ? "👎" : "💬";
      const where = entry.area ? ` at ${entry.area}` : "";
      notify(
        `${thumb} ${who} finished the hunt${where}`,
        `${who} opened ${entry.stop || "a treasure chest"}${where} and left you a note.\n\n` +
        `They said: ${vote === "up" ? "👍 they liked it" : vote === "down" ? "👎 they didn't like it" : "(no thumb)"}\n` +
        (comment ? `\n"${comment}"\n` : "\n(no comment)\n") +
        `\nWhen: ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} (Pacific)\n` +
        `\nOnly you can see this. The full list is on your dashboard.`,
        `${thumb} ${who}${where}: ${comment || "(no comment)"}`,
        { tag: "gift" }
      ).catch(() => {});

      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Use GET or POST" });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
