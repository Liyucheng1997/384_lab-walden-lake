import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, BEANS, CABIN, shoreDist, inBeanField, BOUND } from './geo.js';
import { rand, randRange, softTexture, clamp, lerp, smoothstep } from '../util.js';

function vc(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const mat = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true });

// random point in deep water
function waterPoint(minDepth = 3) {
  for (let i = 0; i < 200; i++) {
    const a = rand() * Math.PI * 2, d = rand() * 110;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (heightAt(x, z) < -minDepth) return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(0, 0, 0);
}

// ---------------- Loon ----------------
class Loon {
  constructor() {
    const parts = [];
    let g = new THREE.SphereGeometry(0.5, 10, 7); g.scale(0.45, 0.32, 1); parts.push(vc(g, 0x14181a));
    // white checker spots on back
    for (let i = 0; i < 14; i++) {
      g = new THREE.SphereGeometry(0.03, 4, 3);
      g.translate(randRange(-0.15, 0.15), 0.13, randRange(-0.35, 0.3)); parts.push(vc(g, 0xe8e8e8));
    }
    g = new THREE.SphereGeometry(0.5, 8, 6); g.scale(0.38, 0.12, 0.85); g.translate(0, -0.07, 0); parts.push(vc(g, 0xe8e8e4));
    g = new THREE.CylinderGeometry(0.07, 0.1, 0.3, 7); g.rotateX(-0.4); g.translate(0, 0.17, 0.42); parts.push(vc(g, 0x182420));
    g = new THREE.TorusGeometry(0.085, 0.015, 4, 10); g.rotateX(Math.PI / 2 - 0.4); g.translate(0, 0.17, 0.42); parts.push(vc(g, 0xdadada));
    g = new THREE.SphereGeometry(0.1, 8, 6); g.scale(1, 0.9, 1.3); g.translate(0, 0.33, 0.5); parts.push(vc(g, 0x12201c));
    g = new THREE.ConeGeometry(0.03, 0.17, 5); g.rotateX(Math.PI / 2); g.translate(0, 0.31, 0.68); parts.push(vc(g, 0x2a2a2a));
    for (const sx of [-0.05, 0.05]) { g = new THREE.SphereGeometry(0.014, 4, 3); g.translate(sx, 0.36, 0.58); parts.push(vc(g, 0xaa1a1a)); }
    this.mesh = new THREE.Mesh(mergeGeometries(parts), mat());
    this.mesh.castShadow = true;
    this.mesh.scale.setScalar(1.2);
    this.pos = waterPoint(4);
    this.target = waterPoint(4);
    this.state = 'swim';
    this.timer = randRange(8, 20);
    this.heading = 0;
    this.mesh.position.copy(this.pos);
    this.onCall = null;
    this.onSurface = null;
    this.present = true;
  }
  update(dt, t, player, boatPos) {
    if (!this.present) { this.mesh.visible = false; return; }
    const m = this.mesh;
    this.timer -= dt;
    const near = boatPos ? boatPos.distanceTo(this.pos) : Infinity;
    if (this.state === 'swim') {
      m.visible = true;
      const d = this.target.clone().sub(this.pos); d.y = 0;
      if (d.length() < 1) this.target = waterPoint(4);
      const want = Math.atan2(d.x, d.z);
      let dh = want - this.heading; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
      this.heading += dh * dt * 0.8;
      this.pos.x += Math.sin(this.heading) * dt * 0.7;
      this.pos.z += Math.cos(this.heading) * dt * 0.7;
      m.position.set(this.pos.x, -0.05 + Math.sin(t * 2) * 0.015, this.pos.z);
      m.rotation.y = this.heading;
      if (this.timer < 0 || near < 22) {
        this.state = 'dive'; this.timer = 1.2; this.diveFrom = m.position.y;
        this.onSurface && this.onSurface(this.pos.clone(), 0.6);
      }
    } else if (this.state === 'dive') {
      m.position.y -= dt * 0.6;
      m.rotation.x = 0.5;
      if (this.timer < 0) {
        this.state = 'under'; this.timer = randRange(7, 16); m.visible = false; m.rotation.x = 0;
        // surface far away — the loon's game
        let p;
        for (let i = 0; i < 30; i++) { p = waterPoint(4); if (!boatPos || p.distanceTo(boatPos) > 25) break; }
        this.pos.copy(p);
      }
    } else if (this.state === 'under') {
      if (this.timer < 0) {
        this.state = 'swim'; this.timer = randRange(10, 25);
        m.visible = true;
        this.target = waterPoint(4);
        this.onSurface && this.onSurface(this.pos.clone(), 0.8);
        if (rand() < 0.75) this.onCall && this.onCall(this.pos.clone());
      }
    }
  }
}

// ---------------- generic small quadruped ----------------
function quadruped(opts) {
  const { body, head, tail, color, belly, len, h } = opts;
  const parts = [];
  let g = new THREE.SphereGeometry(0.5, 9, 7); g.scale(body[0], body[1], body[2]); g.translate(0, h, 0); parts.push(vc(g, color));
  g = new THREE.SphereGeometry(0.5, 7, 5); g.scale(body[0] * 0.8, body[1] * 0.5, body[2] * 0.7); g.translate(0, h - body[1] * 0.25, 0.02); parts.push(vc(g, belly));
  g = new THREE.SphereGeometry(0.5, 8, 6); g.scale(head, head * 0.9, head * 1.2); g.translate(0, h + body[1] * 0.25, len / 2 + head * 0.3); parts.push(vc(g, color));
  if (opts.snout) { g = new THREE.ConeGeometry(head * 0.3, head * 0.8, 6); g.rotateX(Math.PI / 2); g.translate(0, h + body[1] * 0.2, len / 2 + head * 0.9); parts.push(vc(g, color)); }
  for (const sx of [-1, 1]) {
    g = new THREE.ConeGeometry(head * 0.18, head * (opts.ears || 0.35), 4); g.translate(sx * head * 0.25, h + body[1] * 0.25 + head * 0.5, len / 2 + head * 0.15); parts.push(vc(g, color));
    g = new THREE.SphereGeometry(head * 0.07, 4, 3); g.translate(sx * head * 0.22, h + body[1] * 0.3, len / 2 + head * 0.82); parts.push(vc(g, 0x0a0a0a));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g = new THREE.CylinderGeometry(body[0] * 0.09, body[0] * 0.07, h, 4); g.translate(sx * body[0] * 0.28, h / 2, sz * len * 0.3); parts.push(vc(g, opts.legs || color));
  }
  if (tail) {
    g = new THREE.SphereGeometry(0.5, 7, 5); g.scale(tail[0], tail[1], tail[2]); g.rotateX(tail[3] || 0); g.translate(0, h + (tail[4] || 0), -len / 2 - tail[2] * 0.3); parts.push(vc(g, opts.tailColor || color));
  }
  const m = new THREE.Mesh(mergeGeometries(parts), mat());
  m.castShadow = true;
  return m;
}

class Critter {
  constructor(mesh, opts) {
    this.mesh = mesh;
    this.opts = opts;
    this.pos = opts.home();
    this.target = opts.home();
    this.heading = 0;
    this.state = 'idle';
    this.timer = randRange(1, 4);
    this.hidden = 0;
    this.present = false;
  }
  update(dt, t, player) {
    const m = this.mesh;
    if (!this.present) { m.visible = false; return; }
    if (this.hidden > 0) {
      this.hidden -= dt;
      m.visible = false;
      if (this.hidden <= 0) { this.pos = this.opts.home(); this.state = 'idle'; }
      return;
    }
    m.visible = true;
    const pd = Math.hypot(player.x - this.pos.x, player.z - this.pos.z);
    if (pd < this.opts.fear && this.state !== 'flee') {
      this.state = 'flee';
      const away = Math.atan2(this.pos.x - player.x, this.pos.z - player.z);
      this.target = new THREE.Vector3(this.pos.x + Math.sin(away) * 14, 0, this.pos.z + Math.cos(away) * 14);
      this.timer = 3;
    }
    this.timer -= dt;
    let speed = 0;
    if (this.state === 'idle') {
      if (this.timer < 0) { this.state = 'walk'; this.target = this.opts.wander(this.pos); this.timer = 6; }
    } else if (this.state === 'walk') { speed = this.opts.walk; if (this.timer < 0) { this.state = 'idle'; this.timer = randRange(2, 7); } } else if (this.state === 'flee') {
      speed = this.opts.run;
      if (this.timer < 0) { this.hidden = randRange(25, 60); }
    }
    if (speed > 0) {
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3) { if (this.state === 'walk') { this.state = 'idle'; this.timer = randRange(2, 6); } } else {
        const want = Math.atan2(dx, dz);
        let dh = want - this.heading; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
        this.heading += dh * Math.min(1, dt * 6);
        this.pos.x += Math.sin(this.heading) * speed * dt;
        this.pos.z += Math.cos(this.heading) * speed * dt;
      }
    }
    const hop = speed > 0 ? Math.abs(Math.sin(t * (this.opts.hop || 10))) * this.opts.hopH : 0;
    m.position.set(this.pos.x, heightAt(this.pos.x, this.pos.z) + hop, this.pos.z);
    m.rotation.y = this.heading;
    // idle: sit up and look around
    m.rotation.x = this.state === 'idle' && this.opts.sitUp ? -0.35 + Math.sin(t * 0.7) * 0.05 : 0;
  }
}

