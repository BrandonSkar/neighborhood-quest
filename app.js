"use strict";

// ---------- persistent profile ----------
const KEY = "nq_state_v2";
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
let state = load();
if (!state.visited) state.visited = [];

const mascotById = (id) => MASCOTS.find((m) => m.id === id) || MASCOTS[0];
const stopById = (id) => STOPS.find((s) => s.id === id);
const $ = (id) => document.getElementById(id);

// ---------- stamps are keyed by the stop's CODE, never its position ----------
// A stop's `id` is just its slot in the published list, so it shifts whenever the
// hider adds/removes/reorders a card. The QR `code` is stable for the life of a
// card, so that's what we store — a re-ordered hunt keeps everyone's stamps right.
//
// foundCount() only counts stamps belonging to the CURRENT hunt, so leftover codes
// from a previous set can never make the app think the quest is complete.
const isFound = (s) => !!s && state.visited.includes(s.code);
const foundStops = () => STOPS.filter(isFound);
const foundCount = () => foundStops().length;

// One-time upgrade of saves written before this change, plus a guard against any
// non-string junk. Legacy entries were numeric ids into the built-in DEFAULT_STOPS.
function migrateVisited() {
  if (!Array.isArray(state.visited)) { state.visited = []; return; }
  let changed = false;
  const out = [];
  for (const v of state.visited) {
    if (typeof v === "string") { out.push(v); continue; }
    changed = true;
    if (typeof v === "number") {
      const d = DEFAULT_STOPS.find((s) => s.id === v);
      if (d) out.push(d.code);
    }
  }
  // de-dupe while preserving order
  state.visited = out.filter((c, i) => out.indexOf(c) === i);
  if (changed || state.visited.length !== out.length) save();
}

// ---------- read the QR: ?c=<hex> (preferred) or ?stop=<n> ----------
// Resolved AFTER loadConfig() runs (see start() at the bottom) so a code that
// belongs to a freshly-published card matches the live card set, not the defaults.
const params = new URLSearchParams(location.search);
const codeParam = params.get("c");
const stopParam = parseInt(params.get("stop"), 10);
let arrivalStopId = null;
function resolveArrival() {
  arrivalStopId = null;
  if (codeParam && stopByCode(codeParam)) arrivalStopId = stopByCode(codeParam).id;
  else if (!isNaN(stopParam) && stopById(stopParam)) arrivalStopId = stopParam;
}

// This page load came from a sticker, whether or not the code matched a card yet. The
// service-worker auto-reload at the bottom sits out the whole life of such a page: a
// find animation and its stamp must never be interrupted, and a fresh deploy lands on
// the next open anyway.
const fromSticker = !!codeParam || !isNaN(stopParam);

// The code has done its job the moment the arrival resolves, so take it back out of the
// address bar. Left there it re-fires logEvent("scan") on every later reload of the same
// URL — a pull-to-refresh, a restored tab, the service worker taking over — which is why
// one real scan could be tallied twice. An UNRESOLVED code stays put: the published cards
// may simply not have loaded yet, and a reload is that scan's second chance.
function consumeArrivalParam() {
  if (arrivalStopId == null) return;
  try {
    const u = new URL(location.href);
    u.searchParams.delete("c");
    u.searchParams.delete("stop");
    history.replaceState(null, "", u.pathname + u.search + u.hash);
  } catch { /* very old browser: a duplicate tally beats a broken load */ }
}

// ---------- anonymous scan tracking (no personal data) ----------
function sid() {
  let s = localStorage.getItem("nq_sid");
  if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("nq_sid", s); }
  return s;
}
function localBump(event, stop) {
  let st; try { st = JSON.parse(localStorage.getItem("nq_stats")) || {}; } catch { st = {}; }
  st.scans = st.scans || 0; st.perStop = st.perStop || {}; st.completions = st.completions || 0;
  st.sessions = st.sessions || {}; st.sessions[sid()] = 1;
  if (event === "scan" || event === "sticker_missing") { st.scans++; if (stop) st.perStop[stop] = (st.perStop[stop] || 0) + 1; }
  if (event === "complete") st.completions++;
  localStorage.setItem("nq_stats", JSON.stringify(st));
}
function online() { return location.protocol === "http:" || location.protocol === "https:"; }
function logEvent(event, stop, extra) {
  localBump(event, stop);
  if (online()) {
    const s = stop ? stopById(stop) : null;
    // A scan alert names the child and their running total. The stamp itself lands a
    // moment later in startArrival(), so this find has to be counted by hand here.
    const scanInfo = event === "scan"
      ? { name: state.name || "", found: foundCount() + (s && !isFound(s) ? 1 : 0), total: STOPS.length }
      : null;
    try {
      fetch("/api/scan", {
        method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
        // stopName rides along so a "sticker missing" or scan alert can name the spot
        // without the server having to re-read the published config
        body: JSON.stringify(Object.assign({ session: sid(), stop: stop || null, event, mascot: state.mascot || null,
          stopName: s ? s.name : null }, scanInfo || {}, extra || {})),
      }).catch(() => {});
    } catch {}
  }
}

// Upsert this device's record (device id = sid) so their name, guide and stamps
// are stored server-side, keyed by device.
function syncDevice() {
  if (!online()) return;
  try {
    fetch("/api/device", {
      method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ session: sid(), name: state.name || "", mascot: state.mascot || "", visited: state.visited || [],
        season: SEASON, lifetimeFound: state.lifetimeFound || 0, seasonsPlayed: state.seasonsPlayed || 0,
        // which prize they chose — the grown-up has to know what to go and hide
        prize: state.prize ? (state.prize.label || state.prize.id || "") : "" }),
    }).catch(() => {});
  } catch {}
}

// Completely remove this device's data — from the database AND locally — then reset.
function deleteMyData() {
  const ok = typeof confirm !== "function" ||
    confirm("Delete ALL your data?\n\nThis removes your name, guide, and stamps from this device and from our records. This can't be undone.");
  if (!ok) return;
  const s = sid();
  if (online()) {
    try {
      fetch("/api/device", {
        method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
        body: JSON.stringify({ session: s, action: "delete" }),
      }).catch(() => {});
    } catch {}
  }
  ["nq_state_v2", "nq_stats", "nq_sid", "nq_installDismissed"].forEach((k) => { try { localStorage.removeItem(k); } catch {} });
  setTimeout(() => { try { location.reload(); } catch {} }, 200);
}

// ---------- screen manager ----------
function show(id) {
  ["picker", "home", "game"].forEach((s) => $(s).classList.toggle("hidden", s !== id));
  if (id === "game") { showMap(); armBack(); }
}

// ---------- Android/browser back button -> main menu (never leaves the app mid-quest) ----------
const BACK_SUBS = ["stopModal", "passportModal", "guideModal", "finishModal", "scanAnim", "scanCam", "installModal",
  "prizeModal", "prizePlaceModal"];
function anyModalOpen() { return BACK_SUBS.some((id) => !$(id).classList.contains("hidden")); }
function atMenuScreen() { return !$("home").classList.contains("hidden") && !anyModalOpen(); }
function goMenu() {
  closeScanner();   // never leave the camera running behind the menu
  stopGuiding();
  BACK_SUBS.forEach((id) => $(id).classList.add("hidden"));
  if (state.mascot) goHome(); else show("picker");
  maybeParty();     // backing out of the last stop still earns the fanfare
}
let backGuard = false;
function armBack() { if (!backGuard) { backGuard = true; try { history.pushState({ nq: 1 }, ""); } catch {} } }
try { window.addEventListener("popstate", () => { backGuard = false; if (!atMenuScreen()) goMenu(); }); } catch {}

// ---------- Leaflet map (OpenStreetMap tiles, GPS-pinned stops) ----------
let lmap = null;
const leafMarkers = {};
const FALLBACK_CENTER = [47.2561, -122.2099];         // Lakeland Hills, used if nothing has coords

