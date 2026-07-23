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

// ---------- read the QR: ?c=<hex> (preferred) or ?stop=<n> ----------
const params = new URLSearchParams(location.search);
const codeParam = params.get("c");
const stopParam = parseInt(params.get("stop"), 10);
let arrivalStopId = null;
if (codeParam && stopByCode(codeParam)) arrivalStopId = stopByCode(codeParam).id;
else if (!isNaN(stopParam) && stopById(stopParam)) arrivalStopId = stopParam;

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
  if (event === "scan") { st.scans++; if (stop) st.perStop[stop] = (st.perStop[stop] || 0) + 1; }
  if (event === "complete") st.completions++;
  localStorage.setItem("nq_stats", JSON.stringify(st));
}
function logEvent(event, stop) {
  localBump(event, stop);
  if (location.protocol === "http:" || location.protocol === "https:") {
    try {
      fetch("/api/scan", {
        method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
        body: JSON.stringify({ session: sid(), stop: stop || null, event, mascot: state.mascot || null }),
      }).catch(() => {});
    } catch {}
  }
}

// ---------- screen manager ----------
function show(id) {
  ["picker", "home", "game"].forEach((s) => $(s).classList.toggle("hidden", s !== id));
  if (id === "game") setupMapView(false);
}

// ---------- pannable / zoomable map (clamped to boundaries) ----------
const WORLD_W = 1520, WORLD_H = 1230;
const COMPACT_RATIO = 1.7; // below minScale*this, pins collapse to little map dots
let mapScale = 1, mapTx = 0, mapTy = 0, minScale = 0.2, maxScale = 1, mapReady = false, mapMoved = 0;

function applyMapTransform() {
  const world = $("mapWorld"), markers = $("markers");
  if (world) world.style.transform = `translate(${mapTx}px,${mapTy}px) scale(${mapScale})`;
  if (markers) {
    const inv = 1 / mapScale;
    // zoomed out far -> small Google-style pins; zoomed in -> full picture + name
    markers.classList.toggle("compact", minScale > 0 && mapScale < minScale * COMPACT_RATIO);
    for (const m of markers.children) m.style.transform = `translate(-50%,-50%) scale(${inv})`;
  }
}
function clampMap() {
  const map = $("map"); if (!map) return;
  const vw = map.clientWidth, vh = map.clientHeight; if (!vw || !vh) return;
  const ww = WORLD_W * mapScale, wh = WORLD_H * mapScale;
  mapTx = ww <= vw ? (vw - ww) / 2 : Math.min(0, Math.max(vw - ww, mapTx));
  mapTy = wh <= vh ? (vh - wh) / 2 : Math.min(0, Math.max(vh - wh, mapTy));
}
function setupMapView(reset) {
  const map = $("map"); if (!map) return;
  const vw = map.clientWidth, vh = map.clientHeight; if (!vw || !vh) return;
  minScale = Math.min(vw / WORLD_W, vh / WORLD_H); // whole map fits (can't zoom out past this)
  maxScale = minScale * 3.5;
  if (reset || !mapReady) {
    mapScale = Math.min(maxScale, minScale * 2.2);  // start zoomed in enough to show full icon pins (above COMPACT_RATIO)
    mapTx = (vw - WORLD_W * mapScale) / 2;
    mapTy = (vh - WORLD_H * mapScale) / 2;
    mapReady = true;
  } else {
    mapScale = Math.min(maxScale, Math.max(minScale, mapScale));
  }
  clampMap(); applyMapTransform();
}
function zoomMap(factor) {
  const map = $("map"); if (!map) return;
  const vw = map.clientWidth, vh = map.clientHeight;
  const cx = vw / 2, cy = vh / 2;
  const ns = Math.min(maxScale, Math.max(minScale, mapScale * factor));
  mapTx = cx - (cx - mapTx) * (ns / mapScale); // keep the screen centre pinned while zooming
  mapTy = cy - (cy - mapTy) * (ns / mapScale);
  mapScale = ns; clampMap(); applyMapTransform();
}
function initMapPan() {
  const map = $("map"); if (!map || !map.addEventListener) return;
  const pts = new Map();               // active pointers (for 1-finger pan + 2-finger pinch)
  let dragging = false, sx = 0, sy = 0, stx = 0, sty = 0;
  let pinch = null;                    // {dist, cx, cy, scale, tx, ty}
  const rect = () => (map.getBoundingClientRect ? map.getBoundingClientRect() : { left: 0, top: 0 });

  function startPinch() {
    const [a, b] = [...pts.values()];
    const r = rect();
    pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top,
      scale: mapScale, tx: mapTx, ty: mapTy,
    };
  }
  function doPinch() {
    const [a, b] = [...pts.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (!pinch || !pinch.dist) return;
    const ns = Math.min(maxScale, Math.max(minScale, pinch.scale * (dist / pinch.dist)));
    const k = ns / pinch.scale;
    mapTx = pinch.cx - (pinch.cx - pinch.tx) * k;
    mapTy = pinch.cy - (pinch.cy - pinch.ty) * k;
    mapScale = ns; mapMoved = 99; clampMap(); applyMapTransform();
  }

  map.addEventListener("pointerdown", (e) => {
    if (e.target.closest && e.target.closest(".zoombtn")) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { dragging = true; mapMoved = 0; sx = e.clientX; sy = e.clientY; stx = mapTx; sty = mapTy; map.classList.add("grabbing"); }
    else if (pts.size === 2) { dragging = false; startPinch(); }
  });
  map.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2 && pinch) { doPinch(); return; }
    if (dragging) {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      mapMoved = Math.max(mapMoved, Math.hypot(dx, dy));
      mapTx = stx + dx; mapTy = sty + dy; clampMap(); applyMapTransform();
    }
  });
  function endPtr(e) {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) { dragging = false; map.classList.remove("grabbing"); }
    else if (pts.size === 1) { const [p] = [...pts.values()]; dragging = true; mapMoved = 99; sx = p.x; sy = p.y; stx = mapTx; sty = mapTy; }
  }
  map.addEventListener("pointerup", endPtr);
  map.addEventListener("pointercancel", endPtr);

  const zi = $("zoomIn"), zo = $("zoomOut");
  if (zi) zi.onclick = () => zoomMap(1.3);
  if (zo) zo.onclick = () => zoomMap(1 / 1.3);
}
try { addEventListener("resize", () => setupMapView(false)); addEventListener("orientationchange", () => setTimeout(() => setupMapView(false), 250)); } catch {}

