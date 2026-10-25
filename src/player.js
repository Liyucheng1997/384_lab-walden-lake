import * as THREE from 'three';
import { heightAt, BOUND, CABIN, COVE, shoreDist } from './world/geo.js';
import { clamp, lerp } from './util.js';

const EYE = 1.68;
const RADIUS = 0.3;

export class Player {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world; // { cabin, veg, boat, env }
    const start = world.cabin.worldAnchor('door');
    this.pos = new THREE.Vector3(start.x, 0, start.z);
    this.pos.add(new THREE.Vector3(Math.sin(CABIN.rot), 0, Math.cos(CABIN.rot)).multiplyScalar(2.5));
    this.pos.y = this.groundAt(this.pos.x, this.pos.z).y;
    this.vel = new THREE.Vector3();
    this.yaw = CABIN.rot + Math.PI; // face the pond
    this.pitch = -0.05;
    this.keys = {};
    this.mode = 'walk'; // walk | sit | boat | busy
    this.bob = 0;
    this.stepAcc = 0;
    this.eye = EYE;
    this.sitBlend = 0;
    this.locked = false;
    this.onStep = null;
    this.busyAnim = null;
    this.camOffset = new THREE.Vector3();
    this.freeze = false;
    this.surface = 'grass';

    addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });
    // drag-to-look fallback when pointer lock is unavailable
    this.dragging = false;
    document.getElementById('c').addEventListener('mousedown', () => { this.dragging = true; });
    addEventListener('mouseup', () => { this.dragging = false; });
    addEventListener('mousemove', (e) => {
      if (!this.locked && !this.dragging) return;
      const s = 0.0021;
      this.yaw -= e.movementX * s;
      this.pitch = clamp(this.pitch - e.movementY * s, -1.35, 1.25);
    });
  }

  // ground height and surface type (walkable?) at x,z
  groundAt(x, z) {
    const { cabin, env } = this.world;
    const fl = cabin.floorAt(new THREE.Vector3(x, 0, z));
    if (fl !== null) return { y: fl, surface: 'wood', ok: true };
    const h = heightAt(x, z);
    const ice = env ? env.season.ice : 0;
    const snow = env ? env.season.snow : 0;
    if (h < 0) {
      if (ice > 0.95) return { y: 0.02, surface: snow > 0.3 ? 'snow' : 'ice', ok: true };
      // wading up to the knees
      return { y: h, surface: 'water', ok: h > -0.55, wade: -h };
    }
    let surface = 'grass';
    if (snow > 0.4) surface = 'snow';
    else if (shoreDist(x, z) < 6) surface = 'sand';
    return { y: h, surface, ok: true };
  }

  collide(p) {
    const { cabin, veg } = this.world;
    // trunks
    for (const t of veg.nearbyTrunks(p.x, p.z)) {
      const dx = p.x - t.x, dz = p.z - t.z;
      const d = Math.hypot(dx, dz), m = t.r + RADIUS;
      if (d < m && d > 1e-4) { p.x = t.x + (dx / d) * m; p.z = t.z + (dz / d) * m; }
    }
    // cabin boxes in local space
    const l = cabin.toLocal(p);
    if (Math.abs(l.x) < 8 && Math.abs(l.z) < 8) {
      for (const [x0, x1, z0, z1] of cabin.boxes) {
        const cx = clamp(l.x, x0, x1), cz = clamp(l.z, z0, z1);
        const dx = l.x - cx, dz = l.z - cz;
        const d = Math.hypot(dx, dz);
        if (d < RADIUS) {
          if (d > 1e-4) { l.x = cx + (dx / d) * RADIUS; l.z = cz + (dz / d) * RADIUS; } else {
            // inside the box: push out along smallest axis
            const pen = [l.x - x0, x1 - l.x, l.z - z0, z1 - l.z];
            const i = pen.indexOf(Math.min(...pen));
            if (i === 0) l.x = x0 - RADIUS; else if (i === 1) l.x = x1 + RADIUS; else if (i === 2) l.z = z0 - RADIUS; else l.z = z1 + RADIUS;
          }
        }
      }
      for (const [cx, cz, r] of cabin.circles) {
        const dx = l.x - cx, dz = l.z - cz, d = Math.hypot(dx, dz);
        if (d < r + RADIUS && d > 1e-4) { l.x = cx + (dx / d) * (r + RADIUS); l.z = cz + (dz / d) * (r + RADIUS); }
      }
      const w = cabin.toWorld(l);
      p.x = w.x; p.z = w.z;
    }
    // world bound
    const r = Math.hypot(p.x, p.z);
    if (r > BOUND) { p.x *= BOUND / r; p.z *= BOUND / r; }
  }

  forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  lookDir() {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  boardBoat() {
    this.mode = 'boat';
    this.vel.set(0, 0, 0);
  }
  leaveBoat() {
    const b = this.world.boat.group.position;
    // find nearest dry point
    let best = null;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
      for (let d = 1.5; d < 9; d += 0.5) {
        const x = b.x + Math.cos(a) * d, z = b.z + Math.sin(a) * d;
        if (heightAt(x, z) > 0.05) { if (!best || d < best.d) best = { x, z, d }; break; }
      }
    }
    if (!best) return false;
    this.mode = 'walk';
    this.pos.set(best.x, heightAt(best.x, best.z), best.z);
    return true;
  }
  canLeaveBoat() {
    const b = this.world.boat.group.position;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const x = b.x + Math.cos(a) * 4, z = b.z + Math.sin(a) * 4;
      if (heightAt(x, z) > 0.05) return true;
    }
    return false;
  }

  update(dt, t) {
    const k = this.keys;
    const boat = this.world.boat;
    if (this.mode === 'boat') {
      const input = this.freeze ? null : {
        fwd: (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0),
        turn: (k.KeyA || k.ArrowLeft ? 1 : 0) - (k.KeyD || k.ArrowRight ? 1 : 0),
      };
      this.boatInput = input;
      const g = boat.group;
      const seat = new THREE.Vector3(0, 0.95, -0.55).applyAxisAngle(new THREE.Vector3(0, 1, 0), boat.heading);
      this.pos.copy(g.position).add(seat);
      this.pos.y = g.position.y + 0.95;
      this.camera.position.copy(this.pos);
      this.applyLook();
      this.surface = 'water';
      return;
    }
    let speed = k.ShiftLeft || k.ShiftRight ? 4.2 : 2.3;
    const ground = this.groundAt(this.pos.x, this.pos.z);
    if (ground.wade) speed *= 0.55;
    if (ground.surface === 'snow') speed *= 0.85;
    const want = new THREE.Vector3();
    if (this.mode === 'walk' && !this.freeze) {
      const f = this.forward();
      const r = new THREE.Vector3(-f.z, 0, f.x);
      if (k.KeyW || k.ArrowUp) want.add(f);
      if (k.KeyS || k.ArrowDown) want.sub(f);
      if (k.KeyD || k.ArrowRight) want.add(r);
      if (k.KeyA || k.ArrowLeft) want.sub(r);
      if (want.lengthSq() > 0) want.normalize().multiplyScalar(speed);
    }
    this.vel.lerp(want, 1 - Math.exp(-dt * 7));
    const next = this.pos.clone().addScaledVector(this.vel, dt);
    this.collide(next);
    const g2 = this.groundAt(next.x, next.z);
    if (g2.ok && g2.y - this.pos.y < 0.6) {
      this.pos.x = next.x; this.pos.z = next.z;
    } else {
      // slide along: try axis-separated moves
      const nx = this.pos.clone(); nx.x = next.x;
      const nz = this.pos.clone(); nz.z = next.z;
      const gx = this.groundAt(nx.x, nx.z), gz = this.groundAt(nz.x, nz.z);
      if (gx.ok && gx.y - this.pos.y < 0.6) this.pos.x = nx.x;
      else if (gz.ok && gz.y - this.pos.y < 0.6) this.pos.z = nz.z;
      this.vel.multiplyScalar(0.5);
    }
    const g = this.groundAt(this.pos.x, this.pos.z);
    this.surface = g.surface;
    this.wading = g.wade || 0;
    // smooth vertical
    this.pos.y = lerp(this.pos.y, g.y, 1 - Math.exp(-dt * 14));

    // head bob & footsteps
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.3) {
      this.bob += dt * sp * 2.6;
      this.stepAcc += dt * sp;
      if (this.stepAcc > 0.78) { this.stepAcc = 0; this.onStep && this.onStep(this.surface); }
    }
    const sitTarget = this.mode === 'sit' ? 1 : 0;
    this.sitBlend = lerp(this.sitBlend, sitTarget, 1 - Math.exp(-dt * 3));
    const eye = lerp(EYE, 0.95, this.sitBlend);
    const bobY = Math.sin(this.bob * 2) * 0.035 * Math.min(1, sp / 2);
    const bobX = Math.cos(this.bob) * 0.02 * Math.min(1, sp / 2);
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.camera.position.set(this.pos.x, this.pos.y + eye + bobY, this.pos.z).addScaledVector(r, bobX).add(this.camOffset);
    this.applyLook();
  }

  applyLook() {
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch + (this.busyPitch || 0);
    this.camera.rotation.z = 0;
  }
}
