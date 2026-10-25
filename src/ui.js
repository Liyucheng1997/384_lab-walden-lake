import { pondRadius, heightAt, CABIN, BEANS, RAIL, CABIN_FRAME, COVE, toFeet, MAX_DEPTH } from './world/geo.js';
import { READINGS, ENTRIES, FISH } from './texts.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.hud = $('hud');
    this.prompt = $('prompt');
    this.toasts = $('toasts');
    this.panel = $('panel');
    this.body = $('panelBody');
    this.fade = $('fade');
    this.fadeText = $('fadeText');
    this.onClose = null;
    $('panelClose').addEventListener('click', () => this.close());
    this.panel.addEventListener('mousedown', (e) => { if (e.target === this.panel) this.close(); });
    this.lastPrompt = '';
  }

  get open() { return !this.panel.classList.contains('hidden'); }

  setDate(a, b) { $('dateLine').textContent = a; $('timeLine').textContent = b; }
  setStatus(html) { if ($('status').innerHTML !== html) $('status').innerHTML = html; }
  setPrompt(html) { if (html !== this.lastPrompt) { this.prompt.innerHTML = html; this.lastPrompt = html; } }
  setDim(d) { this.hud.classList.toggle('dim', d); }
  showFlute(v) { $('flute').classList.toggle('hidden', !v); }

  toast(text, kind = 'thought', ms = 4200) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = text;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 1300); }, ms);
  }

  show(html, onClose) {
    this.body.innerHTML = html;
    this.panel.classList.remove('hidden');
    this.onClose = onClose || null;
    this.body.parentElement.scrollTop = 0;
  }
  close() {
    if (!this.open) return;
    this.panel.classList.add('hidden');
    const cb = this.onClose; this.onClose = null;
    cb && cb();
  }

  fadeOut(text) {
    return new Promise((res) => {
      this.fadeText.innerHTML = text || '';
      this.fade.classList.add('on');
      setTimeout(res, 1600);
    });
  }
  fadeIn() { this.fade.classList.remove('on'); }

  // ---------- panels ----------
  reading(i, done) {
    const r = READINGS[i % READINGS.length];
    this.show(`<h2>${r.title}</h2><div class="meta">林中手记 · 第 ${i % READINGS.length + 1} 篇 / 共 ${READINGS.length} 篇</div><p>${r.text}</p>
      <div class="row"><button class="btn dark" id="rdClose">合上书页</button></div>`, done);
    $('rdClose').onclick = () => this.close();
  }

  choices(title, meta, items, onClose) {
    this.show(`<h2>${title}</h2><div class="meta">${meta}</div><div class="choices">${items.map((c, i) => `<button class="choice" data-i="${i}">${c.label}${c.sub ? `<small>${c.sub}</small>` : ''}</button>`).join('')}</div>`, onClose);
    this.body.querySelectorAll('.choice').forEach((b) => {
      b.onclick = () => { const c = items[+b.dataset.i]; const cb = this.onClose; this.onClose = null; this.panel.classList.add('hidden'); cb && cb(); c.action(); };
    });
  }

  fishCard(fish, size, isNew, done) {
    this.show(`<div class="fishcard"><div class="meta">${isNew ? '第一次钓到' : '钓到了'}</div><div class="big">${fish.name}</div>
      <div class="meta">约 ${size} 厘米</div><p style="text-indent:0">${fish.text}</p>
      <div class="row" style="justify-content:center"><button class="btn dark" id="fc1">放回湖中</button><button class="btn dark" id="fc2">留作晚餐</button></div></div>`, done);
    $('fc1').onclick = () => this.close();
    $('fc2').onclick = () => this.close();
  }

  help(volume, onVolume) {
    this.show(`<h2>林中须知</h2><div class="meta">这里没有任务与失败，一切随你的心意。</div>
      <div class="help">
        <div><b>W A S D</b>漫步（Shift 快走）</div><div><b>鼠标</b>环顾四周</div>
        <div><b>E</b>互动：锄豆、垂钓、拾柴、读书……</div><div><b>Q</b>测量湖深（在船上或冰上）</div>
        <div><b>C</b>静坐，看光阴流过（时间加快）</div><div><b>F</b>取出/收起长笛，<b>1-8</b> 吹奏</div>
        <div><b>J</b>日记：见闻、手记、渔获</div><div><b>M</b>梭罗的湖区测绘图</div>
        <div><b>Esc</b>暂停</div><div><b>床</b>就寝，可让时光流转到下个季节</div>
      </div>
      <p style="text-indent:0;margin-top:18px">小提示：清晨涉水到湖里可以晨浴；划船到湖心追逐潜鸟；冬天湖面封冻后可以走到冰上凿冰垂钓、测量湖深；夏夜在船上吹笛，会有意外的回应。</p>
      <div class="row" style="align-items:center"><span>音量</span><input class="slider" id="vol" type="range" min="0" max="1" step="0.05" value="${volume}"></div>
      <div class="row"><button class="btn dark" id="hpClose">回到林中</button></div>`);
    $('vol').oninput = (e) => onVolume(+e.target.value);
    $('hpClose').onclick = () => this.close();
  }

  pause(onResume, onHelp, onReset) {
    this.show(`<h2>暂歇</h2><div class="meta">林子会等你。</div>
      <div class="row"><button class="btn dark" id="psGo">继续</button><button class="btn dark" id="psHelp">操作说明</button><button class="btn dark" id="psReset">重新开始一段林中生活</button></div>`, onResume);
    $('psGo').onclick = () => this.close();
    $('psHelp').onclick = () => { this.onClose = null; onHelp(); };
    $('psReset').onclick = () => { if (confirm('确定要抹去这段日子，从一八四五年七月四日重新开始吗？')) onReset(); };
  }

  journal(state, tab = 'entries') {
    const cats = ['劳作', '见闻', '四季'];
    const unlocked = state.journal;
    const total = Object.keys(ENTRIES).length;
    const have = Object.keys(ENTRIES).filter((k) => unlocked.includes(k)).length;
    const readCount = Math.min(state.readIdx, READINGS.length);
    const fishKinds = Object.keys(state.fish).length;
    let left = '', right = '';
    if (tab === 'entries') {
      for (const c of cats) {
        left += `<div class="jcat">${c}</div>`;
        for (const [k, e] of Object.entries(ENTRIES)) {
          if (e.cat !== c) continue;
          const on = unlocked.includes(k);
          left += `<div class="jitem ${on ? '' : 'locked'}" data-k="${on ? k : ''}">${on ? e.title : '· · ·'}</div>`;
        }
      }
      right = `<div class="jpage"><h3>林中日记</h3><div class="meta">已记下 ${have} / ${total} 则</div>
        <div class="stats">
          <div class="stat"><b>${state.daysLived}</b><span>林中的日子</span></div>
          <div class="stat"><b>${state.bushels.toFixed(1)}</b><span>蒲式耳豆子</span></div>
          <div class="stat"><b>${state.fishCount}</b><span>钓到的鱼</span></div>
          <div class="stat"><b>${state.woodBurned}</b><span>烧掉的柴</span></div>
          <div class="stat"><b>${readCount}</b><span>读写的篇章</span></div>
          <div class="stat"><b>${state.soundings.length}</b><span>测深记录</span></div>
        </div>
        <p style="margin-top:20px">从左侧选择一则日记来读。尚未写下的，会在你经历之后出现。</p></div>`;
    } else if (tab === 'readings') {
      left += `<div class="jcat">手记</div>`;
      READINGS.forEach((r, i) => { const on = i < state.readIdx; left += `<div class="jitem ${on ? '' : 'locked'}" data-r="${on ? i : ''}">${on ? r.title : '· · ·'}</div>`; });
      right = `<div class="jpage"><h3>林中手记</h3><div class="meta">已读写 ${readCount} / ${READINGS.length} 篇</div><p>在小屋的书桌前坐下，便能翻开新的一页。</p></div>`;
    } else {
      left += `<div class="jcat">渔获</div>`;
      FISH.forEach((f) => { const on = state.fish[f.id]; left += `<div class="jitem ${on ? '' : 'locked'}" data-f="${on ? f.id : ''}">${on ? f.name : '· · ·'}</div>`; });
      right = `<div class="jpage"><h3>鱼篓</h3><div class="meta">已见过 ${fishKinds} / ${FISH.length} 种鱼</div><p>瓦尔登湖里有黄鲈、狗鱼、银鱼、角鲶、太阳鱼，偶尔还有鳗鱼。不同的时辰与季节，上钩的鱼也不同。</p></div>`;
    }
    this.show(`<div class="tabs"><button class="tab ${tab === 'entries' ? 'on' : ''}" data-t="entries">日记</button><button class="tab ${tab === 'readings' ? 'on' : ''}" data-t="readings">手记</button><button class="tab ${tab === 'fish' ? 'on' : ''}" data-t="fish">鱼篓</button></div>
      <div class="journal"><div class="jlist">${left}</div><div id="jright">${right}</div></div>`, this.onClose);
    this.body.querySelectorAll('.tab').forEach((b) => { b.onclick = () => { const cb = this.onClose; this.journal(state, b.dataset.t); this.onClose = cb; }; });
    const R = $('jright');
    this.body.querySelectorAll('.jitem').forEach((el) => {
      el.onclick = () => {
        this.body.querySelectorAll('.jitem').forEach((x) => x.classList.remove('on'));
        if (el.dataset.k) { const e = ENTRIES[el.dataset.k]; R.innerHTML = `<div class="jpage"><h3>${e.title}</h3><div class="meta">${e.cat}</div><p>${e.text}</p></div>`; el.classList.add('on'); }
        if (el.dataset.r) { const r = READINGS[+el.dataset.r]; R.innerHTML = `<div class="jpage"><h3>${r.title}</h3><div class="meta">手记</div><p>${r.text}</p></div>`; el.classList.add('on'); }
        if (el.dataset.f) {
          const f = FISH.find((x) => x.id === el.dataset.f); const s = state.fish[f.id];
          R.innerHTML = `<div class="jpage"><h3>${f.name}</h3><div class="meta">钓到 ${s.count} 条 · 最大约 ${s.best} 厘米</div><p>${f.text}</p></div>`; el.classList.add('on');
        }
      };
    });
  }

  map(state, player) {
    this.show(`<h2>瓦尔登湖测绘图</h2><div class="meta">仿梭罗一八四六年的湖区测量 · 数字为测得的水深（英尺）</div><canvas class="map" id="mapc" width="1000" height="760"></canvas>`);
    drawMap($('mapc'), state, player);
  }
}