// ---------- boot ----------
function boot() {
  buildMarkers();
  initMapPan();
  $("progressTotal").textContent = STOPS.length;
  $("hpTotal").textContent = STOPS.length;
  renderMascotButtons($("mascotGrid"), false);
  renderMascotButtons($("guideGrid"), true);

  if (state.mascot) {
    applyGuide();
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
        state.mascot = m.id; save(); applyGuide();
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
  save(); applyGuide();
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
function goHome() {
  show("home");
  const m = mascotById(state.mascot);
  $("homeGreeting").textContent = state.name ? `Hi, ${state.name}!` : "Hi, Explorer!";
  homeSpeak(`I'm ${m.name} ${m.emoji}. Ready for an adventure?`);
  refreshProgress();
  maybePromptInstall();
}
function homeSpeak(t) { $("homeSpeech").textContent = t; }
function say(t) { $("speech").textContent = t; }

// ---------- markers / map ----------
function buildMarkers() {
  const wrap = $("markers");
  wrap.innerHTML = "";
  STOPS.forEach((s) => {
    const b = document.createElement("button");
    b.className = "marker";
    b.style.left = s.pos[0] + "%";
    b.style.top = s.pos[1] + "%";
    b.style.setProperty("--mc", s.color);
    b.dataset.id = s.id;
    b.innerHTML =
      `<div class="mini"></div>` +
      `<div class="pin">${s.emoji}<span class="stamp">${s.sticker}</span></div>` +
      `<div class="lbl">${s.name}</div>`;
    b.onclick = () => { if (mapMoved > 8) return; openStop(s.id); }; // ignore taps that were drags; map never stamps
    wrap.appendChild(b);
  });
}
// Every stop is independent (no order) — markers just show found vs not-found.
function refreshMarkers() {
  [...$("markers").children].forEach((b) => {
    b.classList.toggle("done", state.visited.includes(+b.dataset.id));
  });
}
function refreshProgress() {
  const n = state.visited.length, total = STOPS.length;
  $("progressNow").textContent = n;
  $("hpNow").textContent = n;
  $("hpFill").style.width = (n / total * 100) + "%";
  refreshMarkers();
}

// ---------- scan arrival animation ----------
let scanTimers = [];
let pendingStopId = null;
function clearScanTimers() { scanTimers.forEach(clearTimeout); scanTimers = []; }
function startArrival(id, viaQR = true) {
  const s = stopById(id); if (!s) return;
  pendingStopId = id;
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
  if (state.visited.length >= STOPS.length) { show("game"); finish(); return; }
  show("game");
  openStop(id);
}
function skipArrival() {
  if (pendingStopId == null) return;
  clearScanTimers();
  earnSticker(pendingStopId);
  finishArrival();
}

function earnSticker(id) {
  const first = !state.visited.includes(id);
  if (first) { state.visited.push(id); save(); }
  refreshProgress();
  return first;
}

// ---------- stop card (read-only) ----------
// Found stops show the full mission recap. Un-found stops show a "go scan it"
// message and hide the mission — you can only stamp by scanning the real QR.
let activeStop = null;
function openStop(id) {
  const s = stopById(id); if (!s) return;
  activeStop = s;
  const found = state.visited.includes(id);
  $("cardGuide").textContent = mascotById(state.mascot).emoji;
  $("stopName").textContent = s.name;
  $("stopAnswer").classList.add("hidden");
  $("bonusBox").classList.add("hidden");
  $("bonusToggle").textContent = "🧠 Big Kid Challenge";
  if (found) {
    $("stopBadge").textContent = s.emoji;
    $("stopIntro").textContent = s.intro;
    $("stopEasy").textContent = s.easy;
    $("stopBonus").textContent = s.bonus;
    $("stopAnswer").textContent = s.answer;
    $("missionWrap").classList.remove("hidden");
    $("bonusToggle").classList.remove("hidden");
  } else {
    $("stopBadge").textContent = "❓";
    $("stopIntro").textContent = `You haven't found this one yet! Look for the QR sticker at ${s.name} and scan it to stamp your passport. 🔍`;
    $("missionWrap").classList.add("hidden");
    $("bonusToggle").classList.add("hidden");
  }
  $("stopModal").classList.remove("hidden");
  stopSpeaking();
}
function closeStop() { $("stopModal").classList.add("hidden"); stopSpeaking(); }

// ---------- passport ----------
function openPassport() {
  const grid = $("passportGrid"); grid.innerHTML = "";
  STOPS.forEach((s) => {
    const got = state.visited.includes(s.id);
    const d = document.createElement("div");
    d.className = "slot" + (got ? " got" : "");
    d.innerHTML = got ? `${s.sticker}<small>${s.name}</small>` : `<span class="q">❓</span>`;
    grid.appendChild(d);
  });
  $("passportSub").textContent = state.visited.length >= STOPS.length
    ? "You collected them ALL! 🎉" : `You have ${state.visited.length} of ${STOPS.length} treasures!`;
  $("passportModal").classList.remove("hidden");
}

// ---------- finish ----------
function finish() {
  logEvent("complete", null);
  $("finishName").textContent = state.name ? `You did it, ${state.name}! 🎉` : "You did it! 🎉";
  $("finishStickers").textContent = STOPS.map((s) => s.sticker).join(" ");
  $("finishModal").classList.remove("hidden");
  bigConfetti();
}

// ---------- read-aloud ----------
function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  $("readBtn").classList.remove("on");
}
function readAloud() {
  if (!("speechSynthesis" in window) || !activeStop) return;
  if (window.speechSynthesis.speaking) { stopSpeaking(); return; }
  const u = new SpeechSynthesisUtterance(activeStop.intro + " " + activeStop.easy);
  u.rate = 0.92; u.pitch = 1.15;
  u.onend = () => $("readBtn").classList.remove("on");
  $("readBtn").classList.add("on");
  window.speechSynthesis.speak(u);
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
  const left = STOPS.length - state.visited.length;
  say(left > 0 ? `Explore the map and scan any QR sticker you find! ${left} treasure${left > 1 ? "s" : ""} left.` : "You found them all! 🏆");
};
$("btnPassport").onclick = openPassport;
$("btnChangeGuide").onclick = () => {
  [...$("guideGrid").children].forEach((c, i) => c.classList.toggle("sel", MASCOTS[i].id === state.mascot));
  $("guideModal").classList.remove("hidden");
};
$("closeGuide").onclick = () => $("guideModal").classList.add("hidden");
$("btnHome").onclick = goHome;
$("homeGuideBtn").onclick = () => {
  const m = mascotById(state.mascot);
  homeSpeak(m.cheer[Math.floor(Math.random() * m.cheer.length)] + " 🌟");
};
$("passportBtn").onclick = openPassport;
$("closePassport").onclick = () => $("passportModal").classList.add("hidden");
$("closeStop").onclick = closeStop;
$("readBtn").onclick = readAloud;
$("bonusToggle").onclick = () => {
  const hidden = $("bonusBox").classList.toggle("hidden");
  $("bonusToggle").textContent = hidden ? "🧠 Big Kid Challenge" : "🙈 Hide Challenge";
};
$("revealBtn").onclick = () => $("stopAnswer").classList.remove("hidden");
$("scanSkip").onclick = skipArrival;
$("playAgain").onclick = () => {
  state.visited = []; save();
  $("finishModal").classList.add("hidden");
  refreshProgress(); goHome();
};

// ---------- install / Add to Home Screen ----------
let deferredPrompt = null;
try {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; });
  window.addEventListener("appinstalled", () => { $("installBar").classList.add("hidden"); });
} catch {}
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
  try { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; } catch {}
  deferredPrompt = null; $("installBar").classList.add("hidden");
};
$("installClose").onclick = () => {
  $("installBar").classList.add("hidden");
  try { localStorage.setItem("nq_installDismissed", "1"); } catch {}
};

// ---------- TEMPORARY debug: wipe all saved data and start fresh (remove for launch) ----------
{
  const dbg = $("debugReset");
  if (dbg) dbg.onclick = () => {
    if (typeof confirm === "function" && !confirm("DEBUG: erase ALL saved data (profile, stamps, stats) and start over?")) return;
    ["nq_state_v2", "nq_stats", "nq_sid", "nq_installDismissed"].forEach((k) => { try { localStorage.removeItem(k); } catch {} });
    try { location.reload(); } catch {}
  };
}

// register service worker (enables install + offline); harmless on file://
try {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
    // when a newly-deployed service worker takes over, reload once so the fresh
    // version shows up automatically (no manual cache-clearing needed).
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return; reloaded = true; location.reload();
    });
  }
} catch {}

boot();
