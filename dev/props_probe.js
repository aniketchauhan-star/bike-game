// prints per-mesh triangle counts for a vehicle (dev only)
import * as V from '../js/models/vehicles.js';
export function probe(kind = 'bus', seed = 3) {
  const v = V.createVehicle(kind, { seed });
  const out = [];
  v.group.traverse(o => { if (o.isMesh) { const g = o.geometry; const n = (g.index ? g.index.count : g.attributes.position.count) / 3; out.push(`${o.name}:${Math.round(n)}${o.isInstancedMesh ? 'x' + o.count : ''}`); } });
  window.__probe = out.join(' ');
  return v;
}
import * as P from '../js/models/props.js';
export function probeProps() {
  const tri = g => Math.round((g.index ? g.index.count : g.attributes.position.count) / 3);
  const out = [];
  for (const n of ['pole', 'streetlight', 'parapet', 'barrierPost', 'chevron', 'chevronLeft', 'reflectorPost', 'milestoneSmall']) out.push(`${n}:${tri(P.getPropTemplate(n).geometry)}`);
  const objs = { milestone: P.createMilestone({}), signBro: P.createSign({ kind: 'bro' }), signWarn: P.createSign({ kind: 'warning', lines: ['SHARP CURVE'] }), gate: P.createGate({}), bridge: P.createBridge({ name: 'Kosi River Bridge' }), bunting: P.createBunting({}), hoarding: P.createHoarding({}) };
  for (const [k, g] of Object.entries(objs)) { let t = 0, c = 0; g.traverse(o => { if (o.isMesh) { t += tri(o.geometry); c++; } }); out.push(`${k}:${t}/${c}calls`); }
  window.__probe = out.join(' ');
  return objs.gate;
}
