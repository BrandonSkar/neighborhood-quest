// Vercel Serverless Function — records one anonymous scan/event into Upstash Redis.
//
// IMPORTANT: every key this app writes is namespaced under the "nq:" prefix, so this
// database can be SHARED with your other apps (bank app, sparkle quest) without any
// collisions. Do NOT run FLUSHALL/FLUSHDB on a shared database — it wipes everyone.
//
// Credentials are auto-injected by Vercel when you connect the Upstash store to this
// project (KV_REST_API_URL / KV_REST_API_TOKEN). Nothing is hard-coded.
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const P = "nq:"; // Neighborhood Quest namespace
const today = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

// ---- "sticker missing" email alert -------------------------------------------------
// When a kid reports a sign is gone, email the hider so it can be reprinted. Sent via
// Resend's REST API (plain fetch — no extra npm dependency).
//
// Setup: add RESEND_API_KEY in the Vercel project's Environment Variables. Optional
// overrides: ALERT_EMAIL (recipient) and ALERT_FROM (sender). With no key set, the
// alert is skipped silently and scan logging carries on as normal.
const ALERT_TO = process.env.ALERT_EMAIL || "branskar01@gmail.com";
const ALERT_FROM = process.env.ALERT_FROM || "Neighborhood Quest <onboarding@resend.dev>";
const ALERT_COOLDOWN_S = 12 * 60 * 60; // one email per stop per 12h, so a broken sign can't spam
const SETUP_CODE = process.env.ADMIN_CODE || "8979";   // same gate setup.html uses

// Every mail path returns a plain-English status instead of failing silently, so the
// "Send me a test alert" button in setup.html can say exactly what went wrong.
async function sendMail(subject, text) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return "not sent — RESEND_API_KEY isn't set on this project (Vercel → Settings → Environment Variables → add it, then redeploy)";
  let r;
  try {
    r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: ALERT_FROM, to: [ALERT_TO], subject, text }),
    });
  } catch (e) {
    return "not sent — couldn't reach Resend: " + String((e && e.message) || e);
  }
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    return `not sent — Resend replied ${r.status}: ${body.slice(0, 300)}`;
  }
  return `sent to ${ALERT_TO}`;
}

async function alertMissingSticker(stop, stopName, stamped) {
  if (!process.env.RESEND_API_KEY) return sendMail();   // returns the "no key" explanation
  // NX+EX: the first report claims the key and sends; repeats inside the window no-op.
  const claimed = await redis.set(P + "alert:missing:" + stop, Date.now(), { nx: true, ex: ALERT_COOLDOWN_S });
  if (!claimed) return "not sent — already emailed about this stop in the last 12 h";

  const where = stopName ? `${stopName} (stop ${stop})` : `Stop ${stop}`;
  const when = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  return sendMail(
    `🙈 QR sticker missing at ${stopName || "stop " + stop}`,
    `A player tapped "Sticker Missing? Report it!" — the QR sticker is missing or damaged.\n\n` +
    `Where: ${where}\nWhen:  ${when} (Pacific)\n\n` +
    (stamped
      ? `They were stamped automatically (their phone confirmed they were within ~150 m).\n`
      : `They were NOT stamped — they reported it from somewhere else, or had already found this stop.\n`) +
    `Reprint this one from setup.html and tape it back up.\n\n` +
    `You won't get another email about this stop for 12 hours.`
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST" }); return; }

  // Hider-only mail check from setup.html: skips the 12 h cooldown, never touches the
  // stats, and works even before a database is connected.
  {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (b.test === true) {
      if ((b.code || "").toString() !== SETUP_CODE) { res.status(403).json({ error: "Wrong setup code." }); return; }
      const when = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
      const alert = await sendMail(
        "✅ Neighborhood Quest — test alert",
        `This is the "Send me a test alert" button in setup.html.\n\n` +
        `If you're reading this, missing-sticker emails are working: when a kid taps\n` +
        `"🙈 Sticker Missing? Report it!" you'll get one just like it, naming the spot.\n\n` +
        `Sent: ${when} (Pacific)`
      ).catch((e) => "not sent — " + String((e && e.message) || e));
      res.status(200).json({ ok: true, test: true, alert });
      return;
    }
  }

  if (!redis) { res.status(200).json({ ok: false, note: "No database connected yet." }); return; }
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const session = (b.session || "").toString().slice(0, 60);
    const stop = Number.isInteger(b.stop) ? b.stop : null;
    const event = ["scan", "home", "complete", "sticker_missing", "sticker_report"].includes(b.event) ? b.event : "scan";
    const mascot = b.mascot ? b.mascot.toString().slice(0, 20) : null;

    // Two flavours of "the sign is gone": sticker_missing was stamped on the spot via
    // GPS (so it counts as a find), sticker_report is an alert only. Both are tallied
    // separately so /stats shows which sign needs reprinting.
    const isMissingReport = event === "sticker_missing" || event === "sticker_report";
    const isFind = event === "scan" || event === "sticker_missing";

    const p = redis.pipeline();
    if (session) p.sadd(P + "sessions", session);         // unique visitors
    if (isFind) {
      p.incr(P + "scans:total");
      p.incr(P + "scans:day:" + today());
      if (stop != null) p.hincrby(P + "scans:byStop", String(stop), 1);
      if (mascot) p.hincrby(P + "mascots", mascot, 1);
    }
    if (isMissingReport && stop != null) p.hincrby(P + "missing:byStop", String(stop), 1);
    if (event === "complete") p.incr(P + "completions");
    p.lpush(P + "recent", JSON.stringify({ ts: Date.now(), stop, event, mascot }));
    p.ltrim(P + "recent", 0, 49);                          // keep last 50 events
    await p.exec();

    // Email the hider about a downed sign. Never let a mail failure break the scan.
    let alert = null;
    if (isMissingReport && stop != null) {
      const stopName = b.stopName ? b.stopName.toString().slice(0, 60) : null;
      try { alert = await alertMissingSticker(stop, stopName, event === "sticker_missing"); }
      catch (e) { alert = "not sent — " + String((e && e.message) || e); }
    }

    res.status(200).json({ ok: true, alert });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
