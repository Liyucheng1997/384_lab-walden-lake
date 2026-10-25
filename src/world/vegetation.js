import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  WORLD, heightAt, shoreDist, forestDensity, inBeanField, railDist, pathDist, CABIN, BOUND,
} from './geo.js';
import { rand, randRange, pick, enhanceMaterial, colorGeometry, jitterGeometry, fbm, smoothstep, lerp } from '../util.js';

const CHUNKS = 4;
const CHUNK = WORLD / CHUNKS;

// ---------- geometry builders ----------
function vcolor(geo, fn) {
  const p = geo.attributes.position;
  const arr = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), c, i);
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
function clean(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  return g;
}

function makePine(variant) {
  const parts = [];
  const H = variant ? 9 : 7.5;
  const trunk = new THREE.CylinderGeometry(0.11, 0.32, H, 6, 3);
  trunk.translate(0, H / 2, 0);
  jitterGeometry(trunk, 0.06);
  const bark = new THREE.Color(0x4f3a2a);
  vcolor(trunk, (x, y, z, c) => c.copy(bark).multiplyScalar(0.8 + rand() * 0.3));
  parts.push(clean(trunk));
  const L = variant ? 6 : 5;
  const dark = new THREE.Color(0x203a24), light = new THREE.Color(0x3d6a3a);
  for (let i = 0; i < L; i++) {
    const t = i / (L - 1);
    const r = lerp(variant ? 2.3 : 2.7, 0.7, t);
    const h = lerp(2.6, 1.8, t);
    const y0 = lerp(variant ? 2.4 : 1.8, H - 0.6, t);
    const cone = new THREE.ConeGeometry(r, h, 8, 1);
    cone.translate((rand() - 0.5) * 0.25, y0 + h / 2, (rand() - 0.5) * 0.25);
    cone.rotateY(rand() * 3);
    jitterGeometry(cone, 0.35);
    vcolor(cone, (x, y, z, c) => {
      const k = (y - y0) / h;
      c.copy(dark).lerp(light, 0.25 + t * 0.4 + k * 0.25).multiplyScalar(0.85 + rand() * 0.25);
    });
    parts.push(clean(cone));
  }
  return mergeGeometries(parts);
}

function makeDeciduousWood(birch) {
  const parts = [];
  const H = birch ? 6.5 : 5;
  const trunk = new THREE.CylinderGeometry(birch ? 0.09 : 0.2, birch ? 0.15 : 0.38, H, 7, birch ? 10 : 3);
  trunk.translate(0, H / 2, 0);
  jitterGeometry(trunk, 0.05);
  const white = new THREE.Color(0xe6e2d8), mark = new THREE.Color(0x2b2622), bark = new THREE.Color(0x4a4036);
  const rings = new Map();
  vcolor(trunk, (x, y, z, c) => {
    if (birch) {
      const key = Math.round(y * 3);
      if (!rings.has(key)) rings.set(key, rand() < 0.22);
      c.copy(rings.get(key) && rand() < 0.8 ? mark : white);
    } else c.copy(bark).multiplyScalar(0.8 + rand() * 0.3);
  });
  parts.push(clean(trunk));
  const nb = birch ? 3 : 4;
  for (let i = 0; i < nb; i++) {
    const len = birch ? 1.8 : 2.6;
    const b = new THREE.CylinderGeometry(0.04, birch ? 0.07 : 0.12, len, 5);
    b.translate(0, len / 2, 0);
    b.rotateZ(0.6 + rand() * 0.5);
    b.rotateY((i / nb) * Math.PI * 2 + rand());
    b.translate(0, H * (0.6 + rand() * 0.3), 0);
    vcolor(b, (x, y, z, c) => c.copy(birch ? white : bark).multiplyScalar(0.85));
    parts.push(clean(b));
  }
  return mergeGeometries(parts);
}

function makeCanopy(birch) {
  const parts = [];
  const n = birch ? 4 : 5;
  const H = birch ? 6.5 : 5;
  for (let i = 0; i < n; i++) {
    const r = birch ? randRange(1.0, 1.5) : randRange(1.6, 2.3);
    const g = new THREE.IcosahedronGeometry(r, 1);
    const a = (i / n) * Math.PI * 2;
    const off = i === 0 ? 0 : (birch ? 1.0 : 1.5);
    g.scale(1, birch ? 1.25 : 0.85, 1);
    g.translate(Math.cos(a) * off, H + (i === 0 ? 1.4 : 0.3) + rand() * (birch ? 1.6 : 1.0), Math.sin(a) * off);
    jitterGeometry(g, r * 0.35);
    parts.push(clean(g));
  }
  const geo = mergeGeometries(parts);
  const bb = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
  vcolor(geo, (x, y, z, c) => {
    const k = (y - bb.min.y) / (bb.max.y - bb.min.y);
    c.setScalar(0.62 + k * 0.45 + (rand() - 0.5) * 0.12);
  });
  return geo;
}

