// Getting told, on a phone, for nothing.
//
// Every alert this project sends goes through notify() below, which fires each channel
// that's been set up and reports on all of them in plain English. One working channel is
// a success, so a missing Resend key never hides a push that got through — and the
// "Send me a test alert" button in setup.html can say exactly what went wrong.
//
// The channels, in the order they're tried:
//   • web push   — the phones that turned on notifications in setup.html (see push.js)
//   • email      — Resend's REST API. Needs RESEND_API_KEY; ALERT_EMAIL / ALERT_FROM
//                  override the recipient and sender.
//   • text       — ALERT_SMS is a carrier email-to-SMS gateway address, e.g.
//                  2535550123@tmomail.net (T-Mobile), @vtext.com (Verizon),
//                  @txt.att.net (AT&T). The same email send becomes a real text, free.
//                  Carriers filter these hard, so treat it as a bonus.
//   • ntfy       — NTFY_TOPIC on the free ntfy.sh. Install the app, subscribe to the
//                  same topic, and it's an instant push with no account and no cost.
//                  Pick something unguessable: anyone who knows the topic can read it.
//
// With nothing configured every one of these reports "not sent" and the caller carries
// on as normal — an alert is never allowed to break a scan.
import { pushToPhones, pushReady } from "./push.js";

const ALERT_TO = process.env.ALERT_EMAIL || "branskar01@gmail.com";
const ALERT_FROM = process.env.ALERT_FROM || "Neighborhood Quest <onboarding@resend.dev>";
const ALERT_SMS = (process.env.ALERT_SMS || "").trim();
const NTFY_TOPIC = (process.env.NTFY_TOPIC || "").trim();
const NTFY_HOST = (process.env.NTFY_HOST || "https://ntfy.sh").replace(/\/+$/, "");

export async function sendMail(subject, text, to) {
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

export async function sendNtfy(title, body, tag) {
  if (!NTFY_TOPIC) return null;
  try {
    const r = await fetch(NTFY_HOST + "/" + encodeURIComponent(NTFY_TOPIC), {
      method: "POST",
      // HTTP headers must be plain ASCII, so the emoji goes in Tags, not Title
      headers: { Title: title.replace(/[^\x20-\x7E]/g, "").trim() || "Neighborhood Quest", Priority: "high", Tags: tag || "mag" },
      body,
    });
    return r.ok ? `sent to ${NTFY_HOST.replace(/^https?:\/\//, "")}/${NTFY_TOPIC}` : `not sent — ntfy replied ${r.status}`;
  } catch (e) {
    return "not sent — couldn't reach " + NTFY_HOST;
  }
}

// Phone notifications come first: they're the ones that actually reach a pocket.
export async function notify(subject, long, short, opts) {
  const o = opts || {};
  const bits = [];
  let ok = false;
  const phones = await pushToPhones(subject, short || long, "nq-" + Date.now(), o.url || "./stats.html")
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
  const ntfy = await sendNtfy(subject, short || long, o.tag);
  if (ntfy) {
    bits.push("ntfy: " + ntfy);
    if (/^sent/.test(ntfy)) ok = true;
  }
  return { ok, text: bits.join(" · ") };
}

// Is there anywhere to send an alert at all? Worth checking before claiming a cooldown
// key, so a project with nothing set up doesn't silently burn its one-per-12-hours slot.
export const anyChannel = () => !!(process.env.RESEND_API_KEY || NTFY_TOPIC || pushReady());
