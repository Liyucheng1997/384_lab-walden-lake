import * as THREE from 'three';
import { heightAt, shoreDist, railDist, toFeet, CABIN, BEANS, RAIL } from './world/geo.js';
import { BEAN_ROWS, BEAN_SEGS } from './world/props.js';
import { dateOf, dayOfYear, yearCN, seasonName, timeName, clockText, WEEKDAYS, seasonParams } from './time.js';
import { READINGS, ENTRIES, FISH, THOUGHTS } from './texts.js';
import { pick, clamp, lerp, randRange, globalUniforms } from './util.js';

const SAVE_KEY = 'walden-save-v1';
const CN_M = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const cnDay = (d) => (d <= 10 ? (d === 10 ? '十' : CN_M[d]) : d < 20 ? '十' + CN_M[d - 10] : d === 20 ? '二十' : d < 30 ? '二十' + CN_M[d - 20] : d === 30 ? '三十' : '三十' + CN_M[d - 30]);

function freshState() {
  return {
    day: 0, hour: 6.2,
    journal: [], readIdx: 0, fish: {}, fishCount: 0,
    wood: 12, carry: 0, woodBurned: 0, bushels: 0,
    soundings: [], sectors: 0, fireUntil: -1, lamp: false,
    weedy: null, harvested: null, beanYear: 1845,
    chopsToday: 0, bathedDay: -1, daysLived: 1, lastSnow: 0,
  };
}

export class Game {
  constructor(w) {
    Object.assign(this, w); // scene, camera, env, terrain, water, veg, cabin, beans, rail, boat, wood, mist, creatures, weather, player, sound, ui, chimneySmoke
    this.state = freshState();
    this.rate = 2; // game minutes per real second
    this.action = null;
    this.fishing = null;
    this.flute = false;
    this.fluteIdle = 0;
    this.sitTime = 0;
    this.boatTime = 0;
    this.fluteNightTime = 0;
    this.recent = {}; // recent sound events for "listen"
    this.paused = true;
    this.candidate = null;
    this.secondary = null;
    this.tools = this.makeTools();
    this.saveTimer = 0;
    this.bindKeys();
    this.rippleTimer = 0;

    // hooks from world
    this.rail.onWhistle = (p) => { this.sound.whistle(p); this.recent.train = performance.now(); };
    this.creatures.loon.onCall = (p) => { this.sound.loon(p); this.recent.loon = performance.now(); };
    this.creatures.loon.onSurface = (p, s) => this.water.ripple(p.x, p.z, s);
    this.creatures.geese.onHonk = (p) => { this.sound.geese(p); this.recent.geese = performance.now(); };
    this.creatures.onFishJump = (p) => {
      this.water.ripple(p.x, p.z, 0.9);
      this.sound.splash(p, 0.5);
      this.recent.fishjump = performance.now(); this.recent.fishjumpPos = p;
    };
    this.player.onStep = (s) => this.sound.step(s);
  }

