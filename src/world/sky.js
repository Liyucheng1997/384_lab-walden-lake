import * as THREE from 'three';
import { clamp, smoothstep, lerp, globalUniforms } from '../util.js';
import { seasonParams, dayOfYear, weatherOf } from '../time.js';

const SkyShader = {
  uniforms: {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() },
    uMoonDir: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Color() },
    uNight: { value: 0 },
    uCloud: { value: 0.3 },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main() {
      vDir = position;
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p.xyww;
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uTop, uHorizon, uGround, uSunDir, uMoonDir, uSunColor, uCloudLit, uCloudShade;
    uniform float uNight, uCloud, uTime;
    varying vec3 vDir;
    #include <common>
    float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p){
      vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
      return mix(mix(h21(i), h21(i+vec2(1,0)), u.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), u.x), u.y);
    }
    float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5;} return s; }
    void main() {
      vec3 d = normalize(vDir);
      float h = d.y;
      vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.9, h), 0.55));
      col = mix(col, uGround, smoothstep(0.0, -0.25, h));
      float s = max(dot(d, uSunDir), 0.0);
      // sun glow + disk
      col += uSunColor * (pow(s, 6.0) * 0.18 + pow(s, 48.0) * 0.35) * (1.0 - uNight);
      col += uSunColor * smoothstep(0.99955, 0.9998, s) * 18.0 * smoothstep(-0.05, 0.02, uSunDir.y);
      // stars
      if (uNight > 0.01 && h > 0.0) {
        vec3 p = d * 220.0;
        vec3 c = floor(p);
        float hs = h31(c);
        if (hs > 0.985) {
          vec3 off = vec3(h31(c + 1.3), h31(c + 4.7), h31(c + 9.1)) - 0.5;
          float r = length(fract(p) - 0.5 - off * 0.5);
          float tw = 0.65 + 0.35 * sin(uTime * (1.5 + hs * 4.0) + hs * 50.0);
          float b = smoothstep(0.11, 0.0, r) * (hs - 0.985) * 66.0 * tw;
          col += vec3(0.9, 0.93, 1.0) * b * uNight * smoothstep(0.0, 0.25, h) * (1.0 - uCloud);
        }
        // faint milky band
        float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.2, 0.93))) * 3.2, 2.0));
        col += vec3(0.05, 0.06, 0.09) * band * fbm(d.xz * 6.0 + d.y * 3.0) * uNight * (1.0 - uCloud);
      }
      // moon
      float m = max(dot(d, uMoonDir), 0.0);
      float disk = smoothstep(0.99982, 0.9999, m);
      col = mix(col, vec3(1.0, 0.97, 0.88) * 2.4, disk * smoothstep(-0.02, 0.05, uMoonDir.y) * (0.35 + 0.65 * uNight));
      col += vec3(0.5, 0.55, 0.7) * pow(m, 200.0) * 0.25 * uNight;
      // clouds
      if (h > 0.0) {
        vec2 uv = d.xz / (h + 0.12) * 1.2;
        uv += vec2(uTime * 0.004, uTime * 0.0025);
        float n = fbm(uv * 1.3);
        float cov = mix(0.7, 0.34, uCloud);
        float c = smoothstep(cov, cov + 0.28, n);
        float shade = fbm(uv * 1.3 + uSunDir.xz * 0.08);
        vec3 cc = mix(uCloudLit, uCloudShade, smoothstep(0.35, 0.75, shade) * 0.7 + uCloud * 0.3);
        cc += uSunColor * pow(s, 8.0) * 0.4 * (1.0 - uNight);
        c *= smoothstep(0.0, 0.18, h);
        col = mix(col, cc, c * 0.92);
      }
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

const C = (h) => new THREE.Color(h);
// palettes keyed by sun elevation
const KEYS = [
  { e: -0.35, top: C(0x060c1c), hor: C(0x121c30), sun: C(0x000000), amb: 0.12 },
  { e: -0.12, top: C(0x0e1934), hor: C(0x2c3250), sun: C(0x6a3a3a), amb: 0.2 },
  { e: -0.03, top: C(0x253a66), hor: C(0xc77a55), sun: C(0xff7a3a), amb: 0.32 },
  { e: 0.05, top: C(0x4a6fa5), hor: C(0xf0b27a), sun: C(0xffa860), amb: 0.55 },
  { e: 0.18, top: C(0x3f7fcc), hor: C(0xc3d8ea), sun: C(0xffe6c0), amb: 0.85 },
  { e: 0.5, top: C(0x2f6fc8), hor: C(0xb4d0ec), sun: C(0xfff6e6), amb: 1.0 },
];

