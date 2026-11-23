// Scenery for Park Discovery 3K. Plants are built from flat "cards" the way games
// draw foliage. The surfaces use real photo textures (see photo.js) when they load;
// the painted canvas textures below are the fallback for any that do not.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// ---- small helpers --------------------------------------------------------
export function makeRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const hash2 = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Smooth value noise in 0..1. */
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => 0.55 * noise2(x, y) + 0.3 * noise2(x * 2.1, y * 2.1) + 0.15 * noise2(x * 4.3, y * 4.3);
/** Noise that repeats every `period` cells, so textures tile without a seam. */
function tileNoise(x, y, period) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (n) => ((n % period) + period) % period;
  const a = hash2(w(xi), w(yi)), b = hash2(w(xi + 1), w(yi)), c = hash2(w(xi), w(yi + 1)), d = hash2(w(xi + 1), w(yi + 1));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function texture(c, { repeat = false, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}
const mix = (a, b, t) => a + (b - a) * t;

// ---- painted textures -----------------------------------------------------
export function grassTexture(rand, aniso) {
  const S = 512, [c, g] = canvas(S, S);
  const img = g.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = 0.6 * tileNoise(x / 64, y / 64, 8) + 0.4 * tileNoise(x / 16, y / 16, 32);
    const i = (y * S + x) * 4;
    d[i] = mix(58, 118, n); d[i + 1] = mix(98, 152, n); d[i + 2] = mix(40, 70, n); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // blades: thousands of short strokes, some sunlit, some in shade
  for (let k = 0; k < 9000; k++) {
    const x = rand() * S, y = rand() * S, len = 3 + rand() * 7, lean = (rand() - 0.5) * 4, l = rand();
    g.strokeStyle = l < 0.5 ? `rgba(${40 + l * 40},${78 + l * 50},${28 + l * 20},.55)` : `rgba(${120 + l * 50},${165 + l * 40},${70 + l * 30},.4)`;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + lean, y - len); g.stroke();
  }
  return texture(c, { repeat: true, aniso });
}

export function pathTexture(rand, aniso) {
  const W = 256, H = 512, [c, g] = canvas(W, H);
  const img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = 0.5 * tileNoise(x / 40, y / 40, 6) + 0.5 * hash2(x, y);
    // slightly lighter, more worn strip down the middle
    const wear = Math.exp(-Math.pow((x - W / 2) / 70, 2)) * 10;
    const i = (y * W + x) * 4;
    d[i] = mix(112, 146, n) + wear; d[i + 1] = mix(100, 130, n) + wear; d[i + 2] = mix(82, 108, n) + wear; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 2600; k++) {
    const l = rand();
    g.fillStyle = l < 0.6 ? `rgba(70,60,46,${0.25 + rand() * 0.3})` : `rgba(190,178,154,${0.2 + rand() * 0.25})`;
    g.beginPath(); g.ellipse(rand() * W, rand() * H, 0.8 + rand() * 1.8, 0.6 + rand() * 1.2, rand() * 3, 0, Math.PI * 2); g.fill();
  }
  return texture(c, { repeat: true, aniso });
}

function barkTexture(rand) {
  const W = 64, H = 256, [c, g] = canvas(W, H);
  g.fillStyle = '#6a5642'; g.fillRect(0, 0, W, H);
  for (let k = 0; k < 420; k++) {
    const x = rand() * W, y = rand() * H, l = rand();
    g.strokeStyle = l < 0.55 ? `rgba(48,36,26,${0.3 + rand() * 0.4})` : `rgba(150,128,100,${0.2 + rand() * 0.3})`;
    g.lineWidth = 1 + rand() * 2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 5, y + 12 + rand() * 40); g.stroke();
  }
  return texture(c, { repeat: true });
}

