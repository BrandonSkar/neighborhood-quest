# Lakeland Hills Quest 🗺️

A kid-friendly neighborhood treasure hunt. A parent scans a QR code at a park or
school, and the child gets a storybook map, picks a guide, and stamps a passport by
scanning each location's unique code — with a cute "find + stamp" animation.

## How it works
- **Static front-end** (`index.html`, `app.js`, `styles.css`, `data.js`) — installable
  as a phone app (PWA) and works offline during a walk.
- **Each stop has a unique hex code**; scanning `/?c=<code>` is the only way to stamp it.
- **Pannable, real-map style** neighborhood with pinch-zoom and pins that shrink to
  small map dots when zoomed out.
- **Live GPS**: a blue "you are here" dot plus a 🔥 warmer / ❄️ colder hunt meter that
  points at the nearest unfound stop. Works without GPS too — the dot just doesn't show.
- **In-app camera** (📷 Scan sticker on every stop card): asks for camera permission and
  reads the QR right inside the app, so nobody has to back out to the phone's camera app.
  Uses the browser's native `BarcodeDetector` when it exists and falls back to the
  vendored `vendor/jsqr/` decoder (iOS Safari has no detector). Works offline.
- **Or type the code**: the same screen offers ⌨️ *Type the code instead* — every printed
  sheet shows its code in big type. A correct code stamps the stop exactly like a scan
  (case and spaces don't matter); a wrong one just says so. This opens by itself if the
  camera is blocked or unavailable, so a borrowed or locked-down phone can still play.
- **Missing-sticker report** (🙈 *Sticker Missing? Report it!* at the bottom of the stop
  card): asks the child to confirm, then **emails the hider** (see below) so you hear
  about a downed sign without checking the dashboard. If the stop isn't stamped yet and
  their phone confirms they're within ~150 m, the report also stamps it — logged as
  `sticker_missing`; a report from anywhere else logs `sticker_report` and doesn't count
  as a find. Either way `stats.html` shows which sign to reprint.
- **Stamps are keyed by each stop's QR `code`**, not its position in the list, so adding,
  deleting or reordering cards never re-points anyone's existing stamps.
- **Lifetime totals + badges** on the home hub (all-time treasures, season, achievements)
  so returning players are rewarded across seasons.
- **Anonymous scan tracking** (no names, no location) via two serverless functions
  backed by **Upstash Redis**, all keys namespaced under `nq:`.

## Structure
| Path | Purpose |
|---|---|
| `index.html` / `app.js` / `styles.css` / `data.js` | The game (`data.js` holds the built-in/offline default stops) |
| `setup.html` | **Hider-only, code-locked (8979)** card editor: name each stop, pick its picture, drop its pin by standing there, publish, print the QR + code sheets |
| `stats.html` | Live scan dashboard |
| `api/config.js` | Stores/serves the hider's published cards (`nq:config`); publishing bumps the season |
| `api/scan.js` | Records one anonymous scan event (Upstash Redis) |
| `api/stats.js` | Returns aggregate stats for the dashboard |
| `vendor/` | Bundled Leaflet (map) + jsQR (in-app sticker scanner) — no CDN at runtime |
| `manifest.webmanifest` / `sw.js` / `icon-*.png` | PWA install + offline |
| `scripts/` | Icon generator + Redis migration helper |

## Deploy (Vercel)
1. Import the repo; set the project **Root Directory** to this folder.
2. **Storage → Connect Database →** an existing Upstash Redis store. It injects
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` automatically — nothing is hard-coded.
3. Redeploy. Tables/keys are created on the first scan. Visit `/stats.html` to watch
   scans, and `/setup.html` (code **8979**) to place pins and print the QR codes.

The site address is hard-coded to `https://neighborhood-quest.vercel.app/` in
`setup.html` (`BASE`) — that's what the printed QR links point at. Change it there if the
app ever moves. In setup, **Start a fresh hunt** is off by default: publishing only
updates the cards, and nobody loses their stamps unless you tick it. A card's picture also
decides whether the map draws grass and trees around that pin (the outdoorsy ones do).

## Missing-sticker email alerts (optional)
`api/scan.js` emails the hider when a child reports a sign is gone. It uses
[Resend](https://resend.com) over plain REST — no extra npm dependency.

1. Create a free Resend account and an **API key**.
2. In Vercel → Settings → **Environment Variables**, add `RESEND_API_KEY`.
3. Redeploy.

Optional: `ALERT_EMAIL` (recipient, defaults to `branskar01@gmail.com`) and `ALERT_FROM`
(sender, defaults to Resend's shared `onboarding@resend.dev`). Without a verified domain,
Resend only delivers to your own account address. **Without `RESEND_API_KEY` the alert is
skipped silently** — scans still log normally. One email per stop per 12 h, so a single
broken sign can't flood your inbox.

## Local testing
Open `index.html` directly. Simulate a scan with `index.html?c=b7c218`. The scan
dashboard falls back to a local tally until deployed with the database connected.

The in-app camera needs a **secure context**, so it only runs on `https://` (or
`http://localhost`) — over `file://` the button explains to use the phone's camera app.

> The **🧹 Reset data** button is a temporary debug control — remove it before launch.
