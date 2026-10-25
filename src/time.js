// Calendar & seasons. Day 0 = July 4, 1845 (Thoreau moves into his cabin).
import { yearCurve, mulberry32 } from './util.js';

const START = Date.UTC(1845, 6, 4);
const DAY_MS = 86400000;

export const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const CN_NUM = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function dateOf(day) {
  const d = new Date(START + Math.floor(day) * DAY_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay() };
}

export function dayOfYear(day) {
  const d = new Date(START + Math.floor(day) * DAY_MS);
  const y0 = Date.UTC(d.getUTCFullYear(), 0, 1);
  return (START + day * DAY_MS - y0) / DAY_MS; // fractional
}

export function yearCN(y) {
  return String(y).split('').map((c) => CN_NUM[+c]).join('');
}

export function seasonName(doy) {
  // doy 0 = Jan 1
  const m = Math.floor(doy / 30.5); // approx month 0..11
  const table = ['隆冬', '残冬', '早春', '仲春', '暮春', '初夏', '盛夏', '夏末', '初秋', '深秋', '晚秋', '初冬'];
  return table[Math.min(11, Math.max(0, m))];
}

export function seasonKey(doy) {
  if (doy < 59 || doy >= 334) return 'winter';
  if (doy < 151) return 'spring';
  if (doy < 243) return 'summer';
  return 'autumn';
}

export function timeName(h) {
  if (h < 4.5) return '深夜';
  if (h < 6) return '黎明';
  if (h < 8.5) return '清晨';
  if (h < 11) return '上午';
  if (h < 13) return '正午';
  if (h < 16.5) return '午后';
  if (h < 18.5) return '傍晚';
  if (h < 20.5) return '黄昏';
  return '夜晚';
}

export function clockText(h) {
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// continuous season parameters from fractional day-of-year
export function seasonParams(doy) {
  return {
    leaf: yearCurve(doy, [[0, 0], [110, 0], [140, 1], [298, 1], [330, 0]]),
    spring: yearCurve(doy, [[0, 0], [100, 0], [125, 1], [160, 0.6], [185, 0]]),
    autumn: yearCurve(doy, [[0, 0], [250, 0], [282, 1], [315, 1], [335, 0]]),
    bare: yearCurve(doy, [[0, 1], [95, 1], [125, 0], [300, 0], [330, 1]]),
    snow: yearCurve(doy, [[0, 1], [62, 1], [88, 0], [338, 0], [352, 1]]),
    ice: yearCurve(doy, [[0, 1], [82, 1], [96, 0], [345, 0], [358, 1]]),
    beans: yearCurve(doy, [[0, 0], [150, 0], [160, 0.15], [215, 1], [280, 1], [292, 0.0001], [365, 0]]),
    // day length (hours) and max sun elevation (rad) at ~42.4°N
    dayLen: yearCurve(doy, [[0, 9.2], [172, 15.3], [355, 9.1]]),
    maxElev: yearCurve(doy, [[0, 0.44], [172, 1.24], [355, 0.42]]),
    temp: yearCurve(doy, [[0, -6], [200, 24], [365, -6]]),
  };
}

// deterministic weather per day
export function weatherOf(day) {
  const r = mulberry32(Math.floor(day) * 7919 + 11);
  const doy = dayOfYear(Math.floor(day));
  const sk = seasonKey(doy);
  const chance = { summer: 0.18, autumn: 0.25, winter: 0.35, spring: 0.28 }[sk];
  const wet = Math.floor(day) > 0 && r() < chance;
  const start = 6 + r() * 10;
  const len = 2 + r() * 6;
  const cloud = wet ? 0.8 : r() * 0.55;
  const wind = 0.25 + r() * 0.5 + (sk === 'winter' ? 0.25 : 0);
  const mist = r() < 0.55;
  return { wet, start, end: start + len, cloud, wind, mist, snowy: sk === 'winter' };
}