/** A cluster of leaves on a transparent background. */
function leafTexture(rand) {
  const S = 256, [c, g] = canvas(S * 2, S * 2);
  // four different clusters in a 2 x 2 sheet, the same layout as the photo leaf sheet
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * S, oy = Math.floor(q / 2) * S, leaves = [];
    for (let k = 0; k < 430; k++) {
      const a = rand() * Math.PI * 2, rr = Math.pow(rand(), 0.85) * 112;
      leaves.push({ x: ox + S / 2 + Math.cos(a) * rr, y: oy + S / 2 + Math.sin(a) * rr * 0.92, r: 7 + rand() * 9, rot: rand() * Math.PI, l: rand() });
    }
    leaves.sort((p, r2) => p.l - r2.l); // darker leaves underneath, sunlit ones on top
    for (const f of leaves) {
      g.fillStyle = `hsl(${92 + f.l * 22},${34 + f.l * 14}%,${11 + f.l * 24}%)`;
      g.beginPath(); g.ellipse(f.x, f.y, f.r, f.r * 0.5, f.rot, 0, Math.PI * 2); g.fill();
    }
  }
  return texture(c);
}

/** One pine bough: v = 0 at the trunk, v = 1 at the tip. A dense fan of needles, wider towards the tip. */
function pineTexture(rand) {
  const S = 256, [c, g] = canvas(S, S);
  g.lineCap = 'round';
  const halfAt = (y) => 12 + ((S - 6 - y) / (S - 16)) * 112;
  // a few twigs first, needles on top
  g.strokeStyle = 'rgba(54,40,28,.9)'; g.lineWidth = 3;
  for (let b = 0; b < 7; b++) { g.beginPath(); g.moveTo(S / 2, S - 4); g.lineTo(S / 2 + (b - 3) * 34 + (rand() - 0.5) * 12, 26 + rand() * 30); g.stroke(); }
  const needles = [];
  for (let k = 0; k < 2300; k++) {
    const y = 12 + Math.pow(rand(), 0.8) * (S - 22), half = halfAt(y), x = S / 2 + (rand() * 2 - 1) * half * 0.96;
    needles.push({ x, y, a: -Math.PI / 2 + ((x - S / 2) / half) * 0.95 + (rand() - 0.5) * 0.9, len: 9 + rand() * 12, l: rand() });
  }
  needles.sort((p, q) => p.l - q.l);
  for (const n of needles) {
    g.strokeStyle = `hsl(${132 + n.l * 18},${30 + n.l * 14}%,${8 + n.l * 20}%)`; g.lineWidth = 2;
    g.beginPath(); g.moveTo(n.x, n.y); g.lineTo(n.x + Math.cos(n.a) * n.len, n.y + Math.sin(n.a) * n.len); g.stroke();
  }
  return texture(c);
}

function tuftTexture(rand) {
  const S = 128, [c, g] = canvas(S, S);
  g.lineCap = 'round';
  for (let k = 0; k < 46; k++) {
    const x0 = S / 2 + (rand() - 0.5) * 70, lean = (rand() - 0.5) * 70, h = 50 + rand() * 70, l = rand();
    g.strokeStyle = `hsl(${86 + l * 24},${38 + l * 16}%,${24 + l * 26}%)`; g.lineWidth = 1.5 + rand() * 2;
    g.beginPath(); g.moveTo(x0, S); g.quadraticCurveTo(x0 + lean * 0.3, S - h * 0.6, x0 + lean, S - h); g.stroke();
  }
  return texture(c);
}

export function waterTexture(rand) {
  const S = 256, [c, g] = canvas(S, S);
  const img = g.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = 0.6 * tileNoise(x / 32, y / 18, 8) + 0.4 * tileNoise(x / 9, y / 6, 28);
    const hi = Math.pow(n, 3) * 150; // bright ripple crests
    const i = (y * S + x) * 4;
    d[i] = 52 + hi * 0.85; d[i + 1] = 128 + hi * 0.75; d[i + 2] = 150 + hi * 0.6; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return texture(c, { repeat: true });
}

