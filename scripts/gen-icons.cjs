const zlib = require("zlib"), fs = require("fs");
function crc32(buf){let c=~0;for(let i=0;i<buf.length;i++){c^=buf[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return (~c)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length,0);const t=Buffer.from(type,"ascii");const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([t,data])),0);return Buffer.concat([len,t,data,crc]);}
const lerp=(a,b,t)=>a+(b-a)*t;
function color(x,y,S){
  const cx=S/2, cy=S*0.42, R=S*0.155;
  // sky gradient
  const t=y/S;
  let r=lerp(133,74,t), g=lerp(199,168,t), b=lerp(255,239,t);
  // green hill (big circle below)
  const hx=S/2, hy=S*1.18, hr=S*0.74;
  const dh=Math.hypot(x-hx,y-hy);
  if(dh<hr){ r=126; g=203; b=115; if(dh>hr-S*0.02){r=110;g=185;b=100;} }
  // sun top-left
  const ds=Math.hypot(x-S*0.24,y-S*0.22);
  if(ds<S*0.075){ r=255; g=224; b=110; }
  // map pin (teardrop): circle + tapering stem to a point
  const d=Math.hypot(x-cx,y-cy);
  const stemTop=cy, tipY=cy+R*2.5;
  let inPin=false;
  if(d<=R) inPin=true;
  else if(y>=stemTop && y<=tipY){ const w=R*(1-(y-stemTop)/(tipY-stemTop)); if(Math.abs(x-cx)<=w) inPin=true; }
  if(inPin){ r=255; g=90; b=122; if(d>R-S*0.012 && d<=R){r=224;g=70;b=104;} } // outline ring
  // white dot in pin
  if(d<=R*0.42){ r=255; g=255; b=255; }
  return [r|0,g|0,b|0,255];
}
function makePNG(S){
  const raw=Buffer.alloc(S*(S*4+1));
  let o=0;
  for(let y=0;y<S;y++){ raw[o++]=0; for(let x=0;x<S;x++){ const [r,g,b,a]=color(x,y,S); raw[o++]=r;raw[o++]=g;raw[o++]=b;raw[o++]=a; } }
  const sig=Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(S,0); ihdr.writeUInt32BE(S,4); ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  const idat=zlib.deflateSync(raw,{level:9});
  return Buffer.concat([sig, chunk("IHDR",ihdr), chunk("IDAT",idat), chunk("IEND",Buffer.alloc(0))]);
}
[["icon-192.png",192],["icon-512.png",512],["apple-touch-icon.png",180]].forEach(([name,S])=>{
  fs.writeFileSync(name, makePNG(S));
  console.log("wrote",name,S+"x"+S);
});
