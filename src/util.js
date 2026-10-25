import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = mulberry32(18450704);
export const simplex = new SimplexNoise({ random: mulberry32(1854) });

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const randRange = (a, b, r = rand) => a + (b - a) * r();
export const pick = (arr, r = rand) => arr[Math.floor(r() * arr.length)];

export function fbm(x, y, oct = 4) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * simplex.noise(x * f, y * f);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return s / norm;
}

// keyframed value over day-of-year (0..365), keys: [[doy, value], ...] sorted, wraps
export function yearCurve(doy, keys) {
  const n = keys.length;
  for (let i = 0; i < n; i++) {
    const [d0, v0] = keys[i];
    const [d1raw, v1] = keys[(i + 1) % n];
    const d1 = i + 1 < n ? d1raw : d1raw + 365;
    let d = doy;
    if (i + 1 >= n && d < d0) d += 365;
    if (d >= d0 && d <= d1) {
      const t = (d - d0) / Math.max(1e-6, d1 - d0);
      return lerp(v0, v1, t * t * (3 - 2 * t));
    }
  }
  // before first key: interpolate from last (wrapping)
  const [dl, vl] = keys[n - 1];
  const [df, vf] = keys[0];
  const t = (doy + 365 - dl) / (df + 365 - dl);
  return lerp(vl, vf, t * t * (3 - 2 * t));
}

// shared shader uniforms for wind / snow
export const globalUniforms = {
  uTime: { value: 0 },
  uSnow: { value: 0 },
  uWind: { value: 0.5 },
};

// Inject wind sway and snow cover into a built-in material.
// opts.sway: amplitude multiplier (0 disables); opts.swayHeight: height at which sway is full
export function enhanceMaterial(mat, opts = {}) {
  const sway = opts.sway ?? 0;
  const swayH = opts.swayHeight ?? 6;
  const snow = opts.snow ?? true;
  const snowStrength = opts.snowStrength ?? 1;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uSnow = globalUniforms.uSnow;
    shader.uniforms.uWind = globalUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uWind;
        varying vec3 vWN; varying vec3 vWP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 _base = vec3(0.0);
        #ifdef USE_INSTANCING
          _base = instanceMatrix[3].xyz;
        #endif
        _base += modelMatrix[3].xyz;
        ${sway > 0 ? `
        float _h = clamp(position.y / ${swayH.toFixed(2)}, 0.0, 1.5);
        float _ph = _base.x * 0.07 + _base.z * 0.05;
        float _s = sin(uTime * 1.3 + _ph) * 0.6 + sin(uTime * 2.7 + _ph * 1.7) * 0.25 + sin(uTime * 5.1 + position.x * 2.0) * 0.08;
        transformed.x += _s * _h * _h * ${sway.toFixed(3)} * (0.4 + uWind);
        transformed.z += cos(uTime * 1.1 + _ph) * 0.5 * _h * _h * ${sway.toFixed(3)} * (0.4 + uWind);
        ` : ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        {
          mat4 _m = modelMatrix;
          #ifdef USE_INSTANCING
            _m = modelMatrix * instanceMatrix;
          #endif
          vWN = normalize(mat3(_m) * objectNormal);
          vWP = (_m * vec4(transformed, 1.0)).xyz;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uSnow; varying vec3 vWN; varying vec3 vWP;
        float _hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${snow ? `
        {
          float _n = _hash(floor(vWP.xz * 3.0)) * 0.35;
          float _cover = smoothstep(0.25, 0.75, vWN.y + _n - 0.15) * uSnow * ${snowStrength.toFixed(2)};
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), _cover);
        }` : ''}`);
  };
  mat.customProgramCacheKey = () => `enh-${sway}-${swayH}-${snow}-${snowStrength}`;
  return mat;
}

// soft round sprite texture
let _softTex = null;
export function softTexture() {
  if (_softTex) return _softTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  _softTex = new THREE.CanvasTexture(c);
  return _softTex;
}

// tint vertex colors of a geometry
export function colorGeometry(geo, color, jitter = 0, r = rand) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = 1 + (r() - 0.5) * jitter;
    arr[i * 3] = c.r * j; arr[i * 3 + 1] = c.g * j; arr[i * 3 + 2] = c.b * j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export function jitterGeometry(geo, amt, r = rand) {
  // move shared vertices consistently: key by rounded position
  const pos = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let o = map.get(k);
    if (!o) { o = [(r() - 0.5) * amt, (r() - 0.5) * amt, (r() - 0.5) * amt]; map.set(k, o); }
    pos.setXYZ(i, pos.getX(i) + o[0], pos.getY(i) + o[1], pos.getZ(i) + o[2]);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}