/** Falling water: vertical white streaks with soft see-through gaps. */
export function fallTexture(rand) {
  const W = 64, H = 256, [c, g] = canvas(W, H);
  const img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = 0.65 * tileNoise(x / 5, y / 46, 12) + 0.35 * tileNoise(x / 2.5, y / 14, 24);
    const i = (y * W + x) * 4;
    d[i] = 215 + n * 40; d[i + 1] = 238 + n * 17; d[i + 2] = 248; d[i + 3] = Math.min(255, 70 + n * 260);
  }
  g.putImageData(img, 0, 0);
  return texture(c, { repeat: true });
}

function mistTexture() {
  const S = 128, [c, g] = canvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,.55)'); grd.addColorStop(0.5, 'rgba(255,255,255,.18)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  return texture(c);
}

// ---- sky ------------------------------------------------------------------
/** A dome with a blue-to-haze gradient and soft clouds. It follows the camera. */
export function buildSky(scene, rand, photoSky) {
  if (photoSky) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(380, 48, 24), new THREE.MeshBasicMaterial({ map: photoSky, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
    dome.renderOrder = -10; dome.frustumCulled = false; dome.userData.photo = true;
    scene.add(dome);
    return dome;
  }
  const W = 1024, H = 512, [c, g] = canvas(W, H);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#2f76c6'); grd.addColorStop(0.3, '#6fabdf'); grd.addColorStop(0.47, '#b9d7ea'); grd.addColorStop(0.52, '#cfe1e6'); grd.addColorStop(1, '#cfe1e6');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  // clouds: clumps of soft white blobs in the upper half, drawn twice so the seam at the edge matches
  for (let k = 0; k < 13; k++) {
    const cx = rand() * W, cy = 70 + rand() * 130, n = 7 + Math.floor(rand() * 9), s = 0.6 + rand() * 0.9;
    for (let j = 0; j < n; j++) {
      const x = cx + (rand() - 0.5) * 150 * s, y = cy + (rand() - 0.5) * 30 * s, r = (16 + rand() * 30) * s;
      for (const ox of [-W, 0, W]) {
        const rg = g.createRadialGradient(x + ox, y, 0, x + ox, y, r);
        rg.addColorStop(0, 'rgba(255,255,255,.34)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = rg; g.beginPath(); g.ellipse(x + ox, y, r * 1.5, r * 0.75, 0, 0, Math.PI * 2); g.fill();
      }
    }
  }
  const tex = texture(c);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 20), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);
  return dome;
}

// ---- instancing in chunks along the route ---------------------------------
/** Collects instances by position along the lap, then makes one mesh per stretch so far-away stretches are skipped. */
export class Scatter {
  constructor(geo, mat, chunks, opts = {}) {
    this.geo = geo; this.mat = mat; this.opts = opts;
    this.lists = Array.from({ length: chunks }, () => ({ m: [], c: [] }));
  }
  add(u, matrix, color) {
    const l = this.lists[Math.min(this.lists.length - 1, Math.max(0, Math.floor(u * this.lists.length)))];
    l.m.push(matrix.clone());
    l.c.push(color ? color.clone() : null);
  }
  build(scene) {
    const out = [];
    for (const l of this.lists) {
      if (!l.m.length) continue;
      const im = new THREE.InstancedMesh(this.geo, this.mat, l.m.length);
      l.m.forEach((m, i) => { im.setMatrixAt(i, m); if (l.c[i]) im.setColorAt(i, l.c[i]); });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = !!this.opts.cast; im.receiveShadow = !!this.opts.receive;
      if (this.opts.depth) im.customDepthMaterial = this.opts.depth;
      im.computeBoundingSphere();
      scene.add(im); out.push(im);
    }
    return out;
  }
}

