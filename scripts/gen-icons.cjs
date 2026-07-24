// Generates the app icons (PWA + favicon + apple-touch) with no dependencies.
// Design: a friendly cartoon fox face (the app's default guide) on a sky/grass
// background — kid-friendly and on-brand. Run: node scripts/gen-icons.cjs
const zlib = require("zlib"), fs = require("fs");

function crc32(buf){let c=~0;for(let i=0;i<buf.length;i++){c^=buf[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return (~c)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length,0);const t=Buffer.from(type,"ascii");const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([t,data])),0);return Buffer.concat([len,t,data,crc]);}
const lerp=(a,b,t)=>a+(b-a)*t;
function tri(px,py,ax,ay,bx,by,cx,cy){
  const d1=(px-bx)*(ay-by)-(ax-bx)*(py-by);
  const d2=(px-cx)*(by-cy)-(bx-cx)*(py-cy);
  const d3=(px-ax)*(cy-ay)-(cx-ax)*(py-ay);
  const neg=(d1<0)||(d2<0)||(d3<0), pos=(d1>0)||(d2>0)||(d3>0);
  return !(neg&&pos);
}

function color(x,y,S){
  const s=(v)=>v*S;
  const d=(ax,ay)=>Math.hypot(x-ax,y-ay);
  let r,g,b;
  // background: sky (top) -> grassy green (bottom)
  const t=y/S; r=lerp(165,190,t); g=lerp(216,228,t); b=lerp(255,150,t);
  const set=(rr,gg,bb)=>{r=rr;g=gg;b=bb;};

  const ORANGE=[240,146,60], LIGHT=[255,208,150], WHITE=[255,255,255], DARK=[58,43,34], PINK=[255,168,172];
  const hR=s(0.28), hd=d(s(0.50),s(0.55));

  // ears (behind head)
  if(tri(x,y,s(0.27),s(0.19),s(0.32),s(0.44),s(0.49),s(0.35))||tri(x,y,s(0.73),s(0.19),s(0.68),s(0.44),s(0.51),s(0.35))) set(...ORANGE);
  if(tri(x,y,s(0.31),s(0.24),s(0.35),s(0.42),s(0.45),s(0.36))||tri(x,y,s(0.69),s(0.24),s(0.65),s(0.42),s(0.55),s(0.36))) set(...LIGHT);
  // head on top
  if(hd<=hR) set(...ORANGE);
  // white muzzle
  if(hd<=hR && tri(x,y,s(0.34),s(0.57),s(0.66),s(0.57),s(0.50),s(0.83))) set(...WHITE);
  // rosy cheeks
  if(hd<=hR && (d(s(0.33),s(0.61))<s(0.055)||d(s(0.67),s(0.61))<s(0.055))) set(...PINK);
  // eyes + highlight
  if(d(s(0.41),s(0.53))<=s(0.052)||d(s(0.59),s(0.53))<=s(0.052)) set(...DARK);
  if(d(s(0.395),s(0.515))<s(0.02)||d(s(0.575),s(0.515))<s(0.02)) set(...WHITE);
  // nose
  if(tri(x,y,s(0.465),s(0.605),s(0.535),s(0.605),s(0.50),s(0.665))) set(...DARK);
  return [r|0,g|0,b|0,255];
}

function makePNG(S){
  const raw=Buffer.alloc(S*(S*4+1)); let o=0;
  for(let y=0;y<S;y++){ raw[o++]=0; for(let x=0;x<S;x++){ const [r,g,b,a]=color(x+0.5,y+0.5,S); raw[o++]=r;raw[o++]=g;raw[o++]=b;raw[o++]=a; } }
  const sig=Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(S,0); ihdr.writeUInt32BE(S,4); ihdr[8]=8; ihdr[9]=6;
  const idat=zlib.deflateSync(raw,{level:9});
  return Buffer.concat([sig, chunk("IHDR",ihdr), chunk("IDAT",idat), chunk("IEND",Buffer.alloc(0))]);
}

[["icon-192.png",192],["icon-512.png",512],["apple-touch-icon.png",180]].forEach(([name,S])=>{
  fs.writeFileSync(name, makePNG(S));
  console.log("wrote",name,S+"x"+S);
});
