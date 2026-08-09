// Free web-push notifications to the grown-up's phone — the same approach Sparkle Quest
// uses for chore alerts, and for the same reason: no SMS service, no per-message cost,
// and it lands on the lock screen like any other app's notification.
//
// A phone opts in from setup.html / setup-prize.html (both behind the setup code), which
// stores its PushSubscription in the shared Upstash DB under `nq:push` — one field per
// phone. Sending needs a VAPID keypair in the environment:
//
//     npx web-push generate-vapid-keys
//     Vercel → Settings → Environment Variables → VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
//
// Until those exist, everything here reports "not set up" in plain English and the rest
// of the app carries on exactly as before.
//
// (Reusing the keypair from another of your projects is fine — subscriptions are tied to
// the site's origin, not the keys.)
import webpush from "web-push";
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const KEY = "nq:push";
export const PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || "").trim();
const PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || "").trim();
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:branskar01@gmail.com";

export const pushReady = () => !!(PUBLIC_KEY && PRIVATE_KEY && redis);

// @upstash/redis hands back objects for JSON-looking values and strings for the rest
function coerce(v) {
  if (v == null) return null;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } }
  return v;
}

export async function addPhone(sub) {
  if (!redis) return false;
  if (!sub || typeof sub.endpoint !== "string" || !/^https?:\/\//.test(sub.endpoint)) return false;
  await redis.hset(KEY, { [sub.endpoint]: JSON.stringify(sub) });
  return true;
}
export async function dropPhone(endpoint) {
  if (!redis || !endpoint) return false;
  await redis.hdel(KEY, endpoint);
  return true;
}
export async function countPhones() {
  if (!redis) return 0;
  try { return Object.keys((await redis.hgetall(KEY)) || {}).length; } catch { return 0; }
}

// Returns a plain-English status, never throws — an alert must not be able to break the
// thing that triggered it.
export async function pushToPhones(title, body, tag, openUrl) {
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    return "not sent — VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY aren't set on this project (run `npx web-push generate-vapid-keys`, add both in Vercel, redeploy)";
  }
  if (!redis) return "not sent — no database connected yet";
  let subs;
  try {
    const map = (await redis.hgetall(KEY)) || {};
    subs = Object.values(map).map(coerce).filter((s) => s && s.endpoint);
  } catch (e) {
    return "not sent — couldn't read the phone list: " + String((e && e.message) || e);
  }
  if (!subs.length) return "not sent — no phone has turned alerts on yet (setup → 🔔 Alerts on this phone)";

  try { webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY); }
  catch (e) { return "not sent — the VAPID keys look wrong: " + String((e && e.message) || e); }

  const payload = JSON.stringify({
    title: title || "Neighborhood Quest 🗺️",
    body: body || "Something happened in the quest!",
    tag: tag || "nq-alert",
    url: openUrl || "./stats.html",
  });
  let sent = 0, gone = 0, failed = "";
  await Promise.all(subs.map(async (sub) => {
    try { await webpush.sendNotification(sub, payload); sent++; }
    catch (e) {
      const code = e && e.statusCode;
      // the phone uninstalled the app or revoked permission — forget it
      if (code === 404 || code === 410) { gone++; try { await redis.hdel(KEY, sub.endpoint); } catch {} }
      else if (!failed) failed = String(code || (e && e.message) || e);
    }
  }));
  if (sent) return `sent to ${sent} phone${sent > 1 ? "s" : ""}` + (gone ? ` (forgot ${gone} stale one${gone > 1 ? "s" : ""})` : "");
  if (gone) return `not sent — the ${gone} phone(s) we knew about have all revoked alerts; turn them on again`;
  return "not sent — the push service rejected it" + (failed ? ": " + failed : "");
}
