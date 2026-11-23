// Photo textures for the park. These are real scanned surfaces from Poly Haven (CC0),
// resized for phones (see assets/tex/CREDITS.txt). Each one is optional: if a file does not
// load, the scene falls back to the painted version of that surface and says so in its status.
import * as THREE from 'three';

const DIR = './assets/tex/';
const FILES = {
  grass: ['grass.jpg'], asphalt: ['asphalt.jpg'], asphaltN: ['asphalt_n.jpg', { data: true }], kerb: ['kerb.jpg'],
  mulch: ['mulch.jpg'], rock: ['rock.jpg'], rockN: ['rock_n.jpg', { data: true }], bark: ['bark.jpg'], barkN: ['bark_n.jpg', { data: true }],
  firbark: ['firbark.jpg'], leaves: ['leaves.webp', { clamp: true }], fir: ['fir.webp', { clamp: true }], bloom: ['bloom.webp', { clamp: true }],
  waterN: ['water_n.jpg', { data: true }], sky: ['sky.jpg', { clamp: true }], env: ['env.jpg', { clamp: true }],
};

function loadOne(loader, file, opts, aniso) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (t) => { if (!done) { done = true; clearTimeout(timer); resolve(t); } };
    const timer = setTimeout(() => finish(null), 25000);
    loader.load(DIR + file, (t) => {
      if (done) { t.dispose(); return; }
      t.colorSpace = opts.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      if (!opts.clamp) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = aniso;
      finish(t);
    }, undefined, () => finish(null));
  });
}

/** Loads every photo texture. Never rejects; missing ones come back as null and are listed in `missing`. */
export async function loadPhotoTextures(aniso = 4) {
  const loader = new THREE.TextureLoader(), out = { missing: [], total: 0, count: 0 };
  const names = Object.keys(FILES);
  const got = await Promise.all(names.map((n) => loadOne(loader, FILES[n][0], FILES[n][1] || {}, aniso)));
  names.forEach((n, i) => { out[n] = got[i]; out.total++; if (got[i]) out.count++; else out.missing.push(FILES[n][0]); });
  return out;
}