// ---- plants ---------------------------------------------------------------
/** A cloud of textured cards filling an ellipsoid. Each card is doubled so it shows from both sides with the same lighting. */
export function cardCloud(rand, n, rx, ry, rz, sMin, sMax, centre = [0, 0, 0], up = 0.45) {
  const pos = [], nor = [], uv = [], idx = [];
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const th = rand() * Math.PI * 2, ph = Math.acos(1 - rand() * 1.92);
    const dir = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
    const rad = 0.45 + 0.55 * rand();
    const c = new THREE.Vector3(dir.x * rx * rad + centre[0], dir.y * ry * rad + centre[1], dir.z * rz * rad + centre[2]);
    const s = mix(sMin, sMax, rand()), qx = rand() < 0.5 ? 0 : 0.5, qy = rand() < 0.5 ? 0 : 0.5;
    const q = dir.clone().add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(1.2));
    q.y *= 0.4; q.normalize(); // keep cards fairly upright so they are not seen edge-on from the path
    const t = new THREE.Vector3().crossVectors(q, Math.abs(q.y) > 0.9 ? X : Y).normalize(), b = new THREE.Vector3().crossVectors(q, t);
    // Lighting normal points out of the crown and a little up, so the whole crown shades like one soft shape.
    const nrm = dir.clone().multiplyScalar(0.75).add(new THREE.Vector3(0, up, 0)).normalize();
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, d]) => c.clone().addScaledVector(t, (a * s) / 2).addScaledVector(b, (d * s) / 2));
    for (const flip of [false, true]) {
      const base = pos.length / 3;
      corners.forEach((p, k) => { pos.push(p.x, p.y, p.z); nor.push(nrm.x, nrm.y, nrm.z); uv.push(qx + (k === 0 || k === 3 ? 0 : 0.5), qy + (k < 2 ? 0 : 0.5)); });
      if (flip) idx.push(base, base + 2, base + 1, base, base + 3, base + 2); else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

/** A pine 6 units tall: rings of drooping bough cards getting smaller towards the top. */
function pineCards(rand) {
  const pos = [], nor = [], uv = [], idx = [];
  const tiers = 11;
  for (let k = 0; k < tiers; k++) {
    const y = 0.95 + k * 0.47, R = 2.3 * (1 - k / (tiers + 0.5)), n = k < 7 ? 7 : 5, twist = rand() * 6.28;
    for (let j = 0; j < n; j++) {
      const a = twist + (j / n) * Math.PI * 2 + (rand() - 0.5) * 0.3, half = (Math.PI / n) * 1.25, droop = 0.34 + rand() * 0.12;
      const P = (ang, r, yy) => new THREE.Vector3(Math.cos(ang) * r, yy, Math.sin(ang) * r);
      const corners = [P(a - half * 0.25, 0.06, y + 0.25), P(a + half * 0.25, 0.06, y + 0.25), P(a + half, R, y - R * droop), P(a - half, R, y - R * droop)];
      const nrm = new THREE.Vector3(Math.cos(a) * 0.55, 0.83, Math.sin(a) * 0.55).normalize();
      for (const flip of [false, true]) {
        const base = pos.length / 3;
        corners.forEach((p, q) => { pos.push(p.x, p.y, p.z); nor.push(nrm.x, nrm.y, nrm.z); uv.push(q === 0 || q === 3 ? 0.2 + (q === 3 ? -0.2 : 0) : 0.8 + (q === 2 ? 0.2 : 0), q < 2 ? 0 : 1); });
        if (flip) idx.push(base, base + 2, base + 1, base, base + 3, base + 2); else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

/**
 * Everything needed to plant trees and bushes. The caller decides where; this
 * supplies the shapes and materials and builds the instanced meshes.
 */
export function makePlants(rand, chunks, photo = {}) {
  const leafTex = photo.leaves || leafTexture(rand), pineTex = photo.fir || pineTexture(rand);
  const bark = photo.bark || barkTexture(rand);
  bark.repeat.set(photo.bark ? 2 : 2, photo.bark ? 3 : 2);
  const cut = photo.leaves ? 0.32 : 0.42;
  // Lambert shading: leaves are matt, and it is the cheapest lit material, which matters on a phone with this many cards.
  const leafMat = new THREE.MeshLambertMaterial({ map: leafTex, alphaTest: cut, alphaToCoverage: true });
  if (photo.leaves) leafMat.color.setRGB(0.66, 0.74, 0.56); // the leaf photos are bright; this keeps sunlit crowns from washing out
  if (photo.leaves) { leafMat.emissiveMap = leafTex; leafMat.emissive = new THREE.Color(0xffffff); leafMat.emissiveIntensity = 0.24; } // a little glow, as light passes through real leaves
  const pineMat = new THREE.MeshLambertMaterial({ map: pineTex, alphaTest: photo.fir ? 0.3 : 0.4 });
  const trunkMat = new THREE.MeshStandardMaterial({ map: bark, roughness: 1, color: photo.bark ? 0xb3a898 : 0xffffff });
  if (photo.barkN) { photo.barkN.repeat.copy(bark.repeat); trunkMat.normalMap = photo.barkN; trunkMat.normalScale = new THREE.Vector2(1.2, 1.2); }
  let pineTrunkMat = trunkMat;
  if (photo.firbark) { photo.firbark.repeat.set(2, 3); pineTrunkMat = new THREE.MeshStandardMaterial({ map: photo.firbark, roughness: 1 }); }
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x2b4a22, roughness: 1 });
  const pineCoreMat = new THREE.MeshStandardMaterial({ color: 0x1d3524, roughness: 1 });
  const bloomMat = new THREE.MeshLambertMaterial({ map: photo.bloom || bloomTexture(rand), alphaTest: 0.5 });
  const rockMat = new THREE.MeshStandardMaterial({ map: photo.rock || null, color: photo.rock ? 0xffffff : 0x807f72, roughness: 0.96 });
  if (photo.rockN) { rockMat.normalMap = photo.rockN; rockMat.normalScale = new THREE.Vector2(1.4, 1.4); }
  // Shadows should have leaf-shaped gaps, so the shadow pass needs the same cut-out.
  const depth = (map, a = cut) => new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: a });
  const trunkGeo = new THREE.CylinderGeometry(0.17, 0.34, 3.8, 9);
  const pineTrunkGeo = new THREE.CylinderGeometry(0.08, 0.2, 2.2, 6);
  return {
    // more, smaller cards than before so the photographed leaves stay leaf-sized
    crownA: new Scatter(cardCloud(rand, 78, 2.5, 1.9, 2.5, 1.6, 2.3), leafMat, chunks, { cast: true, depth: depth(leafTex, 0.5) }),
    crownB: new Scatter(cardCloud(rand, 70, 1.9, 2.5, 1.9, 1.5, 2.2), leafMat, chunks, { cast: true, depth: depth(leafTex, 0.5) }),
    core: new Scatter(new THREE.IcosahedronGeometry(1.0, 1), coreMat, chunks, {}),
    trunk: new Scatter(trunkGeo, trunkMat, chunks, { cast: true }),
    pine: new Scatter(pineCards(rand), pineMat, chunks, { cast: true, depth: depth(pineTex, photo.fir ? 0.3 : 0.4) }),
    pineCore: new Scatter(new THREE.ConeGeometry(0.42, 5.2, 7), pineCoreMat, chunks, {}),
    pineTrunk: new Scatter(pineTrunkGeo, pineTrunkMat, chunks, {}),
    bush: new Scatter(cardCloud(rand, 26, 1.0, 0.65, 1.0, 0.7, 1.05), leafMat, chunks, { cast: true, depth: depth(leafTex) }),
    // large park trees that stand next to the path and shade it
    heroTrunk: new Scatter(heroTrunkGeo(), trunkMat, chunks, { cast: true, receive: true }),
    heroCrown: new Scatter(heroCrownGeo(rand), leafMat, chunks, { cast: true, depth: depth(leafTex, 0.58) }), // higher cut-out in the shadow pass = more sun spots on the path
    bloom: new Scatter(bloomGeo(rand), bloomMat, chunks, {}),
    rock: new Scatter(rockGeo(), rockMat, chunks, { cast: true, receive: true }),
  };
}

/** Trunk of a big park tree, about 6 m to the first fork, with four heavy limbs. Origin at the ground. */
function heroTrunkGeo() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.3, 0.56, 5.6, 12, 5);
  { // flare the base and lean it a touch so it is not a perfect pole
    const p = trunk.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 2.8, k = 1 + 0.5 * Math.pow(Math.max(0, 1 - y / 1.1), 2); p.setX(i, p.getX(i) * k + 0.05 * y); p.setZ(i, p.getZ(i) * k); }
  }
  trunk.translate(0, 2.8, 0); parts.push(trunk);
  const limbs = [[0.3, 0.72, 4.3], [2.3, 0.86, 3.9], [4.2, 0.66, 4.4], [5.4, 0.95, 3.4], [1.2, 0.3, 3.2]];
  for (const [az, tilt, len] of limbs) {
    const g = new THREE.CylinderGeometry(0.09, 0.24, len, 8, 1);
    g.translate(0, len / 2, 0); g.rotateZ(-tilt); g.rotateY(az); g.translate(0.26, 4.9, 0);
    parts.push(g);
  }
  const geo = mergeGeometries(parts); geo.computeVertexNormals();
  return geo;
}
/** The wide crown that goes with heroTrunkGeo: several leaf clouds around the limb ends. Origin at the ground. */
function heroCrownGeo(rand) {
  const blobs = [[0.3, 8.6, 0, 3.4, 2.3, 3.4, 58], [3.0, 7.6, 0.6, 2.9, 2.0, 2.9, 46], [-2.6, 7.7, 2.2, 2.9, 2.0, 2.9, 46], [-1.6, 7.8, -2.9, 2.9, 2.0, 2.9, 46], [2.2, 7.3, -2.8, 2.6, 1.9, 2.6, 38], [0.4, 7.0, 3.4, 2.5, 1.7, 2.5, 36]];
  const geo = mergeGeometries(blobs.map(([x, y, z, rx, ry, rz, n]) => cardCloud(rand, n, rx, ry, rz, 1.5, 2.3, [x, y, z], 0.3)));
  return geo;
}
/** Flower heads over a rounded bush (same shape as the bush cloud: 1 x 0.65 x 1). White, tinted per bush. */
function bloomGeo(rand) {
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i < 16; i++) {
    const th = rand() * Math.PI * 2, ph = Math.acos(1 - rand() * 0.95);
    const dir = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
    const c = new THREE.Vector3(dir.x * 1.02, dir.y * 0.72 + 0.03, dir.z * 1.02), s = 0.4 + rand() * 0.2;
    const q = dir.clone(); q.y = q.y * 0.6 + 0.25; q.normalize();
    const t = new THREE.Vector3().crossVectors(q, new THREE.Vector3(0, 1, 0)).normalize(); if (t.lengthSq() < 0.1) t.set(1, 0, 0);
    const b = new THREE.Vector3().crossVectors(q, t);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, d]) => c.clone().addScaledVector(t, (a * s) / 2).addScaledVector(b, (d * s) / 2));
    for (const flip of [false, true]) {
      const base = pos.length / 3;
      corners.forEach((p, k) => { pos.push(p.x, p.y, p.z); nor.push(dir.x * 0.5, 0.85, dir.z * 0.5); uv.push(k === 0 || k === 3 ? 0 : 1, k < 2 ? 0 : 1); });
      if (flip) idx.push(base, base + 2, base + 1, base, base + 3, base + 2); else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}