// ---------------- Flying birds (geese / swallows) ----------------
function birdGeo(span, color) {
  const pos = [
    0, 0, 0.25, -span, 0.0, -0.1, 0, 0, -0.15,
    0, 0, 0.25, 0, 0, -0.15, span, 0.0, -0.1,
    0, 0.02, 0.4, -0.06, 0, -0.2, 0.06, 0, -0.2,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

class Flock {
  constructor(kind) {
    this.kind = kind;
    this.group = new THREE.Group();
    const n = kind === 'geese' ? 13 : 6;
    const span = kind === 'geese' ? 0.9 : 0.18;
    const m = new THREE.MeshStandardMaterial({ color: kind === 'geese' ? 0x3a3630 : 0x1e2430, side: THREE.DoubleSide, roughness: 1 });
    this.birds = [];
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(birdGeo(span, 0), m);
      b.userData.ph = rand() * 6;
      b.userData.i = i;
      this.group.add(b);
      this.birds.push(b);
      // per-bird wing vertices: we flap by scaling y of the wing tips via morph-like update
      b.geometry = birdGeo(span, 0);
    }
    this.active = false;
    this.t = 0;
  }
  start(playerPos) {
    this.active = true;
    this.t = 0;
    const a = rand() * Math.PI * 2;
    this.dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    this.origin = playerPos.clone().addScaledVector(this.dir, -320).add(new THREE.Vector3(randRange(-60, 60), 0, randRange(-60, 60)));
    this.origin.y = randRange(55, 80);
    this.onHonk = null;
    this.honked = false;
  }
  update(dt, t, playerPos) {
    if (this.kind === 'swallows') {
      this.group.visible = this.active;
      if (!this.active) return;
      this.birds.forEach((b, i) => {
        const ph = b.userData.ph;
        const tt = t * (0.35 + i * 0.03) + ph;
        const cx = Math.sin(tt * 0.6) * 40, cz = Math.cos(tt * 0.45) * 40;
        b.position.set(cx + Math.sin(tt * 2.3) * 8, 1.5 + Math.abs(Math.sin(tt * 1.7)) * 4, cz + Math.cos(tt * 1.9) * 8);
        const nx = Math.cos(tt * 0.6) * 0.6 * 40 + Math.cos(tt * 2.3) * 2.3 * 8;
        const nz = -Math.sin(tt * 0.45) * 0.45 * 40 - Math.sin(tt * 1.9) * 1.9 * 8;
        b.rotation.y = Math.atan2(nx, nz);
        b.rotation.z = Math.sin(tt * 3) * 0.6;
        this.flap(b, t * 14 + ph);
      });
      return;
    }
    this.group.visible = this.active;
    if (!this.active) return;
    this.t += dt;
    const speed = 13;
    const lead = this.origin.clone().addScaledVector(this.dir, this.t * speed);
    const side = new THREE.Vector3(-this.dir.z, 0, this.dir.x);
    this.birds.forEach((b) => {
      const i = b.userData.i;
      const row = Math.ceil(i / 2), sgn = i % 2 ? 1 : -1;
      b.position.copy(lead).addScaledVector(this.dir, -row * 3.2).addScaledVector(side, sgn * row * 2.6);
      b.position.y += Math.sin(t + i) * 0.4;
      b.rotation.y = Math.atan2(this.dir.x, this.dir.z);
      this.flap(b, t * 4.5 + b.userData.ph);
    });
    if (!this.honked && lead.distanceTo(playerPos) < 200) { this.honked = true; this.onHonk && this.onHonk(lead.clone()); }
    if (this.t * speed > 700) this.active = false;
  }
  flap(b, ph) {
    const p = b.geometry.attributes.position;
    const y = Math.sin(ph) * 0.35 * (this.kind === 'geese' ? 1.6 : 0.4);
    p.setY(1, y); p.setY(5, y);
    p.needsUpdate = true;
  }
}

// ---------------- Fireflies ----------------
class Fireflies {
  constructor() {
    const n = 160;
    const pos = new Float32Array(n * 3);
    this.base = [];
    for (let i = 0; i < n; i++) {
      let x, z;
      for (let k = 0; k < 50; k++) {
        const a = rand() * Math.PI * 2, d = 6 + rand() * 60;
        x = CABIN.x + Math.cos(a) * d; z = CABIN.z + Math.sin(a) * d;
        if (heightAt(x, z) > 0.4) break;
      }
      this.base.push({ x, z, y: heightAt(x, z) + 0.4 + rand() * 1.6, ph: rand() * 20, sp: 0.5 + rand() });
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.alpha = new Float32Array(n);
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: softTexture() }, uAmt: { value: 0 } },
      vertexShader: `attribute float alpha; varying float vA; uniform float uAmt;
        void main(){ vA = alpha * uAmt; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = 90.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying float vA;
        void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vec3(0.85, 1.0, 0.35) * 1.6, t.a * vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.layers.set(1);
  }
  update(t, amount) {
    this.points.visible = amount > 0.01;
    if (!this.points.visible) return;
    this.mat.uniforms.uAmt.value = amount;
    const p = this.geo.attributes.position;
    this.base.forEach((b, i) => {
      p.setXYZ(i, b.x + Math.sin(t * 0.3 * b.sp + b.ph) * 1.5, b.y + Math.sin(t * 0.5 * b.sp + b.ph * 2) * 0.4, b.z + Math.cos(t * 0.25 * b.sp + b.ph) * 1.5);
      const blink = Math.sin(t * 1.4 * b.sp + b.ph);
      this.alpha[i] = blink > 0.6 ? (blink - 0.6) * 2.5 : 0;
    });
    p.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }
}

// ---------------- Ants at war by the woodpile ----------------
class Ants {
  constructor() {
    const g = new THREE.SphereGeometry(0.012, 4, 3); g.scale(1, 0.7, 1.8);
    this.red = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x8a2a14 }), 14);
    this.black = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x0a0a0a }), 14);
    this.group = new THREE.Group();
    this.group.add(this.red, this.black);
    this.red.layers.set(1); this.black.layers.set(1);
    this.center = new THREE.Vector3();
  }
  update(t, show) {
    this.group.visible = show;
    if (!show) return;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 14; i++) {
      for (const [mesh, off] of [[this.red, 0], [this.black, 1]]) {
        const a = t * 0.8 + i * 0.9 + off * 0.3;
        const r = 0.08 + (i % 4) * 0.04 + Math.sin(t * 3 + i) * 0.02;
        const x = this.center.x + Math.cos(a + off * 0.15) * r + Math.sin(t * 9 + i) * 0.01;
        const z = this.center.z + Math.sin(a + off * 0.15) * r;
        m4.makeRotationY(-a);
        m4.setPosition(x, this.center.y + 0.01, z);
        mesh.setMatrixAt(i, m4);
      }
    }
    this.red.instanceMatrix.needsUpdate = true;
    this.black.instanceMatrix.needsUpdate = true;
  }
}

export class Creatures {
  constructor(scene) {
    this.group = new THREE.Group();
    this.loon = new Loon();
    this.group.add(this.loon.mesh);

    const beanHome = () => {
      const a = rand() * Math.PI * 2;
      return new THREE.Vector3(BEANS.cx + Math.cos(a) * randRange(14, 20), 0, BEANS.cz + Math.sin(a) * randRange(10, 16));
    };
    this.woodchuck = new Critter(quadruped({ body: [0.32, 0.26, 0.5], head: 0.2, len: 0.42, h: 0.16, color: 0x6a4a2a, belly: 0x9a7a52, tail: [0.08, 0.08, 0.2, 0.3], ears: 0.2, snout: true }), {
      home: beanHome,
      wander: (p) => new THREE.Vector3(BEANS.cx + randRange(-16, 16), 0, BEANS.cz + randRange(-10, 10)).lerp(p, 0.6),
      fear: 7, walk: 0.45, run: 3, hop: 9, hopH: 0.04, sitUp: true,
    });
    const nearCabin = () => {
      const a = rand() * Math.PI * 2;
      return new THREE.Vector3(CABIN.x + Math.cos(a) * randRange(4, 12), 0, CABIN.z + Math.sin(a) * randRange(4, 12));
    };
    this.squirrel = new Critter(quadruped({ body: [0.12, 0.12, 0.22], head: 0.1, len: 0.2, h: 0.08, color: 0x9a4a22, belly: 0xe0d0b8, tail: [0.1, 0.24, 0.12, -0.6, 0.15], ears: 0.4, tailColor: 0xa85a2a }), {
      home: nearCabin,
      wander: (p) => p.clone().add(new THREE.Vector3(randRange(-5, 5), 0, randRange(-5, 5))),
      fear: 3.5, walk: 1.4, run: 4.5, hop: 14, hopH: 0.07, sitUp: true,
    });
    this.fox = new Critter(quadruped({ body: [0.26, 0.26, 0.62], head: 0.2, len: 0.55, h: 0.36, color: 0xb0561e, belly: 0xeee6dc, tail: [0.13, 0.13, 0.5, 0.2, 0.05], tailColor: 0xb8601e, ears: 0.55, snout: true, legs: 0x2a1a12 }), {
      home: () => { const a = rand() * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * 60, 0, Math.sin(a) * 60); },
      wander: (p) => { const a = rand() * Math.PI * 2; return p.clone().add(new THREE.Vector3(Math.cos(a) * 25, 0, Math.sin(a) * 25)).clampLength(0, 150); },
      fear: 16, walk: 1.6, run: 6, hop: 7, hopH: 0.03,
    });
    for (const c of [this.woodchuck, this.squirrel, this.fox]) this.group.add(c.mesh);

    // mouse in the cabin
    this.mouse = quadruped({ body: [0.05, 0.045, 0.09], head: 0.04, len: 0.08, h: 0.03, color: 0x7a7068, belly: 0xb0a898, tail: [0.01, 0.01, 0.12], ears: 0.4 });
    this.mouse.visible = false;
    this.group.add(this.mouse);

    this.geese = new Flock('geese');
    this.swallows = new Flock('swallows');
    this.group.add(this.geese.group, this.swallows.group);
    this.fireflies = new Fireflies();
    this.group.add(this.fireflies.points);
    this.ants = new Ants();
    this.group.add(this.ants.group);
    this.fishTimer = 5;
    this.onFishJump = null;
    this.geeseTimer = 60;
  }

  update(dt, t, env, player, boatPos, cabin) {
    const s = env.season;
    const h = env.hour;
    const day = h > 6 && h < 19;
    this.loon.present = s.ice < 0.05;
    this.loon.update(dt, t, player, boatPos);
    this.woodchuck.present = day && s.leaf > 0.6 && s.snow < 0.1;
    this.woodchuck.update(dt, t, player);
    this.squirrel.present = day && (s.autumn > 0.3 || s.snow > 0.3 || s.bare > 0.5);
    this.squirrel.update(dt, t, player);
    this.fox.present = s.snow > 0.5 && (h > 15.5 || h < 8);
    this.fox.update(dt, t, player);

    // mouse: scurries along the cabin wall when you are inside and still
    const inside = cabin.isInside(player);
    this.mouse.visible = inside && s.snow < 0.6 && h > 10 && h < 16;
    if (this.mouse.visible) {
      const a = t * 0.25;
      const lx = -1.6 + (Math.sin(a) * 0.5 + 0.5) * 3.0;
      const p = cabin.toWorld(new THREE.Vector3(lx, 0.4, -1.35));
      this.mouse.position.copy(p);
      this.mouse.rotation.y = cabin.group.rotation.y + (Math.cos(a) > 0 ? Math.PI / 2 : -Math.PI / 2);
    }

    // migrating geese in spring & autumn
    this.geeseTimer -= dt;
    if (!this.geese.active && this.geeseTimer < 0 && day && (s.autumn > 0.4 || s.spring > 0.4)) {
      this.geese.start(player);
      this.geeseTimer = randRange(150, 300);
    }
    this.geese.update(dt, t, player);
    this.swallows.active = day && s.leaf > 0.8 && s.autumn < 0.3 && env.rain < 0.3;
    this.swallows.update(dt, t, player);

    const ffDay = env.doy > 160 && env.doy < 225;
    this.fireflies.update(t, ffDay ? env.night * (1 - env.rain) : 0);

    const wp = cabin.worldAnchor('woodpile');
    this.ants.center.set(wp.x + 0.9, heightAt(wp.x + 0.9, wp.z), wp.z + 0.4);
    const antsOn = s.leaf > 0.8 && s.autumn < 0.3 && day && Math.hypot(player.x - wp.x, player.z - wp.z) < 6;
    this.ants.update(t, antsOn);
    this.antsVisible = antsOn;

    // fish jumping
    this.fishTimer -= dt;
    if (this.fishTimer < 0 && s.ice < 0.1) {
      this.fishTimer = randRange(6, 20) * (h > 17 || h < 8 ? 0.5 : 1);
      for (let i = 0; i < 20; i++) {
        const a = rand() * Math.PI * 2, d = randRange(8, 45);
        const x = player.x + Math.cos(a) * d, z = player.z + Math.sin(a) * d;
        if (heightAt(x, z) < -1.5) { this.onFishJump && this.onFishJump(new THREE.Vector3(x, 0, z)); break; }
      }
    }
  }
}
