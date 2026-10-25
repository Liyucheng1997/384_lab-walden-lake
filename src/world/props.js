import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BEANS, RAIL, heightAt, CABIN, shoreDist, forestDensity, inBeanField, railDist, pathDist, COVE } from './geo.js';
import { rand, randRange, enhanceMaterial, softTexture, jitterGeometry, mulberry32, lerp, clamp } from '../util.js';

const C = (h) => new THREE.Color(h);
function vc(geo, color, jitter = 0.1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const k = 1 + (rand() - 0.5) * jitter;
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r * k; arr[i * 3 + 1] = c.g * k; arr[i * 3 + 2] = c.b * k; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// ================= Bean field =================
export const BEAN_ROWS = 20;
export const BEAN_SEGS = 6;
export class BeanField {
  constructor() {
    this.group = new THREE.Group();
    this.group.position.set(BEANS.cx, 0, BEANS.cz);
    this.group.rotation.y = BEANS.rot;
    this.group.updateMatrixWorld();
    // plant: a few leaves on a stem
    const parts = [];
    for (let i = 0; i < 6; i++) {
      const leaf = new THREE.CircleGeometry(0.09, 5);
      leaf.scale(1, 1.5, 1);
      leaf.rotateX(-Math.PI / 2 + 0.5 + rand() * 0.5);
      leaf.rotateY(rand() * Math.PI * 2);
      leaf.translate((rand() - 0.5) * 0.15, 0.12 + rand() * 0.25, (rand() - 0.5) * 0.15);
      parts.push(vc(leaf, 0xffffff, 0.3));
    }
    const stem = new THREE.CylinderGeometry(0.008, 0.012, 0.35, 3);
    stem.translate(0, 0.17, 0);
    parts.push(vc(stem, 0x9ab070));
    const plantGeo = mergeGeometries(parts);
    const weedParts = [];
    for (let i = 0; i < 5; i++) {
      const b = new THREE.ConeGeometry(0.03, randRange(0.2, 0.35), 3);
      b.translate((rand() - 0.5) * 0.15, 0.12, (rand() - 0.5) * 0.15);
      b.rotateZ((rand() - 0.5) * 0.5);
      weedParts.push(vc(b, 0xffffff, 0.3));
    }
    const weedGeo = mergeGeometries(weedParts);
    this.plantMat = enhanceMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9, color: 0x5f8a3a }), { sway: 0.05, swayHeight: 0.4 });
    this.weedMat = enhanceMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, color: 0x7a8a3a }), { sway: 0.06, swayHeight: 0.3 });

    this.plantsPer = 60;
    const total = BEAN_ROWS * this.plantsPer;
    this.plants = new THREE.InstancedMesh(plantGeo, this.plantMat, total);
    this.plants.receiveShadow = true;
    this.plants.layers.set(1);
    this.weedsPer = 9;
    this.weeds = new THREE.InstancedMesh(weedGeo, this.weedMat, BEAN_ROWS * BEAN_SEGS * this.weedsPer);
    this.weeds.layers.set(1);
    this.plantData = [];
    this.weedData = [];
    const rowLen = BEANS.w - 2;
    for (let r = 0; r < BEAN_ROWS; r++) {
      const lz = -BEANS.d / 2 + 1 + (r * (BEANS.d - 2)) / (BEAN_ROWS - 1);
      for (let i = 0; i < this.plantsPer; i++) {
        const lx = -rowLen / 2 + (i + 0.5) * (rowLen / this.plantsPer) + (rand() - 0.5) * 0.1;
        const seg = Math.min(BEAN_SEGS - 1, Math.floor(((lx + rowLen / 2) / rowLen) * BEAN_SEGS));
        this.plantData.push({ lx, lz: lz + (rand() - 0.5) * 0.08, r, seg, rot: rand() * 6, s: randRange(0.8, 1.2) });
      }
      for (let sgi = 0; sgi < BEAN_SEGS; sgi++) {
        for (let k = 0; k < this.weedsPer; k++) {
          const lx = -rowLen / 2 + ((sgi + rand()) * rowLen) / BEAN_SEGS;
          this.weedData.push({ lx, lz: lz + (rand() < 0.5 ? -1 : 1) * randRange(0.2, 0.45), r, seg: sgi, rot: rand() * 6, s: randRange(0.7, 1.3) });
        }
      }
    }
    this.group.add(this.plants, this.weeds);
    this.weedy = new Array(BEAN_ROWS * BEAN_SEGS).fill(true);
    this.harvested = new Array(BEAN_ROWS * BEAN_SEGS).fill(false);
    this.lastGrowth = -1;
    this.lastKey = '';
    this.inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
  }

  segIndex(r, s) { return r * BEAN_SEGS + s; }
  segCenterWorld(idx) {
    const r = Math.floor(idx / BEAN_SEGS), s = idx % BEAN_SEGS;
    const rowLen = BEANS.w - 2;
    const lz = -BEANS.d / 2 + 1 + (r * (BEANS.d - 2)) / (BEAN_ROWS - 1);
    const lx = -rowLen / 2 + ((s + 0.5) * rowLen) / BEAN_SEGS;
    const v = new THREE.Vector3(lx, 0, lz).applyMatrix4(this.group.matrixWorld);
    v.y = heightAt(v.x, v.z);
    return v;
  }
  // nearest segment to point p (world)
  nearestSeg(p) {
    const l = p.clone().applyMatrix4(this.inv);
    const rowLen = BEANS.w - 2;
    if (Math.abs(l.x) > BEANS.w / 2 + 1 || Math.abs(l.z) > BEANS.d / 2 + 1) return -1;
    const r = Math.round(((l.z + BEANS.d / 2 - 1) * (BEAN_ROWS - 1)) / (BEANS.d - 2));
    const s = Math.floor(((l.x + rowLen / 2) / rowLen) * BEAN_SEGS);
    if (r < 0 || r >= BEAN_ROWS || s < 0 || s >= BEAN_SEGS) return -1;
    return this.segIndex(r, s);
  }

  refresh(season) {
    const growth = season.beans;
    const key = `${growth.toFixed(3)}|${season.autumn.toFixed(2)}|${this.weedy.join('')}|${this.harvested.join('')}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const wp = new THREE.Vector3();
    const col = new THREE.Color();
    const ripe = clamp((season.autumn - 0.05) * 3, 0, 1);
    this.plantData.forEach((d, i) => {
      const harvested = this.harvested[this.segIndex(d.r, d.seg)];
      const g = harvested ? 0 : growth;
      const sc = g < 0.01 ? 0 : d.s * (0.25 + 0.95 * g);
      wp.set(d.lx, 0, d.lz).applyMatrix4(this.group.matrixWorld);
      p.set(d.lx, heightAt(wp.x, wp.z) - 0.02, d.lz);
      q.setFromAxisAngle(up, d.rot);
      s.set(sc, sc * (0.8 + g * 0.6), sc);
      m4.compose(p, q, s);
      this.plants.setMatrixAt(i, m4);
      col.setRGB(1, 1, 1).lerp(C(0xd6b860), ripe);
      this.plants.setColorAt(i, col);
    });
    this.plants.instanceMatrix.needsUpdate = true;
    if (this.plants.instanceColor) this.plants.instanceColor.needsUpdate = true;
    const weedSeason = season.snow < 0.3 && season.leaf > 0.3;
    this.weedData.forEach((d, i) => {
      const on = weedSeason && this.weedy[this.segIndex(d.r, d.seg)];
      const sc = on ? d.s : 0;
      wp.set(d.lx, 0, d.lz).applyMatrix4(this.group.matrixWorld);
      p.set(d.lx, heightAt(wp.x, wp.z) - 0.02, d.lz);
      q.setFromAxisAngle(up, d.rot);
      s.set(sc, sc, sc);
      m4.compose(p, q, s);
      this.weeds.setMatrixAt(i, m4);
    });
    this.weeds.instanceMatrix.needsUpdate = true;
    this.plants.computeBoundingSphere();
    this.weeds.computeBoundingSphere();
  }

  newDay(season, r = Math.random) {
    // weeds creep back
    if (season.leaf > 0.3 && season.snow < 0.3) {
      for (let i = 0; i < this.weedy.length; i++) if (!this.weedy[i] && r() < 0.25) this.weedy[i] = true;
    }
  }
}

// ================= Railroad & train =================
function smokePool(n, color) {
  const tex = softTexture();
  const arr = [];
  for (let i = 0; i < n; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity: 0, depthWrite: false, fog: true }));
    sp.visible = false;
    sp.userData = { life: 0, max: 1, vel: new THREE.Vector3() };
    arr.push(sp);
  }
  return arr;
}

export class Smoke {
  constructor(scene, n = 40, color = 0xd8d8d8) {
    this.pool = smokePool(n, color);
    this.pool.forEach((s) => scene.add(s));
    this.idx = 0;
    this.acc = 0;
  }
  emit(pos, vel, life = 6, size = 1.5, opacity = 0.5) {
    const s = this.pool[this.idx];
    this.idx = (this.idx + 1) % this.pool.length;
    s.position.copy(pos);
    s.userData.vel.copy(vel);
    s.userData.life = 0; s.userData.max = life; s.userData.size = size; s.userData.op = opacity;
    s.visible = true;
  }
  update(dt, wind) {
    for (const s of this.pool) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life += dt;
      if (u.life > u.max) { s.visible = false; continue; }
      const t = u.life / u.max;
      s.position.addScaledVector(u.vel, dt);
      s.position.x += wind * 0.8 * dt;
      u.vel.multiplyScalar(1 - dt * 0.3);
      const sz = u.size * (0.6 + t * 2.4);
      s.scale.set(sz, sz, sz);
      s.material.opacity = u.op * Math.sin(Math.PI * Math.min(1, t * 1.3)) * (1 - t);
    }
  }
}

function buildLocomotive() {
  const parts = [];
  const add = (g, color, j = 0.06) => parts.push(vc(g, color, j));
  const black = 0x22262a, green = 0x2c4a3a, red = 0x8a2a1e, brass = 0xb89a4a, wood = 0x6a4a2a;
  // boiler along +z
  let g = new THREE.CylinderGeometry(0.62, 0.62, 4.2, 16); g.rotateX(Math.PI / 2); g.translate(0, 1.95, 0.6); add(g, green);
  g = new THREE.CylinderGeometry(0.66, 0.66, 0.9, 16); g.rotateX(Math.PI / 2); g.translate(0, 1.95, 2.95); add(g, black);
  for (const z of [-0.8, 0.4, 1.6]) { g = new THREE.CylinderGeometry(0.64, 0.64, 0.08, 16); g.rotateX(Math.PI / 2); g.translate(0, 1.95, z); add(g, brass); }
  // balloon stack
  g = new THREE.CylinderGeometry(0.55, 0.2, 1.3, 12); g.translate(0, 3.25, 2.95); add(g, black);
  g = new THREE.CylinderGeometry(0.2, 0.2, 0.5, 8); g.translate(0, 2.6, 2.95); add(g, black);
  // dome & bell
  g = new THREE.SphereGeometry(0.32, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2); g.translate(0, 2.5, 0.8); add(g, brass);
  g = new THREE.CylinderGeometry(0.12, 0.18, 0.25, 10); g.translate(0, 2.7, 1.8); add(g, brass);
  // headlamp
  g = new THREE.BoxGeometry(0.55, 0.55, 0.55); g.translate(0, 2.85, 3.5); add(g, black);
  // cab
  g = new THREE.BoxGeometry(2.0, 1.9, 1.7); g.translate(0, 2.35, -2.25); add(g, wood);
  g = new THREE.BoxGeometry(2.3, 0.1, 2.0); g.translate(0, 3.35, -2.25); add(g, black);
  // frame
  g = new THREE.BoxGeometry(1.5, 0.25, 6.6); g.translate(0, 1.15, 0.3); add(g, black);
  // cowcatcher
  for (let i = -3; i <= 3; i++) {
    g = new THREE.BoxGeometry(0.06, 0.06, 1.4); g.rotateX(0.75); g.rotateY(i * 0.18); g.translate(i * 0.2, 0.65, 3.9 - Math.abs(i) * 0.08); add(g, red);
  }
  // wheels
  for (const sx of [-0.75, 0.75]) {
    for (const z of [-1.2, 0.5]) { g = new THREE.CylinderGeometry(0.8, 0.8, 0.12, 18); g.rotateZ(Math.PI / 2); g.translate(sx, 0.8, z); add(g, red); }
    for (const z of [2.3, 3.2]) { g = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 12); g.rotateZ(Math.PI / 2); g.translate(sx, 0.4, z); add(g, red); }
    g = new THREE.BoxGeometry(0.06, 0.1, 1.9); g.translate(sx * 1.1, 0.85, -0.35); add(g, 0x8a8a8a);
  }
  // cylinders
  for (const sx of [-0.78, 0.78]) { g = new THREE.CylinderGeometry(0.25, 0.25, 0.9, 10); g.rotateX(Math.PI / 2); g.translate(sx, 1.2, 2.5); add(g, green); }
  const loco = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.25 }));
  loco.castShadow = true;
  return loco;
}
function buildTender() {
  const parts = [];
  const add = (g, color, j = 0.08) => parts.push(vc(g, color, j));
  let g = new THREE.BoxGeometry(2.1, 1.1, 3.4); g.translate(0, 1.6, 0); add(g, 0x2c4a3a);
  g = new THREE.BoxGeometry(1.5, 0.25, 3.6); g.translate(0, 1.0, 0); add(g, 0x22262a);
  for (let i = 0; i < 26; i++) { g = new THREE.CylinderGeometry(0.09, 0.09, 1.0, 6); g.rotateZ(Math.PI / 2); g.translate(randRange(-0.6, 0.6) * 0.8, 2.2 + rand() * 0.35, randRange(-1.4, 1.4)); add(g, 0x6a4a30, 0.3); }
  for (const sx of [-0.75, 0.75]) for (const z of [-1.1, -0.4, 0.4, 1.1]) { g = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 12); g.rotateZ(Math.PI / 2); g.translate(sx, 0.45, z); add(g, 0x8a2a1e); }
  const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
  m.castShadow = true;
  return m;
}
function buildCar(kind) {
  const parts = [];
  const add = (g, color, j = 0.05) => parts.push(vc(g, color, j));
  const body = kind === 0 ? 0xa8782e : 0x7a3a26;
  let g = new THREE.BoxGeometry(2.4, 2.1, 8.6); g.translate(0, 2.2, 0); add(g, body);
  g = new THREE.BoxGeometry(2.7, 0.18, 9.0); g.scale(1, 1, 1); g.translate(0, 3.33, 0); add(g, 0x3a3430);
  g = new THREE.BoxGeometry(2.2, 0.25, 8.9); g.translate(0, 1.05, 0); add(g, 0x22262a);
  if (kind === 0) for (let i = 0; i < 8; i++) for (const sx of [-1.21, 1.21]) { g = new THREE.BoxGeometry(0.02, 0.6, 0.55); g.translate(sx, 2.55, -3.5 + i * 1.0); add(g, 0x2a2a30); }
  else for (const sx of [-1.21, 1.21]) { g = new THREE.BoxGeometry(0.03, 1.6, 1.6); g.translate(sx, 2.15, 0); add(g, 0x5a2a1e); }
  for (const sx of [-0.75, 0.75]) for (const z of [-3.4, -2.6, 2.6, 3.4]) { g = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 12); g.rotateZ(Math.PI / 2); g.translate(sx, 0.45, z); add(g, 0x2a2a2a); }
  const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
  m.castShadow = true;
  return m;
}

export class Railroad {
  constructor(scene) {
    this.group = new THREE.Group();
    const len = 900;
    const ang = Math.atan2(RAIL.dx, RAIL.dz);
    const base = new THREE.Group();
    base.position.set(RAIL.px, RAIL.y, RAIL.pz);
    base.rotation.y = ang;
    // ballast
    const ballast = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.3, len), enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x77716a, roughness: 1 })));
    ballast.position.y = 0.05; ballast.receiveShadow = true;
    base.add(ballast);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x6a6460, roughness: 0.4, metalness: 0.7 });
    for (const sx of [-0.72, 0.72]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, len), railMat);
      r.position.set(sx, 0.38, 0);
      r.castShadow = true;
      base.add(r);
    }
    const tieGeo = new THREE.BoxGeometry(2.4, 0.14, 0.22);
    const nTies = Math.floor(len / 0.75);
    const ties = new THREE.InstancedMesh(tieGeo, enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 })), nTies);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < nTies; i++) {
      m4.makeRotationY((rand() - 0.5) * 0.04);
      m4.setPosition((rand() - 0.5) * 0.05, 0.27, -len / 2 + i * 0.75);
      ties.setMatrixAt(i, m4);
    }
    ties.receiveShadow = true;
    base.add(ties);
    // telegraph poles + wires ("the telegraph harp")
    const poleMat = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 1 }));
    const pts = [];
    for (let z = -len / 2; z <= len / 2; z += 45) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 7, 6), poleMat);
      pole.position.set(4.2, 3.5, z);
      pole.castShadow = true;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.1), poleMat);
      arm.position.set(4.2, 6.6, z);
      base.add(pole, arm);
      pts.push(z);
    }
    const wirePos = [];
    for (let i = 0; i < pts.length - 1; i++) {
      for (const wx of [3.7, 4.7]) {
        const N = 8;
        for (let k = 0; k < N; k++) {
          const t0 = k / N, t1 = (k + 1) / N;
          const z0 = lerp(pts[i], pts[i + 1], t0), z1 = lerp(pts[i], pts[i + 1], t1);
          const y0 = 6.7 - Math.sin(t0 * Math.PI) * 0.6, y1 = 6.7 - Math.sin(t1 * Math.PI) * 0.6;
          wirePos.push(wx, y0, z0, wx, y1, z1);
        }
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wirePos, 3));
    base.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.6 })));
    this.group.add(base);

    // train
    this.train = new THREE.Group();
    const loco = buildLocomotive();
    loco.position.z = 0;
    this.train.add(loco);
    const tender = buildTender(); tender.position.z = -5.3; this.train.add(tender);
    for (let i = 0; i < 4; i++) { const car = buildCar(i % 3 === 2 ? 1 : 0); car.position.z = -11.8 - i * 9.4; this.train.add(car); }
    this.trainLen = 52;
    this.train.visible = false;
    this.group.add(this.train);
    this.ang = ang;
    this.smoke = new Smoke(scene, 60, 0xcfcac4);
    this.active = null;
    this.lastHour = null;
    this.schedule = [7.1, 9.9, 12.6, 15.4, 18.2];
    this.stackLocal = new THREE.Vector3(0, 4.0, 2.95);
    this.onWhistle = null;
  }

  start(dir) {
    this.active = { dir, along: dir > 0 ? -470 : 470, whistled: false };
    this.train.visible = true;
  }

  update(dt, hour, playerPos, wind) {
    if (this.lastHour !== null) {
      for (const h of this.schedule) {
        if (this.lastHour < h && hour >= h && !this.active) this.start(Math.round(h * 10) % 2 ? 1 : -1);
      }
    }
    this.lastHour = hour;
    if (this.active) {
      const a = this.active;
      a.along += a.dir * 15 * dt;
      const x = RAIL.px + RAIL.dx * a.along, z = RAIL.pz + RAIL.dz * a.along;
      this.train.position.set(x, RAIL.y + 0.32, z);
      this.train.rotation.y = this.ang + (a.dir > 0 ? 0 : Math.PI);
      // smoke
      this.smokeAcc = (this.smokeAcc || 0) + dt;
      while (this.smokeAcc > 0.09) {
        this.smokeAcc -= 0.09;
        const sp = this.stackLocal.clone().applyMatrix4(this.train.matrixWorld);
        this.smoke.emit(sp, new THREE.Vector3((Math.random() - 0.5) * 0.6, 2.2 + Math.random(), (Math.random() - 0.5) * 0.6), 7, 1.6, 0.55);
      }
      // wheels clatter & whistle handled by audio via callbacks
      const dx = playerPos.x - x, dz = playerPos.z - z;
      const dist = Math.hypot(dx, dz);
      this.distance = dist;
      if (!a.whistled && Math.abs(a.along) < 260) { a.whistled = true; this.onWhistle && this.onWhistle(this.train.position.clone()); }
      if (Math.abs(a.along) > 480) { this.active = null; this.train.visible = false; this.distance = Infinity; }
    } else this.distance = Infinity;
    this.train.updateMatrixWorld();
    this.smoke.update(dt, wind);
  }
}

// ================= Boat =================
export class Boat {
  constructor() {
    this.group = new THREE.Group();
    const L = 3.4, stations = 16, ring = 9;
    const pos = [];
    const width = (t) => { // t: -1 (stern) .. 1 (bow)
      const bow = t > 0 ? 1 - Math.pow(t, 2.2) : 1 - Math.pow(-t, 4) * 0.35;
      return 0.66 * Math.max(0.02, bow);
    };
    const sheer = (t) => 0.42 + Math.pow(Math.abs(t), 2) * 0.18;
    const grid = [];
    for (let i = 0; i <= stations; i++) {
      const t = -1 + (2 * i) / stations;
      const w = width(t), top = sheer(t);
      const row = [];
      for (let j = 0; j <= ring; j++) {
        const a = (j / ring) * Math.PI; // 0..PI around hull bottom
        const x = Math.cos(a) * w;
        const y = top - Math.sin(a) * (0.5 * (0.6 + 0.4 * (1 - Math.abs(t))));
        row.push(new THREE.Vector3(x, y, t * L / 2));
      }
      grid.push(row);
    }
    for (let i = 0; i < stations; i++) for (let j = 0; j < ring; j++) {
      const a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j + 1], d = grid[i][j + 1];
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
    }
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    hg.computeVertexNormals();
    const hull = new THREE.Mesh(hg, enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x6f8a86, roughness: 0.8, side: THREE.DoubleSide })));
    hull.castShadow = true;
    this.group.add(hull);
    const woodMat = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.9 }));
    // gunwales
    for (const sx of [-1, 1]) {
      const pts = grid.map((r) => r[sx > 0 ? 0 : ring].clone().add(new THREE.Vector3(0, 0.02, 0)));
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.035, 5), woodMat);
      this.group.add(tube);
    }
    // depth-only cover over the hull opening so the pond surface never shows inside the boat
    const outline = new THREE.Shape();
    grid.forEach((r, i) => { const p = r[0]; i ? outline.lineTo(p.x, p.z) : outline.moveTo(p.x, p.z); });
    for (let i = grid.length - 1; i >= 0; i--) { const p = grid[i][ring]; outline.lineTo(p.x, p.z); }
    const maskGeo = new THREE.ShapeGeometry(outline);
    maskGeo.rotateX(Math.PI / 2);
    maskGeo.translate(0, 0.36, 0);
    const mask = new THREE.Mesh(maskGeo, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
    mask.renderOrder = 1;
    this.group.add(mask);
    for (let i = 0; i < 4; i++) {
      const fb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 2.4 - Math.abs(i - 1.5) * 0.4), woodMat);
      fb.position.set((i - 1.5) * 0.18, -0.05, -0.1);
      fb.receiveShadow = true;
      this.group.add(fb);
    }
    for (const [z, w] of [[-0.9, 1.1], [0.35, 1.15]]) {
      const th = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, 0.26), woodMat);
      th.position.set(0, 0.28, z);
      this.group.add(th);
    }
    // oars
    this.oars = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.66, 0.46, 0.05);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 2.4, 6), woodMat);
      shaft.rotation.z = Math.PI / 2;
      shaft.position.x = sx * 0.6;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.14), woodMat);
      blade.position.x = sx * 1.65;
      pivot.add(shaft, blade);
      pivot.userData.side = sx;
      this.group.add(pivot);
      this.oars.push(pivot);
    }
    this.heading = 0;
    this.vel = 0;
    this.turn = 0;
    this.stroke = 0;
    // moored at the cove below the cabin
    const dx = -COVE.x, dz = -COVE.z;
    const l = Math.hypot(dx, dz);
    this.home = new THREE.Vector3(COVE.x + (dx / l) * 1.5, 0, COVE.z + (dz / l) * 1.5);
    this.group.position.copy(this.home);
    this.heading = Math.atan2(dx, dz);
    this.group.rotation.y = this.heading;
    this.beached = false;
  }

  update(dt, t, input, iceAmount) {
    // bobbing
    const g = this.group;
    if (iceAmount > 0.5) {
      // pulled up on shore for winter
      g.visible = true;
      g.position.y = 0.25;
      g.rotation.z = 0.25;
      return;
    }
    g.rotation.z = Math.sin(t * 1.3) * 0.025;
    g.rotation.x = Math.sin(t * 0.9 + 1) * 0.015;
    g.position.y = -0.18 + Math.sin(t * 1.1) * 0.02;
    if (input) {
      const fwd = (input.fwd || 0);
      this.vel += fwd * dt * 1.0;
      this.turn += (input.turn || 0) * dt * 0.9;
      if (fwd !== 0 || input.turn) this.stroke += dt * 2.6;
    }
    this.vel *= 1 - dt * 0.35;
    this.turn *= 1 - dt * 1.8;
    this.vel = clamp(this.vel, -0.8, 1.8);
    this.heading += this.turn * dt;
    const nx = g.position.x + Math.sin(this.heading) * this.vel * dt;
    const nz = g.position.z + Math.cos(this.heading) * this.vel * dt;
    // keep in water
    const bowX = nx + Math.sin(this.heading) * 1.6 * Math.sign(this.vel || 1);
    const bowZ = nz + Math.cos(this.heading) * 1.6 * Math.sign(this.vel || 1);
    if (heightAt(bowX, bowZ) < -0.35 && heightAt(nx, nz) < -0.3) { g.position.x = nx; g.position.z = nz; } else this.vel *= -0.2;
    g.rotation.y = this.heading;
    // oar animation
    const ph = this.stroke * Math.PI;
    for (const o of this.oars) {
      const s = o.userData.side;
      const active = Math.abs(this.vel) > 0.05 || Math.abs(this.turn) > 0.05;
      o.rotation.y = active ? Math.sin(ph) * 0.5 * s : 0.9 * s;
      o.rotation.z = active ? (Math.cos(ph) * 0.18 - 0.12) * s : -0.15 * s;
    }
  }
}

// ================= Firewood pickups =================
export class Firewood {
  constructor() {
    this.group = new THREE.Group();
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.CylinderGeometry(0.03, 0.05, randRange(0.8, 1.4), 5);
      g.rotateZ(Math.PI / 2 + (rand() - 0.5) * 0.3);
      g.rotateY(rand() * 0.8 - 0.4);
      g.translate(0, 0.05 + i * 0.03, (rand() - 0.5) * 0.25);
      parts.push(vc(g, 0x5a4432, 0.25));
    }
    this.geo = mergeGeometries(parts);
    this.mat = enhanceMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), { snowStrength: 0.7 });
    this.items = [];
    this.respawn(26, mulberry32(42));
  }
  respawn(n, r = Math.random) {
    let tries = 0;
    while (this.items.filter((i) => i.visible).length < n && tries++ < 4000) {
      const a = r() * Math.PI * 2, d = 12 + r() * 120;
      const x = CABIN.x + Math.cos(a) * d, z = CABIN.z + Math.sin(a) * d;
      if (shoreDist(x, z) < 6 || inBeanField(x, z, 2) || railDist(x, z) < 6 || forestDensity(x, z) < 0.3) continue;
      let m = this.items.find((i) => !i.visible);
      if (!m) { m = new THREE.Mesh(this.geo, this.mat); m.castShadow = true; this.group.add(m); this.items.push(m); }
      m.position.set(x, heightAt(x, z), z);
      m.rotation.y = r() * 6;
      m.visible = true;
    }
  }
}

// ================= Dawn mist over the pond =================
export class Mist {
  constructor() {
    this.group = new THREE.Group();
    const tex = softTexture();
    this.sprites = [];
    const r = mulberry32(77);
    for (let i = 0; i < 46; i++) {
      const a = r() * Math.PI * 2, d = r() * 95;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: true }));
      s.position.set(Math.cos(a) * d, 1.2 + r() * 1.5, Math.sin(a) * d);
      const sz = 24 + r() * 26;
      s.scale.set(sz, sz * 0.22, 1);
      s.userData.base = s.position.clone();
      s.userData.ph = r() * 6;
      this.sprites.push(s);
      this.group.add(s);
    }
  }
  update(t, amount, color) {
    this.group.visible = amount > 0.01;
    if (!this.group.visible) return;
    for (const s of this.sprites) {
      s.material.opacity = amount * 0.32;
      s.material.color.copy(color);
      s.position.x = s.userData.base.x + Math.sin(t * 0.05 + s.userData.ph) * 6;
      s.position.y = s.userData.base.y + Math.sin(t * 0.2 + s.userData.ph) * 0.2;
    }
  }
}
