// Geography of Walden: pond shape, terrain height field, key landmarks.
// North = -Z, East = +X. Water level is y = 0.
import { fbm, smoothstep, lerp, clamp } from '../util.js';

export const WORLD = 840;      // terrain size (m)
export const GRID = 336;       // cells per side
export const CELL = WORLD / GRID;
export const BOUND = 330;      // player wander radius

export function pondRadius(theta) {
  return 108 + 22 * Math.sin(2 * theta + 0.6) + 10 * Math.sin(3 * theta + 2.1)
    + 6 * Math.sin(5 * theta + 0.3) + 3 * Math.sin(8 * theta + 1.2);
}

// distance from shoreline (negative = in the water)
export function shoreDist(x, z) {
  const th = Math.atan2(z, x);
  return Math.hypot(x, z) - pondRadius(th);
}

// ---- landmarks ----
const cabTh = Math.atan2(-0.78, -0.5);
const cabR = pondRadius(cabTh) + 30;
export const CABIN = {
  x: Math.cos(cabTh) * cabR,
  z: Math.sin(cabTh) * cabR,
  // cabin front faces the pond (towards origin)
  rot: 0,
  y: 0,
};
CABIN.rot = Math.atan2(-CABIN.x, -CABIN.z); // rotation.y so that local +Z faces pond
export const COVE = {
  x: Math.cos(cabTh) * (pondRadius(cabTh) - 5),
  z: Math.sin(cabTh) * (pondRadius(cabTh) - 5),
};

// local frame helpers around the cabin
const fwd = { x: Math.sin(CABIN.rot), z: Math.cos(CABIN.rot) };      // towards pond
const right = { x: Math.cos(CABIN.rot), z: -Math.sin(CABIN.rot) };
export const CABIN_FRAME = { fwd, right };

export const BEANS = {
  cx: CABIN.x - fwd.x * 6 + right.x * 34,
  cz: CABIN.z - fwd.z * 6 + right.z * 34,
  w: 34, d: 22, rot: CABIN.rot, y: 0,
};

// Fitchburg railroad: straight line west of the pond
export const RAIL = {
  px: -168, pz: 0, dx: 0.16, dz: 0.987, y: 6.5,
};
{
  const l = Math.hypot(RAIL.dx, RAIL.dz); RAIL.dx /= l; RAIL.dz /= l;
}
export function railDist(x, z) {
  const rx = x - RAIL.px, rz = z - RAIL.pz;
  return Math.abs(rx * RAIL.dz - rz * RAIL.dx);
}
export function railAlong(x, z) {
  return (x - RAIL.px) * RAIL.dx + (z - RAIL.pz) * RAIL.dz;
}

function baseHeight(x, z) {
  const r = Math.hypot(x, z);
  const u = shoreDist(x, z);
  const n = fbm(x * 0.0065 + 3.1, z * 0.0065 - 1.7, 4);
  const n2 = fbm(x * 0.03, z * 0.03, 3);
  let h;
  if (u < 0) {
    h = Math.max(u * 0.11, -1.1) - 15.5 * smoothstep(-6, -52, u) - 3 * smoothstep(-50, -95, u);
    h += n2 * 0.35 * smoothstep(-2, -10, u);
  } else {
    const hill = (15 + 9 * n) * smoothstep(5, 75, u);
    h = 0.07 * Math.min(u, 7) + hill + n2 * 2.2 * smoothstep(4, 30, u);
    h += 28 * smoothstep(210, 360, r) * (0.7 + 0.3 * n);
  }
  return h;
}

function rectMask(x, z, R, inner, outer) {
  const dx = x - R.cx, dz = z - R.cz;
  const c = Math.cos(R.rot), s = Math.sin(R.rot);
  // local coords (x along right, z along fwd)
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const ex = Math.abs(lx) - R.w / 2;
  const ez = Math.abs(lz) - R.d / 2;
  const e = Math.max(ex, ez);
  return 1 - smoothstep(inner, outer, e);
}