/** Painted stand-in for the flower-head picture. */
function bloomTexture(rand) {
  const S = 128, [c, g] = canvas(S, S);
  for (let k = 0; k < 90; k++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * S * 0.42, l = 0.7 + rand() * 0.3;
    g.fillStyle = `rgb(${255 * l},${250 * l},${255 * l})`; g.beginPath(); g.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 4 + rand() * 4, 0, Math.PI * 2); g.fill();
  }
  return texture(c);
}
/** A rounded boulder about 2 units across. */
function rockGeo() {
  let geo = new THREE.IcosahedronGeometry(1, 2);
  geo.deleteAttribute('uv'); geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-4);
  const p = geo.attributes.position, uv = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.8 + 0.42 * noise2(x * 1.3 + 5 + z, y * 1.3 + 9 - z * 0.7) + 0.12 * noise2(x * 4 + 1, z * 4 + y * 3);
    p.setXYZ(i, x * k, Math.max(-0.45, y * k * 0.72), z * k);
    uv.push(Math.atan2(z, x) / Math.PI + 1, y * 0.5 + 0.5);
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}
/** Tall reeds for the water's edge. `spots` = [{x, y, z, s}]. */
export function makeReeds(scene, rand, spots) {
  if (!spots.length) return null;
  const mat = new THREE.MeshStandardMaterial({ map: tuftTexture(rand), alphaTest: 0.4, roughness: 1 });
  const mesh = new THREE.InstancedMesh(crossCards(0.8, 1.15), mat, spots.length), d = new THREE.Object3D(), c = new THREE.Color();
  spots.forEach((sp, i) => {
    d.position.set(sp.x, sp.y, sp.z); d.rotation.set(0, rand() * Math.PI, 0); d.scale.set(sp.s, sp.s * (0.8 + rand() * 0.5), sp.s); d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix); const l = 0.7 + rand() * 0.3; c.setRGB(l * 0.7, l * 0.46, l * 0.55); mesh.setColorAt(i, c);
  });
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.receiveShadow = true; scene.add(mesh);
  return mesh;
}

