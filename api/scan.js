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

// ---- getting told, on a phone, for nothing ------------------------------------------
// ALERT_SMS: a carrier's email-to-SMS gateway address, e.g. 2535550123@tmomail.net
//   (T-Mobile), @vtext.com (Verizon), @txt.att.net (AT&T). The same email send turns
//   into a real text message, free. Carriers filter these hard, so treat it as a bonus.
// NTFY_TOPIC: a topic on the free ntfy.sh — install the ntfy app, subscribe to the same
//   topic, and this is an instant push notification with no account and no cost. Pick
//   something unguessable: anyone who knows the topic name can read it.
const ALERT_SMS = (process.env.ALERT_SMS || "").trim();
const NTFY_TOPIC = (process.env.NTFY_TOPIC || "").trim();
const NTFY_HOST = (process.env.NTFY_HOST || "https://ntfy.sh").replace(/\/+$/, "");

// Every mail path returns a plain-English status instead of failing silently, so the
// "Send me a test alert" button in setup.html can say exactly what went wrong.
async function sendMail(subject, text, to) {
  const dest = to || ALERT_TO;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return "not sent — RESEND_API_KEY isn't set on this project (Vercel → Settings → Environment Variables → add it, then redeploy)";
  let r;
  try {
    r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: ALERT_FROM, to: [dest], subject, text }),
    });
  } catch (e) {
    return "not sent — couldn't reach Resend: " + String((e && e.message) || e);
  }
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    return `not sent — Resend replied ${r.status}: ${body.slice(0, 300)}`;
  }
  return `sent to ${dest}`;
}

// A push notification through ntfy.sh. Free, no account, arrives in about a second.
async function sendPush(title, body) {
  if (!NTFY_TOPIC) return null;
  try {
    const r = await fetch(NTFY_HOST + "/" + encodeURIComponent(NTFY_TOPIC), {
      method: "POST",
      // HTTP headers must be plain ASCII, so the emoji goes in Tags, not Title
      headers: { Title: title.replace(/[^\x20-\x7E]/g, "").trim() || "Neighborhood Quest", Priority: "high", Tags: "gift" },
      body,
    });
    return r.ok ? `sent to ${NTFY_HOST.replace(/^https?:\/\//, "")}/${NTFY_TOPIC}` : `not sent — ntfy replied ${r.status}`;
  } catch (e) {
    return "not sent — couldn't reach " + NTFY_HOST;
  }
}

// Fire every channel that's been configured and report on all of them. One working
// channel is a success, so a missing Resend key doesn't hide a push that got through.
async function notify(subject, long, short) {
  const bits = [];
  let ok = false;
  const mail = await sendMail(subject, long);
  bits.push("email: " + mail);
  if (/^sent/.test(mail)) ok = true;
  if (ALERT_SMS) {
    const sms = await sendMail(subject, short || long, ALERT_SMS);
    bits.push("text: " + sms);
    if (/^sent/.test(sms)) ok = true;
  }
  const push = await sendPush(subject, short || long);
  if (push) {
    bits.push("push: " + push);
    if (/^sent/.test(push)) ok = true;
  }
  return { ok, text: bits.join(" · ") };
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

// ---- "a child just chose their prize" ----------------------------------------------
// This is the one alert that's genuinely time-critical: they're about to walk to the
// hiding place, and somebody has to have put the thing there.
async function alertPrize(name, prize, session) {
  // one alert per device per prize — a double-tap or a retried request must not resend
  const claimed = await redis.set(P + "alert:prize:" + (session || "anon"), Date.now(), { nx: true, ex: 6 * 60 * 60 });
  if (!claimed) return { ok: true, text: "not sent — already alerted about this player in the last 6 h" };

  let where = "";
  try {
    const cfg = await redis.get(P + "prize");
    if (cfg && cfg.place && cfg.place.text) where = cfg.place.text.toString();
  } catch { /* the alert matters more than the address */ }

  const who = name ? name : "A player";
  const what = prize || "a prize";
  const when = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  return notify(
    `🎁 ${who} picked: ${what}`,
    `${who} just finished enough of the hunt to choose a prize, and picked:\n\n` +
    `    ${what}\n\n` +
    `They've been shown where to collect it${where ? `:\n\n    ${where}\n` : "."}\n\n` +
    `Time: ${when} (Pacific)\n\n` +
    `Go and put it there now — they're on their way.`,
    `${who} picked the ${what}! Put it out now.`
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST" }); return; }

  // Hider-only mail check from setup.html: skips the 12 h cooldown, never touches the
  // stats, and works even before a database is connected.
  {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (b.test) {
      if ((b.code || "").toString() !== SETUP_CODE) { res.status(403).json({ error: "Wrong setup code." }); return; }
      const when = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
      const prize = b.test === "prize";
      const r = await notify(
        prize ? "🎁 Test — a prize was picked" : "✅ Neighborhood Quest — test alert",
        prize
          ? `This is the "Test the prize alert" button in setup-prize.html.\n\n` +
            `If you're reading this, you'll be told the moment a child picks their prize —\n` +
            `by whichever of email / text / push you've set up.\n\n` +
            `Sent: ${when} (Pacific)`
          : `This is the "Send me a test alert" button in setup.html.\n\n` +
            `If you're reading this, missing-sticker alerts are working: when a kid taps\n` +
            `"🙈 Sticker Missing? Report it!" you'll get one just like it, naming the spot.\n\n` +
            `Sent: ${when} (Pacific)`,
        prize ? "Test: a child picked their prize." : "Test: a sticker was reported missing."
      ).catch((e) => ({ ok: false, text: "not sent — " + String((e && e.message) || e) }));
      res.status(200).json({ ok: true, test: true, alert: r.text, alertOk: r.ok });
      return;
    }
  }

  if (!redis) { res.status(200).json({ ok: false, note: "No database connected yet." }); return; }
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const session = (b.session || "").toString().slice(0, 60);
    const stop = Number.isInteger(b.stop) ? b.stop : null;
    // NOTE: anything not on this list is filed as a "scan", so a new event type has to be
    // added here or it quietly inflates the find count.
    const event = ["scan", "home", "complete", "sticker_missing", "sticker_report", "prize"].includes(b.event) ? b.event : "scan";
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

    // Tell the hider. Never let a failed notification break the scan itself.
    let alert = null;
    if (isMissingReport && stop != null) {
      const stopName = b.stopName ? b.stopName.toString().slice(0, 60) : null;
      try { alert = await alertMissingSticker(stop, stopName, event === "sticker_missing"); }
      catch (e) { alert = "not sent — " + String((e && e.message) || e); }
    }
    if (event === "prize") {
      const name = b.name ? b.name.toString().slice(0, 40) : "";
      const prize = b.prize ? b.prize.toString().slice(0, 40) : "";
      try { alert = (await alertPrize(name, prize, session)).text; }
      catch (e) { alert = "not sent — " + String((e && e.message) || e); }
    }

    res.status(200).json({ ok: true, alert });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
