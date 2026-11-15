import { Track } from '../js/world/track.js';
import { Rivers } from '../js/world/river.js';
import { Terrain } from '../js/world/terrain.js';
let t = performance.now();
const track = new Track(); console.log('track', (performance.now()-t).toFixed(0)+'ms'); t = performance.now();
const rivers = new Rivers(track); console.log('rivers', (performance.now()-t).toFixed(0)+'ms'); t = performance.now();
const terrain = new Terrain(track, rivers); console.log('terrain ctor (IDW)', (performance.now()-t).toFixed(0)+'ms', 'grid', terrain.cnx, terrain.cnz);
const q = {};
// random far samples
t = performance.now(); let n=0;
for (let i=0;i<50000;i++){ const x = terrain.minX + Math.random()*(terrain.maxX-terrain.minX), z = terrain.minZ + Math.random()*(terrain.maxZ-terrain.minZ); terrain.sample(x,z,q); n++; }
console.log('sample random x50k', (performance.now()-t).toFixed(0)+'ms', ((performance.now()-t)/n*1000).toFixed(2)+'us each');
// near-road samples
t = performance.now();
for (let i=0;i<50000;i++){ const s = Math.random()*track.length; const p = track.point(s, (Math.random()-0.5)*300); terrain.sample(p.x,p.z,q); }
console.log('sample near road x50k', (performance.now()-t).toFixed(0)+'ms');
// count chunk vertices as build would
const C=128; let verts=0, chunks=0; const nCx=(terrain.maxX-terrain.minX)/C, nCz=(terrain.maxZ-terrain.minZ)/C;
const hist={};
for (let j=0;j<nCz;j++) for (let i=0;i<nCx;i++){ const x0=terrain.minX+i*C, z0=terrain.minZ+j*C; const ns=track.nearestSample(x0+C/2,z0+C/2,60); const d=Math.max(0,ns.dist-C*0.71); const segs = d<150?32:d<420?16:d<1000?8:4; hist[segs]=(hist[segs]||0)+1; verts+=(segs+3)**2; chunks++; }
console.log('chunks', chunks, 'verts incl border', verts, JSON.stringify(hist));
