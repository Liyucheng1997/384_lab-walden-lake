import * as THREE from 'three';
import { Terrain } from './world/terrain.js';
import { Water } from './world/water.js';
import { Environment } from './world/sky.js';
import { Vegetation } from './world/vegetation.js';
import { Cabin } from './world/cabin.js';
import { BeanField, Railroad, Boat, Firewood, Mist, Smoke } from './world/props.js';
import { Creatures } from './world/creatures.js';
import { Weather } from './world/weather.js';
import { shoreDist, CABIN } from './world/geo.js';
import { Player } from './player.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { globalUniforms, smoothstep, clamp } from './util.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.08, 2000);
camera.layers.enable(1);
scene.add(camera);

const ui = new UI();
const sound = new Sound();
const btnNew = document.getElementById('btnNew');
const btnCont = document.getElementById('btnContinue');
btnNew.disabled = true;

let game, world;

function build() {
  const env = new Environment(scene);
  const terrain = new Terrain();
  scene.add(terrain.mesh);
  const water = new Water(renderer);
  scene.add(water.mesh);
  // reflections skip layer-1 detail (grass, particles) for speed
  water.mesh.getReflectionCamera(camera).layers.set(0);
  const veg = new Vegetation();
  scene.add(veg.group);
  const cabin = new Cabin();
  scene.add(cabin.group);
  const beans = new BeanField();
  scene.add(beans.group);
  const rail = new Railroad(scene);
  scene.add(rail.group);
  const boat = new Boat();
  scene.add(boat.group);
  const wood = new Firewood();
  scene.add(wood.group);
  const mist = new Mist();
  scene.add(mist.group);
  const creatures = new Creatures(scene);
  scene.add(creatures.group);
  const weather = new Weather();
  scene.add(weather.group);
  const chimneySmoke = new Smoke(scene, 30, 0xb8b4ae);
  const player = new Player(camera, { cabin, veg, boat, env });
  world = { scene, camera, renderer, env, terrain, water, veg, cabin, beans, rail, boat, wood, mist, creatures, weather, player, sound, ui, chimneySmoke };
  game = new Game(world);
  // warm up season-dependent state
  env.update(0, 6.2, camera.position, 1);
  terrain.updateSeason(env.season);
  veg.update(env.season);
  beans.refresh(env.season);
  window.__walden = { game, world }; // handy for debugging in the console
}

