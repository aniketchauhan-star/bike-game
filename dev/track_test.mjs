import { Track } from '../js/world/track.js';
import fs from 'fs';
const t = new Track();
console.log('length', t.length.toFixed(0), 'samples', t.N, 'bounds', JSON.stringify(t.bounds, (k,v)=> typeof v==='number'? +v.toFixed(0):v));
console.log('zones', t.zoneSpans.map(z => `${z.id}:${z.s0.toFixed(0)}-${z.s1.toFixed(0)}`).join('  '));
console.log('marks', JSON.stringify(Object.fromEntries(Object.entries(t.marks).map(([k,v])=>[k, +v.toFixed(0)]))));
let maxGrade = 0; for (let i=0;i<t.N;i++) maxGrade=Math.max(maxGrade, Math.abs(t.grade[i]));
let maxK = 0; for (let i=0;i<t.N;i++) maxK=Math.max(maxK, Math.abs(t.K[i]));
console.log('max grade', (maxGrade*100).toFixed(1)+'%', 'min radius', (1/maxK).toFixed(1), 'final y', t.Y[t.N-1].toFixed(1));
// self proximity check
let worst = []; 
for (let i=0;i<t.N;i+=3) for (let j=i+90;j<t.N;j+=3) { const dx=t.X[i]-t.X[j], dz=t.Z[i]-t.Z[j]; const d=Math.hypot(dx,dz); if (d<38) worst.push([d, i*2, j*2, Math.abs(t.Y[i]-t.Y[j])]); }
worst.sort((a,b)=>a[0]-b[0]);
console.log('close pairs (<38m, ds>180):', worst.length, worst.slice(0,8).map(w=>w.map(x=>x.toFixed(0)).join('/')).join('  '));
const sp = t.speedProfile(11, 8.5, 80); let tt=0; for (let i=1;i<t.N;i++) tt += 2/Math.max(5, sp[i]);
console.log('ideal lap time (aLat 11):', tt.toFixed(1)+'s');
// svg map
const b=t.bounds, pad=60, W=b.maxX-b.minX+pad*2, H=b.maxZ-b.minZ+pad*2;
const col={town:'#e67e22',forest:'#27ae60',river:'#2980b9',mountain:'#8e44ad',ridge:'#c0392b'};
let path=''; let last=null;
for (let i=0;i<t.N;i+=2){ const z=t.zoneIds[i]; if(z!==last){ if(last) path+='"/>'; path+=`<polyline fill="none" stroke-width="7" stroke="${col[z]}" points="`; last=z;} path+=`${(t.X[i]-b.minX+pad).toFixed(1)},${(t.Z[i]-b.minZ+pad).toFixed(1)} `; }
path+='"/>';
let marks=''; for (const [k,s] of Object.entries(t.marks)){ const i=Math.round(s/2); marks+=`<circle cx="${t.X[i]-b.minX+pad}" cy="${t.Z[i]-b.minZ+pad}" r="9" fill="#000"/><text x="${t.X[i]-b.minX+pad+12}" y="${t.Z[i]-b.minZ+pad+5}" font-size="26" fill="#000">${k}</text>`; }
fs.writeFileSync(process.argv[2], `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${Math.min(1400,W)}" style="background:#fff">${path}${marks}</svg>`);