// The pan-limit box is derived from wherever the hider actually dropped their pins,
// so a hunt in a different neighborhood is reachable. (It used to be a hardcoded
// rectangle, which rubber-banded the map away from any stop placed outside it.)
function mapFrame() {
  const pts = STOPS.filter((s) => s.ll).map((s) => s.ll);
  if (!pts.length) return { center: FALLBACK_CENTER, bounds: null };
  let minLa = 90, maxLa = -90, minLn = 180, maxLn = -180;
  for (const [la, ln] of pts) {
    if (la < minLa) minLa = la; if (la > maxLa) maxLa = la;
    if (ln < minLn) minLn = ln; if (ln > maxLn) maxLn = ln;
  }
  // pad generously so kids can see context around the outermost stops, and so a
  // single-stop hunt still gets a usable window instead of a zero-size box
  const padLa = Math.max(0.012, (maxLa - minLa) * 0.6);
  const padLn = Math.max(0.015, (maxLn - minLn) * 0.6);
  return {
    center: [(minLa + maxLa) / 2, (minLn + maxLn) / 2],
    bounds: [[minLa - padLa, minLn - padLn], [maxLa + padLa, maxLn + padLn]],
  };
}

// A found stop wears its sticker and a green ✓; one still to find is a faded emoji
// with a red ? that bobs — tellable apart across a whole map at a glance.
function stopIcon(s) {
  const found = isFound(s);
  const color = found ? "#1fae67" : "#ef3d4e";
  return L.divIcon({
    className: "qpin-wrap",
    html: `<div class="qpin${found ? " found" : ""}" style="--pc:${color}"><span>${found ? s.sticker : s.emoji}</span></div>`,
    iconSize: [40, 48], iconAnchor: [20, 46], tooltipAnchor: [0, -48],
  });
}
const pinLabel = (s) => (isFound(s) ? "✓ " + s.name : s.name);

function initLeaflet() {
  if (lmap || typeof L === "undefined") return;
  const frame = mapFrame();
  lmap = L.map("map", {
    center: frame.center, zoom: 15, minZoom: 13, maxZoom: 18,
    maxBounds: frame.bounds || undefined, maxBoundsViscosity: 0.85, zoomControl: true,
  });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> &copy; <a href="https://carto.com">CARTO</a>',
    maxZoom: 19, subdomains: "abcd",
  }).addTo(lmap);

  // --- cartoon greenery from OpenStreetMap (parks + woods), drawn UNDER the pins ---
  const treeIcon = L.divIcon({ className: "tree-deco", html: "🌲", iconSize: [24, 24], iconAnchor: [12, 20] });
  const treeIcon2 = L.divIcon({ className: "tree-deco", html: "🌳", iconSize: [24, 24], iconAnchor: [12, 20] });
  if (window.NQ_GREEN) {
    L.geoJSON(window.NQ_GREEN, {
      interactive: false,
      style: (f) => f.properties.kind === "wood"
        ? { weight: 0, fillColor: "#9ad97f", fillOpacity: 0.5 }
        : { weight: 0, fillColor: "#a6e08a", fillOpacity: 0.58 },
    }).addTo(lmap);
    // scatter cartoon trees over the greenery (more on the bigger woods)
    let trees = 0;
    for (const f of window.NQ_GREEN.features) {
      if (trees > 90) break;
      const ring = f.geometry.coordinates[0];
      let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9, cx = 0, cy = 0;
      for (const [x, y] of ring) { if (x < mnx) mnx = x; if (y < mny) mny = y; if (x > mxx) mxx = x; if (y > mxy) mxy = y; cx += x; cy += y; }
      cx /= ring.length; cy /= ring.length;
      const w = mxx - mnx, h = mxy - mny, big = (w * h) > 0.000004;
      const spots = (f.properties.kind === "wood" && big)
        ? [[cy, cx], [cy + h * 0.22, cx - w * 0.22], [cy - h * 0.22, cx + w * 0.22], [cy + h * 0.15, cx + w * 0.2]]
        : [[cy, cx]];
      for (const p of spots) { if (trees > 90) break; L.marker(p, { icon: trees % 3 ? treeIcon : treeIcon2, interactive: false, keyboard: false }).addTo(lmap); trees++; }
    }
  }
  // guaranteed green blob on each park stop (in case OSM lacks it)
  STOPS.forEach((s) => {
    if (!s.ll || !s.park) return;
    L.circle(s.ll, { radius: 55, weight: 0, fillColor: "#a6e08a", fillOpacity: 0.5, interactive: false }).addTo(lmap);
    [[0.0004, -0.0004], [-0.00035, 0.00045]].forEach((o) => L.marker([s.ll[0] + o[0], s.ll[1] + o[1]], { icon: treeIcon, interactive: false, keyboard: false }).addTo(lmap));
  });

  STOPS.forEach((s) => {
    if (!s.ll) return;
    const m = L.marker(s.ll, { icon: stopIcon(s) }).addTo(lmap)
      .bindTooltip(pinLabel(s), { permanent: true, direction: "top",
        className: "pin-label" + (isFound(s) ? " done" : ""), offset: [0, -4] });
    m.on("click", () => openStop(s.id));               // view-only: opens the card, never stamps
    leafMarkers[s.id] = m;
  });

  // frame all the stops on first load
  const pts = STOPS.filter((s) => s.ll).map((s) => s.ll);
  if (pts.length) lmap.fitBounds(L.latLngBounds(pts), { padding: [45, 45], maxZoom: 16 });

  const labelToggle = () => $("map").classList.toggle("labels-off", lmap.getZoom() < 15);
  lmap.on("zoomend", labelToggle); labelToggle();

  // cartoon compass in the corner
  const compass = L.control({ position: "topright" });
  compass.onAdd = () => { const d = L.DomUtil.create("div", "nq-compass"); d.innerHTML = '<div class="rose"><b>N</b><i></i></div>'; return d; };
  compass.addTo(lmap);
}

function showMap() {
  initLeaflet();
  if (lmap) setTimeout(() => lmap.invalidateSize(), 0); // container was hidden; recompute size
  startGeo();
}

// ---------- GPS: the "you are here" dot, and the fix the guide steers by ----------
let youMarker = null, youAccuracy = null, geoWatchId = null;
let lastFix = null;                 // [lat, lng] of the child's phone
let lastAcc = null;                 // ...and how much the phone trusts it, in metres