/** Two upright cards crossed at right angles, lit like the ground, visible from both sides. */
function crossCards(w, h) {
  const g = new THREE.PlaneGeometry(w, h);
  g.translate(0, h / 2 - 0.01, 0);
  const g2 = g.clone(); g2.rotateY(Math.PI / 2);
  const pos = [], nor = [], uv = [], idx = [];
  for (const part of [g, g2]) {
    const base = pos.length / 3, p = part.attributes.position, t = part.attributes.uv, ix = part.index;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(0, 1, 0); uv.push(t.getX(i), t.getY(i)); }
    for (let i = 0; i < ix.count; i += 3) { const a = base + ix.getX(i), b = base + ix.getX(i + 1), c2 = base + ix.getX(i + 2); idx.push(a, b, c2, a, c2, b); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

/** A small clump of flowers on stems. Blossoms are white so each patch can be tinted its own colour. */
export function makeFlowers(rand) {
  const S = 128, [c, g] = canvas(S, S);
  g.lineCap = 'round';
  const heads = [];
  for (let k = 0; k < 9; k++) heads.push({ x: 14 + rand() * 100, y: 16 + rand() * 62, r: 6 + rand() * 4 });
  for (const h of heads) {
    g.strokeStyle = 'rgba(96,140,70,1)'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(h.x + (rand() - 0.5) * 24, S); g.quadraticCurveTo(h.x + (rand() - 0.5) * 10, (S + h.y) / 2, h.x, h.y); g.stroke();
  }
  for (const h of heads) {
    g.fillStyle = '#ffffff';
    for (let p = 0; p < 5; p++) { const a = (p / 5) * Math.PI * 2; g.beginPath(); g.ellipse(h.x + Math.cos(a) * h.r * 0.75, h.y + Math.sin(a) * h.r * 0.75, h.r * 0.62, h.r * 0.42, a, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#f2c94c'; g.beginPath(); g.arc(h.x, h.y, h.r * 0.36, 0, Math.PI * 2); g.fill();
  }
  return { geo: crossCards(0.55, 0.46), mat: new THREE.MeshStandardMaterial({ map: texture(c), alphaTest: 0.4, roughness: 1 }) };
}

// ---- grass near the walker -------------------------------------------------
/**
 * Tufts of grass beside the path, only around the walker. The route is cut
 * into 2 m cells; each cell always grows the same tufts, and only the cells
 * near the camera are filled in, so the grass is dense where it is seen.
 */
export function makeTufts(scene, rand, { frameAt, groundY, routeLength, skip }) {
  const CELL = 2, PER = 56, WINDOW = 44; // 44 cells = 88 m of path
  const geo = crossCards(0.62, 0.42);
  const mat = new THREE.MeshStandardMaterial({ map: tuftTexture(rand), alphaTest: 0.4, roughness: 1 });
  const mesh = new THREE.InstancedMesh(geo, mat, WINDOW * PER);
  mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false;
  scene.add(mesh);
  const cells = Math.floor(routeLength / CELL), slots = new Array(WINDOW).fill(-1);
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  const fill = (cell, slot) => {
    for (let k = 0; k < PER; k++) {
      const a = hash2(cell * 7 + 3, k * 13 + 1), b = hash2(cell * 11 + 5, k * 17 + 2), c = hash2(cell * 5 + 9, k * 19 + 7);
      const dist = (cell + a) * CELL, side = k % 2 ? 1 : -1, off = side * (3.45 + Math.pow(b, 1.6) * 11.5);
      const f = frameAt(dist), p = f.p.clone().addScaledVector(f.n, off);
      dummy.position.set(p.x, groundY(dist, off, f.p.y) - 0.02, p.z);
      dummy.rotation.set(0, c * Math.PI, 0);
      if (skip && skip(dist, off)) dummy.scale.setScalar(0); else dummy.scale.set(0.5 + c * 0.5, 0.28 + a * 0.42, 0.5 + c * 0.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(slot * PER + k, dummy.matrix);
      tint.setRGB(0.55 + c * 0.16, 0.4 + a * 0.1, 0.62 + b * 0.2); // brings the painted blades to the colour of the photo lawn
      mesh.setColorAt(slot * PER + k, tint);
    }
  };
  let last = -999;
  return {
    mesh,
    /** Call with the walker's distance along the lap. Refills only the cells that came into range. */
    update(dist) {
      const centre = Math.floor(dist / CELL);
      if (centre === last) return;
      last = centre;
      let changed = false;
      for (let i = -8; i < WINDOW - 8; i++) {
        const cell = (((centre + i) % cells) + cells) % cells, slot = cell % WINDOW;
        if (slots[slot] !== cell) { slots[slot] = cell; fill(cell, slot); changed = true; }
      }
      if (changed) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    },
  };
}

// ---- distant hills --------------------------------------------------------
/** Low hills well away from the path on both sides, for depth. The haze fades them. */
export function buildHills(scene, { frameAt, routeLength }) {
  const N = 220, mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const cross = [150, 205, 255, 320], pos = [], col = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const s = i / N, f = frameAt(s * routeLength), ang = s * Math.PI * 2;
      const h = 16 + 34 * fbm(Math.cos(ang) * 3 + side * 7, Math.sin(ang) * 3 + 11);
      cross.forEach((off, k) => {
        const p = f.p.clone().addScaledVector(f.n, side * off);
        const y = k === 0 ? -0.5 : k === 1 ? h * 0.7 : k === 2 ? h : h * 0.35;
        pos.push(p.x, y, p.z);
        const t = y / 50; col.push(mix(0.27, 0.36, t), mix(0.42, 0.5, t), mix(0.25, 0.4, t));
      });
      if (i < N) { const q0 = i * 4; for (let c = 0; c < 3; c++) { const q = q0 + c; idx.push(q, q + 1, q + 4, q + 1, q + 5, q + 4); } }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat); m.castShadow = false; m.receiveShadow = false; scene.add(m);
  }
}

// ---- waterfall mist -------------------------------------------------------
export function buildMist(scene, centre) {
  const tex = mistTexture(), puffs = [];
  for (let i = 0; i < 7; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.5 }));
    sp.position.set(centre.x + (i - 3) * 1.6, 1.2 + (i % 3) * 0.7, centre.z + ((i * 37) % 5) - 2);
    sp.scale.setScalar(6 + (i % 3) * 2);
    scene.add(sp); puffs.push(sp);
  }
  return (time) => puffs.forEach((sp, i) => { sp.material.opacity = 0.32 + 0.16 * Math.sin(time * 1.3 + i * 1.7); sp.scale.setScalar(6 + (i % 3) * 2 + Math.sin(time * 0.8 + i) * 0.8); });
}
