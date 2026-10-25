// Thoreau's cabin: 10 ft x 15 ft, shingled & clapboarded, a garret, a brick chimney,
// two windows, a door, and inside: a bed, a table, a desk, three chairs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CABIN } from './geo.js';
import { rand, randRange, enhanceMaterial } from '../util.js';

const W = 4.6;    // 15 ft (local X)
const D = 3.05;   // 10 ft (local Z)
const FLOOR = 0.4;
const EAVE = FLOOR + 2.45;
const RIDGE = EAVE + 1.3;
const DOOR = { x0: -1.25, x1: -0.45, y1: FLOOR + 1.95 };
const WIN_F = { x0: 0.55, x1: 1.45, y0: FLOOR + 0.85, y1: FLOOR + 1.95 };
const WIN_B = { x0: -0.9, x1: 0.0, y0: FLOOR + 0.85, y1: FLOOR + 1.95 };

class Builder {
  constructor() { this.parts = []; }
  box(w, h, d, x, y, z, color, opts = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (opts.rx) g.rotateX(opts.rx);
    if (opts.rz) g.rotateZ(opts.rz);
    if (opts.ry) g.rotateY(opts.ry);
    g.translate(x, y, z);
    this.add(g, color, opts.jitter ?? 0.08);
    return g;
  }
  cyl(rt, rb, h, x, y, z, color, opts = {}) {
    const g = new THREE.CylinderGeometry(rt, rb, h, opts.seg || 8);
    if (opts.rx) g.rotateX(opts.rx);
    if (opts.rz) g.rotateZ(opts.rz);
    if (opts.ry) g.rotateY(opts.ry);
    g.translate(x, y, z);
    this.add(g, color, opts.jitter ?? 0.06);
    return g;
  }
  add(g, color, jitter) {
    const c = new THREE.Color(color);
    const k = 1 + (rand() - 0.5) * jitter * 2;
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r * k; arr[i * 3 + 1] = c.g * k; arr[i * 3 + 2] = c.b * k; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (g.index) { const ng = g.toNonIndexed(); this.parts.push(ng); } else this.parts.push(g);
  }
  // apply transform to everything added since mark
  mark() { return this.parts.length; }
  transformSince(m, matrix) { for (let i = m; i < this.parts.length; i++) this.parts[i].applyMatrix4(matrix); }
  build() {
    for (const p of this.parts) { if (p.attributes.uv) p.deleteAttribute('uv'); }
    return mergeGeometries(this.parts);
  }
}

// clapboard wall in XY plane, facing +Z, centered at x=0
function clapWall(b, len, openings, gable) {
  const strip = 0.165;
  const color = 0x8d7d68;
  for (let y = FLOOR - 0.05; y < (gable ? RIDGE : EAVE); y += strip * 0.85) {
    let half = len / 2;
    if (gable && y > EAVE) half = (len / 2 + 0.05) * (1 - (y + strip * 0.5 - EAVE) / (RIDGE - EAVE));
    if (half < 0.05) break;
    // intervals excluding openings
    let segs = [[-half, half]];
    for (const o of openings) {
      if (y + strip > (o.y0 ?? 0) && y < o.y1) {
        const next = [];
        for (const [a, c] of segs) {
          if (o.x1 <= a || o.x0 >= c) { next.push([a, c]); continue; }
          if (o.x0 > a) next.push([a, o.x0]);
          if (o.x1 < c) next.push([o.x1, c]);
        }
        segs = next;
      }
    }
    for (const [a, c] of segs) {
      if (c - a < 0.02) continue;
      b.box(c - a, strip, 0.035, (a + c) / 2, y + strip / 2, 0.02, color, { rx: -0.07, jitter: 0.1 });
    }
  }
  // inner sheathing/plaster (Thoreau plastered before winter)
  const inner = [];
  b.box(len - 0.14, (gable ? EAVE : EAVE) - FLOOR, 0.02, 0, (FLOOR + EAVE) / 2, -0.07, 0xb9a585, { jitter: 0.02 });
}