function haversine(a, b) {          // meters between two [lat, lng] points
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function startGeo() {
  if (geoWatchId != null || !("geolocation" in navigator)) return;
  try {
    geoWatchId = navigator.geolocation.watchPosition(
      (p) => onFix(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
      () => {}, // denied/unavailable -> the map just works without the dot
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
  } catch {}
}
function onFix(lat, lng, acc) {
  lastFix = [lat, lng];
  lastAcc = typeof acc === "number" && isFinite(acc) ? acc : null;
  if (lmap) {
    const ll = [lat, lng];
    if (!youMarker) {
      youMarker = L.marker(ll, {
        icon: L.divIcon({ className: "you-dot-wrap", html: '<div class="you-dot"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
        interactive: false, keyboard: false, zIndexOffset: 1000,
      }).addTo(lmap);
      youAccuracy = L.circle(ll, { radius: acc || 30, weight: 1, color: "#4aa8ff", opacity: 0.5, fillColor: "#4aa8ff", fillOpacity: 0.12, interactive: false }).addTo(lmap);
    } else {
      youMarker.setLatLng(ll);
      youAccuracy.setLatLng(ll).setRadius(acc || 30);
    }
  }
  updateStopGuide();
}

// ---------- boot ----------
function boot() {
  migrateVisited();   // upgrade pre-code saves (numeric ids) before anything reads them
  $("progressTotal").textContent = STOPS.length;
  $("hpTotal").textContent = STOPS.length;
  renderMascotButtons($("mascotGrid"), false);
  renderMascotButtons($("guideGrid"), true);

  if (state.mascot) {
    if (state.season === undefined) {
      state.season = SEASON; save();                 // grandfather existing players into the current season
    } else if (state.season !== SEASON) {
      // NEW season (new locations): keep name + guide, reset stamps, bank the lifetime total
      state.lifetimeFound = (state.lifetimeFound || 0) + foundCount();
      state.seasonsPlayed = (state.seasonsPlayed || 0) + 1;
      state.visited = [];
      state.season = SEASON;
      state.prize = null;          // new hunt, new prize to win
      save();
    }
    applyGuide();
    syncDevice(); // record this returning device (name/guide/progress)
    if (arrivalStopId) { logEvent("scan", arrivalStopId); startArrival(arrivalStopId); }
    else goHome();
  } else {
    logEvent(arrivalStopId ? "scan" : "home", arrivalStopId); // scan still counts before sign-up
    show("picker");
  }
}

// ---------- mascot buttons (used by picker + change-guide) ----------
function renderMascotButtons(container, instant) {
  container.innerHTML = "";
  MASCOTS.forEach((m) => {
    const b = document.createElement("button");
    b.className = "mascot";
    b.innerHTML = `<span class="em">${m.emoji}</span><span class="nm">${m.name}</span>`;
    b.onclick = () => {
      if (instant) {
        state.mascot = m.id; save(); applyGuide(); syncDevice();
        [...container.children].forEach((c) => c.classList.remove("sel"));
        b.classList.add("sel");
        homeSpeak(`Hi! I'm ${m.name} ${m.emoji} — let's explore together!`);
      } else {
        [...container.children].forEach((c) => c.classList.remove("sel"));
        b.classList.add("sel");
        pickerChoice = m.id;
        $("startBtn").disabled = false;
        $("startBtn").style.background = m.color;
      }
    };
    container.appendChild(b);
  });
}
let pickerChoice = null;
$("startBtn").onclick = () => {
  if (!pickerChoice) return;
  state.mascot = pickerChoice;
  state.name = $("nameInput").value.trim();
  state.season = SEASON; state.lifetimeFound = 0; state.seasonsPlayed = 0;
  save(); applyGuide(); syncDevice();
  if (arrivalStopId) startArrival(arrivalStopId);
  else goHome();
};

// ---------- guide + home ----------
function applyGuide() {
  const m = mascotById(state.mascot);
  $("homeGuide").textContent = m.emoji;
  $("cardGuide").textContent = m.emoji;
  $("scanGuideName").textContent = m.name;
}
function refreshGreeting() {
  $("homeGreeting").textContent = state.name ? `Hi, ${state.name}!` : "Hi, Explorer!";
}
function goHome() {
  show("home");
  const m = mascotById(state.mascot);
  refreshGreeting();
  homeSpeak(huntEmpty()
    ? `I'm ${m.name} ${m.emoji}. The treasures are still being hidden! 🗺️`
    : `I'm ${m.name} ${m.emoji}. Ready for an adventure?`);
  $("homeHint").textContent = huntEmpty()
    ? "No stickers are out yet — check back soon and we'll go exploring! 🗺️"
    : "Out exploring? Scan a QR sticker at a park or school to stamp your passport! 🎯";
  refreshProgress();
  renderLifetime();
  refreshPrizeButton();
  warmPrizeImages();
  refreshInstallButton();
  maybePromptInstall();
}
function homeSpeak(t) { $("homeSpeech").textContent = t; }
function say(t) { $("speech").textContent = t; }

// ---------- tap your buddy on the home hub ----------
// Kids tap this over and over, so it has to keep giving: the guide's own lines mixed
// with ones that know their name and how the hunt is going — and NEVER the same line
// twice in a row, which is what makes it feel like someone is actually there.
const CHAT_ANY = [
  (c) => `I'm ${c.guide} ${c.em} and you're ${c.name} — what a team! 🤝`,
  (c) => `Ready when you are, ${c.name}! 🚀`,
  (c) => `Tap a spot on the map and I'll walk you there. 🧭`,
  (c) => `Adventure buddies forever! 💛`,
  (c) => `Wiggle your toes — we've got walking to do! 👣`,
  (c) => `Stuck? Look up high AND down low. Stickers hide! 👀`,
  (c) => `Every sticker is out there for real. Somebody put it there! 🗺️`,
  (c) => `Bring a grown-up, ${c.name} — they carry the snacks. 🍎`,
];
const CHAT_HUNTING = [
  (c) => `${c.left} treasure${c.left > 1 ? "s" : ""} still hiding out there, ${c.name}! 🗺️`,
  (c) => c.found ? `${c.found} stamped already! Let's get another. 🏅` : `Zero stamps so far — the first one is the best one! ⭐`,
  (c) => `Shall we go find number ${c.found + 1}? 🎯`,
  (c) => `I've got a good feeling about today, ${c.name}. 🍀`,
];
const CHAT_DONE = [
  (c) => `You found EVERY treasure, ${c.name}! I'm so proud. 🏆`,
  (c) => `All done! Want to show someone your passport? 📖`,
  (c) => `Champion explorer, that's you. 🥇`,
];
const CHAT_WAITING = [
  () => `No stickers are out yet — they're still being hidden! 🤫`,
  (c) => `Soon, ${c.name}! Check back and we'll go exploring. 🗺️`,
  () => `I'm keeping my eyes peeled for the first one. 👀`,
];
let lastChat = "";
function guideChat() {
  const m = mascotById(state.mascot);
  const found = foundCount();
  const ctx = { name: state.name || "explorer", guide: m.name, em: m.emoji,
    found, left: Math.max(0, STOPS.length - found) };
  const pool = m.cheer.slice()
    .concat(CHAT_ANY.map((f) => f(ctx)))
    .concat((huntEmpty() ? CHAT_WAITING : ctx.left > 0 ? CHAT_HUNTING : CHAT_DONE).map((f) => f(ctx)));

  let line = pool[Math.floor(Math.random() * pool.length)];
  for (let tries = 0; line === lastChat && tries < 8; tries++) line = pool[Math.floor(Math.random() * pool.length)];
  lastChat = line;
  homeSpeak(line);

  // he hops, the bubble pops — the tap has to feel like it did something
  const face = $("homeGuide"), bubble = $("homeSpeech");
  face.classList.remove("chat"); void face.offsetWidth; face.classList.add("chat");
  bubble.classList.remove("pop"); void bubble.offsetWidth; bubble.classList.add("pop");
}

// ---------- markers / map ----------
// Every stop is independent (no order) — pins just show found (green) vs not (red).
function refreshMarkers() {
  for (const s of STOPS) {
    const m = leafMarkers[s.id];
    if (!m) continue;
    m.setIcon(stopIcon(s));
    m.setTooltipContent(pinLabel(s));
    const tip = m.getTooltip();
    if (tip && tip._container) tip._container.classList.toggle("done", isFound(s));
  }
}
// True while the grown-up has printed stickers but not taped any up yet, so the
// published hunt has no playable stops. Everything that divides by the stop count has
// to cope with it.
const huntEmpty = () => STOPS.length === 0;

function refreshProgress() {
  const n = foundCount(), total = STOPS.length;
  $("progressNow").textContent = n;
  $("hpNow").textContent = n;
  $("hpFill").style.width = (total ? (n / total) * 100 : 0) + "%";
  refreshMarkers();
}

// ---------- lifetime totals + badges on the home hub ----------
function renderLifetime() {
  const found = foundCount();
  const total = (state.lifetimeFound || 0) + found;
  $("lifeTotal").textContent = total;
  $("lifeSeason").textContent = state.season || 1;

  const parks = STOPS.filter((s) => s.park);
  const gotAllParks = parks.length > 0 && parks.every(isFound);
  const gotAll = STOPS.length > 0 && found >= STOPS.length;
  const badges = [
    { on: found >= 1,                    em: "🧭", label: "First Find" },
    { on: gotAllParks,                   em: "🌳", label: "Park Ranger" },
    { on: gotAll,                        em: "🏆", label: "Quest Done" },
    { on: (state.seasonsPlayed || 0) >= 1, em: "🔁", label: "Returning" },
    { on: total >= 20,                   em: "⭐", label: "20 Found" },
  ];
  const wrap = $("badgeRow"); wrap.innerHTML = "";
  badges.forEach((b) => {
    const d = document.createElement("div");
    d.className = "badge" + (b.on ? " earned" : "");
    d.innerHTML = `<span class="be">${b.em}</span><span class="bl">${b.label}</span>`;
    wrap.appendChild(d);
  });
}

// ---------- scan arrival animation ----------
let scanTimers = [];
let pendingStopId = null;
let pendingFirst = false;      // did THIS arrival stamp something new?
let partyAfterCard = false;    // ...and did it finish the hunt? (celebrate on the way out)
function clearScanTimers() { scanTimers.forEach(clearTimeout); scanTimers = []; }
function startArrival(id, viaQR = true) {
  const s = stopById(id); if (!s) return;
  armBack();
  pendingStopId = id;
  pendingFirst = false;
  const el = $("scanAnim");
  el.className = "scan-anim finding";
  $("scanEmoji").textContent = s.emoji;
  $("stampMark").textContent = s.sticker;
  $("scanTitle").textContent = "Searching for a treasure…";
  const m = mascotById(state.mascot);
  $("scanSub").innerHTML = `Following ${m.name} ${m.emoji}…`;
  el.classList.remove("hidden");
  clearScanTimers();
  scanTimers.push(setTimeout(() => {   // FOUND
    el.classList.add("found");
    $("scanTitle").textContent = `Found ${s.name}! 🎉`;
  }, 1300));
  scanTimers.push(setTimeout(() => {   // STAMP
    el.classList.remove("finding");
    el.classList.add("stamp");
    $("scanTitle").textContent = "Stamping your passport…";
    const first = earnSticker(id);
    pendingFirst = first;
    chime();
    miniConfetti();
    if (!first) $("scanTitle").textContent = "You found this one already! ⭐";
  }, 2100));
  scanTimers.push(setTimeout(() => finishArrival(), 3200));
}
function finishArrival() {
  clearScanTimers();
  $("scanAnim").classList.add("hidden");
  maybePromptInstall(); // nudge "Add to Home Screen" after a scan
  const id = pendingStopId; pendingStopId = null;
  // The stop's mission and the hider's question come first — ALWAYS, even when this was
  // the last one. The finish party used to jump in here instead, which on a one-stop
  // hunt meant the child never saw the card at all.
  partyAfterCard = pendingFirst && STOPS.length > 0 && foundCount() >= STOPS.length;
  prizeAfterCard = pendingFirst && prizeUnlocked() && !prizeWon();
  pendingFirst = false;
  show("game");
  openStop(id);
}
function skipArrival() {
  if (pendingStopId == null) return;
  clearScanTimers();
  pendingFirst = earnSticker(pendingStopId) || pendingFirst;
  finishArrival();
}
// The celebration, held back until they leave the stop card. A prize outranks the
// generic "you did it" card — it IS the payoff, and two party modals in a row is one
// too many for a six-year-old.
function maybeParty() {
  if (prizeAfterCard) {
    prizeAfterCard = false; partyAfterCard = false;
    refreshPrizeButton();
    openPrizePicker();
    return;
  }
  if (!partyAfterCard) return;
  partyAfterCard = false;
  finish();
}

function earnSticker(id) {
  const s = stopById(id); if (!s) return false;
  const first = !isFound(s);
  if (first) { state.visited.push(s.code); save(); syncDevice(); }
  refreshProgress();
  return first;
}

// ---------- stop card (read-only) ----------
// Found stops show the full mission recap. Un-found stops show a "go scan it"
// message and hide the mission — you can only stamp by scanning the real QR.
let activeStop = null;
function openStop(id) {
  const s = stopById(id); if (!s) return;
  armBack();
  activeStop = s;
  const found = isFound(s);
  $("cardGuide").textContent = mascotById(state.mascot).emoji;
  $("stopName").textContent = s.name;
  $("stopNote").classList.add("hidden");
  $("stopNote").classList.remove("good");
  // Reveal the card BEFORE filling it in: the guide below only paints into a visible
  // card, and the browser can't repaint until this whole function has finished anyway.
  $("stopModal").classList.remove("hidden");

  // Found = a celebration card: mission recap only, no scanning tools to get in the way.
  $("scanStickerBtn").classList.toggle("hidden", found);
  $("codeBtn").classList.toggle("hidden", found);
  $("stickerGoneBtn").classList.toggle("hidden", found);
  // on a stop still to find, the guide lives in the directions panel doing the talking,
  // so the decorative one at the top of the card would just be a second face
  $("cardGuideWrap").classList.toggle("hidden", !found);
  openCodeBox(false);                       // always start collapsed on a fresh card
  if (found) {
    $("stopBadge").textContent = s.emoji;
    $("stopIntro").textContent = s.intro;
    $("stopEasy").textContent = s.easy;
    $("missionWrap").classList.remove("hidden");
    renderQuiz(s);
    stopGuiding();
  } else {
    $("stopBadge").textContent = "❓";
    $("stopIntro").textContent = `Let's go find ${s.name}!`;
    $("missionWrap").classList.add("hidden");
    $("quizWrap").classList.add("hidden");
    startGuiding(s);
  }
}

// ---------- the hider's question, answered by tapping ----------
// Wrong answers just dim and stay put — the child keeps choosing until it clicks,
// which is the whole point: nobody is out, everybody gets there.
function renderQuiz(s) {
  const wrap = $("quizWrap"), box = $("quizChoices"), msg = $("quizMsg");
  const quiz = s.quiz;
  box.innerHTML = "";
  msg.textContent = ""; msg.className = "quiz-msg hidden";
  if (!quiz || !quiz.q || !Array.isArray(quiz.choices) || quiz.choices.length < 2) {
    wrap.classList.add("hidden");
    return;
  }
  $("quizQ").textContent = quiz.q;
  quiz.choices.forEach((text, i) => {
    const b = document.createElement("button");
    b.className = "quiz-choice";
    b.textContent = text;
    b.onclick = () => answerQuiz(b, i === quiz.correct);
    box.appendChild(b);
  });
  wrap.classList.remove("hidden");
}
function answerQuiz(btn, right) {
  if (btn.classList.contains("wrong") || $("quizMsg").classList.contains("win")) return;
  const msg = $("quizMsg");
  msg.classList.remove("hidden");
  if (!right) {
    btn.classList.add("wrong", "shake");
    setTimeout(() => btn.classList.remove("shake"), 400);
    msg.textContent = "Not quite — have another go! 🤔";
    msg.className = "quiz-msg";
    return;
  }
  btn.classList.remove("wrong");
  btn.classList.add("right");
  [...$("quizChoices").children].forEach((c) => { if (c !== btn) c.disabled = true; });
  msg.textContent = "That's it! You got it! 🎉";
  msg.className = "quiz-msg win";
  chime();
  miniConfetti();
}

// ---------- your guide walks you to a stop you haven't found ----------
// The card used to just say "you haven't found this one yet". Now the guide talks the
// child in: an arrow pointing at the real spot, a warmer/colder line, and a countdown
// in kid-sized steps that refreshes on every GPS fix.
let navStop = null;                  // the stop the open card is guiding to
let navBearing = null;               // direction to it, degrees clockwise from north
let navLastDist = null, navWrong = 0;
let headingDeg = null, compassOn = false;   // which way the phone is actually pointing

function bearingTo(from, to) {
  const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
  const la1 = rad(from[0]), la2 = rad(to[0]), dLn = rad(to[1] - from[1]);
  const y = Math.sin(dLn) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLn);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
const DIRS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const dirName = (d) => DIRS[Math.round(d / 45) % 8];

// A kid's step is about half a metre. We only ever say this out loud once the number
// is small enough to picture — "about 25 more steps" lands, "about 1750" doesn't.
const kidSteps = (m) => Math.max(5, Math.round((m * 2) / 5) * 5);
const STEPS_MAX_M = 25;   // ~50 steps: past this the guide talks in warm/cold instead

// ---- how much of what the phone says can we believe? ----
// A phone that reports ±30 m can put a child "18 m away" while they're standing on the
// sticker, so the guide has to widen its idea of "here" to match, and stop reading
// meaning into wobbles smaller than the error itself. Under trees, near a fence or
// between houses, ±25 m is completely normal.
const FUZZY_M = 40;                                  // past this, stop talking in steps
const accNow = () => (lastAcc == null ? 15 : lastAcc);
const arriveRadius = () => Math.max(10, Math.min(30, accNow() * 0.9));
const moveNoise = () => Math.max(3, accNow() / 3);   // smaller than this isn't a real move

// Everything the guide says, in their own voice. Several lines per band so the same
// walk never sounds identical twice; one is picked when the band changes, then kept
// (so a step count can tick down without the sentence flickering).
const GUIDE_LINES = {
  far: [
    (c) => `Big adventure walk ahead — follow me, ${c.name}! 🗺️`,
    () => "Ooh, that one's far away. Ready? Let's march! 🥾",
    (c) => `Stick with me, ${c.name}, I know the way! 🗺️`,
  ],
  onway: [
    () => "We're on our way! Keep following me. 🧭",
    (c) => `Good walking, ${c.name}! This way! 👣`,
    () => "Nice and steady — I'll keep pointing! 🧭",
  ],
  warmer: [
    () => "Getting warmer! Keep walking! 🔥",
    () => "Ooh, warmer over here! Come on! 👣",
    (c) => `We're closing in, ${c.name}! 🔥`,
  ],
  warm: [
    () => "Really warm now — it's just around here! 🔥",
    () => "Ooh ooh, VERY warm! Nearly there! 🔥",
    () => "So close I can almost see it! 👀",
  ],
  close: [
    (c) => `SO close — about ${c.n} more steps! 🔥🔥`,
    (c) => `Just ${c.n} steps to go! Almost! 🎉`,
    (c) => `${c.n} more steps, ${c.name} — I can feel it! 🔥🔥`,
  ],
  arrived: [
    (c) => `We made it! 🎯 Find the ${c.sticker} sticker!`,
    (c) => `This is the spot! Hunt for the ${c.sticker} sticker! 🔎`,
    (c) => `Here we are! Look for the ${c.sticker} sticker! 🎯`,
  ],
  wrong: [
    () => "Oops — that's colder! Let's turn around. ↩️",
    () => "Hmm, wrong way! Follow me back. ↩️",
    (c) => `Brr, chilly! This way instead, ${c.name}! ↩️`,
  ],
};
function guideBand(d, wrong) {
  if (d < arriveRadius()) return "arrived";
  if (wrong >= 2) return "wrong";
  if (d < STEPS_MAX_M) return "close";
  if (d < 80) return "warm";
  if (d < 200) return "warmer";
  if (d < 600) return "onway";
  return "far";
}
let navBand = null, navLine = 0;

function popBubble() {
  const b = $("gnBubble");
  b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
}
function guideCheer() {
  const f = $("gnFace");
  f.classList.remove("cheer"); void f.offsetWidth; f.classList.add("cheer");
}
function guideBurst(text) {
  const el = $("gnBurst");
  el.textContent = text;
  el.classList.remove("go"); void el.offsetWidth; el.classList.add("go");
}

function startGuiding(s) {
  navStop = s; navBearing = null; navLastDist = null; navWrong = 0; navBand = null;
  $("gnFace").textContent = mascotById(state.mascot).emoji;
  $("guideNav").classList.remove("hidden");
  startGeo();
  startCompass();
  updateStopGuide();
}
function stopGuiding() {
  navStop = null;
  $("guideNav").classList.add("hidden");
  stopCompass();
}

function updateStopGuide() {
  const s = navStop;
  if (!s || $("stopModal").classList.contains("hidden")) return;
  const box = $("guideNav"), say = $("gnSay"), steps = $("gnSteps");

  const guide = mascotById(state.mascot);
  $("gnFace").textContent = guide.emoji;

  if (!s.ll || !lastFix) {
    box.classList.add("searching");
    box.classList.remove("hot", "north-up", "arrived");
    navBand = null;
    say.textContent = s.ll
      ? "Hold on — let me find us on the map! 📍"
      : `Look for the ${s.emoji} sticker around ${s.name}! 🔍`;
    steps.textContent = s.ll ? "Turn on your location and I'll point the way." : "";
    $("gnFill").style.width = "0%";
    $("gnCompass").classList.add("hidden");
    return;
  }

  box.classList.remove("searching");
  const d = haversine(lastFix, s.ll);
  navBearing = bearingTo(lastFix, s.ll);
  paintArrow();

  // warmer / colder, from how the distance changed since the last fix — but only when
  // the move is bigger than the phone's own margin of error, or a child standing still
  // gets told they're going the wrong way by GPS drift alone
  const noise = moveNoise();
  let closedIn = false;
  if (navLastDist != null) {
    if (d < navLastDist - noise) { navWrong = 0; closedIn = d < navLastDist - noise * 1.7; }
    else if (d > navLastDist + noise) navWrong++;
  }
  const wasBand = navBand;
  navLastDist = d;

  box.classList.toggle("hot", d < Math.max(30, arriveRadius() + 10));
  box.classList.toggle("arrived", d < arriveRadius());   // swaps the arrow for a 🎯

  // the guide speaks: a fresh line each time the situation changes, held steady in between
  const band = guideBand(d, navWrong);
  const ctx = { name: state.name || "explorer", guide: guide.name, sticker: s.emoji, n: kidSteps(d) };
  if (band !== navBand) {
    navBand = band;
    navLine = Math.floor(Math.random() * GUIDE_LINES[band].length);
    popBubble();
    if (band !== "wrong" && wasBand != null) guideCheer();
  }
  say.textContent = GUIDE_LINES[band][navLine](ctx);

  const way = headingDeg != null ? "Follow my arrow ⬆️" : `Head ${dirName(navBearing)}`;
  steps.textContent = band === "arrived" ? "You're right by it — start hunting! 👀"
    : band === "close" ? "Start looking around for the sticker! 👀"
    : accNow() > FUZZY_M ? "My map is a bit blurry here 🌫️ — " + way.toLowerCase()
    : way;

  if (closedIn && band !== "arrived") guideBurst("🔥 warmer!");
  else if (navWrong === 1) guideBurst("❄️ colder…");

  // hotness bar: empty a couple of blocks away, full when you're on top of it
  $("gnFill").style.width = Math.round(Math.max(0, Math.min(1, 1 - d / 250)) * 100) + "%";
  offerCompass();
}

// The arrow points at the real spot when we know which way the phone is facing;
// otherwise the dial goes north-up (with an N marker) and the text names the direction.
function paintArrow() {
  if (navBearing == null) return;
  const rel = headingDeg != null ? (navBearing - headingDeg + 360) % 360 : navBearing;
  $("gnArrow").style.transform = `rotate(${rel}deg)`;
  $("guideNav").classList.toggle("north-up", headingDeg == null);
}

function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === "number" && isFinite(e.webkitCompassHeading)) h = e.webkitCompassHeading;
  else if (e.absolute && typeof e.alpha === "number" && isFinite(e.alpha)) h = (360 - e.alpha) % 360;
  if (h == null) return;
  headingDeg = h;
  paintArrow();                      // cheap: the text only changes on a GPS fix
}
function startCompass() {
  if (compassOn) return;
  compassOn = true;
  try {
    window.addEventListener("deviceorientationabsolute", onOrient, true);
    window.addEventListener("deviceorientation", onOrient, true);
  } catch {}
}
function stopCompass() {
  if (!compassOn) return;
  compassOn = false;
  try {
    window.removeEventListener("deviceorientationabsolute", onOrient, true);
    window.removeEventListener("deviceorientation", onOrient, true);
  } catch {}
}
// iPhones only hand over the compass after a tap, so offer a button when we need one
function needsCompassTap() {
  try { return typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function"; }
  catch { return false; }
}
function offerCompass() {
  $("gnCompass").classList.toggle("hidden", !(headingDeg == null && needsCompassTap()));
}
async function askCompass() {
  try {
    const r = await DeviceOrientationEvent.requestPermission();
    if (r === "granted") { startCompass(); $("gnCompass").classList.add("hidden"); }
    else $("gnCompass").textContent = "Compass is off — the arrow still points from the map 🗺️";
  } catch { $("gnCompass").classList.add("hidden"); }
}

// ---------- "Sticker Missing? Report it!" (bottom of the stop card) ----------
// Asks for a confirmation, then emails the grown-up who hid the stickers so the sign
// can be reprinted (the mail is sent server-side — see api/scan.js).
//
// A report ALSO stamps the stop, but only when it isn't stamped yet AND the child's
// phone confirms they are standing there (GPS within ~150 m), so a downed sign can
// never block them. Reporting from the couch just sends the alert.
const NEAR_M = 150;
function reportStickerMissing() {
  const s = activeStop;
  if (!s) return;
  const ok = typeof confirm !== "function" ||
    confirm(`Is the QR sticker at ${s.name} missing or damaged?\n\nWe'll email the grown-up who hid it so they can put a new one up.`);
  if (!ok) return;

  const dist = (s.ll && lastFix) ? haversine(lastFix, s.ll) : null;
  const canStamp = !isFound(s) && dist != null && dist <= NEAR_M;

  // "sticker_missing" = reported AND stamped on the spot; "sticker_report" = reported
  // only. Both email the hider; only the first one counts as a find.
  logEvent(canStamp ? "sticker_missing" : "sticker_report", s.id);

  if (canStamp) { closeStop(); startArrival(s.id); return; }

  if (isFound(s)) {
    flashCardNote("Thanks for telling us! We'll get a new sticker up there. 📬", true);
  } else if (dist == null) {
    startGeo();
    flashCardNote("Thanks, we told the grown-up! 📬 Turn on location and tap again while you're at the spot to still get your stamp. 📍", true);
  } else {
    flashCardNote(`Thanks, we told the grown-up! 📬 You're not at ${s.name} yet — tap again when you get there to still get your stamp. 🚶`, true);
  }
}
function flashCardNote(t, good) {
  const n = $("stopNote"); if (!n) return;
  n.textContent = t;
  n.classList.toggle("good", !!good);
  n.classList.remove("hidden");
}
function closeStop() {
  stopGuiding(); openCodeBox(false);
  $("stopModal").classList.add("hidden");
  maybeParty();
}

// ---------- in-app QR camera ("Scan sticker") ----------
// Scanning inside the app means no backing out to the phone's camera app. Decoding
// uses the browser's native BarcodeDetector where it exists (Android/Chrome) and
// falls back to the vendored jsQR on everything else (iOS Safari has no detector).
let camStream = null, camRaf = null, camDetector = null, camBusy = false, camFrame = 0;
let camCanvas = null, camCtx = null, camHintTimer = null, jsqrLoad = null;
const CAM_DEFAULT_HINT = "Point at the QR sticker 🎯";

function camSay(html, sticky) {
  const el = $("camHint"); if (!el || el.innerHTML === html) return;
  el.innerHTML = html;
  clearTimeout(camHintTimer);
  if (!sticky) camHintTimer = setTimeout(() => { $("camHint").innerHTML = CAM_DEFAULT_HINT; }, 2600);
}

// jsQR is ~130 KB, so it only loads the first time a phone actually needs it.
function loadJsQR() {
  if (window.jsQR) return Promise.resolve();
  if (!jsqrLoad) {
    jsqrLoad = new Promise((done) => {
      const t = document.createElement("script");
      t.src = "vendor/jsqr/jsQR.min.js";
      t.onload = () => done();
      t.onerror = () => { jsqrLoad = null; done(); };  // let a later try re-attempt
      document.head.appendChild(t);
    });
  }
  return jsqrLoad;
}

async function prepDecoder() {
  camDetector = null;
  try {
    if ("BarcodeDetector" in window) {
      const fmts = await window.BarcodeDetector.getSupportedFormats();
      if (fmts.includes("qr_code")) { camDetector = new window.BarcodeDetector({ formats: ["qr_code"] }); return; }
    }
  } catch { /* fall through to jsQR */ }
  await loadJsQR();
}

// Any camera dead end hands the child straight back to the card with the code box
// already open, so saying "no" to the camera never ends the hunt.
function fallBackToCode(why) {
  closeScanner();
  flashCardNote(why);
  openCodeBox(true);
}

async function openScanner() {
  if (camStream) return;                                  // already running
  armBack();
  $("scanCam").classList.remove("hidden");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    fallBackToCode("This phone won't let the app open the camera 📷 — type the code from the sticker instead.");
    return;
  }
  camSay("Asking to use your camera — tap <b>Allow</b> 📷", true);
  try {
    // facingMode as a plain hint (not exact) so laptops/tablets with one camera still work
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (e) {
    const name = (e && e.name) || "";
    fallBackToCode(name === "NotAllowedError" || name === "SecurityError"
      ? "No camera, no problem 🔒 — type the code printed on the sticker instead."
      : "Couldn't start the camera 😕 — type the code printed on the sticker instead.");
    return;
  }
  const v = $("camVideo");
  v.srcObject = camStream;
  try { await v.play(); } catch { /* some browsers autoplay it themselves */ }
  camSay(CAM_DEFAULT_HINT, true);
  await prepDecoder();
  if (!camStream) return;                                  // cancelled while we were loading
  if (!camDetector && !window.jsQR) {
    fallBackToCode("The scanner didn't load 😕 — type the code printed on the sticker instead.");
    return;
  }
  camBusy = false; camFrame = 0;
  camRaf = requestAnimationFrame(camTick);
}

function closeScanner() {
  if (camRaf) { cancelAnimationFrame(camRaf); camRaf = null; }
  clearTimeout(camHintTimer);
  camBusy = false;
  const v = $("camVideo");
  if (v) { try { v.pause(); v.srcObject = null; } catch {} }
  if (camStream) { try { camStream.getTracks().forEach((t) => t.stop()); } catch {} camStream = null; }
  $("scanCam").classList.add("hidden");
}

// ---------- typing the code in, from the stop card ----------
// Deliberately NOT part of the camera screen: a child who won't (or can't) allow the
// camera needs this waiting for them on the card, not behind the thing they said no to.
function openCodeBox(on) {
  $("codeForm").classList.toggle("hidden", !on);
  $("codeBtn").textContent = on ? "⌨️ Hide the code box" : "⌨️ Enter the code instead";
  const i = $("codeInput");
  if (on) {
    i.value = "";
    setTimeout(() => { try { i.focus(); i.scrollIntoView({ block: "center" }); } catch {} }, 60);
  } else { try { i.blur(); } catch {} }
}
function submitTypedCode(e) {
  if (e) e.preventDefault();
  const el = $("codeInput");
  const raw = (el.value || "").trim();
  if (!raw) return;
  // accept it however they type it: "A1F4C9", "a1 f4 c9", or the whole printed link
  const s = stopFromScan(raw) || stopFromScan(raw.toLowerCase().replace(/[^0-9a-z]/g, ""));
  if (!s) {
    flashCardNote("That code isn't one of ours 🤔 Check the sticker and try again.");
    el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake");
    try { el.select(); } catch {}
    return;
  }
  arriveAtStop(s);
}

function camTick() {
  camRaf = requestAnimationFrame(camTick);
  const v = $("camVideo");
  if (camBusy || !v.videoWidth) return;
  if (++camFrame % 3) return;                              // ~20 checks/sec is plenty
  camBusy = true;
  decodeFrame(v)
    .then((text) => { camBusy = false; if (text) onScanText(text); })
    .catch(() => { camBusy = false; });
}

async function decodeFrame(v) {
  if (camDetector) {
    const codes = await camDetector.detect(v);
    return codes && codes.length ? codes[0].rawValue : null;
  }
  if (!window.jsQR) return null;
  if (!camCanvas) {
    camCanvas = document.createElement("canvas");
    camCtx = camCanvas.getContext("2d", { willReadFrequently: true });
  }
  // downscale: a printed sticker still reads fine, and jsQR stays smooth on old phones
  const scale = Math.min(1, 540 / Math.max(v.videoWidth, v.videoHeight));
  const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
  if (camCanvas.width !== w || camCanvas.height !== h) { camCanvas.width = w; camCanvas.height = h; }
  camCtx.drawImage(v, 0, 0, w, h);
  const img = camCtx.getImageData(0, 0, w, h);
  const r = window.jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
  return r && r.data ? r.data : null;
}

// The sticker QR holds this app's address with ?c=<hex>. Accept the whole link, an
// older ?stop=<n> sticker, or a bare code someone typed onto a sign.
function stopFromScan(text) {
  const t = (text || "").trim();
  if (!t) return null;
  const c = t.match(/[?&]c=([0-9a-zA-Z]+)/);
  if (c && stopByCode(c[1])) return stopByCode(c[1]);
  const n = t.match(/[?&]stop=(\d+)/);
  if (n && stopById(+n[1])) return stopById(+n[1]);
  if (/^[0-9a-zA-Z]{4,12}$/.test(t) && stopByCode(t)) return stopByCode(t);
  return null;
}
function isOurLink(text) {
  try { return new URL(text, location.href).host === location.host; } catch { return false; }
}

function onScanText(text) {
  const s = stopFromScan(text);
  if (!s) {
    if (!isOurLink(text)) camSay("That's not a Quest sticker 🤔<br>Keep looking!");
    else if (/[?&](c|stop)=/.test(text)) camSay("That sticker is from another hunt 🗺️<br>Look for the spots on your map!");
    else camSay("That's the welcome poster 🏠<br>Look for a sticker at one of the map spots!");
    return;
  }
  arriveAtStop(s);
}

// scanned or typed, a correct code lands here: stamp it with the find animation
function arriveAtStop(s) {
  closeScanner();
  try { if (navigator.vibrate) navigator.vibrate(60); } catch {}
  closeStop();
  logEvent("scan", s.id);
  startArrival(s.id);
}

// never keep the camera on in the background
try {
  document.addEventListener("visibilitychange", () => { if (document.hidden) closeScanner(); });
  window.addEventListener("pagehide", closeScanner);
} catch {}

// ---------- the prize ----------
// A real thing, hidden somewhere real. Find enough stops and the child picks one of the
// grown-up's photos; picking it reveals where to go and collect it. The pictures live
// behind /api/prize and are only pulled when a prize is actually within one find, so a
// hunt with no prize set up costs nothing.
const PRIZE_KEY = "nq_prize";
let PRIZE = null;
let prizeAfterCard = false;
let prizePick = null;                      // what they've tapped, before confirming

const prizeOn = () => !!(PRIZE && PRIZE.enabled && PRIZE.prizes && PRIZE.prizes.length);
const prizeUnlocked = () => prizeOn() && foundCount() >= (PRIZE.need || 4);
const prizeWon = () => !!(state.prize && state.prize.id);
const prizeImg = (id) => "/api/prize?img=" + encodeURIComponent(id);
const prizeById = (id) => (prizeOn() ? PRIZE.prizes.find((p) => p.id === id) : null) || null;

async function loadPrize() {
  try { const c = JSON.parse(localStorage.getItem(PRIZE_KEY)); if (c) PRIZE = c; } catch {}
  if (!online()) return;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch("/api/prize", { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (r.ok) {
      const c = await r.json();
      if (c && typeof c === "object") {
        PRIZE = c;
        try { localStorage.setItem(PRIZE_KEY, JSON.stringify(c)); } catch {}
      }
    }
  } catch { /* offline: whatever we cached last time */ }
}

// Pull the pictures into the browser's cache BEFORE the big moment, so the reveal isn't
// five spinners on a weak signal. Only bothers once they're one find away.
function warmPrizeImages() {
  if (!prizeOn() || foundCount() < (PRIZE.need || 4) - 1) return;
  const ids = PRIZE.prizes.map((p) => p.id).concat(PRIZE.place && PRIZE.place.img ? [PRIZE.place.img] : []);
  ids.forEach((id) => { try { new Image().src = prizeImg(id); } catch {} });
}

function refreshPrizeButton() {
  const b = $("btnPrize"); if (!b) return;
  const show = prizeOn() && (prizeUnlocked() || prizeWon());
  b.classList.toggle("hidden", !show);
  if (show) $("btnPrizeText").textContent = prizeWon() ? "My prize" : "Pick your prize!";
  b.classList.toggle("ready", show && !prizeWon());
}

// Tapping 🎁 on the home hub: back to the picker if they haven't chosen, otherwise
// straight to "here's what you picked and where it is".
function openPrize() {
  if (!prizeOn()) return;
  if (prizeWon()) { showPrizePlace(); return; }
  if (prizeUnlocked()) openPrizePicker();
}

function openPrizePicker() {
  armBack();
  prizePick = null;
  const grid = $("prizeGrid"); grid.innerHTML = "";
  PRIZE.prizes.forEach((p) => {
    const b = document.createElement("button");
    b.className = "prize-opt";
    b.innerHTML = `<span class="po-shot" style="background-image:url('${prizeImg(p.id)}')"></span>` +
      (p.label ? `<span class="po-name">${escapeText(p.label)}</span>` : "");
    b.onclick = () => {
      prizePick = p.id;
      [...grid.children].forEach((c) => c.classList.toggle("sel", c === b));
      const take = $("prizeTake");
      take.disabled = false;
      take.textContent = p.label ? `Yes — the ${p.label}! 🎉` : "Yes, this one! 🎉";
    };
    grid.appendChild(b);
  });
  $("prizeTake").disabled = true;
  $("prizeTake").textContent = "Pick one first 👆";
  $("prizeSub").textContent = `You found ${foundCount()} treasures — one of these is yours!`;
  $("prizeModal").classList.remove("hidden");
  bigConfetti();
}

function takePrize() {
  if (!prizePick) return;
  const p = prizeById(prizePick);
  state.prize = { id: prizePick, label: (p && p.label) || "", ts: Date.now() };
  save(); syncDevice();
  // the grown-up has minutes, not hours, to get the thing to the hiding place
  logEvent("prize", null, { prize: (p && p.label) || prizePick, name: state.name || "" });
  $("prizeModal").classList.add("hidden");
  refreshPrizeButton();
  showPrizePlace();
}

function showPrizePlace() {
  armBack();
  const p = prizeById(state.prize && state.prize.id);
  const shot = $("prizePlaceShot");
  $("prizePicked").innerHTML = p
    ? `<span class="pp-shot" style="background-image:url('${prizeImg(p.id)}')"></span>` +
      `<span class="pp-name">${escapeText(p.label || "Your prize")} is yours!</span>`
    : "";
  const place = (PRIZE && PRIZE.place) || {};
  shot.classList.toggle("hidden", !place.img);
  if (place.img) shot.style.backgroundImage = `url('${prizeImg(place.img)}')`;
  $("prizePlaceText").textContent = place.text || "Ask a grown-up where to collect it!";
  $("prizePlaceModal").classList.remove("hidden");
  chime();
}
// belt and braces: the label comes from the grown-up's typing, so never trust it as HTML
function escapeText(s) { return (s + "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m])); }

// ---------- passport ----------
function openPassport() {
  armBack();
  const grid = $("passportGrid"); grid.innerHTML = "";
  STOPS.forEach((s) => {
    const got = isFound(s);
    const d = document.createElement("div");
    d.className = "slot" + (got ? " got" : "");
    d.innerHTML = got ? `<span class="sticker">${s.sticker}</span><small>${s.name}</small>` : `<span class="q">❓</span>`;
    grid.appendChild(d);
  });
  const n = foundCount();
  $("passportSub").textContent = huntEmpty() ? "Your passport is waiting for a hunt! 🗺️"
    : n >= STOPS.length ? "You collected them ALL! 🎉"
    : `You have ${n} of ${STOPS.length} treasures!`;
  $("passportModal").classList.remove("hidden");
}

// ---------- finish ----------
function finish() {
  armBack();
  logEvent("complete", null);
  const n = foundCount();
  $("finishName").textContent = state.name ? `You did it, ${state.name}! 🎉` : "You did it! 🎉";
  // A hunt that's still being hidden gets finished after one sticker, so don't claim the
  // whole neighborhood is done — say what's true and promise more.
  $("finishBlurb").textContent = n === 1
    ? "You found the treasure! Keep your eyes peeled — more stickers are on their way. 🕵️"
    : `You found all ${n} treasures! Keep your eyes peeled — more might appear. 🕵️`;
  $("finishStickers").textContent = STOPS.map((s) => s.sticker).join(" ");
  $("finishModal").classList.remove("hidden");
  bigConfetti();
}

// ---------- happy sound ----------
let actx = null;
function chime() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const now = actx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "triangle"; o.frequency.value = f; o.connect(g); g.connect(actx.destination);
      const t = now + i * 0.09;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      o.start(t); o.stop(t + 0.3);
    });
  } catch {}
}

// ---------- confetti ----------
const cvs = $("confetti"), cx = cvs.getContext("2d");
let parts = [], confettiRunning = false;
function sizeCanvas() { cvs.width = innerWidth; cvs.height = innerHeight; }
sizeCanvas(); addEventListener("resize", sizeCanvas);
function spawn(n, power) {
  const colors = ["#ff7aa8", "#ffd54b", "#7ecb73", "#5ec8ff", "#c79bff", "#ff9d3d"];
  for (let i = 0; i < n; i++) parts.push({
    x: innerWidth / 2, y: innerHeight * 0.4,
    vx: (Math.random() - 0.5) * power, vy: (Math.random() - 1) * power * 0.9,
    s: 6 + Math.random() * 8, c: colors[(Math.random() * colors.length) | 0],
    rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, life: 1,
  });
  if (!confettiRunning) { confettiRunning = true; requestAnimationFrame(tick); }
}
function tick() {
  cx.clearRect(0, 0, cvs.width, cvs.height);
  parts.forEach((p) => {
    p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 0.008;
    cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot);
    cx.globalAlpha = Math.max(0, p.life); cx.fillStyle = p.c;
    cx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); cx.restore();
  });
  parts = parts.filter((p) => p.life > 0 && p.y < cvs.height + 40);
  if (parts.length) requestAnimationFrame(tick);
  else { confettiRunning = false; cx.clearRect(0, 0, cvs.width, cvs.height); }
}
function miniConfetti() { spawn(45, 15); }
function bigConfetti() { spawn(160, 20); setTimeout(() => spawn(120, 18), 400); }

// ---------- wire up ----------
$("btnMap").onclick = () => {
  show("game"); refreshProgress();
  const left = STOPS.length - foundCount();
  say(huntEmpty() ? "The hunt is being set up — check back soon! 🗺️"
    : left > 0 ? `Explore the map and scan any QR sticker you find! ${left} treasure${left > 1 ? "s" : ""} left.`
    : "You found them all! 🏆");
};
$("btnPassport").onclick = openPassport;
$("btnPrize").onclick = openPrize;
$("prizeTake").onclick = takePrize;
$("prizePlaceDone").onclick = () => { $("prizePlaceModal").classList.add("hidden"); goHome(); };
// Change Guide is also where you fix your name — it's the only "this is me" screen
// after the first run, and a kid who typed "asdf" on day one shouldn't be stuck with it.
$("btnChangeGuide").onclick = () => {
  armBack();
  [...$("guideGrid").children].forEach((c, i) => c.classList.toggle("sel", MASCOTS[i].id === state.mascot));
  $("guideName").value = state.name || "";
  $("guideModal").classList.remove("hidden");
};
$("guideName").oninput = () => {
  state.name = $("guideName").value.trim().slice(0, 12);
  save();
  refreshGreeting();
};
$("closeGuide").onclick = () => {
  $("guideModal").classList.add("hidden");
  syncDevice();
  refreshGreeting();
  const m = mascotById(state.mascot);
  homeSpeak(state.name ? `Let's go exploring, ${state.name}! ${m.emoji}` : `Ready when you are! ${m.emoji}`);
};
$("btnHome").onclick = () => { if (backGuard) { try { history.back(); } catch { goMenu(); } } else goMenu(); };
$("btnDelete").onclick = deleteMyData;
$("btnInstall").onclick = installNow;
$("closeInstallHow").onclick = () => $("installModal").classList.add("hidden");
$("homeGuideBtn").onclick = guideChat;
$("passportBtn").onclick = openPassport;
$("closePassport").onclick = () => $("passportModal").classList.add("hidden");
$("closeStop").onclick = closeStop;
$("scanStickerBtn").onclick = openScanner;
$("camClose").onclick = closeScanner;
$("gnCompass").onclick = askCompass;
$("codeBtn").onclick = () => openCodeBox($("codeForm").classList.contains("hidden"));
$("codeForm").onsubmit = submitTypedCode;
$("stickerGoneBtn").onclick = reportStickerMissing;
$("scanSkip").onclick = skipArrival;
$("finishDone").onclick = () => {
  $("finishModal").classList.add("hidden");
  goHome();
  openPassport();      // the trophy cabinet, not a reset button
};

// ---------- install / Add to Home Screen ----------
let deferredPrompt = null;
let knownInstalled = false;
try {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); deferredPrompt = e;
    maybePromptInstall(); refreshInstallButton();
  });
  window.addEventListener("appinstalled", () => {
    knownInstalled = true;
    $("installBar").classList.add("hidden");
    refreshInstallButton();
  });
} catch {}

