import * as THREE from 'three';
import { softTexture, rand } from '../util.js';

const BOX = { x: 50, y: 28, z: 50 };

export class Weather {
  constructor() {
    this.group = new THREE.Group();
    // ---- snow ----
    const ns = 5000;
    const sp = new Float32Array(ns * 3);
    for (let i = 0; i < ns; i++) { sp[i * 3] = (rand() - 0.5) * BOX.x; sp[i * 3 + 1] = rand() * BOX.y; sp[i * 3 + 2] = (rand() - 0.5) * BOX.z; }
    this.snowGeo = new THREE.BufferGeometry();
    this.snowGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snowMat = new THREE.PointsMaterial({ map: softTexture(), size: 0.12, transparent: true, opacity: 0.9, depthWrite: false, color: 0xffffff });
    this.snow = new THREE.Points(this.snowGeo, this.snowMat);
    this.snow.frustumCulled = false;
    this.snow.layers.set(1);
    this.group.add(this.snow);
    this.snowSeeds = Float32Array.from({ length: ns }, () => rand() * 6.28);

    // ---- rain ----
    const nr = 3500;
    const rp = new Float32Array(nr * 6);
    this.rainHead = new Float32Array(nr * 3);
    for (let i = 0; i < nr; i++) {
      this.rainHead[i * 3] = (rand() - 0.5) * BOX.x; this.rainHead[i * 3 + 1] = rand() * BOX.y; this.rainHead[i * 3 + 2] = (rand() - 0.5) * BOX.z;
    }
    this.rainGeo = new THREE.BufferGeometry();
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.35, depthWrite: false });
    this.rain = new THREE.LineSegments(this.rainGeo, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.layers.set(1);
    this.group.add(this.rain);

    // ---- falling leaves ----
    const nl = 260;
    const lg = new THREE.PlaneGeometry(0.09, 0.06);
    this.leafMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 });
    this.leaves = new THREE.InstancedMesh(lg, this.leafMat, nl);
    this.leaves.layers.set(1);
    this.leafData = [];
    const cols = [0xc23b20, 0xd6741f, 0xe0a832, 0x9a4a24, 0xd8b23a];
    for (let i = 0; i < nl; i++) {
      this.leafData.push({ x: (rand() - 0.5) * BOX.x, y: rand() * 14, z: (rand() - 0.5) * BOX.z, ph: rand() * 6, sp: 0.5 + rand() * 0.6 });
      this.leaves.setColorAt(i, new THREE.Color(cols[i % cols.length]));
    }
    this.leaves.frustumCulled = false;
    this.group.add(this.leaves);
    this.origin = new THREE.Vector3();
  }

  update(dt, t, cam, env) {
    const s = env.season;
    // re-centre volumes on the camera with wrapping
    const cx = cam.x, cy = cam.y, cz = cam.z;
    const wrap = (v, c, size) => { const d = v - c; return c + (((d + size / 2) % size) + size) % size - size / 2; };

    // snow
    const sAmt = env.snowfall;
    this.snow.visible = sAmt > 0.02;
    if (this.snow.visible) {
      this.snowMat.opacity = Math.min(1, sAmt * 1.2);
      const p = this.snowGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const ph = this.snowSeeds[i];
        y -= dt * (0.7 + (ph % 1) * 0.5);
        x += dt * (Math.sin(t * 0.7 + ph) * 0.4 + env.wind * 0.8);
        z += dt * Math.cos(t * 0.5 + ph) * 0.4;
        if (y < cy - 6) y += BOX.y;
        if (y > cy - 6 + BOX.y) y -= BOX.y;
        p.setXYZ(i, wrap(x, cx, BOX.x), y, wrap(z, cz, BOX.z));
      }
      p.needsUpdate = true;
    }

    // rain
    const rAmt = env.rain;
    this.rain.visible = rAmt > 0.02;
    if (this.rain.visible) {
      this.rainMat.opacity = 0.35 * Math.min(1, rAmt * 1.3);
      const p = this.rainGeo.attributes.position;
      const h = this.rainHead;
      const n = h.length / 3;
      for (let i = 0; i < n; i++) {
        let x = h[i * 3], y = h[i * 3 + 1], z = h[i * 3 + 2];
        y -= dt * 16;
        x += dt * env.wind * 2;
        if (y < cy - 6) { y += BOX.y; }
        x = wrap(x, cx, BOX.x); z = wrap(z, cz, BOX.z);
        h[i * 3] = x; h[i * 3 + 1] = y; h[i * 3 + 2] = z;
        p.setXYZ(i * 2, x, y, z);
        p.setXYZ(i * 2 + 1, x - env.wind * 0.1, y + 0.45, z);
      }
      p.needsUpdate = true;
    }

    // leaves in autumn
    const lAmt = s.autumn * s.leaf;
    this.leaves.visible = lAmt > 0.15;
    if (this.leaves.visible) {
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const sc = new THREE.Vector3(1, 1, 1);
      const pos = new THREE.Vector3();
      const count = Math.floor(this.leafData.length * Math.min(1, lAmt));
      this.leaves.count = count;
      for (let i = 0; i < count; i++) {
        const d = this.leafData[i];
        d.y -= dt * 0.55 * d.sp;
        d.x += dt * (Math.sin(t * 1.2 + d.ph) * 0.6 + env.wind);
        d.z += dt * Math.cos(t * 0.9 + d.ph) * 0.5;
        if (d.y < cy - 2.5) { d.y = cy + 6 + rand() * 6; }
        d.x = wrap(d.x, cx, BOX.x); d.z = wrap(d.z, cz, BOX.z);
        e.set(t * 2 * d.sp + d.ph, t * 1.3 + d.ph, Math.sin(t * 3 + d.ph));
        q.setFromEuler(e);
        pos.set(d.x, d.y, d.z);
        m4.compose(pos, q, sc);
        this.leaves.setMatrixAt(i, m4);
      }
      this.leaves.instanceMatrix.needsUpdate = true;
    }
  }
}
