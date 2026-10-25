import * as THREE from 'three';
import {
  WORLD, GRID, CELL, HEIGHTS, shoreDist, inBeanField, railDist, pathDist, forestDensity,
} from './geo.js';
import { fbm, smoothstep, clamp, lerp } from '../util.js';

const C = (h) => new THREE.Color(h);
const PAL = {
  sandWet: C(0xb8a982), sand: C(0xd2c4a0), pebble: C(0xe4ddcc),
  bottomShallow: C(0xbdb08a), bottomMid: C(0x7d8462), bottomDeep: C(0x34463e),
  path: C(0x8c7656), soil: C(0x5e4530), ballast: C(0x7a746b), rock: C(0x7c776a),
  snow: C(0xf1f4f8), snowShade: C(0xdde5ee),
};
// seasonal ground palettes: [grass, forest floor]
const SEASON_GROUND = {
  spring: [C(0x8bad52), C(0x6b5f3d)],
  summer: [C(0x6b8d3f), C(0x5a5034)],
  autumn: [C(0x9c8c4c), C(0x8a5a2c)],
  bare: [C(0x8a7a55), C(0x6e5638)],
};

export class Terrain {
  constructor() {
    const W = GRID + 1;
    const N = W * W;
    const pos = new Float32Array(N * 3);
    const uv = new Float32Array(N * 2);
    this.fixed = new Float32Array(N * 3);
    this.fixedW = new Float32Array(N);
    this.grassW = new Float32Array(N);
    this.snowMask = new Float32Array(N);
    this.jit = new Float32Array(N);
    const tmp = new THREE.Color();
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        const x = -WORLD / 2 + i * CELL, z = -WORLD / 2 + j * CELL;
        const h = HEIGHTS[k];
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        uv[k * 2] = i / GRID; uv[k * 2 + 1] = j / GRID;
        const u = shoreDist(x, z);
        const n = fbm(x * 0.08, z * 0.08, 2);
        this.jit[k] = 1 + n * 0.09 + (Math.random() - 0.5) * 0.04;
        // slope
        const hx = HEIGHTS[j * W + Math.min(i + 1, W - 1)] - HEIGHTS[j * W + Math.max(i - 1, 0)];
        const hz = HEIGHTS[Math.min(j + 1, W - 1) * W + i] - HEIGHTS[Math.max(j - 1, 0) * W + i];
        const slope = Math.hypot(hx, hz) / (2 * CELL);
        let fw = 0;
        let snow = 1;
        if (h < 0.15) {
          // pond bottom & wet sand
          const d = -h;
          tmp.copy(PAL.sandWet);
          tmp.lerp(PAL.bottomShallow, smoothstep(0, 1.2, d));
          tmp.lerp(PAL.bottomMid, smoothstep(2, 7, d));
          tmp.lerp(PAL.bottomDeep, smoothstep(7, 16, d));
          fw = 1;
          snow = smoothstep(0.05, 0.15, h);
        } else if (u < 7) {
          // stony white beach
          const pebbles = smoothstep(0.1, 0.5, fbm(x * 0.4, z * 0.4, 2));
          tmp.copy(PAL.sand).lerp(PAL.pebble, pebbles * 0.7);
          fw = 1 - smoothstep(3.5, 7, u);
        } else {
          tmp.copy(PAL.rock);
          fw = smoothstep(0.55, 0.9, slope) * 0.8;
        }
        // paths, fields, rail
        const pd = pathDist(x, z);
        if (pd < 2.2 && h > 0.2) { const w = 1 - smoothstep(0.8, 2.2, pd); tmp.lerp(PAL.path, w / Math.max(fw + w, 1e-3)); fw = Math.max(fw, w); }
        if (inBeanField(x, z, 0.5)) { tmp.copy(PAL.soil); fw = 1; }
        const rd = railDist(x, z);
        if (rd < 4) { const w = 1 - smoothstep(2.5, 4, rd); tmp.lerp(PAL.ballast, w); fw = Math.max(fw, w); snow *= 1 - w * 0.4; }
        this.fixed[k * 3] = tmp.r; this.fixed[k * 3 + 1] = tmp.g; this.fixed[k * 3 + 2] = tmp.b;
        this.fixedW[k] = clamp(fw, 0, 1);
        const fd = forestDensity(x, z);
        this.grassW[k] = clamp(1 - fd * 1.15 + n * 0.2, 0, 1);
        this.snowMask[k] = snow * (1 - smoothstep(0.6, 1.2, slope) * 0.6) * (0.85 + 0.15 * n) * (1 - fd * 0.15);
      }
    }
    const idx = new Uint32Array(GRID * GRID * 6);
    let p = 0;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const v00 = j * W + i, v10 = v00 + 1, v01 = v00 + W, v11 = v01 + 1;
        idx[p++] = v00; idx[p++] = v01; idx[p++] = v10;
        idx[p++] = v10; idx[p++] = v01; idx[p++] = v11;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    this.colors = new Float32Array(N * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry = geo;
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
    this.lastKey = '';
  }

  // season: { leaf, autumn, spring, snow, bare }
  updateSeason(s) {
    const key = [s.spring, s.autumn, s.snow, s.bare].map((v) => v.toFixed(2)).join();
    if (key === this.lastKey) return;
    this.lastKey = key;
    const g = new THREE.Color(), f = new THREE.Color(), t = new THREE.Color();
    g.copy(SEASON_GROUND.summer[0]).lerp(SEASON_GROUND.spring[0], s.spring)
      .lerp(SEASON_GROUND.autumn[0], s.autumn).lerp(SEASON_GROUND.bare[0], s.bare);
    f.copy(SEASON_GROUND.summer[1]).lerp(SEASON_GROUND.spring[1], s.spring)
      .lerp(SEASON_GROUND.autumn[1], s.autumn).lerp(SEASON_GROUND.bare[1], s.bare);
    const col = this.colors, fx = this.fixed;
    const N = this.fixedW.length;
    const snow = s.snow;
    for (let k = 0; k < N; k++) {
      const gw = this.grassW[k];
      let r = g.r * gw + f.r * (1 - gw), gg = g.g * gw + f.g * (1 - gw), b = g.b * gw + f.b * (1 - gw);
      const w = this.fixedW[k];
      r = lerp(r, fx[k * 3], w); gg = lerp(gg, fx[k * 3 + 1], w); b = lerp(b, fx[k * 3 + 2], w);
      const j = this.jit[k];
      r *= j; gg *= j; b *= j;
      const sm = clamp(this.snowMask[k] * snow * 1.15, 0, 1);
      if (sm > 0) {
        const sj = 0.94 + (j - 1) * 0.6;
        r = lerp(r, PAL.snow.r * sj, sm); gg = lerp(gg, PAL.snow.g * sj, sm); b = lerp(b, PAL.snow.b * sj, sm);
      }
      col[k * 3] = r; col[k * 3 + 1] = gg; col[k * 3 + 2] = b;
    }
    this.geometry.attributes.color.needsUpdate = true;
  }
}
