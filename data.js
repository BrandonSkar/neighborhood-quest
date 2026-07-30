// Bump this each time you set NEW locations (a new "season"). On the next app
// open, every device resets its stamps automatically but KEEPS its name + guide,
// and rolls the old count into its lifetime total.
//
// NOTE: SEASON and STOPS below are the built-in DEFAULTS / offline fallback. Once you
// publish cards from setup.html they are stored in the backend (nq:config) and loaded
// over these by loadConfig() — see the bottom of this file. That's why they are `let`.
let SEASON = 1;

// ---- Guides the kid can choose from ----
// `cheer` is what they say when you tap them on the home hub. Plenty of lines each, in
// their own voice, and app.js never plays the same one twice running.
const MASCOTS = [
  { id: "fox",    name: "Scout",   emoji: "🦊", color: "#ff8a3d", cheer: [
    "Wow, you found it! 🎉", "Adventure time! 🗺️", "You're a super explorer! ⭐",
    "My nose says treasure is THAT way! 👃", "Foxes love a good sneaky hunt. 🦊",
    "Wanna race to the next one? 💨", "I've got my adventure boots on! 🥾",
    "Shhh… I think I hear a treasure. 👂", "Best. Team. Ever. 🧡"] },
  { id: "cat",    name: "Mittens", emoji: "🐱", color: "#c79bff", cheer: [
    "Purr-fect! 💜", "Meow, nice find! 🐾", "You're pawsome! 🐾",
    "I napped for nine hours. Ready now! 😸", "Cats always land on the treasure. 🐱",
    "Let's go before I find a sunny spot… ☀️", "You may pet me. Then we walk. 💜",
    "Sniff sniff — smells like adventure! 👃", "Whiskers twitching, that means treasure! 〰️"] },
  { id: "puppy",  name: "Pip",     emoji: "🐶", color: "#ffc24b", cheer: [
    "Woof woof, yay! 🎉", "Great sniffing! 👃", "Good job, pal! 🦴",
    "WALK?! Did somebody say WALK?! 🐕", "My tail is wagging SO hard right now! 💛",
    "You're my favourite human. 🥰", "I'd find every treasure for one belly rub. 🐾",
    "Let's go let's go let's GO! 💨", "I'm a very good boy AND a very good guide. 🏅"] },
  { id: "robot",  name: "Beep",    emoji: "🤖", color: "#5ec8ff", cheer: [
    "Treasure detected! 📡", "Beep boop, success! 🔵", "Mission complete! ✅",
    "Recharging… ok, done. Let's go! ⚡", "Scanning neighborhood… adventure found. 🛰️",
    "My circuits say you're awesome. 💙", "Beep. Boop. Beep. (That means hooray!) 🎉",
    "Calculating fun levels… they are HIGH. 📈", "Explorer mode: ON. 🔛"] },
  { id: "owl",    name: "Luna",    emoji: "🦉", color: "#8ce6b0", cheer: [
    "Hoo-ray, smart one! 🌟", "Wise move! 📖", "You solved it! 🧠",
    "Hoo goes exploring today? YOU do! 🦉", "I see everything from up here. 👁️",
    "A clever explorer looks up as well as down. 🌳", "Twit-twoo — that means 'nice work'. 💚",
    "Owls know all the best hiding places. 🌙", "Big brain, bigger adventure! 🧭"] },
  { id: "dino",   name: "Rex",     emoji: "🦖", color: "#79c24a", cheer: [
    "ROAR-some job! 🦖", "Stomp stomp, yes! 👣", "Dino-mite find! 💥",
    "RAWR! (That's dinosaur for hello.) 🦕", "My little arms can't hug, but I would. 💚",
    "Stomping makes the walking more fun! 👣", "I'm 65 million years old and STILL exploring. 🌋",
    "Let's make some dino-sized footprints! 🦶", "Nothing scares us. Except broccoli. 🥦"] },
  { id: "bunny",  name: "Clover",  emoji: "🐰", color: "#ff9ec4", cheer: [
    "Hoppy days! 🐇", "Ear-resistible find! 👂", "Some-bunny did great! 💗",
    "Hop hop hop — try it, it's faster! 🐰", "My ears heard a treasure that way! 👂",
    "You're my lucky clover. 🍀", "Ready to bounce? 🎀", "Wiggle your nose for good luck! 👃",
    "Carrots later, adventure now! 🥕"] },
  { id: "penguin",name: "Waddles", emoji: "🐧", color: "#5b8fd6", cheer: [
    "Slip-slidin' success! ⛸️", "Waddle-tastic! 🐧", "Cool find, buddy! ❄️",
    "Waddle with me — left, right, left! 👣", "I'd slide there if there was snow. 🏔️",
    "Penguins stick together. Always. 💙", "Brrr-illiant work! ❄️", "Flap flap! I'm cheering! 🎉",
    "I brought snacks. Fish, mostly. 🐟"] },
  { id: "bear",   name: "Honey",   emoji: "🐻", color: "#c98a4a", cheer: [
    "Beary good job! 🐻", "Paw-some! 🐾", "Sweet as honey! 🍯",
    "Big bear hug for you! 🤗", "I know every berry bush around here. 🫐",
    "Slow and steady finds the treasure. 🐢", "That deserves a honey break. 🍯",
    "You're un-bear-ably good at this! 💛", "Let's lumber on, explorer! 🐾"] },
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
    quiz: { q: "How many letters are in the word SCHOOL?", choices: ["5","6","7"], correct: 1 },
  },
  {
    id: 2, name: "Lakeland Hills Park", emoji: "🎡", sticker: "🛝", color: "#7ecb73", pos: [40, 36],
    code: "b7c218",
    park: true,
    ll: [47.2595, -122.2113],
    intro: "Lakeland Hills Park! The big playground with room to run.",
    easy: "Go down a slide or swing up high — wheee! 🛝",
    quiz: { q: "I go up when you push me and back when you pull. What am I?", choices: ["A slide","A swing","A tree"], correct: 1 },
  },
  {
    id: 3, name: "Evergreen Park", emoji: "🌲", sticker: "🌲", color: "#ffb24b", pos: [69, 34],
    code: "3ed0aa",
    park: true,
    ll: [47.26072, -122.195542],
    intro: "Evergreen Park — surrounded by tall green trees!",
    easy: "Find the tallest tree you can and give it a big high-five! 🌲",
    quiz: { q: "What do evergreen trees do all winter long?", choices: ["Stay green","Turn blue","Lose every leaf"], correct: 0 },
  },
  {
    id: 4, name: "Alcove Park", emoji: "🌳", sticker: "🍃", color: "#7ecb73", pos: [58, 65],
    code: "c95b2f",
    park: true,
    ll: [47.251373, -122.200515],
    intro: "Alcove Park — a little green hideaway!",
    easy: "Find a leaf and see how many colors are on it. 🍃",
    quiz: { q: "What are the little lines on a leaf called?", choices: ["Veins","Roots","Branches"], correct: 0 },
  },
  {
    id: 5, name: "Sunrise Montessori", emoji: "🎓", sticker: "☀️", color: "#5ec8ff", pos: [50, 59],
    code: "d3a0e7",
    ll: [47.2528, -122.2065],
    intro: "Sunrise Montessori — where little learners grow!",
    easy: "The sun rises in the east. Point which way you think is east! ☀️",
    quiz: { q: "The sun rises in the east. Which way does it set?", choices: ["North","West","South"], correct: 1 },
  },
  {
    id: 6, name: "Lakeland Hills School", emoji: "🏫", sticker: "📚", color: "#4ec5c1", pos: [32, 55],
    code: "e2477b",
    ll: [47.2543, -122.2151],
    intro: "Lakeland Hills Elementary — right in the heart of the neighborhood!",
    easy: "Give the school a big wave and find a window to count. 🪟",
    quiz: { q: "What do you call the person who teaches your class?", choices: ["A teacher","A chef","A pilot"], correct: 0 },
  },
  {
    id: 7, name: "Dorothy Bothell Park", emoji: "🛝", sticker: "🌸", color: "#ff7aa8", pos: [33, 47],
    code: "f0819d",
    park: true,
    ll: [47.2566, -122.2157],
    intro: "Dorothy Bothell Park — the little park with swings!",
    easy: "Find the swings and count how many there are! 🛝",
    quiz: { q: "I have a seat but no legs, and I swing all day. What am I?", choices: ["A swing","A slide","A bench"], correct: 0 },
  },
  {
    id: 8, name: "Sunset Park", emoji: "🌇", sticker: "🏆", color: "#ffd84b", pos: [39, 84],
    code: "9c6d31",
    park: true,
    ll: [47.2459, -122.2119],
    intro: "Sunset Park — a golden place to explore!",
    easy: "Strike a pose like you're watching a beautiful sunset! 🌇",
    quiz: { q: "Which color do you often see in a sunset?", choices: ["Orange","Black","Grey"], correct: 0 },
  },
];

