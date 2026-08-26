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
  The guide also knows how much to trust the phone: it widens "you're here" to match the
  reported accuracy (a ±30 m phone can't tell 20 m from 0 m, so at 20 m it says *start
  hunting* instead of quoting steps), ignores movement smaller than that margin so a child
  standing still is never told they're going the wrong way by drift alone, and admits it
  when the fix is hopeless (*my map is a bit blurry here 🌫️*).
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
- **A stamp is never taken away by the app.** The stop's mission and question always come
  first, and the "you got them all" party waits until the child leaves that card — so a
  hunt with only one sticker out still gets played properly. The party's button opens the
  passport; there is no reset in the kid's app but **🗑️ Delete my data**, and only a new
  season clears stamps.
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
  backed by **Upstash Redis**, all keys namespaced under `nq:`. The *tally* is what's
  anonymous: the scan alert that reaches your phone names the child, but nothing stored
  against a scan does.

## Structure
| Path | Purpose |
|---|---|
| `index.html` / `app.js` / `styles.css` / `data.js` | The game (`data.js` holds the built-in/offline default stops) |
| `setup.html` | **Hider-only, code-locked (8979)**: print a 3×3 sheet of blank stickers, then add each one by its code once it's taped up — pin, name, picture, question — and publish |
| `setup-prize.html` | **Hider-only**: photograph the prizes and the hiding place, set how many finds unlock them, and write where to collect |
| `stats.html` | Live dashboard: players and their progress, scans per stop, and a **Recent activity** feed of every event — a find, an app open, a prize pick — in plain English |
| `api/config.js` | Stores/serves the hider's published cards (`nq:config`), and mints sticker codes for the print sheet that don't clash with any live card |
| `api/prize.js` | The prize: its photos (`nq:prizeimg:<id>`, one per key) and its setup (`nq:prize`) |
| `api/push.js` / `api/_lib/push.js` | Which phones get alerts (`nq:push`), and sending them — free web push, needs a VAPID keypair |
| `push-toggle.js` | The "🔔 Alerts on this phone" switch, shared by both setup pages |
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
   the server hands out nine codes — all different from each other and from every card
   you've already published — the page lays them out three across, and the print dialog
   opens. Every sticker is identical — 🗺️ *Neighborhood Quest*, a QR, and a big **code** —
   so no sticker is promised to any place yet. Cut them out, laminate if you like.
2. **On the walk.** Tape one up wherever you actually like. Open `/setup.html` on your
   phone, type the **code printed on that sticker**, tap **📍 Use my location** while
   you're standing at it, name the spot, pick a picture, write its question — and
   **Publish**. That sticker is now live on every kid's map. Repeat for the next one.

   *Dropping the pin takes a few seconds on purpose.* One reading is whatever the phone
   believed at that instant — often ±30 m from a cold start. It keeps watching while you
   stand there, holds on to the **sharpest** fix (never averaging a worse one in), stops
   as soon as it's within ±8 m, and tells you what you got: *spot on* / *good* / *rough —
   tap again in the open, away from walls*. Tap the button again to take the best so far.
   Every reading is saved as it arrives, so wandering off mid-sample loses nothing.
3. **Anything left over** stays a blank piece of paper. Carry spares; nothing is wasted,
   and an unused code simply never becomes a card.

Only **published** codes are protected — blank paper isn't reserved, so two sheets printed
months apart could in principle carry the same code, and that's fine: it only ever
matters when a card goes live, and setup won't let you add a code that's already on one.
Publishing from a second device notices any card the page hasn't seen and offers to keep
it, so editing from the phone in the park and the PC at home can't quietly delete each
other's work.

## The prize (optional)
`/setup-prize.html`, behind the same code. Photograph up to four prizes and one photo of
where they're hidden, say how many treasures unlock them (default 4), and type what the
child should be told — *"1234 Example Ave SE, Springfield WA. Behind the tree"*. There's a
live preview of the card they'll get, and an on/off switch.

Photos are shrunk **in your browser** before upload — longest edge 900 px, JPEG, stepped
down until it's under ~250 KB — so a 6 MB phone photo becomes ~55 KB. Each one is
uploaded and stored under its own key, so no single request has to carry all five.
Your address lives only in the database, never in this repo.

For the child: finding the required number opens **"Select your prize!"** with the photos.
The stop's own card and question always come first — the prize waits until they leave it,
and it replaces the generic "you did it" card rather than stacking on top of it. They tap
one, confirm, and get the hiding-place photo with your words under it. It's then parked on
a 🎁 button on the home hub so it can never be lost, and the pictures are pre-loaded once
they're one find away so the big moment isn't five spinners on a weak signal. The
dashboard's **Prize picked** column tells you which one to go and hide.

A new season clears the claim, so the next hunt can win a prize again.