function makeShrub() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.IcosahedronGeometry(randRange(0.45, 0.75), 0);
    g.scale(1, 0.7, 1);
    g.translate((rand() - 0.5) * 0.9, 0.35 + rand() * 0.2, (rand() - 0.5) * 0.9);
    jitterGeometry(g, 0.15);
    parts.push(clean(g));
  }
  const geo = mergeGeometries(parts);
  vcolor(geo, (x, y, z, c) => c.setScalar(0.6 + y * 0.5 + (rand() - 0.5) * 0.15));
  return geo;
}

function makeGrassTuft() {
  const pos = [], col = [];
  const nb = 7;
  for (let i = 0; i < nb; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 0.18;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const h = randRange(0.16, 0.38);
    const w = 0.028;
    const lean = randRange(0.05, 0.22);
    const la = rand() * Math.PI * 2;
    const px = Math.cos(a + 1.57) * w, pz = Math.sin(a + 1.57) * w;
    const tx = bx + Math.cos(la) * lean, tz = bz + Math.sin(la) * lean;
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, tx, h, tz);
    col.push(0.45, 0.45, 0.45, 0.5, 0.5, 0.5, 1.05, 1.05, 1.05);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  // grass normals point up for soft lighting
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return geo;
}

function makeRock() {
  const g = new THREE.DodecahedronGeometry(1, 0);
  jitterGeometry(g, 0.35);
  g.scale(1, 0.6, 1);
  const geo = clean(g);
  vcolor(geo, (x, y, z, c) => c.setScalar(0.75 + rand() * 0.25));
  return geo;
}

function makeFlower() {
  const g = new THREE.OctahedronGeometry(0.07, 0);
  g.translate(0, 0.22, 0);
  const stem = new THREE.CylinderGeometry(0.008, 0.008, 0.22, 3);
  stem.translate(0, 0.11, 0);
  const a = clean(g), b = clean(stem);
  vcolor(a, (x, y, z, c) => c.setScalar(1));
  vcolor(b, (x, y, z, c) => c.setRGB(0.25, 0.45, 0.2));
  return mergeGeometries([a, b]);
}

