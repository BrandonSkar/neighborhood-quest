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
- **Missing-sticker fallback**: if a sign is gone, the child can stamp the stop anyway,
  but only when their phone confirms they're within ~150 m. Logged as a `sticker_missing`
  event so `stats.html` shows which sign to reprint.
- **Lifetime totals + badges** on the home hub (all-time treasures, season, achievements)
  so returning players are rewarded across seasons.
- **Anonymous scan tracking** (no names, no location) via two serverless functions
  backed by **Upstash Redis**, all keys namespaced under `nq:`.

## Structure
| Path | Purpose |
|---|---|
| `index.html` / `app.js` / `styles.css` / `data.js` | The game (`data.js` holds the built-in/offline default stops) |
| `setup.html` | **Hider-only, code-locked (8979)** card editor: add/edit/delete stops, drop exact GPS pins, publish, print QR codes |
| `stats.html` | Live scan dashboard |
| `api/config.js` | Stores/serves the hider's published cards (`nq:config`); publishing bumps the season |
| `api/scan.js` | Records one anonymous scan event (Upstash Redis) |
| `api/stats.js` | Returns aggregate stats for the dashboard |
| `manifest.webmanifest` / `sw.js` / `icon-*.png` | PWA install + offline |
| `scripts/` | Icon generator + Redis migration helper |

## Deploy (Vercel)
1. Import the repo; set the project **Root Directory** to this folder.
2. **Storage → Connect Database →** an existing Upstash Redis store. It injects
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` automatically — nothing is hard-coded.
3. Redeploy. Tables/keys are created on the first scan. Visit `/stats.html` to watch
   scans, and `/setup.html` to print the QR codes.

## Local testing
Open `index.html` directly. Simulate a scan with `index.html?c=b7c218`. The scan
dashboard falls back to a local tally until deployed with the database connected.

> The **🧹 Reset data** button is a temporary debug control — remove it before launch.