function windowFrame(b, o, z, out = 1) {
  const trim = 0x5f5040;
  const w = o.x1 - o.x0, h = o.y1 - o.y0, cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2;
  b.box(w + 0.2, 0.1, 0.06, cx, o.y1 + 0.05, z + 0.03 * out, trim);
  b.box(w + 0.24, 0.06, 0.12, cx, o.y0 - 0.03, z + 0.05 * out, trim);
  b.box(0.1, h, 0.06, o.x0 - 0.05, cy, z + 0.03 * out, trim);
  b.box(0.1, h, 0.06, o.x1 + 0.05, cy, z + 0.03 * out, trim);
  // sash muntins: 2 x 3 panes
  const sash = 0xe8e0cf;
  b.box(0.025, h, 0.03, cx, cy, z, sash);
  for (let i = 1; i < 3; i++) b.box(w, 0.025, 0.03, cx, o.y0 + (h * i) / 3, z, sash);
  b.box(w, 0.04, 0.035, cx, cy, z, sash);
}

function brickRow(b, x0, x1, y, z, depth, offset) {
  const L = 0.21;
  let x = x0 - (offset ? L / 2 : 0);
  while (x < x1) {
    const a = Math.max(x, x0), c = Math.min(x + L, x1);
    if (c - a > 0.02) {
      const col = new THREE.Color(0x8a3e2a).multiplyScalar(randRange(0.75, 1.15));
      b.box(c - a - 0.012, 0.064, depth, (a + c) / 2, y, z, col, { jitter: 0.04 });
    }
    x += L;
  }
}