// ---------- instancing in chunks ----------
class ChunkedInstances {
  constructor(geo, mat, opts = {}) {
    this.geo = geo; this.mat = mat; this.opts = opts;
    this.items = Array.from({ length: CHUNKS * CHUNKS }, () => []);
    this.meshes = [];
  }
  add(x, y, z, rotY, scale, sy = scale, extra = {}) {
    const cx = Math.min(CHUNKS - 1, Math.max(0, Math.floor((x + WORLD / 2) / CHUNK)));
    const cz = Math.min(CHUNKS - 1, Math.max(0, Math.floor((z + WORLD / 2) / CHUNK)));
    this.items[cz * CHUNKS + cx].push({ x, y, z, rotY, scale, sy, ...extra });
  }
  build(group) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (const list of this.items) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(this.geo, this.mat, list.length);
      list.forEach((it, i) => {
        e.set(it.tilt || 0, it.rotY, it.tiltZ || 0);
        q.setFromEuler(e);
        s.set(it.scale, it.sy, it.scale);
        p.set(it.x, it.y, it.z);
        m4.compose(p, q, s);
        mesh.setMatrixAt(i, m4);
        if (this.opts.colors) mesh.setColorAt(i, it.color || new THREE.Color(1, 1, 1));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = !!this.opts.castShadow;
      mesh.receiveShadow = this.opts.receiveShadow !== false;
      if (this.opts.layer1) { mesh.layers.set(1); }
      mesh.computeBoundingSphere();
      mesh.userData.list = list;
      group.add(mesh);
      this.meshes.push(mesh);
    }
  }
  // rescale all instances by factor fn(item) -> scale multiplier
  rescale(fn) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (const mesh of this.meshes) {
      mesh.userData.list.forEach((it, i) => {
        const f = fn(it);
        e.set(it.tilt || 0, it.rotY, it.tiltZ || 0); q.setFromEuler(e);
        s.set(it.scale * f, it.sy * f, it.scale * f); p.set(it.x, it.y, it.z);
        m4.compose(p, q, s);
        mesh.setMatrixAt(i, m4);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
  recolor(fn) {
    for (const mesh of this.meshes) {
      const c = new THREE.Color();
      mesh.userData.list.forEach((it, i) => { fn(it, c); mesh.setColorAt(i, c); });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  setVisible(v) { for (const m of this.meshes) m.visible = v; }
}

const C = (h) => new THREE.Color(h);
const AUTUMN = [C(0xb52d1c), C(0xd0611f), C(0xdb8d2a), C(0xd6b23a), C(0x9a4a24), C(0xc23b20), C(0xe0a030)];
const BIRCH_AUTUMN = [C(0xe0c040), C(0xd8b030), C(0xe8cc55)];

export class Vegetation {
  constructor() {
    this.group = new THREE.Group();
    this.trunks = new Map(); // spatial hash for collisions
    const matTree = enhanceMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), { sway: 0.12, swayHeight: 10 });
    const matWood = enhanceMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), { sway: 0.05, swayHeight: 8, snowStrength: 0.6 });
    const matCanopy = enhanceMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }), { sway: 0.16, swayHeight: 8 });
    const matShrub = enhanceMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), { sway: 0.08, swayHeight: 1 });
    this.grassMat = enhanceMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, color: 0x6b8d3f }), { sway: 0.15, swayHeight: 0.6, snow: false });
    const matRock = enhanceMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, color: 0xb9b4a8 }), { snowStrength: 1.2 });
    this.flowerMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });

    const pineA = makePine(false), pineB = makePine(true);
    this.pinesA = new ChunkedInstances(pineA, matTree, { castShadow: true });
    this.pinesB = new ChunkedInstances(pineB, matTree, { castShadow: true });
    this.oakWood = new ChunkedInstances(makeDeciduousWood(false), matWood, { castShadow: true });
    this.oakCanopy = new ChunkedInstances(makeCanopy(false), matCanopy, { castShadow: true, colors: true });
    this.birchWood = new ChunkedInstances(makeDeciduousWood(true), matWood, { castShadow: true });
    this.birchCanopy = new ChunkedInstances(makeCanopy(true), matCanopy, { castShadow: true, colors: true });
    this.shrubs = new ChunkedInstances(makeShrub(), matShrub, { castShadow: false, colors: true });
    this.grass = new ChunkedInstances(makeGrassTuft(), this.grassMat, { layer1: true });
    this.rocks = new ChunkedInstances(makeRock(), matRock, { castShadow: true });
    this.flowers = new ChunkedInstances(makeFlower(), this.flowerMat, { layer1: true, colors: true });

    this.scatterTrees();
    this.scatterGround();
    for (const ci of [this.pinesA, this.pinesB, this.oakWood, this.oakCanopy, this.birchWood, this.birchCanopy, this.shrubs, this.grass, this.rocks, this.flowers]) ci.build(this.group);
    this.lastLeaf = -1; this.lastColorKey = '';
  }

  addTrunk(x, z, r) {
    const k = `${Math.floor(x / 8)},${Math.floor(z / 8)}`;
    if (!this.trunks.has(k)) this.trunks.set(k, []);
    this.trunks.get(k).push({ x, z, r });
  }
  nearbyTrunks(x, z) {
    const out = [];
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = this.trunks.get(`${cx + i},${cz + j}`);
      if (l) out.push(...l);
    }
    return out;
  }

  scatterTrees() {
    const placed = [];
    const minD = 3.2;
    const grid = new Map();
    const key = (x, z) => `${Math.floor(x / minD)},${Math.floor(z / minD)}`;
    const ok = (x, z) => {
      const cx = Math.floor(x / minD), cz = Math.floor(z / minD);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const l = grid.get(`${cx + i},${cz + j}`);
        if (l) for (const p of l) if ((p.x - x) ** 2 + (p.z - z) ** 2 < minD * minD) return false;
      }
      return true;
    };
    const R = WORLD / 2 - 10;
    for (let n = 0; n < 60000 && placed.length < 5200; n++) {
      const x = randRange(-R, R), z = randRange(-R, R);
      const d = forestDensity(x, z);
      if (d <= 0.02 || rand() > d) continue;
      if (Math.hypot(x, z) > 405) continue;
      if (!ok(x, z)) continue;
      const k = key(x, z);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push({ x, z });
      placed.push({ x, z, d });
    }
    for (const p of placed) {
      const y = heightAt(p.x, p.z) - 0.15;
      const mix = fbm(p.x * 0.006 - 9, p.z * 0.006 + 4, 2); // pine vs hardwood regions
      const u = shoreDist(p.x, p.z);
      const pinePref = 0.5 + mix * 0.9 + (u < 40 ? 0.1 : 0);
      const r = rand();
      const s = randRange(0.75, 1.35);
      const rot = rand() * Math.PI * 2;
      const tilt = (rand() - 0.5) * 0.06, tiltZ = (rand() - 0.5) * 0.06;
      if (r < pinePref * 0.75) {
        (rand() < 0.5 ? this.pinesA : this.pinesB).add(p.x, y, p.z, rot, s, s * randRange(0.9, 1.25), { tilt, tiltZ });
        this.addTrunk(p.x, p.z, 0.35 * s);
      } else if (rand() < 0.22) {
        const it = { tilt, tiltZ, summer: C(0x6f9a3c).multiplyScalar(randRange(0.85, 1.1)), autumn: pick(BIRCH_AUTUMN).clone(), hue: rand() };
        this.birchWood.add(p.x, y, p.z, rot, s * 0.9, s, it);
        this.birchCanopy.add(p.x, y, p.z, rot, s * 0.9, s, it);
        this.addTrunk(p.x, p.z, 0.18 * s);
      } else {
        const it = { tilt, tiltZ, summer: C(rand() < 0.5 ? 0x4f7a32 : 0x5d8436).multiplyScalar(randRange(0.8, 1.1)), autumn: pick(AUTUMN).clone().multiplyScalar(randRange(0.85, 1.1)), hue: rand() };
        const ss = s * randRange(0.9, 1.25);
        this.oakWood.add(p.x, y, p.z, rot, ss, ss, it);
        this.oakCanopy.add(p.x, y, p.z, rot, ss, ss, it);
        this.addTrunk(p.x, p.z, 0.4 * ss);
      }
    }
    // a few landmark pines near the cabin (Thoreau built among pines)
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2, rr = randRange(13, 22);
      const x = CABIN.x + Math.cos(a) * rr, z = CABIN.z + Math.sin(a) * rr;
      if (shoreDist(x, z) < 10 || pathDist(x, z) < 3 || inBeanField(x, z, 3)) continue;
      const s = randRange(1.2, 1.5);
      this.pinesB.add(x, heightAt(x, z) - 0.15, z, rand() * 6, s, s * 1.2);
      this.addTrunk(x, z, 0.4 * s);
    }
  }

  scatterGround() {
    const R = 300;
    // shrubs: forest edges
    let shrubCount = 0;
    for (let n = 0; n < 30000 && shrubCount < 2600; n++) {
      const x = randRange(-R, R), z = randRange(-R, R);
      const u = shoreDist(x, z);
      if (u < 4 || inBeanField(x, z, 1) || railDist(x, z) < 5 || pathDist(x, z) < 2) continue;
      if (Math.hypot(x - CABIN.x, z - CABIN.z) < 7) continue;
      const d = forestDensity(x, z);
      const edge = 1 - Math.abs(d - 0.45) * 1.8;
      if (rand() > edge * 0.8) continue;
      const kind = rand();
      const it = kind < 0.3
        ? { summer: C(0x557a30), autumn: C(0xb0201a), kind: 'sumac' }
        : kind < 0.65 ? { summer: C(0x4a6a2e), autumn: C(0xa3402a), kind: 'blueberry' }
          : { summer: C(0x5f7f38), autumn: C(0xb08a3a), kind: 'hazel' };
      const s = randRange(0.7, 1.5);
      this.shrubs.add(x, heightAt(x, z) - 0.05, z, rand() * 6, s, s * randRange(0.8, 1.2), it);
      shrubCount++;
    }
    // grass tufts in open ground
    const GR = 260;
    let count = 0;
    for (let n = 0; n < 300000 && count < 32000; n++) {
      const x = randRange(-GR, GR), z = randRange(-GR, GR);
      const h = heightAt(x, z);
      if (h < 0.35) continue;
      const u = shoreDist(x, z);
      if (u < 4.5) continue;
      if (inBeanField(x, z, 0.3) || railDist(x, z) < 3.2 || pathDist(x, z) < 0.9) continue;
      if (Math.hypot(x - CABIN.x, z - CABIN.z) < 3.5) continue;
      const d = forestDensity(x, z);
      const near = Math.hypot(x - CABIN.x, z - CABIN.z) < 70 ? 1 : 0.35;
      if (rand() > (1 - d * 1.1) * near) continue;
      const s = randRange(0.7, 1.3);
      this.grass.add(x, h - 0.03, z, rand() * 6, s, s * randRange(0.75, 1.15));
      count++;
      if (rand() < 0.07) {
        const col = pick([C(0xf2efe6), C(0xf0cf3a), C(0xa47ad0), C(0xe8a0b8), C(0xf4f4ff)]);
        this.flowers.add(x + randRange(-0.3, 0.3), h - 0.02, z + randRange(-0.3, 0.3), rand() * 6, randRange(0.8, 1.3), randRange(0.8, 1.4), { color: col });
      }
    }
    // shore stones (Walden's shore is "a belt of smooth rounded white stones")
    for (let n = 0; n < 2400; n++) {
      const a = rand() * Math.PI * 2;
      const x0 = Math.cos(a), z0 = Math.sin(a);
      // find shore along ray
      let lo = 40, hi = 200;
      for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (shoreDist(x0 * m, z0 * m) < 0) lo = m; else hi = m; }
      const r = lo + randRange(-2.5, 5);
      const x = x0 * r, z = z0 * r;
      const s = randRange(0.12, 0.45) * (rand() < 0.08 ? 2.4 : 1);
      this.rocks.add(x, heightAt(x, z) - s * 0.25, z, rand() * 6, s, s * randRange(0.7, 1.1), { tilt: rand() * 0.4 });
    }
    // glacial boulders in the woods
    for (let n = 0; n < 160; n++) {
      const x = randRange(-280, 280), z = randRange(-280, 280);
      if (shoreDist(x, z) < 8 || inBeanField(x, z, 3) || railDist(x, z) < 8 || pathDist(x, z) < 3) continue;
      if (Math.hypot(x - CABIN.x, z - CABIN.z) < 12) continue;
      const s = randRange(0.6, 1.8);
      this.rocks.add(x, heightAt(x, z) - s * 0.3, z, rand() * 6, s, s * 0.8, { tilt: rand() * 0.3 });
      if (s > 1.0) this.addTrunk(x, z, s * 0.9);
    }
  }

  update(season) {
    const leaf = season.leaf;
    if (Math.abs(leaf - this.lastLeaf) > 0.015) {
      this.lastLeaf = leaf;
      const show = leaf > 0.02;
      this.oakCanopy.setVisible(show); this.birchCanopy.setVisible(show);
      if (show) {
        const f = (it) => (0.25 + 0.75 * Math.min(1, leaf * 1.2)) * (0.85 + 0.15 * Math.min(1, Math.max(0, (leaf - it.hue * 0.3) * 2)));
        this.oakCanopy.rescale(f); this.birchCanopy.rescale(f);
      }
    }
    const key = [season.autumn, season.spring, season.bare, season.snow].map((v) => v.toFixed(2)).join();
    if (key !== this.lastColorKey) {
      this.lastColorKey = key;
      const spring = C(0x9cc458);
      const color = (it, c) => {
        const a = Math.min(1, Math.max(0, season.autumn * 1.4 - it.hue * 0.4));
        c.copy(it.summer).lerp(spring, season.spring * 0.6).lerp(it.autumn, a);
      };
      this.oakCanopy.recolor(color); this.birchCanopy.recolor(color);
      const brown = C(0x5a4632);
      this.shrubs.recolor((it, c) => {
        c.copy(it.summer).lerp(spring, season.spring * 0.4).lerp(it.autumn, Math.min(1, season.autumn * (it.kind === 'sumac' ? 1.5 : 1.1))).lerp(brown, season.bare * 0.85);
        c.lerp(C(0xe8edf2), season.snow * 0.7);
      });
      const gc = C(0x6b8d3f).lerp(C(0x8fb352), season.spring).lerp(C(0xa69250), season.autumn).lerp(C(0x8f7d58), season.bare * 0.9);
      this.grassMat.color.copy(gc);
      this.grass.setVisible(season.snow < 0.55);
      const bloom = season.leaf * (1 - season.autumn) * (1 - season.snow);
      this.flowers.setVisible(bloom > 0.4);
    }
  }
}
