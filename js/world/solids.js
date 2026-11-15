// Spatial hash of solid circles (tree trunks, rocks, buildings, poles) for off-road collisions.
export class Solids {
  constructor(cell = 12) { this.cell = cell; this.map = new Map(); this.count = 0; }
  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  add(x, z, r, top = 1e9, kind = 'tree') {
    const c = { x, z, r, top, kind }; const rr = r + 0.6; const C = this.cell;
    for (let cx = Math.floor((x - rr) / C); cx <= Math.floor((x + rr) / C); cx++)
      for (let cz = Math.floor((z - rr) / C); cz <= Math.floor((z + rr) / C); cz++) {
        const k = this.key(cx, cz); let a = this.map.get(k); if (!a) this.map.set(k, a = []); a.push(c);
      }
    this.count++;
  }
  near(x, z) { return this.map.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))); }
}
