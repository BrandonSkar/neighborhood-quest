// Vercel Serverless Function — records one anonymous scan/event into Upstash Redis.
//
// IMPORTANT: every key this app writes is namespaced under the "nq:" prefix, so this
// database can be SHARED with your other apps (bank app, sparkle quest) without any
// collisions. Do NOT run FLUSHALL/FLUSHDB on a shared database — it wipes everyone.
//
// Credentials are auto-injected by Vercel when you connect the Upstash store to this
// project (KV_REST_API_URL / KV_REST_API_TOKEN). Nothing is hard-coded.
import { Redis } from "@upstash/redis";
import { pushToPhones, pushReady } from "./_lib/push.js";

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

// A push notification through ntfy.sh — an alternative to the phone alerts above for
// anyone who'd rather subscribe in the ntfy app than turn on notifications here.
async function sendNtfy(title, body) {
  if (!NTFY_TOPIC) return null;
  try {
    const r = await fetch(NTFY_HOST + "/" + encodeURIComponent(NTFY_TOPIC), {
      method: "POST",
      // HTTP headers must be plain ASCII, so the emoji goes in Tags, not Title
      headers: { Title: title.replace(/[^\x20-\x7E]/g, "").trim() || "Neighborhood Quest", Priority: "high", Tags: "mag" },
      body,
    });
    return r.ok ? `sent to ${NTFY_HOST.replace(/^https?:\/\//, "")}/${NTFY_TOPIC}` : `not sent — ntfy replied ${r.status}`;
  } catch (e) {
    return "not sent — couldn't reach " + NTFY_HOST;
  }
}

// Fire every channel that's been set up and report on all of them. One working channel
// is a success, so a missing Resend key doesn't hide a phone alert that got through.
// Phone notifications come first: they're the ones that actually reach a pocket.
async function notify(subject, long, short) {
  const bits = [];
  let ok = false;
  const phones = await pushToPhones(subject, short || long, "nq-" + Date.now(), "./stats.html")
    .catch((e) => "not sent — " + String((e && e.message) || e));
  bits.push("phones: " + phones);
  if (/^sent/.test(phones)) ok = true;

  const mail = await sendMail(subject, long);
  bits.push("email: " + mail);
  if (/^sent/.test(mail)) ok = true;

  if (ALERT_SMS) {
    const sms = await sendMail(subject, short || long, ALERT_SMS);
    bits.push("text: " + sms);
    if (/^sent/.test(sms)) ok = true;
  }
  const ntfy = await sendNtfy(subject, short || long);
  if (ntfy) {
    bits.push("ntfy: " + ntfy);
    if (/^sent/.test(ntfy)) ok = true;
  }
  return { ok, text: bits.join(" · ") };
}

// Is there anywhere to send an alert at all? Checked before the cooldown key is claimed,
// so a project with nothing set up doesn't silently burn its one-per-12-hours slot.
const anyChannel = () => !!(process.env.RESEND_API_KEY || NTFY_TOPIC || pushReady());

async function alertMissingSticker(stop, stopName, stamped) {
  if (!anyChannel()) return "not sent — no alerts are set up on this project yet (see the README)";
  // NX+EX: the first report claims the key and sends; repeats inside the window no-op.
  const claimed = await redis.set(P + "alert:missing:" + stop, Date.now(), { nx: true, ex: ALERT_COOLDOWN_S });
  if (!claimed) return "not sent — already alerted about this stop in the last 12 h";

  const where = stopName ? `${stopName} (stop ${stop})` : `Stop ${stop}`;
  const when = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const r = await notify(
    `🙈 QR sticker missing at ${stopName || "stop " + stop}`,
    `A player tapped "Sticker Missing? Report it!" — the QR sticker is missing or damaged.\n\n` +
    `Where: ${where}\nWhen:  ${when} (Pacific)\n\n` +
    (stamped
      ? `They were stamped automatically (their phone confirmed they were within ~150 m).\n`
      : `They were NOT stamped — they reported it from somewhere else, or had already found this stop.\n`) +
    `Reprint this one from setup.html and tape it back up.\n\n` +
    `You won't get another alert about this stop for 12 hours.`,
    `Sticker missing at ${stopName || "stop " + stop} — reprint it.`
  );
  return r.text;
}

// ---- "a sticker just got scanned" ---------------------------------------------------
// One of these every time a child finds a stop — by camera or by typing the code, which
// both land in arriveAtStop() and log the same "scan". The hunt reads like a commentary
// from the sofa: who it was, which sticker, and how far through they are. It's the chatty
// alert — every channel that's set up gets one per scan, so with email or a text gateway
// turned on that's one apiece, every time.
const SCAN_COOLDOWN_S = 60 * 60; // per device per STOP, so every new find still buzzes:
                                 // it only silences the same child at the same sticker,
                                 // which is a refresh or a retry, not a new find

async function alertScan(stop, stopName, session, name, found, total) {
  if (!anyChannel()) return "not sent — no alerts are set up on this project yet (see the README)";
  const claimed = await redis.set(P + "alert:scan:" + (session || "anon") + ":" + stop, Date.now(), { nx: true, ex: SCAN_COOLDOWN_S });
  if (!claimed) return "not sent — already alerted about this player at this stop in the last hour";

  const who = name || "Someone";
  const where = stopName || "stop " + stop;
  const when = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  // "3 of 4" is also the prize warning: the last one or two mean a child is about to be
  // shown the hiding place, and something had better be in it.
  const progress = total ? `${found} of ${total}` : found ? `${found} found` : "";
  const r = await notify(
    `🔍 ${who} found ${where}` + (progress ? ` (${progress})` : ""),
    `${who} just scanned the sticker at:\n\n` +
    `    ${stopName ? `${stopName} (stop ${stop})` : `Stop ${stop}`}\n\n` +
    (progress ? `Treasures so far: ${progress}\n` : "") +
    `Time: ${when} (Pacific)\n\n` +
    `Who's where, and which prize they've picked, is on the dashboard: stats.html`,
    `${who} found ${where}` + (progress ? ` — ${progress}.` : ".")
  );
  return r.text;
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
      // setup.html sends `test: true`; anything else is the scan test on setup-prize.html
      // (including the "prize" a stale, cached copy of that page still sends)
      const scan = b.test !== true;
      const r = await notify(
        scan ? "🔍 Test — a sticker was scanned" : "✅ Neighborhood Quest — test alert",
        scan
          ? `This is the "Send a test alert" button in setup-prize.html.\n\n` +
            `If you're reading this, you'll hear about every sticker a child scans — who\n` +
            `it was, which spot, and how many treasures they have — by whichever of\n` +
            `push / email / text you've set up.\n\n` +
            `Sent: ${when} (Pacific)`
          : `This is the "Send me a test alert" button in setup.html.\n\n` +
            `If you're reading this, missing-sticker alerts are working: when a kid taps\n` +
            `"🙈 Sticker Missing? Report it!" you'll get one just like it, naming the spot.\n\n` +
            `Sent: ${when} (Pacific)`,
        scan ? "Test: a child scanned a sticker." : "Test: a sticker was reported missing."
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
    if (event === "scan" && stop != null) {
      const stopName = b.stopName ? b.stopName.toString().slice(0, 60) : null;
      const name = b.name ? b.name.toString().slice(0, 40) : "";
      const found = Number.isFinite(b.found) ? b.found : null;
      const total = Number.isFinite(b.total) ? b.total : null;
      try { alert = await alertScan(stop, stopName, session, name, found, total); }
      catch (e) { alert = "not sent — " + String((e && e.message) || e); }
    }

    res.status(200).json({ ok: true, alert });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
