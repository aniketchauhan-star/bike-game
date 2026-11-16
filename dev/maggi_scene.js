import * as THREE from 'three';
import { createMaggiStall, createMaggiMarker, createMaggiBowl, createFork, createLadle } from '../js/models/maggi.js';
export function stall() {
  const g = new THREE.Group(); const st = createMaggiStall({ seed: 3 }); g.add(st.group);
  const mk = createMaggiMarker(); mk.group.position.set(0, 3, 0); g.add(mk.group);
  const bowl = createMaggiBowl(); bowl.position.set(1.6, 1.0, 2.2); bowl.scale.setScalar(3); g.add(bowl);
  const f = createFork(); f.position.set(2.2, 1.0, 2.2); f.scale.setScalar(3); g.add(f);
  const l = createLadle(); l.position.set(-2.2, 1.0, 2.2); l.scale.setScalar(2); g.add(l);
  return { group: g, update(dt, t) { st.update(dt, t); mk.update(dt, t, new THREE.Vector3(5, 3, 9)); bowl.userData.update?.(dt, t); } };
}