function drawMap(cv, state, player) {
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  // paper
  g.fillStyle = '#efe5cc'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(120,90,50,${Math.random() * 0.05})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  const scale = 2.05, ox = W / 2 + 30, oy = H / 2 + 10;
  const P = (x, z) => [ox + x * scale, oy + z * scale];
  const ink = 'rgba(48,36,24,0.9)';
  // contours
  const levels = [3, 8, 13, 17];
  levels.forEach((lv, li) => {
    g.beginPath();
    for (let a = 0; a <= 360; a += 2) {
      const th = (a * Math.PI) / 180;
      const R = pondRadius(th);
      // find first radius from center outward where depth < level
      let found = null;
      for (let rr = 0; rr < R; rr += 0.8) { if (-heightAt(Math.cos(th) * rr, Math.sin(th) * rr) < lv) { found = rr; break; } }
      if (found === null) found = 0;
      const [px, py] = P(Math.cos(th) * found, Math.sin(th) * found);
      if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.strokeStyle = `rgba(70,90,110,${0.25 + li * 0.08})`;
    g.setLineDash([3, 4]);
    g.lineWidth = 1;
    g.stroke();
  });
  g.setLineDash([]);
  // water wash
  g.beginPath();
  for (let a = 0; a <= 360; a += 1) {
    const th = (a * Math.PI) / 180, R = pondRadius(th);
    const [px, py] = P(Math.cos(th) * R, Math.sin(th) * R);
    if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  g.fillStyle = 'rgba(90,130,140,0.16)'; g.fill();
  g.strokeStyle = ink; g.lineWidth = 2.2; g.stroke();
  // hatching on hills
  g.strokeStyle = 'rgba(60,45,30,0.22)'; g.lineWidth = 1;
  for (let i = 0; i < 900; i++) {
    const x = (Math.random() - 0.5) * 460, z = (Math.random() - 0.5) * 360;
    const h = heightAt(x, z);
    if (h < 8) continue;
    const [px, py] = P(x, z);
    g.beginPath(); g.moveTo(px, py); g.lineTo(px + 3, py + 5); g.stroke();
  }
  // railroad
  g.strokeStyle = ink; g.lineWidth = 2;
  const r0 = P(RAIL.px - RAIL.dx * 200, RAIL.pz - RAIL.dz * 200), r1 = P(RAIL.px + RAIL.dx * 200, RAIL.pz + RAIL.dz * 200);
  g.beginPath(); g.moveTo(...r0); g.lineTo(...r1); g.stroke();
  for (let t = -200; t < 200; t += 6) {
    const [px, py] = P(RAIL.px + RAIL.dx * t, RAIL.pz + RAIL.dz * t);
    g.beginPath(); g.moveTo(px - 4 * RAIL.dz, py + 4 * RAIL.dx); g.lineTo(px + 4 * RAIL.dz, py - 4 * RAIL.dx); g.stroke();
  }
  g.fillStyle = ink; g.font = '16px "Noto Serif SC", serif';
  { const [px, py] = P(RAIL.px + RAIL.dx * 120 + 8, RAIL.pz + RAIL.dz * 120); g.save(); g.translate(px, py); g.rotate(Math.atan2(RAIL.dz, RAIL.dx)); g.fillText('菲奇堡铁路', 0, -10); g.restore(); }
  // bean field
  {
    const c = Math.cos(BEANS.rot), s = Math.sin(BEANS.rot);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
      const lx = (a * BEANS.w) / 2, lz = (b * BEANS.d) / 2;
      return P(BEANS.cx + lx * c + lz * s, BEANS.cz - lx * s + lz * c);
    });
    g.beginPath(); corners.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.closePath();
    g.fillStyle = 'rgba(120,90,50,0.15)'; g.fill(); g.strokeStyle = ink; g.lineWidth = 1.2; g.stroke();
    const [px, py] = P(BEANS.cx, BEANS.cz); g.fillStyle = ink; g.fillText('豆田', px - 16, py + 6);
  }
  // path & cabin
  g.setLineDash([4, 4]); g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(...P(CABIN.x, CABIN.z)); g.lineTo(...P(COVE.x, COVE.z)); g.stroke(); g.setLineDash([]);
  {
    const [px, py] = P(CABIN.x, CABIN.z);
    g.save(); g.translate(px, py); g.rotate(-CABIN.rot);
    g.fillStyle = '#5a3a24'; g.fillRect(-7, -5, 14, 10);
    g.restore();
    g.fillStyle = ink; g.fillText('我的小屋', px - 70, py - 10);
  }
  // labels
  g.font = '34px "Ma Shan Zheng", "KaiTi", serif'; g.fillStyle = 'rgba(48,36,24,0.75)';
  g.fillText('瓦 尔 登 湖', ox - 90, oy + 10);
  g.font = '14px "Noto Serif SC", serif'; g.fillStyle = 'rgba(48,36,24,0.7)';
  g.fillText('梭罗湾', COVE.x * scale + ox - 20, COVE.z * scale + oy + 24);
  // soundings
  g.font = '13px "Noto Serif SC", serif';
  for (const s of state.soundings) {
    const [px, py] = P(s.x, s.z);
    g.fillStyle = s.ft >= 100 ? '#8a2a18' : 'rgba(30,50,70,0.9)';
    g.fillText(String(s.ft), px - 7, py + 4);
  }
  // player
  {
    const [px, py] = P(player.pos.x, player.pos.z);
    const yaw = player.yaw;
    g.save(); g.translate(px, py); g.rotate(-yaw);
    g.beginPath(); g.moveTo(0, -11); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath();
    g.fillStyle = '#9a2a18'; g.fill(); g.restore();
  }
  // compass & title block
  g.strokeStyle = ink; g.lineWidth = 1.5;
  const cx = W - 80, cy = 90;
  g.beginPath(); g.arc(cx, cy, 34, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx, cy - 44); g.lineTo(cx + 7, cy); g.lineTo(cx, cy + 44); g.lineTo(cx - 7, cy); g.closePath(); g.fillStyle = 'rgba(48,36,24,0.85)'; g.fill();
  g.font = '18px "Noto Serif SC", serif'; g.fillText('北', cx - 9, cy - 50);
  g.font = '13px "Noto Serif SC", serif';
  g.fillText(`最深处：${toFeet(MAX_DEPTH)} 英尺`, 30, H - 54);
  g.fillText('比例：一英寸约四十杆', 30, H - 32);
  g.strokeRect(14, 14, W - 28, H - 28);
}