## Alerts: getting told, on your phone, for nothing
You're told two things: **a sticker has just been scanned** — who found it, which spot,
and how many treasures they have now — and **a sticker has been reported missing**. Both
go out over every channel that's set up.

The scan alert is the chatty one: one per find, per child — a code typed in by hand
counts, since that stamps the stop exactly like a camera scan. Every alert names the
sticker the way your card does (*"🏀 Basketball court"*): the app sends the name it's
showing, and the server falls back to the published cards, so a phone running a long-
cached `app.js` still gets a named alert instead of "stop 3". It's also the prize warning —
*"Ivy found Owl Tree (3 of 4)"* means somebody is one sticker away from being shown the
hiding place, so put the thing there. The pick itself sends nothing; the dashboard's
**Prize picked** column says which prize to take.

Worth knowing before you switch on email or a text gateway: that's one message per scan
as well, and a hunt with a few kids and eight stops adds up fast. Push (below) and ntfy
are the two built for that volume.

### Phone notifications (the one to use)
The same approach as Sparkle Quest's chore alerts: **web push**. No SMS service, nothing
per message, and it lands on the lock screen like any other app.

They **buzz and make a sound**: `sw.js` asks for a double-buzz pattern, marks the alert
non-silent, and sets `renotify` so a second find re-alerts instead of quietly replacing
the first. **Android** honours the pattern. **iPhone** ignores it and uses the phone's own
alert style for the installed app (Settings → Notifications → Quest), which is Apple's
call, not something a web app can override. Either way the phone's own switches win: a
site muted in Chrome's notification settings, or a Focus mode, still silences it.

Changing any of that ships in the service worker, and the *old* worker keeps handling
pushes until it's replaced — so after a deploy, open the installed app once on each phone
to pick up the new one.

1. Generate a keypair on any computer: `npx web-push generate-vapid-keys`
2. Vercel → Settings → **Environment Variables** → add `VAPID_PUBLIC_KEY` and
   `VAPID_PRIVATE_KEY` (optionally `VAPID_SUBJECT`, a `mailto:` for the push services).
   *The pair from another of your projects works fine — subscriptions belong to the
   site's origin, not to the keys.*
3. Redeploy, then on **your phone**: open `/setup.html` or `/setup-prize.html` → tap
   **🔕 Alerts OFF on this phone — tap to turn on**. Repeat on any other phone that should
   hear about it.

Alerts are **per device**, behind the setup code, so only phones you tapped ever buzz —
the kids' phones never do. Subscriptions live in `nq:push`; a phone that uninstalls or
revokes permission is dropped automatically on the next send. **iPhone**: add the page to
the Home Screen first and turn alerts on from there (Apple only allows web push in an
installed app, iOS 16.4+). **Android**: works straight away.

### The other three, if you'd rather
| Env var | What you get |
|---|---|
| `RESEND_API_KEY` | **Email**, via [Resend](https://resend.com) over plain REST. Free tier, no card. |
| `ALERT_SMS` | **A real text message**, free, by emailing your carrier's SMS gateway: `2535550123@tmomail.net` (T‑Mobile), `@vtext.com` (Verizon), `@txt.att.net` (AT&T). Needs `RESEND_API_KEY` too, since it *is* an email. Carriers filter these unpredictably — test it before relying on it. |
| `NTFY_TOPIC` | **A push notification** via free [ntfy.sh](https://ntfy.sh) — install the app, subscribe to a topic only you know (`nq-9f3c2a`), put that name here. No account, no key. Anyone who knows the topic name can read it, so make it unguessable. `NTFY_HOST` points at a self-hosted one. |

Other optional vars: `ALERT_EMAIL` (recipient, defaults to `branskar01@gmail.com`) and
`ALERT_FROM` (sender, defaults to Resend's shared `onboarding@resend.dev` — without a
verified domain Resend only delivers to your own account address).

Set none of them and nothing is sent; scans still log normally and the app is unaffected.
Missing-sticker alerts are one per stop per 12 h; scan alerts are one per child per stop
per hour, so a refresh or a retried request can't send the same find twice — a different
child, or the same child at a different sticker, always buzzes straight away. **Test
buttons**: 🔔 *Send me a test alert* in `setup.html` (the missing-sticker one), 🔔 *Send a
test alert* in `setup-prize.html` (a scan) — both report, in plain English, exactly what
each channel did.

**Nothing showing up?** The test buttons skip the cooldown and say what happened. The
usual causes: the key was never added in Vercel (or you didn't redeploy after adding it),
you already got an alert about that stop within 12 h, Resend's shared sender only delivers
to the address that owns the Resend account — or, for a text, your carrier silently
dropped a message from an unknown sender. If texts prove flaky, use ntfy: it's the one
that always arrives.

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
