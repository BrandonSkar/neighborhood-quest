// Bump this each time you set NEW locations (a new "season"). On the next app
// open, every device resets its stamps automatically but KEEPS its name + guide,
// and rolls the old count into its lifetime total.
//
// NOTE: SEASON and STOPS below are the built-in DEFAULTS / offline fallback. Once you
// publish cards from setup.html they are stored in the backend (nq:config) and loaded
// over these by loadConfig() — see the bottom of this file. That's why they are `let`.
let SEASON = 1;

// ---- Guides the kid can choose from ----
const MASCOTS = [
  { id: "fox",    name: "Scout",   emoji: "🦊", color: "#ff8a3d", cheer: ["Wow, you found it!", "Adventure time!", "You're a super explorer!"] },
  { id: "cat",    name: "Mittens", emoji: "🐱", color: "#c79bff", cheer: ["Purr-fect!", "Meow, nice find!", "You're pawsome!"] },
  { id: "puppy",  name: "Pip",     emoji: "🐶", color: "#ffc24b", cheer: ["Woof woof, yay!", "Great sniffing!", "Good job, pal!"] },
  { id: "robot",  name: "Beep",    emoji: "🤖", color: "#5ec8ff", cheer: ["Treasure detected!", "Beep boop, success!", "Mission complete!"] },
  { id: "owl",    name: "Luna",    emoji: "🦉", color: "#8ce6b0", cheer: ["Hoo-ray, smart one!", "Wise move!", "You solved it!"] },
  { id: "dino",   name: "Rex",     emoji: "🦖", color: "#79c24a", cheer: ["ROAR-some job!", "Stomp stomp, yes!", "Dino-mite find!"] },
  { id: "bunny",  name: "Clover",  emoji: "🐰", color: "#ff9ec4", cheer: ["Hoppy days!", "Ear-resistible find!", "Some-bunny did great!"] },
  { id: "penguin",name: "Waddles", emoji: "🐧", color: "#5b8fd6", cheer: ["Slip-slidin' success!", "Waddle-tastic!", "Cool find, buddy!"] },
  { id: "bear",   name: "Honey",   emoji: "🐻", color: "#c98a4a", cheer: ["Beary good job!", "Paw-some!", "Sweet as honey!"] },
];

// ---- Stops around Lakeland Hills (Auburn, WA) ----
// pos = percent position on the map WORLD (x%, y%), traced from Google Maps.
// code = the unique hex value each QR sticker links to  ->  ...?c=<code>
let STOPS = [
  {
    id: 1, name: "Terminal Park School", emoji: "🏫", sticker: "🎒", color: "#ff9db1", pos: [20, 10],
    code: "a1f4c9",
    ll: [47.267724, -122.222273],
    intro: "You're at Terminal Park Elementary — welcome, explorer!",
    easy: "Give a big cheer for school! Find something with the letter A on it. 🔤",
    bonus: "How many letters are in the word SCHOOL? Try spelling it out loud!",
    answer: "S-C-H-O-O-L — that's 6 letters! 🔤",
  },
  {
    id: 2, name: "Lakeland Hills Park", emoji: "🎡", sticker: "🛝", color: "#7ecb73", pos: [40, 36],
    code: "b7c218",
    park: true,
    ll: [47.2595, -122.2113],
    intro: "Lakeland Hills Park! The big playground with room to run.",
    easy: "Go down a slide or swing up high — wheee! 🛝",
    bonus: "Riddle: I go up when you push and back when you pull. You sit on me at the park. What am I?",
    answer: "A swing! 🛝",
  },
  {
    id: 3, name: "Evergreen Park", emoji: "🌲", sticker: "🌲", color: "#ffb24b", pos: [69, 34],
    code: "3ed0aa",
    park: true,
    ll: [47.26072, -122.195542],
    intro: "Evergreen Park — surrounded by tall green trees!",
    easy: "Find the tallest tree you can and give it a big high-five! 🌲",
    bonus: "Evergreen trees stay green all year long. Can you name another thing that's always green?",
    answer: "Grass, pine trees, or even a frog! 🌲",
  },
  {
    id: 4, name: "Alcove Park", emoji: "🌳", sticker: "🍃", color: "#7ecb73", pos: [58, 65],
    code: "c95b2f",
    park: true,
    ll: [47.251373, -122.200515],
    intro: "Alcove Park — a little green hideaway!",
    easy: "Find a leaf and see how many colors are on it. 🍃",
    bonus: "Pick up a leaf and look closely — how many little lines (veins) can you spot?",
    answer: "Every leaf is different — nice looking! 🍃",
  },
  {
    id: 5, name: "Sunrise Montessori", emoji: "🎓", sticker: "☀️", color: "#5ec8ff", pos: [50, 59],
    code: "d3a0e7",
    ll: [47.2528, -122.2065],
    intro: "Sunrise Montessori — where little learners grow!",
    easy: "The sun rises in the east. Point which way you think is east! ☀️",
    bonus: "The sun rises in the east. So which direction does it set?",
    answer: "The west! 🌇",
  },
  {
    id: 6, name: "Lakeland Hills School", emoji: "🏫", sticker: "📚", color: "#4ec5c1", pos: [32, 55],
    code: "e2477b",
    ll: [47.2543, -122.2151],
    intro: "Lakeland Hills Elementary — right in the heart of the neighborhood!",
    easy: "Give the school a big wave and find a window to count. 🪟",
    bonus: "Guess how many windows are on the school, then count to check. Were you close?",
    answer: "You're a super counter! 🪟",
  },
  {
    id: 7, name: "Dorothy Bothell Park", emoji: "🛝", sticker: "🌸", color: "#ff7aa8", pos: [33, 47],
    code: "f0819d",
    park: true,
    ll: [47.2566, -122.2157],
    intro: "Dorothy Bothell Park — the little park with swings!",
    easy: "Find the swings and count how many there are! 🛝",
    bonus: "Riddle: I have a seat but no legs, and I swing back and forth all day. What am I?",
    answer: "A swing! 🛝",
  },
  {
    id: 8, name: "Sunset Park", emoji: "🌇", sticker: "🏆", color: "#ffd84b", pos: [39, 84],
    code: "9c6d31",
    park: true,
    ll: [47.2459, -122.2119],
    intro: "Sunset Park — a golden place to explore!",
    easy: "Strike a pose like you're watching a beautiful sunset! 🌇",
    bonus: "How many colors can you spot in a real sunset? Try to name three!",
    answer: "Red, orange, pink, purple — so pretty! 🌅",
  },
];