// ---------- the permanent "add me to your home screen" button ----------
// It disappears the moment the quest is running as an installed app, and on phones
// that can tell us (Chrome/Android) as soon as the app is on the device at all.
async function refreshInstallButton() {
  const b = $("btnInstall"); if (!b) return;
  let hide = isStandalone() || knownInstalled;
  if (!hide && navigator.getInstalledRelatedApps) {
    try {
      const apps = await navigator.getInstalledRelatedApps();
      if (apps && apps.length) { knownInstalled = true; hide = true; }
    } catch { /* not supported here — the button just stays */ }
  }
  b.classList.toggle("hidden", hide);
}
async function installNow() {
  if (deferredPrompt) {                          // Android/Chrome: real one-tap install
    try {
      deferredPrompt.prompt();
      const r = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (r && r.outcome === "accepted") knownInstalled = true;
    } catch {}
    refreshInstallButton();
    return;
  }
  showInstallHow();                              // everyone else: show them the steps
}
function showInstallHow() {
  armBack();
  const me = mascotById(state.mascot);
  const steps = isIOS()
    ? [`Tap the <b>Share</b> button ⬆️ at the bottom of Safari.`,
       `Scroll down and tap <b>Add to Home Screen</b>.`,
       `Tap <b>Add</b> — and ${me.name} ${me.emoji} lands on your home screen!`]
    : [`Open your browser's menu <b>⋮</b>.`,
       `Tap <b>Install app</b> (or <b>Add to Home screen</b>).`,
       `Confirm — and ${me.name} ${me.emoji} lands on your home screen!`];
  $("installSteps").innerHTML = steps.map((s) => `<li>${s}</li>`).join("");
  $("installModal").classList.remove("hidden");
}
function isStandalone() {
  try { return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true; }
  catch { return false; }
}
function isIOS() {
  try { return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream; } catch { return false; }
}
function maybePromptInstall() {
  try {
    if (isStandalone()) return;                              // already installed
    if (localStorage.getItem("nq_installDismissed")) return; // said "not now"
    const bar = $("installBar");
    if (deferredPrompt) {                          // Android/Chrome — real one-tap install
      $("installText").textContent = "Add Lakeland Quest to your home screen!";
      $("installAdd").style.display = "";
    } else if (isIOS()) {                           // iOS — no auto prompt, show the steps
      $("installText").innerHTML = "Add to Home Screen: tap Share ⬆️ then “Add to Home Screen”.";
      $("installAdd").style.display = "none";
    } else {                                        // anything else — point at the browser menu
      $("installText").innerHTML = "Add to your home screen: open your browser menu (⋮) → “Install app” / “Add to Home screen”.";
      $("installAdd").style.display = "none";
    }
    bar.classList.remove("hidden");
  } catch {}
}
$("installAdd").onclick = async () => {
  try {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const r = await deferredPrompt.userChoice;
    if (r && r.outcome === "accepted") knownInstalled = true;
  } catch {}
  deferredPrompt = null; $("installBar").classList.add("hidden");
  refreshInstallButton();
};
$("installClose").onclick = () => {
  $("installBar").classList.add("hidden");
  try { localStorage.setItem("nq_installDismissed", "1"); } catch {}
};

// register service worker (enables install + offline); harmless on file://
try {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
    // when a newly-deployed service worker takes over, reload once so the fresh
    // version shows up automatically (no manual cache-clearing needed).
    // ...but not on a page opened from a sticker. sw.js claims its clients as soon as it
    // activates, so this fires on a phone's FIRST visit and after every deploy — exactly
    // when a child is standing at a QR code — and the reload would replay the arrival and
    // log the same find twice.
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded || fromSticker) return; reloaded = true; location.reload();
    });
  }
} catch {}

// ---------- start: load the hider's published cards, then boot ----------
(async function start() {
  try { await loadConfig(); } catch { /* fall back to built-in STOPS */ }
  // The cached prize is applied synchronously here; the fresh copy lands a beat later and
  // never gates the map, a stamp, or the find animation.
  loadPrize().then(() => { refreshPrizeButton(); warmPrizeImages(); });
  resolveArrival();
  consumeArrivalParam();
  boot();
})();