export class Cabin {
  constructor() {
    this.group = new THREE.Group();
    this.group.position.set(CABIN.x, CABIN.y - 0.2, CABIN.z);
    this.group.rotation.y = CABIN.rot;
    this.group.updateMatrixWorld();

    const b = new Builder();
    // stone foundation
    for (let i = 0; i < 18; i++) {
      const t = i / 18;
      const per = 2 * (W + D);
      let d = t * per, x, z;
      if (d < W) { x = -W / 2 + d; z = D / 2; } else if ((d -= W) < D) { x = W / 2; z = D / 2 - d; } else if ((d -= D) < W) { x = W / 2 - d; z = -D / 2; } else { d -= W; x = -W / 2; z = -D / 2 + d; }
      b.box(randRange(0.45, 0.7), randRange(0.35, 0.45), randRange(0.4, 0.55), x, 0.15, z, 0x8e8a80, { ry: rand(), jitter: 0.15 });
    }
    // floor (wide boards)
    for (let x = -W / 2 + 0.11; x < W / 2; x += 0.24) {
      b.box(0.23, 0.05, D - 0.04, x, FLOOR - 0.025, 0, 0x9a7650, { jitter: 0.12 });
    }
    // sills & framing posts
    b.box(W + 0.1, 0.16, 0.16, 0, FLOOR - 0.13, D / 2 - 0.04, 0x5a4a38);
    b.box(W + 0.1, 0.16, 0.16, 0, FLOOR - 0.13, -D / 2 + 0.04, 0x5a4a38);

    // walls
    let m = b.mark();
    clapWall(b, W + 0.1, [{ x0: DOOR.x0, x1: DOOR.x1, y0: 0, y1: DOOR.y1 }, WIN_F], false);
    windowFrame(b, WIN_F, 0.04);
    b.box(0.1, DOOR.y1 - FLOOR, 0.07, DOOR.x0 - 0.05, (FLOOR + DOOR.y1) / 2, 0.05, 0x5f5040);
    b.box(0.1, DOOR.y1 - FLOOR, 0.07, DOOR.x1 + 0.05, (FLOOR + DOOR.y1) / 2, 0.05, 0x5f5040);
    b.box(DOOR.x1 - DOOR.x0 + 0.2, 0.1, 0.07, (DOOR.x0 + DOOR.x1) / 2, DOOR.y1 + 0.05, 0.05, 0x5f5040);
    b.transformSince(m, new THREE.Matrix4().makeTranslation(0, 0, D / 2));
    m = b.mark();
    // back wall (mirror x for the window: wall faces -Z after rotation)
    clapWall(b, W + 0.1, [{ x0: -WIN_B.x1, x1: -WIN_B.x0, y0: WIN_B.y0, y1: WIN_B.y1 }], false);
    windowFrame(b, { ...WIN_B, x0: -WIN_B.x1, x1: -WIN_B.x0 }, 0.04);
    b.transformSince(m, new THREE.Matrix4().makeRotationY(Math.PI).premultiply(new THREE.Matrix4().makeTranslation(0, 0, -D / 2)));
    m = b.mark();
    clapWall(b, D + 0.1, [], true);
    b.transformSince(m, new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(-W / 2, 0, 0)));
    m = b.mark();
    clapWall(b, D + 0.1, [], true);
    b.transformSince(m, new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(W / 2, 0, 0)));
    // corner boards
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      b.box(0.1, EAVE - FLOOR + 0.3, 0.1, sx * (W / 2 + 0.03), (FLOOR + EAVE) / 2 - 0.1, sz * (D / 2 + 0.03), 0x5f5040);
    }

    // roof: shingles in courses
    const slopeLen = Math.hypot(D / 2, RIDGE - EAVE) + 0.4;
    const ang = Math.atan2(RIDGE - EAVE, D / 2);
    for (const side of [1, -1]) {
      m = b.mark();
      const course = 0.17;
      for (let s = 0; s < slopeLen; s += course) {
        let x = -W / 2 - 0.35 + (Math.floor(s / course) % 2 ? 0.09 : 0);
        while (x < W / 2 + 0.35) {
          const sw = randRange(0.12, 0.24);
          const xx = Math.min(x + sw, W / 2 + 0.35);
          const col = new THREE.Color(0x6a5d4f).multiplyScalar(randRange(0.7, 1.15));
          // along slope: local z from ridge (0) down to eave (slopeLen)
          b.box(xx - x - 0.01, 0.022, course * 1.6, (x + xx) / 2, 0.012 * (s / course % 2), s + course * 0.8, col, { jitter: 0.05 });
          x = xx;
        }
      }
      const mat = new THREE.Matrix4().makeRotationX(ang)
        .premultiply(new THREE.Matrix4().makeTranslation(0, RIDGE + 0.06, 0));
      if (side < 0) mat.premultiply(new THREE.Matrix4().makeRotationY(Math.PI));
      b.transformSince(m, mat);
    }
    // ridge board and rake boards
    b.box(W + 0.75, 0.08, 0.16, 0, RIDGE + 0.1, 0, 0x4f4436);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.box(0.05, 0.16, slopeLen, sx * (W / 2 + 0.37), (RIDGE + EAVE) / 2 + 0.02 - 0.15, sz * (D / 4 + 0.2), 0x5f5040, { rx: sz * ang });
    }

    const cx = W / 2 - 0.35;
    this.fireLocal = new THREE.Vector3(cx - 0.2, FLOOR + 0.25, 0);

    this.mesh = null;
    const exterior = b;

    // ---- furniture builder ----
    const f = new Builder();
    const wood = 0x7a5a3a, dark = 0x4a3726;
    // bed in back-left corner
    const bx = -W / 2 + 0.55, bz = -D / 2 + 1.1;
    f.box(0.9, 0.08, 1.95, bx, FLOOR + 0.35, bz, dark);
    for (const [lx, lz] of [[-0.42, -0.94], [0.42, -0.94], [-0.42, 0.94], [0.42, 0.94]]) f.box(0.06, lz < 0 ? 0.75 : 0.45, 0.06, bx + lx, FLOOR + (lz < 0 ? 0.375 : 0.225), bz + lz, dark);
    f.box(0.84, 0.14, 1.85, bx, FLOOR + 0.46, bz, 0xd8ceb5);
    f.box(0.88, 0.06, 1.2, bx, FLOOR + 0.55, bz + 0.3, 0x7a2e26);
    f.box(0.6, 0.1, 0.32, bx, FLOOR + 0.58, bz - 0.72, 0xeee6d4);
    f.box(0.9, 0.5, 0.05, bx, FLOOR + 0.6, bz - 0.98, dark);
    // table in middle
    const tx = 0.15, tz = -0.4;
    f.box(1.0, 0.05, 0.65, tx, FLOOR + 0.74, tz, wood);
    for (const [lx, lz] of [[-0.44, -0.28], [0.44, -0.28], [-0.44, 0.28], [0.44, 0.28]]) f.box(0.05, 0.72, 0.05, tx + lx, FLOOR + 0.36, tz + lz, wood);
    // desk under front window
    const dx = 1.0, dz = D / 2 - 0.42;
    f.box(0.95, 0.04, 0.55, dx, FLOOR + 0.78, dz, 0x6a4a30);
    for (const [lx, lz] of [[-0.43, -0.24], [0.43, -0.24], [-0.43, 0.24], [0.43, 0.24]]) f.box(0.045, 0.76, 0.045, dx + lx, FLOOR + 0.38, dz + lz, 0x6a4a30);
    f.box(0.3, 0.02, 0.22, dx - 0.15, FLOOR + 0.81, dz - 0.05, 0xf0e8d8, { ry: 0.15 }); // open book
    f.box(0.3, 0.02, 0.22, dx + 0.13, FLOOR + 0.81, dz - 0.05, 0xf2ead8, { ry: 0.25 });
    f.box(0.22, 0.01, 0.3, dx + 0.3, FLOOR + 0.805, dz + 0.1, 0xe8e0c8, { ry: -0.3 }); // papers
    f.cyl(0.03, 0.035, 0.05, dx - 0.35, FLOOR + 0.825, dz + 0.12, 0x1a1a1a); // ink
    f.cyl(0.004, 0.004, 0.25, dx - 0.3, FLOOR + 0.86, dz + 0.12, 0xf0f0f0, { rz: 0.5 }); // quill
    f.cyl(0.011, 0.011, 0.5, dx + 0.1, FLOOR + 0.815, dz + 0.2, 0x8a6a40, { rz: Math.PI / 2, ry: 0.2 }); // flute
    // three chairs: "one for solitude, two for friendship, three for society"
    const chair = (x, z, ry) => {
      const mm = f.mark();
      f.box(0.42, 0.04, 0.4, 0, FLOOR + 0.45, 0, wood);
      for (const [lx, lz] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) f.box(0.035, 0.45, 0.035, lx, FLOOR + 0.225, lz, wood);
      for (const lx of [-0.18, 0.18]) f.box(0.035, 0.5, 0.035, lx, FLOOR + 0.72, -0.18, wood);
      f.box(0.42, 0.07, 0.03, 0, FLOOR + 0.95, -0.18, wood);
      for (const lx of [-0.09, 0, 0.09]) f.box(0.02, 0.42, 0.02, lx, FLOOR + 0.7, -0.18, wood);
      f.transformSince(mm, new THREE.Matrix4().makeRotationY(ry).premultiply(new THREE.Matrix4().makeTranslation(x, 0, z)));
    };
    chair(tx - 0.15, tz - 0.6, 0);
    chair(dx, dz - 0.55, Math.PI);
    chair(-0.9, 0.85, 2.2);
    // shelf with books on left wall
    f.box(0.22, 0.03, 1.1, -W / 2 + 0.15, FLOOR + 1.55, 0.6, wood);
    let by = 0.1;
    for (let i = 0; i < 9; i++) {
      const bw = randRange(0.04, 0.08), bh = randRange(0.18, 0.26);
      f.box(0.16, bh, bw, -W / 2 + 0.15, FLOOR + 1.565 + bh / 2, by + 0.1, [0x6a2a20, 0x2a3a5a, 0x3a4a2a, 0x7a5a2a, 0x4a2a3a][i % 5]);
      by += bw + 0.01;
    }
    // looking-glass & broom & pail
    f.cyl(0.05, 0.05, 0.01, -W / 2 + 0.07, FLOOR + 1.3, 1.1, 0xb8c4cc, { rz: Math.PI / 2 });
    f.cyl(0.015, 0.015, 1.2, DOOR.x0 - 0.3, FLOOR + 0.6, D / 2 - 0.15, 0x9a8050, { rz: 0.15 });
    f.box(0.22, 0.25, 0.05, DOOR.x0 - 0.35, FLOOR + 0.12, D / 2 - 0.15, 0xc0a060, { rz: 0.15 });
    f.cyl(0.14, 0.12, 0.28, -W / 2 + 0.4, FLOOR + 0.14, D / 2 - 0.35, 0x7a6a50);
    // rag rug
    f.box(1.1, 0.012, 0.7, -0.6, FLOOR + 0.006, 0.4, 0x8a5a40, { jitter: 0.02 });
    // kettle by the hearth
    f.cyl(0.11, 0.13, 0.16, cx - 0.55, FLOOR + 0.12, 0.5, 0x2a2a2a);

    // ---- materials ----
    const woodMat = enhanceMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), { snowStrength: 1.0 });
    const extGeo = exterior.build();
    const ext = new THREE.Mesh(extGeo, woodMat);
    ext.castShadow = true; ext.receiveShadow = true;
    this.group.add(ext);

    // chimney geometry rebuilt in its own builder so we can place it on the right wall
    const ch = new Builder();
    for (let i = 0; i < 20; i++) {
      const y = FLOOR + 0.035 + i * 0.07;
      const off = i % 2 === 1;
      if (i < 11) { brickRow(ch, -0.6, -0.25, y, 0, 0.1, off); brickRow(ch, 0.25, 0.6, y, 0, 0.1, off); } else brickRow(ch, -0.6, 0.6, y, 0, 0.1, off);
    }
    ch.box(1.18, 1.42, 0.55, 0, FLOOR + 0.7, -0.33, 0x6e3424, { jitter: 0.02 });
    ch.box(0.52, 0.76, 0.02, 0, FLOOR + 0.38, -0.04, 0x140e0c, { jitter: 0 });
    ch.box(1.3, 0.05, 0.5, 0, FLOOR + 0.02, 0.25, 0x7c3a28);
    ch.box(1.35, 0.08, 0.66, 0, FLOOR + 1.45, -0.27, 0x5a4636);
    for (let i = 0; i < 52; i++) {
      const y = FLOOR + 1.5 + i * 0.07;
      const off = i % 2 === 1;
      const w0 = 0.5;
      brickRow(ch, -w0 / 2, w0 / 2, y, -0.08, 0.05, off);
      brickRow(ch, -w0 / 2, w0 / 2, y, -0.52, 0.05, !off);
      let mm = ch.mark();
      brickRow(ch, -0.2, 0.2, 0, 0, 0.05, off);
      ch.transformSince(mm, new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(-w0 / 2 + 0.025, y, -0.3)));
      mm = ch.mark();
      brickRow(ch, -0.2, 0.2, 0, 0, 0.05, !off);
      ch.transformSince(mm, new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(w0 / 2 - 0.025, y, -0.3)));
    }
    const chGeo = ch.build();
    // rotate so fireplace faces -X, and move to right wall
    chGeo.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(W / 2 - 0.62, 0, 0)));
    const brickMat = enhanceMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), { snowStrength: 0.8 });
    const chMesh = new THREE.Mesh(chGeo, brickMat);
    chMesh.castShadow = true; chMesh.receiveShadow = true;
    this.group.add(chMesh);
    this.fireLocal.set(W / 2 - 0.75, FLOOR + 0.25, 0);
    this.chimneyTopLocal = new THREE.Vector3(W / 2 - 0.32, FLOOR + 1.5 + 52 * 0.07 + 0.1, 0);

    const furn = new THREE.Mesh(f.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    furn.castShadow = true; furn.receiveShadow = true;
    this.group.add(furn);

    // door (open inward)
    const dg = new Builder();
    for (let i = 0; i < 4; i++) dg.box(0.195, 1.93, 0.045, 0.1 + i * 0.2, 0.965, 0, 0x6e5a44, { jitter: 0.1 });
    dg.box(0.75, 0.1, 0.03, 0.4, 0.4, -0.035, 0x5a4836);
    dg.box(0.75, 0.1, 0.03, 0.4, 1.55, -0.035, 0x5a4836);
    dg.box(0.04, 0.04, 0.06, 0.72, 1.0, 0.04, 0x2a2a2a);
    this.door = new THREE.Mesh(dg.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    this.door.position.set(DOOR.x0 + 0.02, FLOOR, D / 2);
    this.door.rotation.y = -1.9;
    this.door.castShadow = true;
    this.group.add(this.door);

    // window glass
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xaac4d0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28 });
    const g1 = new THREE.Mesh(new THREE.PlaneGeometry(WIN_F.x1 - WIN_F.x0, WIN_F.y1 - WIN_F.y0), glassMat);
    g1.position.set((WIN_F.x0 + WIN_F.x1) / 2, (WIN_F.y0 + WIN_F.y1) / 2, D / 2 + 0.03);
    const g2 = g1.clone();
    g2.position.set((WIN_B.x0 + WIN_B.x1) / 2, (WIN_B.y0 + WIN_B.y1) / 2, -D / 2 - 0.03);
    g2.rotation.y = Math.PI;
    this.group.add(g1, g2);

    // doorstep stone
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.22, 0.5), new THREE.MeshStandardMaterial({ color: 0x8a867c, roughness: 1 }));
    step.position.set((DOOR.x0 + DOOR.x1) / 2, 0.11, D / 2 + 0.3);
    step.receiveShadow = true; step.castShadow = true;
    this.group.add(step);

    // lamp on table
    const lampG = new THREE.Group();
    const lb = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.1, 10), new THREE.MeshStandardMaterial({ color: 0x8a7040, metalness: 0.6, roughness: 0.4 }));
    lb.position.y = 0.05;
    this.lampGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.16, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffb050, emissiveIntensity: 0, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    this.lampGlass.position.y = 0.18;
    lampG.add(lb, this.lampGlass);
    lampG.position.set(tx + 0.25, FLOOR + 0.765, tz);
    this.group.add(lampG);
    this.lampLight = new THREE.PointLight(0xffb060, 0, 9, 1.6);
    this.lampLight.position.set(tx + 0.25, FLOOR + 1.05, tz);
    this.group.add(this.lampLight);
    this.lampOn = false;

    // fire
    this.fireLight = new THREE.PointLight(0xff7a30, 0, 10, 1.4);
    this.fireLight.position.copy(this.fireLocal).add(new THREE.Vector3(-0.4, 0.3, 0));
    this.group.add(this.fireLight);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flames = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.07 + rand() * 0.05, 0.3 + rand() * 0.2, 6), flameMat);
      fl.position.set((rand() - 0.5) * 0.12, 0.15, (rand() - 0.5) * 0.35);
      this.flames.add(fl);
    }
    const logs = new Builder();
    for (let i = 0; i < 3; i++) logs.cyl(0.05, 0.05, 0.45, 0, 0.05 + (i === 2 ? 0.08 : 0), (i - 1) * 0.1, 0x4a3020, { rx: Math.PI / 2, ry: (i - 1) * 0.3 });
    const logMesh = new THREE.Mesh(logs.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    logMesh.position.copy(this.fireLocal).add(new THREE.Vector3(0, -0.2, 0));
    this.group.add(logMesh);
    this.flames.position.copy(this.fireLocal).add(new THREE.Vector3(0, -0.2, 0));
    this.flames.visible = false;
    this.group.add(this.flames);
    this.fireOn = false;

    // ---- outside: woodpile, chopping block ----
    this.woodpileLocal = new THREE.Vector3(-W / 2 - 1.3, 0, -0.2);
    const logGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.6, 7);
    logGeo.rotateZ(Math.PI / 2);
    colorLogs(logGeo);
    this.woodLogs = new THREE.InstancedMesh(logGeo, enhanceMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), { snowStrength: 0.9 }), 60);
    this.woodLogs.castShadow = true; this.woodLogs.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 60; i++) {
      const row = Math.floor(i / 10), col = i % 10;
      const y = 0.1 + row * 0.17;
      const z = -1.0 + col * 0.19 + (row % 2) * 0.09;
      m4.makeRotationFromEuler(new THREE.Euler(0, Math.PI / 2 + (rand() - 0.5) * 0.15, (rand() - 0.5) * 0.1));
      m4.setPosition(this.woodpileLocal.x + (rand() - 0.5) * 0.06, y, this.woodpileLocal.z + z);
      this.woodLogs.setMatrixAt(i, m4);
    }
    this.woodLogs.count = 12;
    this.group.add(this.woodLogs);
    // stakes
    const stakeMat = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 1 });
    for (const zz of [-1.15, 0.95]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.2, 0.06), stakeMat);
      st.position.set(this.woodpileLocal.x, 0.6, this.woodpileLocal.z + zz);
      st.castShadow = true;
      this.group.add(st);
    }
    this.blockLocal = new THREE.Vector3(-W / 2 - 1.6, 0, 2.2);
    const bk = new Builder();
    bk.cyl(0.32, 0.36, 0.5, 0, 0.25, 0, 0x6a5038, { seg: 12 });
    bk.cyl(0.3, 0.3, 0.01, 0, 0.505, 0, 0xb09068, { seg: 12, jitter: 0 });
    // axe stuck in block (Thoreau borrowed an axe to begin)
    bk.cyl(0.018, 0.022, 0.75, 0.15, 0.78, 0, 0x9a7a50, { rz: -0.5 });
    bk.box(0.16, 0.1, 0.03, 0.0, 0.53, 0, 0x5a5a5e, { rz: -0.5 });
    const blk = new THREE.Mesh(bk.build(), enhanceMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })));
    blk.position.copy(this.blockLocal);
    blk.castShadow = true; blk.receiveShadow = true;
    this.group.add(blk);

    // ---- collision boxes (local) ----
    const t = 0.1;
    this.boxes = [
      [-W / 2 - t, DOOR.x0 - 0.05, D / 2 - t, D / 2 + t],
      [DOOR.x1 + 0.05, W / 2 + t, D / 2 - t, D / 2 + t],
      [-W / 2 - t, W / 2 + t, -D / 2 - t, -D / 2 + t],
      [-W / 2 - t, -W / 2 + t, -D / 2, D / 2],
      [W / 2 - t, W / 2 + t, -D / 2, D / 2],
      [W / 2 - 0.68, W / 2, -0.65, 0.65],                   // fireplace
      [bx - 0.47, bx + 0.47, bz - 1.0, bz + 1.0],          // bed
      [tx - 0.52, tx + 0.52, tz - 0.34, tz + 0.34],        // table
      [dx - 0.5, dx + 0.5, dz - 0.3, dz + 0.3],            // desk
      [this.woodpileLocal.x - 0.4, this.woodpileLocal.x + 0.4, -1.3, 1.1], // woodpile
    ];
    this.circles = [[this.blockLocal.x, this.blockLocal.z, 0.45]];

    // anchors for interactions (local)
    this.anchors = {
      bed: new THREE.Vector3(bx + 0.2, FLOOR + 0.5, bz),
      desk: new THREE.Vector3(dx, FLOOR + 0.85, dz),
      lamp: new THREE.Vector3(tx + 0.25, FLOOR + 0.9, tz),
      fire: new THREE.Vector3(W / 2 - 0.9, FLOOR + 0.4, 0),
      woodpile: new THREE.Vector3(this.woodpileLocal.x + 0.2, 0.6, this.woodpileLocal.z),
      block: new THREE.Vector3(this.blockLocal.x, 0.5, this.blockLocal.z),
      chair: new THREE.Vector3(-0.9, FLOOR + 0.5, 0.85),
      door: new THREE.Vector3((DOOR.x0 + DOOR.x1) / 2, FLOOR + 1, D / 2 + 0.6),
    };
    this.inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    this.floorY = this.group.position.y + FLOOR;
  }

  worldAnchor(name) {
    return this.anchors[name].clone().applyMatrix4(this.group.matrixWorld);
  }
  toLocal(v) { return v.clone().applyMatrix4(this.inv); }
  toWorld(v) { return v.clone().applyMatrix4(this.group.matrixWorld); }
  isInside(p) {
    const l = this.toLocal(p);
    return Math.abs(l.x) < W / 2 && Math.abs(l.z) < D / 2;
  }
  floorAt(p) {
    const l = this.toLocal(p);
    if (Math.abs(l.x) < W / 2 + 0.05 && Math.abs(l.z) < D / 2 + 0.05) return this.floorY;
    // doorstep
    if (l.x > DOOR.x0 - 0.2 && l.x < DOOR.x1 + 0.2 && l.z > D / 2 && l.z < D / 2 + 0.55) return this.group.position.y + 0.22;
    return null;
  }

  setWood(n) { this.woodLogs.count = Math.max(0, Math.min(60, n)); }

  setLamp(on) {
    this.lampOn = on;
    this.lampLight.intensity = on ? 2.2 : 0;
    this.lampGlass.material.emissiveIntensity = on ? 2.5 : 0;
  }
  setFire(on) {
    this.fireOn = on;
    this.flames.visible = on;
    if (!on) this.fireLight.intensity = 0;
  }
  update(t) {
    if (this.fireOn) {
      this.fireLight.intensity = 3 + Math.sin(t * 13) * 0.6 + Math.sin(t * 7.3) * 0.5 + Math.random() * 0.4;
      this.flames.children.forEach((fl, i) => {
        fl.scale.y = 0.8 + Math.sin(t * (9 + i) + i) * 0.25 + Math.random() * 0.1;
        fl.scale.x = fl.scale.z = 0.9 + Math.sin(t * 6 + i * 2) * 0.1;
      });
    }
    if (this.lampOn) this.lampLight.intensity = 2.2 + Math.sin(t * 9) * 0.05;
  }
}

function colorLogs(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const end = Math.abs(n.getX(i)) > 0.9;
    const c = end ? new THREE.Color(0xc09a68) : new THREE.Color(0x5a4430);
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

export const CABIN_DIMS = { W, D, FLOOR, EAVE, RIDGE };