// find a stop by its QR hex code
function stopByCode(code) {
  return STOPS.find((s) => s.code === code) || null;
}

// ---------------------------------------------------------------------------
// Published cards (the hider's setup) live in the backend under nq:config. The
// setup page (setup.html) writes them; every player device reads them here so a
// new "exact coords" placement reaches all the kids' phones automatically.
//
// Order of preference on load:
//   1. the built-in STOPS above  (instant, offline, first-ever run)
//   2. a cached copy in localStorage  (instant, works offline / on file://)
//   3. a fresh copy from /api/config  (network, when online — becomes the cache)
// ---------------------------------------------------------------------------
const NQ_CONFIG_KEY = "nq_config";
const NQ_PALETTE = ["#ff9db1", "#7ecb73", "#ffb24b", "#5ec8ff", "#c79bff", "#ff7aa8", "#4ec5c1", "#ffd84b", "#8ce6b0", "#79c24a"];

// Turn a lean setup card {name, emoji, code, ll, park} into a full STOPS entry,
// auto-filling a friendly generic mission so the hider only enters name+emoji+pin.
function nqNormalizeStop(s, i) {
  const emoji = (s.emoji || "📍").toString();
  const name = (s.name || "Mystery Spot").toString();
  return {
    id: i + 1,
    name,
    emoji,
    sticker: s.sticker || emoji,
    color: s.color || NQ_PALETTE[i % NQ_PALETTE.length],
    code: s.code || Math.random().toString(16).slice(2, 8),
    ll: Array.isArray(s.ll) ? [Number(s.ll[0]), Number(s.ll[1])] : null,
    park: !!s.park,
    intro: s.intro || `You found ${name} — awesome exploring! 🎉`,
    easy: s.easy || `You made it to ${name}! Look all around and find something ${emoji}.`,
    bonus: s.bonus || `Big-kid challenge: how many things can you count from right here in 10 seconds?`,
    answer: s.answer || `Great counting — you're a super explorer! ⭐`,
  };
}

function nqApplyConfig(c) {
  if (!c || !Array.isArray(c.stops) || !c.stops.length) return false;
  STOPS = c.stops.map(nqNormalizeStop);
  if (Number.isInteger(c.season)) SEASON = c.season;
  return true;
}

function nqOnline() { return location.protocol === "http:" || location.protocol === "https:"; }

async function loadConfig() {
  // instant: cached copy (offline / file://)
  try { const c = JSON.parse(localStorage.getItem(NQ_CONFIG_KEY)); if (c) nqApplyConfig(c); } catch { /* keep defaults */ }
  // fresh: network, with a short timeout so a weak signal outdoors can't hang the app
  if (!nqOnline()) return;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch("/api/config", { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (r.ok) {
      const c = await r.json();
      if (c && Array.isArray(c.stops) && c.stops.length) {
        nqApplyConfig(c);
        try { localStorage.setItem(NQ_CONFIG_KEY, JSON.stringify(c)); } catch { /* private mode */ }
      }
    }
  } catch { /* offline / timeout -> defaults or cache */ }
}
