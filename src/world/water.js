import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { WORLD, GRID, HEIGHTS } from './geo.js';
import { globalUniforms } from '../util.js';

const MAX_RIPPLES = 10;

const WaterShader = {
  name: 'WaldenWater',
  uniforms: THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      color: { value: null },
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      uTime: { value: 0 },
      uDepth: { value: null },
      uWorld: { value: WORLD },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uAmbient: { value: new THREE.Color(0.5, 0.5, 0.5) },
      uShallow: { value: new THREE.Color(0x4f8a6c) },
      uDeep: { value: new THREE.Color(0x163a48) },
      uIce: { value: 0 },
      uSnow: { value: 0 },
      uRain: { value: 0 },
      uWindW: { value: 0.5 },
      uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0)) },
      uHoles: { value: Array.from({ length: 6 }, () => new THREE.Vector3(0, 0, 0)) },
    },
  ]),
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <fog_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D uDepth;
    uniform float uWorld, uTime, uIce, uSnow, uRain, uWindW;
    uniform vec3 uSunDir, uSunColor, uAmbient, uShallow, uDeep;
    uniform vec4 uRipples[${MAX_RIPPLES}];
    uniform vec3 uHoles[6];
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <fog_pars_fragment>

    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1,0)), u.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), u.x), u.y);
    }
    float fbm2(vec2 p){ float s = 0.0, a = 0.5; for(int i=0;i<4;i++){ s += a * vnoise(p); p *= 2.07; a *= 0.5; } return s; }

    // returns slope (dh/dx, dh/dz)
    vec2 waves(vec2 p, float t){
      vec2 g = vec2(0.0);
      float amp = 0.02 + uWindW * 0.05;
      vec2 dirs[5];
      dirs[0] = normalize(vec2(1.0, 0.3)); dirs[1] = normalize(vec2(-0.4, 1.0));
      dirs[2] = normalize(vec2(0.7, -0.8)); dirs[3] = normalize(vec2(-1.0, -0.2)); dirs[4] = normalize(vec2(0.2, 1.0));
      float fr[5]; fr[0]=0.35; fr[1]=0.55; fr[2]=0.9; fr[3]=1.6; fr[4]=2.7;
      for (int i = 0; i < 5; i++) {
        float k = fr[i];
        float ph = dot(dirs[i], p) * k + t * sqrt(9.8 * k) * 0.55 + float(i) * 1.7;
        g += dirs[i] * cos(ph) * k * amp / (1.0 + float(i) * 0.6);
      }
      // fine capillary noise
      float e = 0.15;
      vec2 q = p * 1.3 + vec2(t * 0.25, t * 0.18);
      float n0 = vnoise(q), nx = vnoise(q + vec2(e, 0.0)), nz = vnoise(q + vec2(0.0, e));
      g += vec2(nx - n0, nz - n0) / e * (0.03 + 0.05 * uWindW);
      // rain rings
      if (uRain > 0.01) {
        vec2 cell = floor(p * 0.9);
        for (int ox = -1; ox <= 1; ox++) for (int oz = -1; oz <= 1; oz++) {
          vec2 c = cell + vec2(float(ox), float(oz));
          float hs = h21(c);
          float tt = fract(t * 0.8 + hs);
          vec2 cp = (c + vec2(h21(c + 3.1), h21(c + 7.7))) / 0.9;
          vec2 d = p - cp;
          float r = length(d);
          float ring = sin((r - tt * 1.2) * 28.0) * exp(-r * 5.0) * (1.0 - tt);
          g += (r > 0.001 ? d / r : vec2(0.0)) * ring * 0.6 * uRain;
        }
      }
      // dynamic ripples
      for (int i = 0; i < ${MAX_RIPPLES}; i++) {
        vec4 rp = uRipples[i];
        float age = t - rp.z;
        if (age < 0.0 || age > 6.0) continue;
        vec2 d = p - rp.xy;
        float r = length(d) + 1e-4;
        float front = age * 1.6;
        float w = exp(-pow((r - front) * 1.4, 2.0)) * exp(-age * 0.6) * rp.w;
        g += d / r * cos((r - front) * 9.0) * w * 0.9;
      }
      return g;
    }

    void main() {
      vec2 wuv = (vWorld.xz + uWorld * 0.5) / uWorld;
      float depth = texture2D(uDepth, wuv).r * 20.0;
      vec2 sl = waves(vWorld.xz, uTime);
      vec3 n = normalize(vec3(-sl.x, 1.0, -sl.y));
      vec3 V = normalize(cameraPosition - vWorld);
      float dist = length(cameraPosition - vWorld);
      // flatten normal with distance to avoid aliasing
      n = normalize(mix(n, vec3(0.0, 1.0, 0.0), smoothstep(40.0, 260.0, dist) * 0.7));
      float NdV = max(dot(n, V), 0.0);
      float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
      fres = clamp(fres * 1.15, 0.0, 1.0);

      vec4 ruv = vUv;
      ruv.xy += n.xz * 1.6 * (1.0 - smoothstep(10.0, 200.0, dist) * 0.6);
      vec3 refl = texture2DProj(tDiffuse, ruv).rgb;

      vec3 body = mix(uShallow, uDeep, smoothstep(0.5, 11.0, depth));
      body *= uAmbient;
      // light scattered from below in shallow parts
      body += uShallow * uAmbient * 0.35 * (1.0 - smoothstep(0.0, 3.0, depth));

      vec3 H = normalize(uSunDir + V);
      float spec = pow(max(dot(n, H), 0.0), 420.0) * 6.0 + pow(max(dot(n, H), 0.0), 60.0) * 0.12;
      vec3 col = mix(body, refl, fres) + uSunColor * spec * step(0.0, uSunDir.y);

      float alpha = mix(0.18, 0.92, smoothstep(0.0, 3.5, depth));
      alpha = max(alpha, fres);
      // gentle shore line
      float shore = 1.0 - smoothstep(0.0, 0.25, depth);
      float foam = shore * (0.5 + 0.5 * sin(uTime * 1.2 + vWorld.x * 0.7 + vWorld.z * 0.5));
      col = mix(col, uAmbient * 1.1, foam * 0.25);

      // ---- ice ----
      if (uIce > 0.001) {
        float cracks = 0.0;
        vec2 ip = vWorld.xz * 0.12;
        float r1 = abs(fbm2(ip) - 0.5);
        float r2 = abs(fbm2(ip * 2.3 + 11.0) - 0.5);
        cracks = (1.0 - smoothstep(0.0, 0.012, r1)) * 0.6 + (1.0 - smoothstep(0.0, 0.008, r2)) * 0.35;
        vec3 iceCol = mix(vec3(0.42, 0.56, 0.62), vec3(0.72, 0.8, 0.84), fbm2(vWorld.xz * 0.05));
        iceCol = mix(iceCol, vec3(0.3, 0.38, 0.42), cracks);
        vec2 sp = vWorld.xz * vec2(0.025, 0.06);
        float drift = fbm2(sp + 4.0) * 0.75 + fbm2(vWorld.xz * 0.2) * 0.25;
        float snowy = smoothstep(0.5, 0.62, drift) * uSnow;
        iceCol = mix(iceCol, vec3(0.93, 0.95, 0.98), snowy);
        vec3 iceLit = iceCol * uAmbient * 1.25 + uSunColor * spec * 0.15 * (1.0 - snowy);
        iceLit = mix(iceLit, refl, 0.08 * (1.0 - snowy));
        // fishing holes
        float hole = 0.0;
        for (int i = 0; i < 6; i++) {
          if (uHoles[i].z > 0.0) hole = max(hole, 1.0 - smoothstep(0.35, 0.45, length(vWorld.xz - uHoles[i].xy)));
        }
        float ice = uIce * (1.0 - hole);
        // ice forms from the shore inwards
        float form = smoothstep(uIce * 22.0 - 2.0, uIce * 22.0, depth);
        ice *= 1.0 - form * step(uIce, 0.98);
        col = mix(col, iceLit, ice);
        alpha = mix(alpha, 1.0, ice);
      }

      gl_FragColor = vec4(col, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
};

export class Water {
  constructor(renderer) {
    // depth texture
    const W = GRID + 1;
    const data = new Uint8Array(W * W * 4);
    for (let k = 0; k < W * W; k++) {
      const d = Math.max(0, Math.min(1, -HEIGHTS[k] / 20));
      data[k * 4] = d * 255; data[k * 4 + 1] = 0; data[k * 4 + 2] = 0; data[k * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, W, W, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;

    const geo = new THREE.CircleGeometry(170, 160);
    const pr = Math.min(window.devicePixelRatio, 1.5);
    this.mesh = new Reflector(geo, {
      shader: WaterShader,
      textureWidth: Math.floor(window.innerWidth * pr * 0.5),
      textureHeight: Math.floor(window.innerHeight * pr * 0.5),
      clipBias: 0.002,
      multisample: 0,
    });
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0;
    const m = this.mesh.material;
    m.fog = true;
    m.transparent = true;
    m.depthWrite = false;
    m.uniforms.uDepth.value = tex;
    this.u = m.uniforms;
    this.mesh.renderOrder = 2;
    this.rippleIdx = 0;
    this.holeIdx = 0;
  }

  resize(w, h) {
    const pr = Math.min(window.devicePixelRatio, 1.5);
    this.mesh.getRenderTarget().setSize(Math.floor(w * pr * 0.5), Math.floor(h * pr * 0.5));
  }

  ripple(x, z, strength = 1) {
    const r = this.u.uRipples.value[this.rippleIdx];
    r.set(x, z, globalUniforms.uTime.value, strength);
    this.rippleIdx = (this.rippleIdx + 1) % MAX_RIPPLES;
  }

  addHole(x, z) {
    const h = this.u.uHoles.value[this.holeIdx];
    h.set(x, z, 1);
    this.holeIdx = (this.holeIdx + 1) % 6;
  }

  clearHoles() {
    for (const h of this.u.uHoles.value) h.set(0, 0, 0);
  }

  update(env) {
    this.u.uTime.value = globalUniforms.uTime.value;
    this.u.uSunDir.value.copy(env.lightDir);
    this.u.uSunColor.value.copy(env.sunSpecular);
    this.u.uAmbient.value.copy(env.waterAmbient);
    this.u.uIce.value = env.season.ice;
    this.u.uSnow.value = env.season.snow;
    this.u.uRain.value = env.rain * (1 - env.season.ice);
    this.u.uWindW.value = env.wind;
  }
}
