import * as THREE from 'three';
export function testBox() { const m = new THREE.Mesh(new THREE.TorusKnotGeometry(0.5,0.18,128,16), new THREE.MeshPhysicalMaterial({color:0x22aa44, metalness:0.3, roughness:0.25, clearcoat:1})); m.position.y=0.9; const g=new THREE.Group(); g.add(m); return {group:g, update(dt){ m.rotation.y+=dt; }}; }
