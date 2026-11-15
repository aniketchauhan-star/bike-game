// dev diagnostics: count draw calls per object category inside the camera frustum
import * as THREE from 'three';
export default function diag() {
  const app = window.__app; const cam = app.camera; const scene = app.world.scene;
  cam.updateMatrixWorld();
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const cats = {}; let total = 0;
  scene.traverseVisible(o => {
    if (!(o.isMesh || o.isPoints || o.isLine)) return;
    if (o.frustumCulled && !fr.intersectsObject(o)) return;
    let root = o; while (root.parent && root.parent !== scene) root = root.parent;
    let k = o.isInstancedMesh ? 'instanced' : o.isSkinnedMesh ? 'skinned' : o.isLine ? 'line' : o.isPoints ? 'points' : 'mesh';
    if (root === o) k += ':root:' + (o.material?.type || '') + (o.geometry?.attributes?.splat ? ':terrain' : '');
    else k += ':child-of-group(' + root.children.length + ')';
    const n = Array.isArray(o.material) ? o.material.length : 1;
    cats[k] = (cats[k] || 0) + n; total += n;
  });
  return { total, cats: Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 20) };
}