  // ---------------- persistence ----------------
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!s) return false;
      this.state = Object.assign(freshState(), s);
      if (s.player) {
        this.player.pos.set(s.player[0], s.player[1], s.player[2]);
        this.player.yaw = s.player[3];
      }
      return true;
    } catch (e) { return false; }
  }
  save() {
    const s = this.state;
    s.weedy = this.beans.weedy.map((v) => (v ? 1 : 0));
    s.harvested = this.beans.harvested.map((v) => (v ? 1 : 0));
    const p = this.player.mode === 'boat' ? this.boat.home : this.player.pos;
    s.player = [p.x, this.player.pos.y, p.z, this.player.yaw];
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable */ }
  }
  reset() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    location.reload();
  }
  applyState() {
    const s = this.state;
    if (s.weedy) s.weedy.forEach((v, i) => { this.beans.weedy[i] = !!v; });
    if (s.harvested) s.harvested.forEach((v, i) => { this.beans.harvested[i] = !!v; });
    this.cabin.setWood(s.wood);
    this.cabin.setLamp(!!s.lamp);
    this.updateFire();
  }

  // ---------------- time ----------------
  get T() { return this.state.day * 24 + this.state.hour; }
  advance(minutes) {
    const s = this.state;
    s.hour += minutes / 60;
    while (s.hour >= 24) { s.hour -= 24; s.day += 1; this.newDay(1); }
  }
  newDay(n) {
    const s = this.state;
    s.daysLived += n;
    s.chopsToday = 0;
    const season = seasonParams(dayOfYear(s.day));
    for (let i = 0; i < Math.min(n, 5); i++) this.beans.newDay(season);
    // new year's beans
    const y = dateOf(s.day).y;
    const doy = dayOfYear(s.day);
    if (doy > 120 && doy < 200 && s.beanYear < y) {
      s.beanYear = y;
      this.beans.harvested.fill(false);
      this.beans.weedy.fill(true);
    }
    this.wood.respawn(26);
    // Sunday bells
    if (dateOf(s.day).wd === 0) this.bellsPending = true;
    this.water.clearHoles();
  }

  sunrise() { const p = seasonParams(dayOfYear(this.state.day)); return 12 - p.dayLen / 2; }

  // ---------------- tools in hand ----------------
  makeTools() {
    const cam = this.camera;
    const mk = (parts) => { const g = new THREE.Group(); parts.forEach((p) => g.add(p)); g.visible = false; cam.add(g); return g; };
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.8 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.5, metalness: 0.6 });
    // fishing rod
    const rodShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.009, 2.2, 6), wood);
    rodShaft.rotation.x = -1.05; rodShaft.position.set(0, 0.45, -0.95);
    const rod = mk([rodShaft]);
    rod.position.set(0.34, -0.36, -0.2);
    this.rodTip = new THREE.Object3D();
    this.rodTip.position.set(0, 0.45 + Math.cos(1.05) * 1.1, -0.95 - Math.sin(1.05) * 1.1);
    rod.add(this.rodTip);
    // hoe
    const hShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.4, 6), wood);
    hShaft.rotation.x = -0.9; hShaft.position.set(0, 0, -0.5);
    const hBlade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.14), iron);
    hBlade.position.set(0, -0.4, -1.05);
    const hoe = mk([hShaft, hBlade]);
    hoe.position.set(0.2, -0.3, -0.3);
    // axe
    const aShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.8, 6), wood);
    aShaft.position.set(0, 0.2, 0);
    const aHead = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.2), iron);
    aHead.position.set(0, 0.55, -0.06);
    const axe = mk([aShaft, aHead]);
    axe.position.set(0.25, -0.35, -0.5);
    // flute
    const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.55, 8), new THREE.MeshStandardMaterial({ color: 0x9a7448, roughness: 0.5 }));
    fl.rotation.z = Math.PI / 2 - 0.2;
    const flute = mk([fl]);
    flute.position.set(0.08, -0.12, -0.32);
    // bobber + line
    const bob = new THREE.Group();
    const b1 = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc8361e, roughness: 0.5 }));
    const b2 = new THREE.Mesh(new THREE.SphereGeometry(0.046, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2efe6 }));
    bob.add(b1, b2);
    bob.visible = false;
    this.scene.add(bob);
    const lineGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 16 }, () => new THREE.Vector3()));
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xe8e8e0, transparent: true, opacity: 0.55 }));
    line.frustumCulled = false;
    line.visible = false;
    this.scene.add(line);
    return { rod, hoe, axe, flute, bob, line };
  }

  // ---------------- journal ----------------
  unlock(id, quiet = false) {
    if (this.state.journal.includes(id)) return false;
    this.state.journal.push(id);
    const e = ENTRIES[id];
    if (!quiet && e) {
      this.ui.toast(`日记新添一页 ·《${e.title}》`, 'entry', 4800);
      this.sound.chime();
    }
    return true;
  }
  has(id) { return this.state.journal.includes(id); }

  // ---------------- input ----------------
  bindKeys() {
    addEventListener('keydown', (e) => {
      if (this.paused && !this.ui.open) return;
      if (e.repeat) return;
      if (this.ui.open) {
        if (e.code === 'KeyJ' || e.code === 'KeyM' || e.code === 'KeyH' || e.code === 'Escape') this.ui.close();
        return;
      }
      const c = e.code;
      if (c === 'KeyE') this.interact('E');
      else if (c === 'KeyQ') this.interact('Q');
      else if (c === 'KeyC') this.toggleSit();
      else if (c === 'KeyF') this.toggleFlute();
      else if (c === 'KeyJ') this.openPanel(() => this.ui.journal(this.state));
      else if (c === 'KeyM') this.openPanel(() => this.ui.map(this.state, this.player));
      else if (c === 'KeyH') this.openPanel(() => this.ui.help(this.sound.volume, (v) => this.sound.setVolume(v)));
      else if (this.flute && /^Digit[1-8]$/.test(c)) { this.sound.fluteKey(+c.slice(5) - 1); this.fluteIdle = 0; }
      if (this.player.mode === 'sit' && ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(c)) this.toggleSit();
    });
  }

  openPanel(fn, after) {
    this.panelOpen = true;
    document.exitPointerLock && document.exitPointerLock();
    fn();
    const prev = this.ui.onClose;
    this.ui.onClose = () => { prev && prev(); after && after(); this.panelOpen = false; this.relock(); };
  }
  relock() {
    const c = document.getElementById('c');
    try { const p = c.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* needs gesture */ }
  }

  toggleSit() {
    const p = this.player;
    if (p.mode === 'sit') { p.mode = 'walk'; this.ui.setDim(false); this.ui.toast('起身。', 'thought', 2000); return; }
    if (p.mode !== 'walk' || this.action || this.fishing) return;
    p.mode = 'sit';
    this.sitTime = 0;
    this.ui.setDim(true);
    this.ui.toast('静坐片刻，看光阴流过。', 'thought', 3000);
  }
  toggleFlute() {
    if (this.action || this.fishing) return;
    this.flute = !this.flute;
    this.tools.flute.visible = this.flute;
    this.ui.showFlute(this.flute);
    this.fluteIdle = 3.5;
    this.sound.impT = 0.3;
    this.sound.phrase = null;
  }

  // run a timed action: duration (s), minutes of game time, per-frame fn, completion fn
  run(duration, minutes, onUpdate, onDone) {
    this.action = { t: 0, duration, minutes, onUpdate, onDone };
    this.player.freeze = true;
  }

  // ---------------- interaction targeting ----------------
  findCandidates() {
    const p = this.player, cam = this.camera;
    const eye = cam.position;
    const look = p.lookDir();
    const s = this.env.season;
    const out = [];
    const facing = (pt, maxD, minDot = 0.8) => {
      const d = pt.clone().sub(eye);
      const dist = d.length();
      if (dist > maxD) return null;
      const dot = d.normalize().dot(look);
      return dot > minDot || dist < 0.9 ? { dist, dot } : null;
    };
    const add = (key, label, action, prio = 1) => out.push({ key, label, action, prio });
    if (this.fishing) return out;
    const boating = p.mode === 'boat';

    if (!boating) {
      // cabin anchors
      const c = this.cabin;
      const st = this.state;
      const A = (n) => c.worldAnchor(n);
      if (facing(A('bed'), 2.3, 0.7)) add('E', '就寝', () => this.sleepMenu(), 3);
      if (facing(A('desk'), 2.0, 0.75)) add('E', '伏案读写', () => this.read(), 3);
      if (facing(A('lamp'), 1.9, 0.85)) add('E', c.lampOn ? '吹熄油灯' : '点亮油灯', () => { c.setLamp(!c.lampOn); st.lamp = c.lampOn; this.sound.pick(); }, 4);
      if (facing(A('fire'), 2.3, 0.75)) {
        if (c.fireOn) add('E', `添一根柴（柴堆 ${st.wood}）`, () => this.addFire(), 3);
        else add('E', `生火（柴堆 ${st.wood}）`, () => this.addFire(), 3);
      }
      if (facing(A('woodpile'), 2.6, 0.7)) {
        if (st.carry > 0) add('E', `把 ${st.carry} 根枯枝堆上柴堆`, () => this.stackWood(), 3);
        else add('E', `看看柴堆（${st.wood} 根）`, () => this.ui.toast(st.wood > 20 ? '柴堆满满的，冬天不必发愁了。' : st.wood > 6 ? '柴还够烧几天。' : '柴不多了，去林子里拾些枯枝吧。'), 1);
      }
      if (facing(A('block'), 2.4, 0.7)) add('E', '劈柴', () => this.chop(), 3);
      if (facing(A('chair'), 1.8, 0.8)) add('E', '坐在椅子上', () => this.toggleSit(), 2);

      // firewood pickups
      for (const m of this.wood.items) {
        if (!m.visible) continue;
        if (facing(m.position.clone().add(new THREE.Vector3(0, 0.1, 0)), 2.6, 0.75)) { add('E', '拾起枯枝', () => this.gather(m), 3); break; }
      }

      // bean field
      const ahead = p.pos.clone().addScaledVector(p.forward(), 1.0);
      const seg = this.beans.nearestSeg(ahead);
      if (seg >= 0 && p.pitch < 0.1) {
        const harvestTime = s.beans > 0.3 && !this.beans.harvested[seg] && dayOfYear(this.state.day) > 235;
        const growing = s.leaf > 0.3 && s.snow < 0.2;
        if (harvestTime) add('E', '收获这一垄豆子', () => this.harvest(seg), 3);
        else if (growing && this.beans.weedy[seg]) add('E', '锄草松土', () => this.hoe(seg), 3);
      }

      // boat
      const bp = this.boat.group.position;
      if (s.ice < 0.5 && Math.hypot(bp.x - p.pos.x, bp.z - p.pos.z) < 3.2 && facing(bp.clone().setY(0.2), 4, 0.6)) add('E', '登船', () => this.board(), 4);

      // morning bath
      if (p.wading > 0.12 && s.ice < 0.05 && this.state.bathedDay !== this.state.day) {
        const h = this.state.hour;
        if (h > 4.5 && h < 11) add('E', '在湖中晨浴', () => this.bathe(), 5);
        else add('E', '在湖中沐浴', () => this.bathe(), 2);
      }
      if (p.mode === 'sit') return out;
    } else {
      if (p.canLeaveBoat()) add('E', '上岸', () => this.unboard(), 4);
    }

    // water: fishing & sounding
    if (look.y < -0.02) {
      const tt = -eye.y / look.y;
      const hit = eye.clone().addScaledVector(look, tt);
      const d = Math.hypot(hit.x - eye.x, hit.z - eye.z);
      const depth = -heightAt(hit.x, hit.z);
      const onIce = s.ice > 0.95;
      if (d < (boating ? 18 : 14) && d > (onIce ? 0.6 : 2.5) && depth > 0.8) {
        if (!onIce || p.surface === 'ice' || p.surface === 'snow') {
          add('E', onIce ? '凿冰垂钓' : '垂钓', () => this.startFishing(hit, onIce), 2);
        }
        if ((boating || (onIce && heightAt(p.pos.x, p.pos.z) < 0)) && d < 6) add('Q', '测量湖深', () => this.sounding(hit), 2);
      }
    }

    // creatures
    const cr = this.creatures;
    const seeLoon = cr.loon.mesh.visible && facing(cr.loon.mesh.position, 55, 0.96);
    if (seeLoon) add('E', '凝望潜鸟', () => this.observe('loon', '潜鸟在不远处浮游，忽然回头看了你一眼。'), 1);
    if (cr.woodchuck.mesh.visible && facing(cr.woodchuck.mesh.position, 25, 0.95)) add('E', '观察土拨鼠', () => this.observe('woodchuck', '土拨鼠直起身子，嚼着豆苗，毫不在意。'), 1);
    if (cr.squirrel.mesh.visible && facing(cr.squirrel.mesh.position, 14, 0.94)) add('E', '观察红松鼠', () => this.observe('squirrel', '红松鼠抱着一粒坚果，尾巴一抖一抖。'), 1);
    if (cr.fox.mesh.visible && facing(cr.fox.mesh.position, 45, 0.96)) add('E', '远远看着狐狸', () => this.observe('fox', '狐狸停下来，嗅了嗅风，又小跑着走了。'), 1);
    if (cr.mouse.visible && facing(cr.mouse.position, 4, 0.85)) add('E', '看那只小鼠', () => this.observe('mouse', '小鼠在墙根停下，抬起两只前爪洗脸。'), 2);
    if (cr.antsVisible && facing(cr.ants.center, 3.2, 0.85)) add('E', '俯身看蚂蚁', () => this.observe('ants', '红蚁与黑蚁仍在柴堆边厮杀，谁也不肯退让。'), 2);
    if (cr.geese.active && look.y > 0.25) add('E', '仰望雁阵', () => this.observe('geese', '雁阵排成人字，慢慢没入云里。'), 1);
    if (cr.swallows.active && cr.swallows.birds.some((b) => facing(b.position, 45, 0.96))) add('E', '看燕子掠过湖面', () => this.observe('swallows', '燕子贴着水面飞，翅尖点出一圈涟漪。'), 1);
    if (cr.fireflies.points.visible && !this.cabin.isInside(p.pos)) add('E', '看萤火虫', () => this.observe('fireflies', '萤火虫一明一灭，像在低声交谈。'), 0);

    // listening to recent sounds
    const now = performance.now();
    const recent = (k, ms = 9000) => this.recent[k] && now - this.recent[k] < ms;
    if (recent('train')) add('E', '聆听远处的汽笛', () => { this.observe('train', '汽笛声渐渐远了，林子又安静下来。'); this.recent.train = 0; }, 1);
    if (recent('loon') && !seeLoon) add('E', '聆听潜鸟的叫声', () => { this.observe('loon', '潜鸟的长啸在湖上回荡。'); this.recent.loon = 0; }, 1);
    if (recent('geese') && !cr.geese.active) add('E', '聆听雁鸣', () => { this.observe('geese', '雁鸣声从头顶掠过。'); this.recent.geese = 0; }, 1);
    if (recent('bells', 14000)) add('E', '聆听远处的钟声', () => { this.observe('bells', '钟声随风而来，又随风而去。'); this.recent.bells = 0; }, 1);
    if (recent('fishjump', 5000) && !this.cabin.isInside(p.pos)) add('E', '看那条跃起的鱼', () => { this.observe('fishjump', '涟漪一圈圈荡开。'); this.recent.fishjump = 0; }, 1);
    const nv = this.sound.lastNightVoice;
    if (nv && now - (this.sound.lastNightVoiceTime || 0) < 9000) {
      const names = { owl: ['聆听猫头鹰', '猫头鹰又叫了两声，远处有另一只应和。'], whippoorwill: ['聆听夜鹰', '夜鹰一遍一遍地唱着，准得像钟。'], bullfrog: ['聆听牛蛙', '湖边的牛蛙一只接一只地应和着。'], ice: ['聆听冰湖的吼声', '冰面深处传来沉闷的轰鸣。'] };
      const [label, thought] = names[nv];
      add('E', label, () => { this.observe(nv, thought); this.sound.lastNightVoice = null; }, 1);
    }

    // scenery
    const sun = this.env.sunDir;
    const h = this.state.hour;
    const outside = !this.cabin.isInside(p.pos);
    if (outside && sun.y > -0.05 && sun.y < 0.25 && look.dot(sun) > 0.85) {
      if (h < 12) add('E', '看日出', () => this.observe('sunrise', '太阳从湖对面的林梢升起来。'), 1);
      else add('E', '看日落', () => this.observe('sunset', '落日把湖面染成了金色。'), 1);
    }
    if (outside && this.env.mist > 0.3 && shoreDist(p.pos.x, p.pos.z) < 30) add('E', '看湖上的晨雾', () => this.observe('mist', '雾气在湖面上缓缓流动。'), 1);
    if (outside && p.pos.y > 13 && this.env.night < 0.3 && look.y < -0.05 && shoreDist(p.pos.x, p.pos.z) > 15) {
      const tt = -eye.y / look.y;
      const hit = eye.clone().addScaledVector(look, tt);
      if (heightAt(hit.x, hit.z) < -1 && tt < 400) add('E', '凝望湖色', () => this.observe('color', '湖心深绿，近岸淡黄，这一刻又是另一种颜色了。'), 1);
    }
    if (outside && railDist(p.pos.x, p.pos.z) < 14 && s.spring > 0.2 && s.snow < 0.5 && s.snow > 0.01) add('E', '观察解冻的沙岸', () => this.observe('thaw', '沙泥像叶脉一样流淌下来。'), 2);
    return out;
  }

  pickCandidates() {
    const list = this.findCandidates().sort((a, b) => b.prio - a.prio);
    this.candidate = list.find((c) => c.key === 'E') || null;
    this.secondary = list.find((c) => c.key === 'Q') || null;
  }

  interact(key) {
    if (this.action) return;
    if (this.fishing) { this.fishingKey(); return; }
    const c = key === 'E' ? this.candidate : this.secondary;
    if (c) c.action();
  }

  observe(id, thought) {
    if (!this.unlock(id)) this.ui.toast(thought);
  }

  // ---------------- activities ----------------
  read() {
    const i = this.state.readIdx;
    this.sound.page();
    this.openPanel(() => this.ui.reading(i), () => {
      this.state.readIdx++;
      this.advance(40);
      if (this.state.readIdx === READINGS.length) this.ui.toast('手记已经翻完了，下回从头再读。', 'thought');
    });
  }

  sleepMenu() {
    const h = this.state.hour;
    const night = h > 19 || h < 4.5;
    const items = [];
    if (!night) items.push({ label: '小憩一会儿', sub: '约两个钟头', action: () => this.sleep('nap') });
    items.push({ label: '睡到明天清晨', sub: '鸟声会叫醒你', action: () => this.sleep('night') });
    items.push({ label: '让十天悄悄过去', sub: '日子一天一天地流过，像湖水一样', action: () => this.sleep('ten') });
    items.push({ label: '一直睡到下一个季节', sub: '醒来时，林子会换上新的颜色', action: () => this.sleep('season') });
    items.push({ label: '还不困', action: () => {} });
    this.openPanel(() => this.ui.choices(night ? '夜深了' : '在床上躺一会儿', night ? '油灯的光渐渐暗下去。' : '午后的光斜斜地照进窗子。', items));
  }

  async sleep(kind) {
    this.panelOpen = true;
    this.player.mode = 'walk';
    this.ui.setDim(false);
    const quotes = ['破晓的日子还多着呢。', '每一个早晨都是一次愉快的邀请。', '我在那些季节里生长，像玉米在夜里生长。', '时间不过是我垂钓的溪流。'];
    let text = pick(quotes);
    const s = this.state;
    let days = 0;
    if (kind === 'nap') { await this.ui.fadeOut('……'); this.advance(120); } else {
      if (kind === 'night') days = s.hour > 4.5 ? 1 : 0;
      else if (kind === 'ten') days = 10;
      else {
        // to start of next season
        const doy = dayOfYear(s.day);
        const bounds = [80, 172, 265, 355, 445];
        const nb = bounds.find((b) => b > doy + 3);
        days = Math.round(nb - doy);
      }
      const d1 = dateOf(s.day + days);
      text = `${kind === 'night' ? '' : `${days} 天之后<br/>`}${CN_M[d1.m]}月${cnDay(d1.d)}日<br/><span style="font-size:15px;opacity:.7">${text}</span>`;
      await this.ui.fadeOut(text);
      await new Promise((r) => setTimeout(r, 1400));
      s.day += days;
      if (days > 0) this.newDay(days);
      s.hour = this.sunrise() + 0.3;
      s.fireUntil = -1;
      this.cabin.setLamp(false); s.lamp = false;
      this.updateFire();
    }
    this.env.weatherDay = -1;
    this.save();
    this.ui.fadeIn();
    this.panelOpen = false;
    this.ui.toast(kind === 'nap' ? '醒来时，光影已经挪了位置。' : pick(THOUGHTS.wake), 'thought');
    this.relock();
  }

  addFire() {
    const s = this.state;
    if (s.wood <= 0) { this.ui.toast(pick(THOUGHTS.noWood)); return; }
    s.wood--; s.woodBurned++;
    this.cabin.setWood(s.wood);
    const base = Math.max(this.T, s.fireUntil);
    s.fireUntil = base + 3;
    this.sound.pick();
    this.updateFire();
    if (!this.unlock('fire')) this.ui.toast(this.cabin.fireOn ? '火苗舔着新添的柴，噼啪作响。' : '火生起来了。');
  }
  updateFire() {
    const on = this.T < this.state.fireUntil;
    if (on !== this.cabin.fireOn) this.cabin.setFire(on);
  }

  stackWood() {
    const s = this.state;
    s.wood = Math.min(60, s.wood + s.carry);
    this.ui.toast(`堆好了 ${s.carry} 根枯枝。柴堆现在有 ${s.wood} 根。`);
    s.carry = 0;
    this.cabin.setWood(s.wood);
    this.sound.pick();
  }

  gather(m) {
    const s = this.state;
    if (s.carry >= 6) { this.ui.toast(pick(THOUGHTS.carryFull)); return; }
    this.run(1.0, 5, (t) => { this.player.busyPitch = -Math.sin(t * Math.PI) * 0.4; }, () => {
      m.visible = false;
      s.carry++;
      this.sound.pick();
      if (!this.unlock('gather')) this.ui.toast(`怀里抱着 ${s.carry} 根枯枝。`, 'thought', 2500);
    });
  }

  chop() {
    const s = this.state;
    if (s.chopsToday >= 4) { this.ui.toast('今天劈得够了，留些力气明天再劈。'); return; }
    this.tools.axe.visible = true;
    let hits = 0;
    this.run(2.8, 25, (t) => {
      const ph = (t * 3) % 1;
      this.tools.axe.rotation.x = ph < 0.6 ? -ph * 2.2 : -1.32 + (ph - 0.6) * 3.3 * 1.2;
      const n = Math.floor(t * 3 + 0.35);
      if (n > hits && n <= 3) { hits = n; this.sound.chop(); }
    }, () => {
      this.tools.axe.visible = false; this.tools.axe.rotation.x = 0;
      s.chopsToday++;
      s.wood = Math.min(60, s.wood + 2);
      this.cabin.setWood(s.wood);
      if (!this.unlock('chop')) this.ui.toast(`劈好了两段木柴。柴堆有 ${s.wood} 根了。`);
    });
  }

  hoe(seg) {
    this.tools.hoe.visible = true;
    let hits = 0;
    const stoneHit = Math.random() < 0.6;
    this.run(2.6, 20, (t) => {
      const ph = (t * 1.2) % 1;
      this.tools.hoe.rotation.x = ph < 0.5 ? ph * 1.6 : 0.8 - (ph - 0.5) * 1.6;
      this.player.busyPitch = -0.35 * Math.min(1, t * 3);
      const n = Math.floor(t * 1.2 + 0.5);
      if (n > hits && n <= 3) { hits = n; this.sound.hoe(stoneHit && n === 2); }
    }, () => {
      this.tools.hoe.visible = false;
      this.beans.weedy[seg] = false;
      this.state.hoed = (this.state.hoed || 0) + 1;
      const left = this.beans.weedy.filter((w) => w).length;
      if (!this.unlock('hoe')) {
        this.ui.toast(stoneHit ? '锄头碰在石头上，叮的一声，回荡在林子里。' : left === 0 ? '整片豆田都锄干净了。' : `锄好了一段。还有 ${left} 段长着杂草。`, 'thought');
      }
    });
  }

  harvest(seg) {
    this.run(2.2, 15, (t) => { this.player.busyPitch = -0.45 * Math.min(1, t * 3); }, () => {
      this.beans.harvested[seg] = true;
      this.state.bushels += 0.1;
      this.sound.pick();
      if (!this.unlock('harvest')) this.ui.toast(`收了一垄豆子，今年共 ${this.state.bushels.toFixed(1)} 蒲式耳。`);
    });
  }

  bathe() {
    this.state.bathedDay = this.state.day;
    this.sound.bathe();
    const p = this.player.pos;
    this.water.ripple(p.x, p.z, 1.2);
    this.run(3.2, 20, (t) => {
      this.player.camOffset.y = -Math.sin(Math.min(1, t / 3.2) * Math.PI) * 1.1;
      if (Math.random() < 0.05) this.water.ripple(p.x + (Math.random() - 0.5) * 2, p.z + (Math.random() - 0.5) * 2, 0.6);
    }, () => {
      this.player.camOffset.y = 0;
      if (!this.unlock('bathe')) this.ui.toast('湖水清凉，整个人都醒透了。', 'thought');
    });
  }

  board() {
    const b = this.boat;
    this.player.boardBoat();
    this.player.yaw = b.heading + Math.PI;
    this.ui.toast('W/S 划桨，A/D 转向。靠近岸边按 E 上岸。', 'thought', 4500);
    this.sound.splash(b.group.position, 0.4);
  }
  unboard() {
    if (this.player.leaveBoat()) {
      this.boat.vel = 0;
      this.sound.splash(this.player.pos, 0.3);
    }
  }

  sounding(hit) {
    const depth = Math.max(0, -heightAt(hit.x, hit.z));
    const ft = toFeet(depth);
    this.sound.plop(hit);
    this.water.ripple(hit.x, hit.z, 0.6);
    this.run(2.0, 10, null, () => {
      this.state.soundings.push({ x: Math.round(hit.x * 10) / 10, z: Math.round(hit.z * 10) / 10, ft });
      if (this.state.soundings.length > 160) this.state.soundings.shift();
      if (ft >= 98) this.ui.toast(`线放了很久才触底——${ft} 英尺！这大概就是湖最深的地方了。`, 'entry', 5000);
      else this.ui.toast(`石头触底了：水深 ${ft} 英尺。已记在测绘图上（M）。`, 'thought');
      if (this.state.soundings.length >= 5 || ft >= 98) this.unlock('sound');
    });
  }

  // ---------------- fishing ----------------
  startFishing(hit, ice) {
    const f = { state: 'cast', t: 0, target: hit.clone(), ice };
    f.target.y = 0.02;
    this.fishing = f;
    this.player.freeze = true;
    this.tools.rod.visible = true;
    this.tools.bob.visible = true;
    this.tools.line.visible = true;
    if (this.flute) this.toggleFlute();
    if (ice) { this.water.addHole(hit.x, hit.z); this.sound.chop(); }
    this.sound.cast();
    f.from = new THREE.Vector3();
    this.rodTip.getWorldPosition(f.from);
  }
  fishingKey() {
    const f = this.fishing;
    if (!f) return;
    if (f.state === 'bite') {
      f.state = 'reel'; f.t = 0;
      this.sound.reel();
    } else if (f.state === 'wait' || f.state === 'cast') {
      this.endFishing();
      this.ui.toast('收起了钓线。', 'thought', 2000);
    }
  }
  endFishing() {
    this.fishing = null;
    this.player.freeze = false;
    this.tools.rod.visible = false;
    this.tools.bob.visible = false;
    this.tools.line.visible = false;
  }
  rollFish() {
    const s = this.env.season, h = this.state.hour;
    const night = this.env.night > 0.5;
    const pool = FISH.map((f) => {
      let w = f.weight;
      if (f.night) w *= night ? 4 : 0.3;
      if (f.summer && s.leaf < 0.7) w *= 0.1;
      if (s.ice > 0.9 && f.id === 'pickerel') w *= 2.5;
      return [f, w];
    });
    let r = Math.random() * pool.reduce((a, [, w]) => a + w, 0);
    for (const [f, w] of pool) { r -= w; if (r <= 0) return f; }
    return FISH[0];
  }
  updateFishing(dt) {
    const f = this.fishing;
    if (!f) return;
    f.t += dt;
    const tip = new THREE.Vector3();
    this.rodTip.getWorldPosition(tip);
    const bob = this.tools.bob;
    const tm = globalUniforms.uTime.value;
    if (f.state === 'cast') {
      const k = Math.min(1, f.t / 0.9);
      bob.position.lerpVectors(f.from, f.target, k);
      bob.position.y += Math.sin(k * Math.PI) * 2.5;
      if (k >= 1) {
        f.state = 'wait'; f.t = 0;
        const h = this.state.hour;
        const good = (h > 4.5 && h < 8) || (h > 17 && h < 21);
        f.biteAt = randRange(4, 13) * (good ? 0.6 : 1);
        this.sound.plop(f.target);
        this.water.ripple(f.target.x, f.target.z, 0.7);
      }
    } else if (f.state === 'wait') {
      bob.position.copy(f.target);
      bob.position.y = 0.02 + Math.sin(tm * 2) * 0.01;
      // nibbles
      if (f.t > f.biteAt - 2 && Math.random() < dt * 2) { bob.position.y -= 0.025; this.water.ripple(f.target.x, f.target.z, 0.2); }
      if (f.t > f.biteAt) {
        f.state = 'bite'; f.t = 0;
        this.sound.plop(f.target);
        this.water.ripple(f.target.x, f.target.z, 1);
      }
    } else if (f.state === 'bite') {
      bob.position.copy(f.target);
      bob.position.y = -0.08 + Math.sin(tm * 18) * 0.03;
      if (f.t > 2.6) {
        this.ui.toast(pick(THOUGHTS.missFish), 'thought');
        this.endFishing();
        return;
      }
    } else if (f.state === 'reel') {
      const k = Math.min(1, f.t / 1.1);
      bob.position.lerpVectors(f.target, tip, k * 0.9);
      if (k >= 1) {
        const fish = this.rollFish();
        const size = Math.round(randRange(fish.min, fish.max));
        const st = this.state;
        const isNew = !st.fish[fish.id];
        st.fish[fish.id] = st.fish[fish.id] || { count: 0, best: 0 };
        st.fish[fish.id].count++;
        st.fish[fish.id].best = Math.max(st.fish[fish.id].best, size);
        st.fishCount++;
        this.sound.splash(f.target, 0.4);
        this.endFishing();
        this.advance(20);
        this.openPanel(() => this.ui.fishCard(fish, size, isNew));
        return;
      }
    }
    // line with sag
    const pts = this.tools.line.geometry.attributes.position;
    const end = bob.position;
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      const x = lerp(tip.x, end.x, t), y = lerp(tip.y, end.y, t) - Math.sin(t * Math.PI) * 0.25 * (f.state === 'cast' ? 0.2 : 1), z = lerp(tip.z, end.z, t);
      pts.setXYZ(i, x, y, z);
    }
    pts.needsUpdate = true;
  }

  // ---------------- per-frame ----------------
  update(dt) {
    const s = this.state;
    const p = this.player;
    if (this.paused || this.panelOpen) {
      this.ui.setPrompt('');
      return;
    }
    // time flow
    let rate = this.rate;
    if (p.mode === 'sit') { rate *= 12; this.sitTime += dt; if (this.sitTime > 20) this.unlock('sit'); }
    if (this.action) {
      const a = this.action;
      a.t += dt;
      const extra = a.minutes / a.duration;
      this.advance(extra * dt);
      a.onUpdate && a.onUpdate(Math.min(a.t, a.duration));
      if (a.t >= a.duration) {
        this.action = null;
        p.freeze = !!this.fishing;
        p.busyPitch = 0;
        a.onDone && a.onDone();
      }
    }
    this.advance(rate * dt);
    this.updateFire();

    // flute
    if (this.flute) {
      this.fluteIdle += dt;
      if (this.fluteIdle > 3.5) this.sound.fluteImprov(dt);
      this.tools.flute.position.y = -0.12 + Math.sin(performance.now() * 0.002) * 0.005;
      if (p.mode === 'boat' && this.env.night > 0.6 && this.env.season.ice < 0.1) {
        this.fluteNightTime += dt;
        // perch gather round, charmed
        this.rippleTimer -= dt;
        if (this.rippleTimer < 0) {
          this.rippleTimer = 0.8 + Math.random();
          const b = this.boat.group.position;
          const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 5;
          this.water.ripple(b.x + Math.cos(a) * r, b.z + Math.sin(a) * r, 0.35);
        }
        if (this.fluteNightTime > 10) this.unlock('moonflute');
      }
    }
    if (p.mode === 'boat') { this.boatTime += dt; if (this.boatTime > 50) this.unlock('boat'); }

    this.updateFishing(dt);

    // automatic journal entries by circumstance
    const ss = this.env.season;
    if (ss.snow > 0.6) this.unlock('firstSnow');
    if (ss.ice > 0.97) this.unlock('frozen');
    if (this.has('frozen') && ss.ice < 0.05 && ss.spring > 0.1) this.unlock('spring');
    const doy = this.env.doy;
    if (doy > 175 && doy < 235 && s.daysLived > 1 && this.env.night < 0.2) this.unlock('summer');
    if (ss.autumn > 0.85) this.unlock('autumn');
    if (this.env.rain > 0.6 && this.cabin.isInside(p.pos)) this.unlock('rain');
    if (p.pos.y > 24 && p.mode === 'walk') this.unlock('hill');
    if (railDist(p.pos.x, p.pos.z) < 6) this.unlock('rail');
    // walking round the pond
    const sd = shoreDist(p.pos.x, p.pos.z);
    if (sd < 14 && sd > -3) {
      const sec = Math.floor(((Math.atan2(p.pos.z, p.pos.x) + Math.PI) / (Math.PI * 2)) * 12) % 12;
      s.sectors |= 1 << sec;
      if (s.sectors === 0xfff) this.unlock('circuit');
    }
    // Sunday bells in the morning
    if (this.bellsPending && s.hour > 8.5 && s.hour < 11 && this.env.season.snow < 0.9) {
      this.bellsPending = false;
      this.sound.bells();
      this.recent.bells = performance.now();
    }

    // chimney smoke
    if (this.cabin.fireOn) {
      this.smokeAcc = (this.smokeAcc || 0) + dt;
      if (this.smokeAcc > 0.35) {
        this.smokeAcc = 0;
        const top = this.cabin.toWorld(this.cabin.chimneyTopLocal);
        this.chimneySmoke.emit(top, new THREE.Vector3(0, 0.9, 0), 8, 0.8, 0.35);
      }
    }

    // interaction prompt
    this.pickCandidates();
    let prompt = '';
    if (this.fishing) {
      const st = this.fishing.state;
      prompt = st === 'bite' ? '<b>E</b> 提竿！' : st === 'reel' ? '收线中……' : '<b>E</b> 收线 · 静静等着浮子';
    } else if (!this.action) {
      if (this.candidate) prompt += `<b>E</b> ${this.candidate.label}`;
      if (this.secondary) prompt += `${prompt ? '<br/>' : ''}<b>Q</b> ${this.secondary.label}`;
    }
    this.ui.setPrompt(prompt);

    // HUD
    const d = dateOf(s.day);
    const sn = seasonName(this.env.doy);
    this.ui.setDate(`${yearCN(d.y)}年 ${CN_M[d.m]}月${cnDay(d.d)}日 · ${WEEKDAYS[d.wd]}`, `${sn} · ${timeName(s.hour)} ${clockText(s.hour)} · ${this.weatherWord()}`);
    const bits = [];
    if (s.carry > 0) bits.push(`怀抱枯枝 ${s.carry}`);
    if (p.mode === 'boat') bits.push('泛舟湖上');
    if (p.mode === 'sit') bits.push('静坐中 · 时光加快');
    if (this.cabin.fireOn && this.cabin.isInside(p.pos)) bits.push('炉火正旺');
    this.ui.setStatus(bits.join('<br/>'));

    this.saveTimer += dt;
    if (this.saveTimer > 45) { this.saveTimer = 0; this.save(); }
  }

  weatherWord() {
    const e = this.env;
    if (e.snowfall > 0.3) return '落雪';
    if (e.rain > 0.3) return '下雨';
    if (e.mist > 0.3) return '晨雾';
    if (e.cloud > 0.6) return '阴';
    if (e.cloud > 0.35) return '多云';
    return e.night > 0.5 ? '晴夜' : '晴';
  }
}
