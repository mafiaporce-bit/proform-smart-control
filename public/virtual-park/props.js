// Park furniture built from simple shapes: gazebo, lamp posts, benches. No downloaded models.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const box = (w, h, d, x, y, z, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); return g; };
const cyl = (rt, rb, h, seg, x, y, z) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(x, y, z); return g; };

/** A white eight-sided park gazebo with a grey roof, about 6.4 m across. The open side faces +Z. */
export function buildGazebo() {
  const white = [], roof = [], floor = [];
  const R = 2.9, N = 8, a0 = Math.PI / 8;
  { const f = new THREE.CylinderGeometry(3.25, 3.35, 0.36, N); f.rotateY(a0); f.translate(0, 0.18, 0); floor.push(f); }
  floor.push(box(1.7, 0.18, 0.5, 0, 0.09, 3.35), box(1.7, 0.18, 0.5, 0, 0.27, 3.15)); // two steps
  const corner = (k) => { const a = a0 + (k / N) * Math.PI * 2; return [Math.sin(a) * R, Math.cos(a) * R]; };
  for (let k = 0; k < N; k++) {
    const [x, z] = corner(k), [x2, z2] = corner(k + 1);
    white.push(cyl(0.085, 0.1, 2.6, 8, x, 0.36 + 1.3, z));
    white.push(cyl(0.14, 0.14, 0.12, 8, x, 0.42, z), cyl(0.13, 0.085, 0.14, 8, x, 2.89, z));
    const mx = (x + x2) / 2, mz = (z + z2) / 2, len = Math.hypot(x2 - x, z2 - z), ry = Math.atan2(x2 - x, z2 - z) + Math.PI / 2;
    white.push(box(len, 0.2, 0.1, mx, 3.02, mz, ry));                       // beam under the roof
    white.push(box(len * 0.9, 0.3, 0.04, mx, 2.78, mz, ry));                // fretwork panel
    if (Math.abs(mx) < 0.5 && mz > 0) continue;                              // the entrance has no railing
    white.push(box(len, 0.07, 0.09, mx, 1.2, mz, ry), box(len, 0.06, 0.07, mx, 0.5, mz, ry));
    for (let j = 1; j < 9; j++) { const t = j / 9; white.push(box(0.035, 0.7, 0.035, x + (x2 - x) * t, 0.85, z + (z2 - z) * t)); }
  }
  const cone = new THREE.ConeGeometry(4.0, 1.75, N, 1); cone.rotateY(a0); cone.translate(0, 3.12 + 0.875, 0); roof.push(cone);
  { const f = new THREE.CylinderGeometry(0.62, 0.62, 0.5, N); f.rotateY(a0); f.translate(0, 4.95, 0); white.push(f); }
  const cap = new THREE.ConeGeometry(0.95, 0.75, N, 1); cap.rotateY(a0); cap.translate(0, 5.2 + 0.375, 0); roof.push(cap);
  const ball = new THREE.SphereGeometry(0.1, 8, 6); ball.translate(0, 6.02, 0); white.push(ball.toNonIndexed());
  const g = new THREE.Group();
  const add = (list, mat) => { const m = new THREE.Mesh(mergeGeometries(list.map((q) => (q.index ? q.toNonIndexed() : q))), mat); m.castShadow = true; m.receiveShadow = true; g.add(m); };
  add(white, new THREE.MeshStandardMaterial({ color: 0xf3f0e8, roughness: 0.72 }));
  add(roof, new THREE.MeshStandardMaterial({ color: 0x61646d, roughness: 0.86, flatShading: true }));
  add(floor, new THREE.MeshStandardMaterial({ color: 0xb9b3a6, roughness: 0.95 }));
  return g;
}

/** Lamp post in two parts: the dark ironwork and the glowing lantern glass. Origin at the ground, 3.9 m tall. */
export function lampGeos() {
  const iron = [cyl(0.15, 0.2, 0.5, 8, 0, 0.25, 0), cyl(0.1, 0.15, 0.16, 8, 0, 0.58, 0), cyl(0.055, 0.075, 2.7, 8, 0, 2.0, 0), cyl(0.1, 0.06, 0.12, 8, 0, 3.38, 0), cyl(0.17, 0.1, 0.07, 6, 0, 3.47, 0)];
  const cap = new THREE.ConeGeometry(0.3, 0.24, 6, 1); cap.translate(0, 4.03, 0); iron.push(cap);
  iron.push(cyl(0.03, 0.03, 0.14, 6, 0, 4.2, 0));
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; iron.push(box(0.022, 0.42, 0.022, Math.sin(a) * 0.185, 3.7, Math.cos(a) * 0.185)); }
  const glass = new THREE.CylinderGeometry(0.21, 0.15, 0.42, 6); glass.translate(0, 3.7, 0);
  return { iron: mergeGeometries(iron.map((q) => q.toNonIndexed())), glass };
}

/** A slatted park bench with iron ends. The seat faces +Z. */
export function buildBench(woodMat, ironMat) {
  const wood = [], iron = [];
  for (let k = 0; k < 4; k++) wood.push(box(1.7, 0.035, 0.1, 0, 0.46, -0.14 + k * 0.125));
  for (let k = 0; k < 3; k++) { const g = new THREE.BoxGeometry(1.7, 0.1, 0.035); g.rotateX(-0.2); g.translate(0, 0.62 + k * 0.14, -0.24 - k * 0.03); wood.push(g); }
  for (const x of [-0.78, 0.78]) {
    iron.push(box(0.05, 0.46, 0.05, x, 0.23, 0.2), box(0.05, 0.95, 0.05, x, 0.475, -0.25), box(0.05, 0.05, 0.5, x, 0.44, -0.02), box(0.05, 0.04, 0.44, x, 0.68, -0.02), box(0.05, 0.24, 0.05, x, 0.57, 0.2));
  }
  const g = new THREE.Group();
  const w = new THREE.Mesh(mergeGeometries(wood.map((q) => q.toNonIndexed())), woodMat), i = new THREE.Mesh(mergeGeometries(iron.map((q) => q.toNonIndexed())), ironMat);
  for (const m of [w, i]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  return g;
}
