// The little icon Android puts in the status bar for a notification. It renders ONLY
// the alpha silhouette, tinted — so this has to be white-on-transparent. A full-colour
// icon here comes out as a plain white square.
//
//   node scripts/gen-badge.cjs .      -> writes badge-96.png
const zlib = require("zlib"), fs = require("fs"), path = require("path");
const DIR = process.argv[2] || ".";
const S = 96, SS = 4;                       // 4x supersampling for smooth edges

// a map pin: circle head, tapering to a point, with a hole punched in the middle
const CX = 48, CY = 38, R = 26, HOLE = 10, TIP = 90;
function inside(x, y) {
  const dx = x - CX, dy = y - CY;
  const inHead = dx * dx + dy * dy <= R * R;
  // triangle from the tip up to the widest points of the head
  const half = R * 0.86, top = CY + R * 0.42;
  const inTail = y >= top && y <= TIP &&
    Math.abs(dx) <= half * (1 - (y - top) / (TIP - top));
  if (!(inHead || inTail)) return false;
  return dx * dx + dy * dy > HOLE * HOLE;   // punch the hole
}

const px = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let hit = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        if (inside(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hit++;
      }
    }
    const i = (y * S + x) * 4;
    px[i] = px[i + 1] = px[i + 2] = 255;               // white
    px[i + 3] = Math.round((hit / (SS * SS)) * 255);   // coverage -> alpha
  }
}

// --- minimal PNG writer (RGBA, filter 0) ---
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
let TAB = null;
function crc32(buf) {
  if (!TAB) {
    TAB = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; TAB[n] = c; }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TAB[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return c ^ -1;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
]);
const out = path.join(DIR, "badge-96.png");
fs.writeFileSync(out, png);
console.log("wrote " + out + " (" + png.length + " bytes)");