function samplePalette(e, out) {
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  if (e <= a.e) { b = a; } else if (e >= b.e) { a = b; } else {
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (e >= KEYS[i].e && e <= KEYS[i + 1].e) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    }
  }
  const t = a === b ? 0 : (e - a.e) / (b.e - a.e);
  out.top.copy(a.top).lerp(b.top, t);
  out.hor.copy(a.hor).lerp(b.hor, t);
  out.sun.copy(a.sun).lerp(b.sun, t);
  out.amb = lerp(a.amb, b.amb, t);
}

const _gray = new THREE.Color();
function desaturate(c, amt) {
  const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
  _gray.setRGB(l, l, l);
  c.lerp(_gray, amt);
}

export class Environment {
  constructor(scene) {
    this.scene = scene;
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.sky = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      ...SkyShader, uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms),
      side: THREE.BackSide, depthWrite: false, fog: false,
    }));
    this.sky.scale.setScalar(1500);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);
    this.su = this.sky.material.uniforms;

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x4a4a30, 1.0);
    scene.add(this.hemi);

    scene.fog = new THREE.Fog(0xcad8e2, 60, 620);

    this.pal = { top: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), amb: 1 };
    this.lightDir = new THREE.Vector3();
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.sunSpecular = new THREE.Color();
    this.waterAmbient = new THREE.Color();
    this.fogColor = new THREE.Color();
    this.night = 0;
    this.rain = 0;
    this.snowfall = 0;
    this.wind = 0.4;
    this.cloud = 0.3;
    this.mist = 0;
    this.season = seasonParams(185);
    this.day = 0;
    this.hour = 6;
    this.weather = weatherOf(0);
    this.weatherDay = -1;
  }

  update(day, hour, playerPos, dt) {
    this.day = day; this.hour = hour;
    const doy = dayOfYear(day + hour / 24);
    this.doy = doy;
    this.season = seasonParams(doy);
    const s = this.season;
    if (Math.floor(day) !== this.weatherDay) {
      this.weatherDay = Math.floor(day);
      this.weather = weatherOf(day);
    }
    const w = this.weather;

    // ---- sun ----
    const rise = 12 - s.dayLen / 2;
    const ph = (hour - rise) / s.dayLen; // 0..1 during the day
    let elev;
    if (ph >= 0 && ph <= 1) elev = Math.sin(ph * Math.PI) * s.maxElev;
    else {
      const set = rise + s.dayLen, nightLen = 24 - s.dayLen;
      const np = (ph > 1 ? hour - set : hour + 24 - set) / nightLen;
      elev = -Math.sin(clamp(np, 0, 1) * Math.PI) * 0.7;
    }
    // azimuth: east (+x) at sunrise -> south (+z) at noon -> west (-x)
    const az = Math.PI * clamp(ph, -0.3, 1.3);
    const ce = Math.cos(elev);
    this.sunDir.set(Math.cos(az) * ce, Math.sin(elev), Math.sin(az) * ce * 0.9 + 0.25).normalize();
    // moon roughly opposite
    const mph = ((hour + 12 - rise) % 24) / 24 * 2; // 0..2
    const mel = Math.sin(clamp(mph, 0, 1) * Math.PI) * 0.75 - (mph > 1 ? 0.3 : 0);
    const maz = Math.PI * clamp(mph, -0.2, 1.2);
    this.moonDir.set(Math.cos(maz) * Math.cos(mel), Math.sin(mel), Math.sin(maz) * Math.cos(mel) * 0.6 + 0.3).normalize();

    const e = this.sunDir.y;
    samplePalette(e, this.pal);
    const pal = this.pal;
    this.night = smoothstep(0.02, -0.18, e);

    // ---- weather ----
    const rainingNow = w.wet && hour >= w.start && hour <= w.end;
    const target = rainingNow ? 1 : 0;
    const k = 1 - Math.exp(-dt * 0.25);
    const prec = lerp(this.rain + this.snowfall, target, k);
    const snowy = s.snow > 0.5 || s.ice > 0.6;
    this.rain = snowy ? 0 : prec;
    this.snowfall = snowy ? prec : 0;
    this.cloud = lerp(this.cloud, Math.max(w.cloud, prec * 0.95), k);
    this.wind = lerp(this.wind, w.wind + prec * 0.4, k);
    globalUniforms.uWind.value = this.wind;
    // dawn mist on the pond
    const mistT = w.mist && s.ice < 0.2 ? smoothstep(rise - 1.5, rise, hour) * (1 - smoothstep(rise + 1.2, rise + 3.2, hour)) : 0;
    this.mist = lerp(this.mist, mistT, k);

    // winter & overcast desaturation
    const wintry = s.snow * 0.35 + Math.max(0, this.cloud - 0.2) * 0.6;
    desaturate(pal.top, wintry * 0.8);
    desaturate(pal.hor, wintry * 0.6);
    const dim = Math.max(0.2, 1 - this.cloud * 0.45 - prec * 0.4);
    pal.top.multiplyScalar(lerp(1, 0.85, this.cloud));

    // ---- sky uniforms ----
    const su = this.su;
    su.uTop.value.copy(pal.top);
    su.uHorizon.value.copy(pal.hor);
    su.uGround.value.copy(pal.hor).multiplyScalar(0.55);
    su.uSunDir.value.copy(this.sunDir);
    su.uMoonDir.value.copy(this.moonDir);
    su.uSunColor.value.copy(pal.sun).multiplyScalar(1 - this.cloud * 0.8);
    su.uNight.value = this.night;
    su.uCloud.value = this.cloud;
    su.uCloudLit.value.copy(pal.hor).lerp(new THREE.Color(1, 1, 1), 0.5 * (1 - this.night)).multiplyScalar(lerp(1, 0.75, this.cloud));
    su.uCloudShade.value.copy(pal.top).lerp(pal.hor, 0.4).multiplyScalar(0.6);
    su.uTime.value = globalUniforms.uTime.value;
    this.sky.position.copy(playerPos);

    // ---- lights ----
    const isDay = e > -0.04;
    if (isDay) {
      this.lightDir.copy(this.sunDir);
      if (this.lightDir.y < 0.05) this.lightDir.y = 0.05;
      this.lightDir.normalize();
      this.sun.color.copy(pal.sun);
      this.sun.intensity = 4.2 * smoothstep(-0.04, 0.12, e) * dim;
    } else {
      this.lightDir.copy(this.moonDir);
      if (this.lightDir.y < 0.15) this.lightDir.y = 0.15;
      this.lightDir.normalize();
      this.sun.color.setRGB(0.55, 0.65, 0.95);
      this.sun.intensity = 0.9 * smoothstep(-0.04, -0.15, e) * (1 - this.cloud * 0.6);
    }
    this.sun.position.copy(playerPos).addScaledVector(this.lightDir, 150);
    // snap target to shadow texels to reduce shimmer
    const snap = 110 / 2048;
    this.sun.target.position.set(
      Math.round(playerPos.x / snap) * snap, Math.round(playerPos.y / snap) * snap, Math.round(playerPos.z / snap) * snap);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.lightDir, 150);

    this.hemi.color.copy(pal.top).lerp(pal.hor, 0.35).lerp(new THREE.Color(0.22, 0.28, 0.45), this.night * 0.7);
    this.hemi.groundColor.setRGB(0.25, 0.24, 0.16).lerp(new THREE.Color(0.75, 0.78, 0.82), s.snow * 0.7);
    this.hemi.intensity = lerp(0.35, 1.7, pal.amb) * (0.85 + this.cloud * 0.25) + this.night * 0.9;

    // fog
    this.fogColor.copy(pal.hor).lerp(pal.top, 0.15);
    this.scene.fog.color.copy(this.fogColor);
    const fogFar = lerp(950, 260, Math.max(prec * 0.9, this.mist * 0.5)) * (this.night > 0.5 ? 0.8 : 1);
    this.scene.fog.near = lerp(90, 8, prec);
    this.scene.fog.far = fogFar;

    // water lighting helpers
    this.sunSpecular.copy(isDay ? pal.sun : new THREE.Color(0.6, 0.65, 0.8)).multiplyScalar((isDay ? 1 : 0.3) * (1 - this.cloud * 0.85));
    this.waterAmbient.copy(this.hemi.color).multiplyScalar(this.hemi.intensity * 0.55)
      .add(new THREE.Color().copy(this.sun.color).multiplyScalar(this.sun.intensity * this.lightDir.y * 0.25));
  }
}