// pre-render once behind the title so the first frame is not a hitch
function startLoop() {
  const clock = new THREE.Clock();
  let t = 0;
  const tmpCol = new THREE.Color();
  function frame() {
    requestAnimationFrame(frame);
    tick(Math.min(clock.getDelta(), 0.05));
  }
  function tick(dt) {
    t += dt;
    globalUniforms.uTime.value = t;
    const { env, terrain, water, veg, cabin, beans, rail, boat, creatures, weather, mist, player, chimneySmoke } = world;
    const st = game.state;

    game.update(dt);
    env.update(st.day, st.hour, camera.position, dt);
    const s = env.season;
    terrain.updateSeason(s);
    veg.update(s);
    beans.refresh(s);
    globalUniforms.uSnow.value = s.snow;
    water.update(env);

    const active = !game.paused && !game.panelOpen;
    boat.update(dt, t, active && player.mode === 'boat' ? player.boatInput : null, s.ice);
    if (active || game.paused) player.update(active ? dt : 0, t);
    if (!active) player.vel.set(0, 0, 0);
    creatures.update(dt, t, env, player.pos, player.mode === 'boat' ? boat.group.position : null, cabin);
    rail.update(dt, st.hour, player.pos, env.wind);
    weather.update(dt, t, camera.position, env);
    tmpCol.copy(env.fogColor).lerp(new THREE.Color(1, 1, 1), 0.35);
    mist.update(t, env.mist, tmpCol);
    cabin.update(t);
    chimneySmoke.update(dt, env.wind);

    // ambience
    sound.listener.x = camera.position.x; sound.listener.y = camera.position.y; sound.listener.z = camera.position.z;
    sound.listener.yaw = player.yaw;
    const indoors = cabin.isInside(player.pos);
    const sd = Math.abs(shoreDist(player.pos.x, player.pos.z));
    const day = 1 - env.night;
    const birdSeason = s.leaf * 0.8 + 0.15 + s.spring * 0.3 - s.snow * 0.2;
    const distCabin = Math.hypot(player.pos.x - CABIN.x, player.pos.z - CABIN.z);
    sound.updateAmbience(dt, {
      wind: env.wind, indoors, winter: s.snow > 0.5, night: env.night,
      shore: 1 - smoothstep(0, 28, sd), ice: s.ice, boating: player.mode === 'boat' ? 1 : 0,
      rain: env.rain + env.snowfall * 0.15,
      fire: cabin.fireOn ? (indoors ? 1 : clamp(1 - distCabin / 12, 0, 1) * 0.3) : 0,
      train: rail.distance < 600 ? clamp(1 - rail.distance / 600, 0, 1) ** 1.5 : 0,
      crickets: env.night * (s.leaf > 0.6 ? 1 : 0) * (1 - s.snow) * (1 - env.rain),
      birds: clamp(day * smoothstep(0.0, 0.2, env.sunDir.y + 0.1) * birdSeason * (1 - env.rain), 0, 1),
      summer: s.leaf > 0.7 && s.autumn < 0.5,
    });

    renderer.render(scene, camera);
  }
  window.__walden.tick = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) tick(dt); };
  // debug: jump the view somewhere ({x, z, yaw, pitch, hour, day})
  window.__walden.V = (o) => {
    const p = game.player;
    ui.close(); game.panelOpen = false;
    if (o.hour !== undefined) game.state.hour = o.hour;
    if (o.day !== undefined) game.state.day = o.day;
    if (o.x !== undefined) { p.pos.set(o.x, 0, o.z); p.pos.y = p.groundAt(o.x, o.z).y; }
    if (o.yaw !== undefined) p.yaw = o.yaw;
    if (o.pitch !== undefined) p.pitch = o.pitch;
    world.env.weatherDay = -1;
    window.__walden.tick(o.n || 30);
    return p.pos.toArray().map((v) => +v.toFixed(1));
  };
  frame();
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  world && world.water.resize(innerWidth, innerHeight);
});

function lock() {
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (world) world.player.locked = locked;
  if (!locked && game && !game.paused && !game.panelOpen) {
    game.openPanel(() => ui.pause(() => {}, () => ui.help(sound.volume, (v) => sound.setVolume(v)), () => game.reset()));
  }
});
canvas.addEventListener('click', () => { if (game && !game.paused && !game.panelOpen) lock(); });

function begin(cont) {
  sound.init();
  if (cont) game.load();
  game.applyState();
  document.getElementById('title').classList.add('out');
  setTimeout(() => document.getElementById('title').classList.add('hidden'), 1700);
  document.getElementById('hud').classList.remove('hidden');
  game.paused = false;
  lock();
  if (!cont) {
    setTimeout(() => ui.toast('一八四五年七月四日，我搬进了瓦尔登湖畔亲手搭起的小屋。', 'thought', 6000), 1200);
    setTimeout(() => ui.toast('四处走走吧。按 <b style="font-style:normal">H</b> 查看林中须知。', 'thought', 5000), 7000);
  } else {
    setTimeout(() => ui.toast('又回到了林中。', 'thought', 4000), 1200);
  }
}

btnNew.addEventListener('click', () => { if (game.hasSave() && !confirm('开始新的林中生活会覆盖之前的日子，确定吗？')) return; try { localStorage.removeItem('walden-save-v1'); } catch (e) { /* ignore */ } begin(false); });
btnCont.addEventListener('click', () => begin(true));

setTimeout(() => {
  build();
  startLoop();
  btnNew.disabled = false;
  document.getElementById('loading').classList.add('hidden');
  if (game.hasSave()) { btnCont.classList.remove('hidden'); btnNew.textContent = '新的林中生活'; }
  if (location.hash === '#dev') begin(false);
}, 50);