CABIN.y = baseHeight(CABIN.x, CABIN.z) + 0.2;
BEANS.y = (baseHeight(BEANS.cx, BEANS.cz) + CABIN.y) / 2;

export function computeHeight(x, z) {
  let h = baseHeight(x, z);
  // cabin clearing
  const dc = Math.hypot(x - CABIN.x, z - CABIN.z);
  h = lerp(h, CABIN.y - 0.2, 1 - smoothstep(9, 20, dc));
  // bean field
  const bm = rectMask(x, z, { cx: BEANS.cx, cz: BEANS.cz, w: BEANS.w, d: BEANS.d, rot: BEANS.rot }, 0, 10);
  h = lerp(h, BEANS.y + fbm(x * 0.05, z * 0.05, 2) * 0.25, bm);
  // railroad cut / embankment
  const rd = railDist(x, z);
  h = lerp(h, RAIL.y, 1 - smoothstep(4.5, 16, rd));
  return h;
}

// ---- baked height grid ----
export const HEIGHTS = new Float32Array((GRID + 1) * (GRID + 1));
for (let j = 0; j <= GRID; j++) {
  for (let i = 0; i <= GRID; i++) {
    const x = -WORLD / 2 + i * CELL, z = -WORLD / 2 + j * CELL;
    HEIGHTS[j * (GRID + 1) + i] = computeHeight(x, z);
  }
}

// height matching the terrain mesh triangulation
export function heightAt(x, z) {
  const gx = clamp((x + WORLD / 2) / CELL, 0, GRID - 1e-4);
  const gz = clamp((z + WORLD / 2) / CELL, 0, GRID - 1e-4);
  const i = Math.floor(gx), j = Math.floor(gz);
  const fx = gx - i, fz = gz - j;
  const W = GRID + 1;
  const h00 = HEIGHTS[j * W + i], h10 = HEIGHTS[j * W + i + 1];
  const h01 = HEIGHTS[(j + 1) * W + i], h11 = HEIGHTS[(j + 1) * W + i + 1];
  if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
  return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

export function waterDepth(x, z) {
  return -heightAt(x, z);
}

export function inBeanField(x, z, margin = 0) {
  const dx = x - BEANS.cx, dz = z - BEANS.cz;
  const c = Math.cos(BEANS.rot), s = Math.sin(BEANS.rot);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) < BEANS.w / 2 + margin && Math.abs(lz) < BEANS.d / 2 + margin;
}

// path from cabin down to the cove
export function pathDist(x, z) {
  const ax = CABIN.x + fwd.x * 3, az = CABIN.z + fwd.z * 3;
  const bx = COVE.x, bz = COVE.z;
  const abx = bx - ax, abz = bz - az;
  const t = clamp(((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz), 0, 1);
  const wob = Math.sin(t * 7) * 1.6;
  const px = ax + abx * t + right.x * wob, pz = az + abz * t + right.z * wob;
  return Math.hypot(x - px, z - pz);
}

// convert Walden depth (m in our world) to feet as Thoreau measured (deepest 102 ft)
export const MAX_DEPTH = (() => {
  let m = 0;
  for (let i = 0; i < HEIGHTS.length; i++) m = Math.max(m, -HEIGHTS[i]);
  return m;
})();
export const toFeet = (d) => Math.round((d / MAX_DEPTH) * 102);

// 0..1 how wooded a spot is (used by vegetation + ground colors)
export function forestDensity(x, z) {
  const u = shoreDist(x, z);
  if (u < 3) return 0;
  let d = smoothstep(-0.35, 0.25, fbm(x * 0.011 + 7.3, z * 0.011 - 2.2, 3));
  d = 0.25 + 0.75 * d;
  d *= smoothstep(4, 16, u);
  const dc = Math.hypot(x - CABIN.x, z - CABIN.z);
  d *= smoothstep(9, 20, dc);
  if (inBeanField(x, z, 4)) d = 0;
  d *= smoothstep(6, 14, railDist(x, z));
  d *= smoothstep(1.5, 4, pathDist(x, z));
  return d;
}
