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
- **Live GPS**: a blue "you are here" dot on the map. Works without GPS too — the dot
  just doesn't show, and the guide asks for location when you open a stop.
- **The map reads at a glance**: a stop you've found is a bright badge wearing its
  sticker and a green ✓, with a green name label; one still to find is a faded emoji
  under a red ❓ that bobs for attention.
- **A question at every stop**, written by the hider: one question, up to three answers,
  tapped until the right one lands (wrong ones dim and say "have another go" — nobody is
  ever out). A stop with no question written just doesn't show the box.
- **Your guide walks you in**: tap a stop you haven't found and your chosen buddy shows
  up in the card, bobbing along and talking to you from a speech bubble — several lines
  per mood (picked fresh each time the situation changes, and they use the kid's name),
  a big arrow pointing at the real spot that nudges "come on, this way!", a cold-to-hot
  bar, and a 🔥 warmer! puff off the dial each time you close the gap. Up close the whole
  panel goes orange and the buddy starts hopping. **Nothing ever shows metres** — far is
  "a little walk", and a step count only appears once it's small enough to picture ("SO
  close — about 25 more steps!"). Walk the wrong way twice and it says so, with a ❄️ puff.
  All the motion honours the OS "reduce motion" setting. The arrow follows the compass
  (iPhones ask first, via a 🧭 button); otherwise the dial goes north-up and the text
  names the direction. A stop you've already found shows just its mission and Back to
  map — no scanning tools in the way.
- **In-app camera** (📷 Scan sticker on every stop card): asks for camera permission and
  reads the QR right inside the app, so nobody has to back out to the phone's camera app.
  Uses the browser's native `BarcodeDetector` when it exists and falls back to the
  vendored `vendor/jsqr/` decoder (iOS Safari has no detector). Works offline.
- **Or type the code**: ⌨️ *Enter the code instead* sits on the stop card itself, under
  Back to map — deliberately not inside the camera screen, so a child who won't or can't
  allow the camera never hits a dead end. Every printed sheet shows its code in big type.
  A correct code stamps the stop exactly like a scan (case and spaces don't matter); a
  wrong one just says so. Refusing the camera closes it and opens this box automatically.
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
- **Tap your buddy to chat**: on the home hub he hops, his bubble pops, and he says
  something new — his own lines mixed with ones that use the kid's name and know how many
  treasures are left. He never repeats himself twice running.
- **Change Guide is also where you fix your name** — swap buddy and retype the name you
  play under, any time. It saves as you type.
- **📲 Add Quest to my home screen** on the home hub, right above Delete my data. One tap
  installs it where the browser allows (Android/Chrome/Edge); everywhere else it shows the
  steps for that browser. It hides itself once the quest is running as an installed app —
  and on phones that can tell us (`getInstalledRelatedApps`), as soon as it's installed
  at all.
- **Anonymous scan tracking** (no names, no location) via two serverless functions
  backed by **Upstash Redis**, all keys namespaced under `nq:`.

## Structure
| Path | Purpose |
|---|---|
| `index.html` / `app.js` / `styles.css` / `data.js` | The game (`data.js` holds the built-in/offline default stops) |
| `setup.html` | **Hider-only, code-locked (8979)**: print a 3×3 sheet of blank stickers, then add each one by its code once it's taped up — pin, name, picture, question — and publish |
| `stats.html` | Live scan dashboard |
| `api/config.js` | Stores/serves the hider's published cards (`nq:config`), and mints never-repeated sticker codes for the print sheet (`nq:printed`) |
| `api/scan.js` | Records one anonymous scan event (Upstash Redis) |
| `api/stats.js` | Returns aggregate stats for the dashboard (needs the code) |
| `api/reset.js` | The "Start over" wipe — clears `nq:*` and resets to Season 1 |
| `vendor/` | Bundled Leaflet (map) + jsQR (in-app sticker scanner) — no CDN at runtime |
| `manifest.webmanifest` / `sw.js` / `icon-*.png` | PWA install + offline |
| `scripts/dev.mjs` | Local server for your PC — serves these files, proxies `/api/*` to the live site |
| `scripts/` | Icon generator, Redis migration helper, `reset-nq.mjs` wipe |

## Deploy (Vercel)
1. Import the repo; set the project **Root Directory** to this folder.
2. **Storage → Connect Database →** an existing Upstash Redis store. It injects
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` automatically — nothing is hard-coded.
3. Redeploy. Tables/keys are created on the first scan. Visit `/stats.html` to watch
   scans, and `/setup.html` (code **8979**) to print stickers and place pins — see
   *Setting a hunt* below.

The site address is hard-coded to `https://neighborhood-quest.vercel.app/` in
`setup.html` (`BASE`) — that's what the printed QR links point at. Change it there if the
app ever moves. In setup, **Start a fresh hunt** is off by default: publishing only
updates the cards, and nobody loses their stamps unless you tick it. A card's picture also
decides whether the map draws grass and trees around that pin (the outdoorsy ones do).

Setup won't publish if it couldn't read your cards from the database (no signal, say) —
it says so and disables the button, because publishing from an empty page would wipe
every stop that's really out there.

Each card can carry a question — "How many swings are at this park?", "Does this park
have a slide?", "What's the name of this park?" — with up to three answers and a tick on
the right one. It shows once the kid has stamped that stop, and they tap until they get
it. Leave the question blank for no quiz. Blank answer slots are dropped on publish and
the tick follows its answer, so you can't accidentally mark the wrong one right.

## Setting a hunt: print first, decide the places later
A quest starts with **zero cards**. Nothing is committed to a location until you're
standing in it.

1. **At the desk.** `/setup.html` → **🖨️ Print a new sheet of 9**. That's the whole step:
   the server hands out nine codes it has never used before, the page lays them out three
   across, and the print dialog opens. Every sticker is identical — 🗺️ *Neighborhood
   Quest*, a QR, and a big **code** — so no sticker is promised to any place yet. Cut them
   out, laminate if you like.
2. **On the walk.** Tape one up wherever you actually like. Open `/setup.html` on your
   phone, type the **code printed on that sticker**, tap **📍 Use my location** while
   you're standing at it, name the spot, pick a picture, write its question — and
   **Publish**. That sticker is now live on every kid's map. Repeat for the next one.
3. **Anything left over** stays a blank piece of paper. Carry spares; nothing is wasted,
   and an unused code simply never becomes a card.

The code is the sticker's whole identity, so setup checks it: a code that isn't on any
sheet you've printed asks "are you sure?" before it becomes a card (0/o and 1/l are easy
to mis-read), and the same sticker can't be added twice. Publishing from a second device
notices any card the page hasn't seen and offers to keep it, so editing from the phone in
the park and the PC at home can't quietly delete each other's work.

Printed codes are remembered in `nq:printed`, which is what makes "no sheet ever repeats
a code" true across devices and years. **🧹 Wipe all data, keep my cards** keeps that
memory (the stickers in your drawer still work); **💣 Wipe everything** clears it.

## Missing-sticker email alerts (optional)
`api/scan.js` emails the hider when a child reports a sign is gone. It uses
[Resend](https://resend.com) over plain REST — no extra npm dependency.

1. Create a free Resend account and an **API key**.
2. In Vercel → Settings → **Environment Variables**, add `RESEND_API_KEY`.
3. Redeploy.

Optional: `ALERT_EMAIL` (recipient, defaults to `branskar01@gmail.com`) and `ALERT_FROM`
(sender, defaults to Resend's shared `onboarding@resend.dev`). Without a verified domain,
Resend only delivers to your own account address. **Without `RESEND_API_KEY` no alert is
sent** — scans still log normally. One email per stop per 12 h, so a single broken sign
can't flood your inbox.

**No email showing up?** Open `/setup.html` and tap **🔔 Send me a test alert**. It skips
the 12 h limit and reports back in plain English — missing API key, whatever Resend
replied, or "sent to …". The three usual causes: the key was never added in Vercel, you
already got an email about that stop within 12 h, or Resend's shared sender only delivers
to the address that owns the Resend account.

## Your two private pages
`/setup.html` (cards, pins, questions, printing) and `/stats.html` (the dashboard) both
sit behind the same code — **8979** by default. Each device remembers it after the first
unlock, so add them to your home screen and they open straight in. The API checks the
code too (`/api/stats?code=…`, and every POST), so the URL alone shows a stranger nothing.

Want a code only you know? Add **`ADMIN_CODE`** in Vercel → Settings → Environment
Variables and redeploy. The pages ask the server whether a code is good, so a new one
works everywhere with no code changes. (Offline, `setup.html` still opens on 8979.)

## Local testing
Two ways:

**With your real data** — `node scripts/dev.mjs` (or `npm run dev`), then open
http://localhost:5173. Pages come off your disk, while `/api/*` is forwarded to the live
site, so setup shows the cards you actually published and the dashboard shows real scans.
No npm install, no Vercel CLI, no database credentials on your PC. Publishing and wiping
from here are real. Point it somewhere else with `NQ_LIVE=https://… node scripts/dev.mjs`.
(Opening the `.html` files straight off disk can't do this — there's no `/api` to answer,
so you get the built-in demo stops and this device's own tally, which is why the numbers
looked wrong.)

**Offline** — open `index.html` directly and simulate a scan with `index.html?c=b7c218`.

## Starting over
`/setup.html` → **Start over**:
- **🧹 Wipe all data, keep my cards** — clears every scan, player, tally and alert, keeps
  your stops and pins, and puts the hunt back to **Season 1**.
- **💣 Wipe everything, cards too** — the above plus the published cards.

Both ask twice and can't be undone. Only `nq:*` keys are touched, so anything else in a
shared Upstash database is safe. Each phone notices the season changed the next time it
opens and clears its own stamps; to wipe a phone right now, use **🗑️ Delete my data** on
its home screen. `scripts/reset-nq.mjs` does the same job from a terminal if you'd rather
(needs `NQ_URL` / `NQ_TOKEN`).

The in-app camera needs a **secure context**, so it only runs on `https://` (or
`http://localhost`) — over `file://` the button explains to use the phone's camera app.

Until the first card is published, the game shows an empty map and says the hunt is being
set up. (The built-in Lakeland stops in `data.js` are only used when there's no database
at all — a bare checkout or `file://`.)
