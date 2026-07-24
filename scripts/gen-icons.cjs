// App icons are the fox in scripts/icon.html. Regenerate:
//   1) render the 512 with headless Chrome:
//      chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \n//        --virtual-time-budget=2500 --screenshot=icon-512.png --window-size=512,512 scripts/icon.html
//   2) downscale to 192 + 180 (small headless windows render blank, so we resize):
//      node scripts/gen-icons.cjs .   (reads icon-512.png, writes icon-192.png + apple-touch-icon.png)

const zlib = require("zlib"), fs = require("fs");
const DIR = process.argv[2];

function decodePNG(buf) {
  let p = 8, W, H, bd, ct; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.slice(p + 8, p + 8 + len);
    if (type === "IHDR") { W = data.readUInt32BE(0); H = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 4 ? 2 : 1;
  const bpp = ch * (bd / 8), stride = W * bpp;
  const out = Buffer.alloc(H * stride); let ip = 0;
  for (let y = 0; y < H; y++) {
    const filter = raw[ip++];
    for (let xb = 0; xb < stride; xb++) {
      const cur = raw[ip++];
      const a = xb >= bpp ? out[y * stride + xb - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + xb] : 0;
      const c = (xb >= bpp && y > 0) ? out[(y - 1) * stride + xb - bpp] : 0;
      let v;
      if (filter === 0) v = cur;
      else if (filter === 1) v = cur + a;
      else if (filter === 2) v = cur + b;
      else if (filter === 3) v = cur + ((a + b) >> 1);
      else { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = cur + ((pa <= pb && pa <= pc) ? a : (pb <= pc) ? b : c); }
      out[y * stride + xb] = v & 255;
    }
  }
  return { W, H, ch, data: out };
}

function downscale(src, W, H, ch, T) {
  const out = Buffer.alloc(T * T * 4); const sx = W / T, sy = H / T;
  for (let y = 0; y < T; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < T; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * W + xx) * ch;
        r += src[i]; g += src[i + 1]; b += src[i + 2]; a += ch === 4 ? src[i + 3] : 255; n++;
      }
      const o = (y * T + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return out;
}

function crc32(buf){let c=~0;for(let i=0;i<buf.length;i++){c^=buf[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return (~c)>>>0;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const ty=Buffer.from(t,"ascii");const cr=Buffer.alloc(4);cr.writeUInt32BE(crc32(Buffer.concat([ty,d])),0);return Buffer.concat([l,ty,d,cr]);}
function encode(rgba, S) {
  const raw = Buffer.alloc(S * (S * 4 + 1)); let o = 0, ip = 0;
  for (let y = 0; y < S; y++) { raw[o++] = 0; for (let x = 0; x < S * 4; x++) raw[o++] = rgba[ip++]; }
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S,0); ihdr.writeUInt32BE(S,4); ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([sig, chunk("IHDR",ihdr), chunk("IDAT", zlib.deflateSync(raw,{level:9})), chunk("IEND",Buffer.alloc(0))]);
}

const src = decodePNG(fs.readFileSync(DIR + "/icon-512.png"));
console.log("source:", src.W + "x" + src.H, "ch=" + src.ch);
for (const [name, T] of [["icon-192.png", 192], ["apple-touch-icon.png", 180]]) {
  const small = downscale(src.data, src.W, src.H, src.ch, T);
  fs.writeFileSync(DIR + "/" + name, encode(small, T));
  console.log("wrote", name, T + "x" + T);
}