// Snapshot of the built-in stops, taken before any published config replaces STOPS.
// Saves from before the "publish" feature stored numeric stop ids relative to THIS
// list, so the id -> code migration in app.js has to resolve against it.
const DEFAULT_STOPS = STOPS.slice();

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

// A stop's quiz: one question, up to three answers, one of them right. Anything
// half-filled in the setup editor just means "no quiz on this card".
function nqNormalizeQuiz(q) {
  if (!q || typeof q !== "object") return null;
  const question = (q.q || "").toString().trim();
  const choices = (Array.isArray(q.choices) ? q.choices : []).map((c) => (c || "").toString().trim()).filter(Boolean).slice(0, 3);
  if (!question || choices.length < 2) return null;
  const correct = Number.isInteger(q.correct) && q.correct >= 0 && q.correct < choices.length ? q.correct : 0;
  return { q: question, choices, correct };
}

// Turn a lean setup card {name, emoji, code, ll, park, quiz} into a full STOPS entry,
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
    quiz: nqNormalizeQuiz(s.quiz),
  };
}

// The published set can include blank cards — stickers that are printed but not taped up
// anywhere yet. Kids only ever see the ones with a real name and a dropped pin, so a
// half-finished hunt never shows a mystery pin or inflates "3 / 9 treasures".
//
// An empty result still counts as applied: once the hider has published anything, that
// IS the hunt, and quietly falling back to the built-in demo stops would put phantom
// Lakeland stops on every kid's map mid-setup.
function nqApplyConfig(c) {
  if (!c || !Array.isArray(c.stops)) return false;
  const live = c.stops.filter((s) => s && (s.name || "").toString().trim() &&
    Array.isArray(s.ll) && s.ll.length === 2);
  STOPS = live.map(nqNormalizeStop);
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
      if (c && Array.isArray(c.stops)) {
        nqApplyConfig(c);
        try { localStorage.setItem(NQ_CONFIG_KEY, JSON.stringify(c)); } catch { /* private mode */ }
      } else if (c && !c.note) {
        // Database is connected and holds no cards at all — the hunt hasn't been set up
        // yet, or it was wiped. Show an empty map and say so, rather than the built-in
        // demo stops: those are real streets in Auburn that nobody has stickered.
        // (`note` means there's no database at all, where the demo IS the right answer.)
        STOPS = [];
        if (Number.isInteger(c.season)) SEASON = c.season;
        try { localStorage.removeItem(NQ_CONFIG_KEY); } catch {}
      }
    }
  } catch { /* offline / timeout -> defaults or cache */ }
}
