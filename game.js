(() => {
'use strict';
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);
const W = 400;
let H = 700, scale = 1, dpr = 1;

// ---------- storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('polarity.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('polarity.' + k, JSON.stringify(v)); } catch {} }
};
let best = store.get('best', 0);
let soundOn = store.get('sound', true);
const todayKey = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };

// ---------- rng ----------
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------- audio ----------
let actx = null;
function getCtx() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  return actx;
}
function unlockAudio() {
  const c = getCtx(); if (!c) return;
  if (c.state !== 'running') c.resume();
  try { const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch {}
}
['touchstart', 'touchend', 'pointerup', 'click', 'keydown'].forEach(n => window.addEventListener(n, unlockAudio, { passive: true }));
function beep(freq, dur = 0.1, type = 'sine', vol = 0.12, slide = 0) {
  if (!soundOn) return;
  const c = getCtx(); if (!c) return;
  if (c.state !== 'running') c.resume();
  try {
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur);
  } catch {}
}

// ---------- layout ----------
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cssH = window.innerHeight, cssW = Math.min(window.innerWidth, cssH * 0.66);
  cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
  scale = cv.width / W; H = cv.height / scale;
}
window.addEventListener('resize', resize);
resize();

// ---------- game state ----------
const RED = '#ff4d6d', BLUE = '#4dc3ff', GOLD = '#ffd166', ORANGE = '#ff9e3d';
let state = 'menu', mode = 'random', seed = 0, rng = Math.random;
let t = 0, camY = 0, genY = 0, dist = 0, bonus = 0, combo = 0, comboT = 0, shake = 0, deadT = 0, shardCount = 0;
let slowT = 0, bannerT = 0, curZone = 0, voids = [], winds = [], pows = [], held = 0, p, magnets, shards, mines, parts, trail;
ctx.imageSmoothingQuality = 'high';
const stars = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * 1000, d: 0.1 + Math.random() * 0.5, r: Math.random() * 1.4 + .4 }));

const K = 3.0e6, SOFT = 2500, FMAX = 1500, VMAX = 560, DRAG = 0.55;
const diff = () => Math.min(1, dist / 7000);
const score = () => Math.floor(dist / 10) + bonus;

function startGame(m) {
  mode = m;
  seed = m === 'daily' ? hashStr(todayKey()) : (Math.random() * 4294967296) >>> 0;
  rng = mulberry32(seed);
  held = 0; t = 0; camY = 0; dist = 0; bonus = 0; combo = 0; comboT = 0; shake = 0; deadT = 0; shardCount = 0;
  p = { x: W / 2, y: H * 0.72, vx: 0, vy: 0, s: 1, flip: 0, shield: false, inv: 0 };
  voids = []; winds = []; pows = []; slowT = 0; bannerT = 2.5; curZone = 0;
  magnets = []; shards = []; mines = []; parts = []; trail = [];
  // tutorial magnet
  magnets.push({ x: W / 2 + 55, y: p.y - 190, q: -1, s: 1, r: 15 });
  shards.push({ x: W / 2 - 40, y: p.y - 250, got: false });
  genY = p.y - 330;
  generate();
  state = 'play';
  $('menu').classList.add('hidden'); $('over').classList.add('hidden');
}

const ZONES = [
  { n: 'ДРЕЙФ', bg: '#07071a' }, { n: 'ПУЛЬСАР', bg: '#14061f' },
  { n: 'ШТОРМ', bg: '#061620' }, { n: 'БЕЗДНА', bg: '#190808' }
];
const ZLEN = 2500;
const zoneOf = d => Math.floor(Math.max(0, d) / ZLEN);

function addMagnet(x, y, q, sPow, mv) {
  const m = { x, y, q, s: sPow, r: 15 };
  if (mv) { m.ox = x; m.amp = mv.amp; m.sp = mv.sp; m.ph = rng() * 6.28; }
  magnets.push(m); return m;
}
const addShard = (x, y) => shards.push({ x: Math.max(22, Math.min(W - 22, x)), y, got: false });
const addMine = (x, y, amp = 0) => mines.push({ x0: x, y, amp, ph: rng() * 6.28, sp: 1 + rng() * 1.6, r: 11, x });
const rq = () => rng() < .5 ? 1 : -1;

function pBasic(y, d) {
  const n = rng() < 0.35 + d * 0.3 ? 2 : 1, row = [];
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 70 + rng() * 260 : (i === 0 ? 60 + rng() * 120 : 220 + rng() * 120);
    row.push(addMagnet(x, y + (rng() - .5) * 50, rq(), .75 + rng() * .6));
  }
  const b = row[(rng() * row.length) | 0], a = rng() * 6.283, rr = 55 + rng() * 40;
  addShard(b.x + Math.cos(a) * rr, b.y + Math.sin(a) * rr);
  if (rng() < 0.2 + d * 0.55) {
    for (let k = 0; k < 6; k++) {
      const mx = 40 + rng() * 320, my = y + (rng() - .5) * 140;
      if (magnets.every(m => Math.hypot(m.x - mx, m.y - my) > 70) && shards.every(s => Math.hypot(s.x - mx, s.y - my) > 55)) {
        addMine(mx, my, rng() < 0.2 + d * 0.6 ? 40 + rng() * 70 : 0); break;
      }
    }
  }
}
function pSlalom(y) {
  const side = rq(); let q = rq();
  for (let i = 0; i < 3; i++) {
    addMagnet(200 + side * (i % 2 ? 85 : -85), y - i * 100, q, .9);
    q = -q;
    if (i < 2) addShard(200 + side * (i % 2 ? -10 : 10), y - i * 100 - 50);
  }
  genY -= 200;
}
function pArc(y) {
  const mx = 120 + rng() * 160, q = rq(), a0 = rng() * 6.283;
  addMagnet(mx, y, q, 1.1);
  for (let i = 0; i < 5; i++) { const a = a0 + i * .8; addShard(mx + Math.cos(a) * 72, y + Math.sin(a) * 72); }
  addMagnet(mx + (rng() < .5 ? -1 : 1) * 110, y - 130, -q, .9);
  genY -= 130;
}
function pMoving(y, d) {
  const n = rng() < .4 + d * .3 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const ox = n === 1 ? 200 : (i ? 270 : 130), m = addMagnet(ox, y - i * 120, rq(), 1, { amp: 45 + rng() * 55, sp: .8 + rng() * .9 });
    addShard(ox + (rng() < .5 ? -1 : 1) * 80, m.y + (rng() - .5) * 60);
  }
  genY -= n > 1 ? 120 : 0;
}
function pGate(y) {
  const gx = 100 + rng() * 200, gw = 125, mv = rng() < .35 ? 28 : 0;
  for (let x = 28; x < W; x += 40) if (Math.abs(x - gx) > gw / 2) addMine(x, y, 0);
  addShard(gx, y);
  addMagnet(gx + rq() * 95, y + 110, rq(), 1);
  addMagnet(gx + rq() * 95, y - 100, rq(), 1);
  genY -= 100;
}
function pWind(y) {
  winds.push({ y: y - 90, h: 180, dir: rq(), str: 300 + rng() * 120 });
  for (let i = 0; i < 2; i++) { addMagnet(80 + rng() * 240, y - 60 + i * 110, rq(), 1); }
  addShard(60 + rng() * 280, y); addShard(60 + rng() * 280, y + 60);
  genY -= 90;
}
function pVoid(y) {
  const vx = 120 + rng() * 160;
  voids.push({ x: vx, y, r: 15 });
  for (let i = 0; i < 4; i++) { const a = i * 1.57 + .8; addShard(vx + Math.cos(a) * 88, y + Math.sin(a) * 88); }
  addMagnet(vx + (vx < 200 ? 120 : -120), y - 120, rq(), 1.1);
  addMagnet(vx + (vx < 200 ? 120 : -120), y + 100, rq(), 1.1);
  genY -= 120;
}
const PATTERNS = [
  { min: 0, w: 5, z: -1, f: pBasic }, { min: 300, w: 2, z: -1, f: pSlalom },
  { min: 700, w: 2, z: 1, f: pArc }, { min: 1000, w: 2, z: 1, f: pMoving },
  { min: 1500, w: 2, z: -1, f: pGate }, { min: 2000, w: 2, z: 2, f: pWind },
  { min: 2800, w: 2, z: 3, f: pVoid }
];

function generate() {
  while (genY > camY - 300) {
    const d = diff(), gd = Math.max(0, -genY), gz = zoneOf(gd) % 4;
    genY -= 140 + rng() * 80 - d * 30;
    const opts = PATTERNS.filter(p => gd >= p.min).map(p => ({ p, w: p.w * (p.z === gz ? 3 : 1) }));
    let r = rng() * opts.reduce((a, o) => a + o.w, 0), pick = opts[0].p;
    for (const o of opts) { r -= o.w; if (r <= 0) { pick = o.p; break; } }
    pick.f(genY, d);
    if (rng() < 0.13 && gd > 400) {
      const px = 50 + rng() * 300, py = genY - 70;
      if (mines.every(m => Math.hypot(m.x0 - px, m.y - py) > 60) && voids.every(v => Math.hypot(v.x - px, v.y - py) > 90))
        pows.push({ x: px, y: py, type: rng() < .55 ? 'shield' : 'slow', got: false });
    }
  }
}

function burst(x, y, col, n, spd = 160) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, v = spd * (.3 + Math.random());
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .5 + Math.random() * .5, max: 1, col, r: 1.5 + Math.random() * 2 });
  }
}

function flip(side = 0) {
  if (state !== 'play') return;
  p.s *= -1; p.flip = 1;
  if (side) { p.vx = Math.max(-VMAX, Math.min(VMAX, p.vx * 0.5 + side * 260)); }
  beep(p.s > 0 ? 520 : 390, 0.08, 'triangle', 0.1, p.s > 0 ? 160 : -120);
  burst(p.x, p.y, p.s > 0 ? RED : BLUE, 8, 90);
}

function die() {
  if (state !== 'play') return;
  state = 'dying'; deadT = 0; shake = 14;
  burst(p.x, p.y, p.s > 0 ? RED : BLUE, 50, 320);
  beep(180, 0.5, 'sawtooth', 0.18, -140);
  if (navigator.vibrate) navigator.vibrate(120);
  const sc = score();
  const isBest = sc > best;
  if (isBest) { best = sc; store.set('best', best); }
  let dBest = store.get('daily.' + todayKey(), 0), dNew = false;
  if (mode === 'daily' && sc > dBest) { dBest = sc; store.set('daily.' + todayKey(), sc); dNew = true; }
  $('finalScore').textContent = sc;
  $('finalInfo').textContent = (mode === 'daily' ? 'Ежедневный вызов · лучший сегодня: ' + dBest : 'Рекорд: ' + best) +
    (isBest || dNew ? ' · новый рекорд! 🎉' : '') + ' · кристаллов: ' + shardCount;
}

// ---------- update ----------
function step(dt) {
  t += dt;
  if (p.flip > 0) p.flip = Math.max(0, p.flip - dt * 5);
  if (state === 'dying') { deadT += dt; if (deadT > 0.8) { state = 'over'; $('over').classList.remove('hidden'); } return; }
  if (state !== 'play') return;

  if (p.inv > 0) p.inv -= dt;
  for (const m of magnets) if (m.amp) m.x = m.ox + Math.sin(t * m.sp + m.ph) * m.amp;
  let ax = 0, ay = 0;
  for (const m of magnets) {
    const dx = m.x - p.x, dy = m.y - p.y;
    if (Math.abs(dy) > 420) continue;
    const d2 = dx * dx + dy * dy, d = Math.sqrt(d2) || 1;
    let f = K * m.s / (d2 + SOFT); if (f > FMAX) f = FMAX;
    const sign = p.s * m.q < 0 ? 1 : -1;
    ax += dx / d * f * sign; ay += dy / d * f * sign;
    // bounce off core
    const minD = m.r + 9;
    if (d < minD) {
      const nx = -dx / d, ny = -dy / d;
      p.x = m.x + nx * minD; p.y = m.y + ny * minD;
      const vn = p.vx * nx + p.vy * ny;
      if (vn < 0) { p.vx -= 1.7 * vn * nx; p.vy -= 1.7 * vn * ny; beep(140, .06, 'square', .05); shake = Math.max(shake, 3); }
    }
  }
  for (const v of voids) {
    const dx = v.x - p.x, dy = v.y - p.y, d2 = dx * dx + dy * dy, d = Math.sqrt(d2) || 1;
    if (d > 380) continue;
    const f = Math.min(FMAX, K * .8 / (d2 + SOFT));
    ax += dx / d * f; ay += dy / d * f;
    if (d < v.r + 7 && p.inv <= 0) {
      if (p.shield) { p.shield = false; p.inv = 1; p.vx = -dx / d * 450; p.vy = -dy / d * 450; burst(p.x, p.y, '#7cffb2', 20, 220); beep(300, .2, 'square', .12, 300); }
      else { die(); return; }
    }
  }
  for (const w of winds) if (p.y > w.y && p.y < w.y + w.h) ax += w.dir * w.str;
  p.vx += (ax + held * 800) * dt; p.vy += ay * dt;
  const dr = Math.exp(-DRAG * dt); p.vx *= dr; p.vy *= dr;
  const sp = Math.hypot(p.vx, p.vy); if (sp > VMAX) { p.vx *= VMAX / sp; p.vy *= VMAX / sp; }
  p.x += p.vx * dt; p.y += p.vy * dt;
  if (p.x < 10) { p.x = 10; p.vx = Math.abs(p.vx) * .6; }
  if (p.x > W - 10) { p.x = W - 10; p.vx = -Math.abs(p.vx) * .6; }

  // camera
  const speed = 52 + 120 * diff();
  camY -= speed * dt;
  if (p.y < camY + H * 0.38) camY = p.y - H * 0.38;
  dist = Math.max(dist, -camY);
  generate();

  trail.push({ x: p.x, y: p.y, life: .6 });

  // shards
  for (const s of shards) {
    if (s.got) continue;
    if (Math.hypot(s.x - p.x, s.y - p.y) < 24) {
      s.got = true; combo = comboT > 0 ? combo + 1 : 1; comboT = 3;
      bonus += 10 * Math.min(combo, 10); shardCount++;
      burst(s.x, s.y, GOLD, 18, 200);
      beep(520 + Math.min(combo, 12) * 55, .14, 'triangle', .13);
    }
  }
  for (const o of pows) {
    if (o.got || Math.hypot(o.x - p.x, o.y - p.y) > 24) continue;
    o.got = true; burst(o.x, o.y, o.type === 'shield' ? '#7cffb2' : '#c58bff', 20, 200);
    if (o.type === 'shield') { p.shield = true; beep(660, .2, 'sine', .14, 400); } else { slowT = 5; beep(300, .3, 'sine', .14, 500); }
  }
  if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 0; }

  // mines
  for (const m of mines) {
    if (m.dead) continue;
    m.x = m.x0 + Math.sin(t * m.sp + m.ph) * m.amp;
    if (p.inv <= 0 && Math.hypot(m.x - p.x, m.y - p.y) < m.r + 7) {
      if (p.shield) { p.shield = false; p.inv = 1; m.dead = true; burst(m.x, m.y, ORANGE, 24, 240); beep(300, .2, 'square', .12, 300); shake = 6; }
      else { die(); return; }
    }
  }
  if (p.y > camY + H + 12) { die(); return; }

  const z = zoneOf(dist);
  if (z !== curZone) { curZone = z; bannerT = 2.5; beep(330, .4, 'sine', .1, 330); }
  if (bannerT > 0) bannerT -= dt;
  // cleanup
  const lim = camY + H + 150;
  if (magnets.length > 60) magnets = magnets.filter(m => m.y < lim);
  if (shards.length > 60) shards = shards.filter(s => !s.got && s.y < lim);
  if (mines.length > 60) mines = mines.filter(m => m.y < lim && !m.dead);
  if (voids.length > 6) voids = voids.filter(v => v.y < lim);
  if (winds.length > 6) winds = winds.filter(w => w.y < lim);
  if (pows.length > 10) pows = pows.filter(o => !o.got && o.y < lim);
}

function stepParts(dt) {
  for (const q of parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= .96; q.vy *= .96; q.life -= dt; }
  parts = parts.filter(q => q.life > 0);
  for (const q of trail) q.life -= dt * 1.6;
  trail = trail.filter(q => q.life > 0);
  if (shake > 0) shake = Math.max(0, shake - dt * 30);
}

// ---------- render ----------
const glowCache = {};
function glow(x, y, r, col, a) {
  let c = glowCache[col];
  if (!c) {
    c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, col); gr.addColorStop(.4, col + '88'); gr.addColorStop(1, col + '00');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); glowCache[col] = c;
  }
  const pa = ctx.globalAlpha; ctx.globalAlpha = pa * a;
  ctx.drawImage(c, x - r, y - r, r * 2, r * 2); ctx.globalAlpha = pa;
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = ZONES[state === 'menu' ? 0 : curZone % 4].bg; ctx.fillRect(0, 0, cv.width, cv.height);
  const sx = shake ? (Math.random() - .5) * shake : 0, sy = shake ? (Math.random() - .5) * shake : 0;
  ctx.setTransform(scale, 0, 0, scale, sx * scale, sy * scale);

  const cy = state === 'menu' ? -t * 40 : camY;
  // stars
  ctx.fillStyle = '#aab8ff';
  for (const s of stars) {
    let y = ((s.y - cy * s.d) % H + H) % H;
    ctx.globalAlpha = .25 + s.d; ctx.fillRect(s.x, y, s.r, s.r);
  }
  ctx.globalAlpha = 1;

  if (state === 'menu') { drawMenuBg(); return; }

  ctx.save(); ctx.translate(0, -camY);
  const top = camY - 60, bot = camY + H + 60;

  // danger line at bottom
  const dg = ctx.createLinearGradient(0, camY + H - 50, 0, camY + H);
  dg.addColorStop(0, 'rgba(255,60,80,0)'); dg.addColorStop(1, 'rgba(255,60,80,.45)');
  ctx.fillStyle = dg; ctx.fillRect(0, camY + H - 50, W, 50);

  // wind
  for (const w of winds) {
    if (w.y > bot || w.y + w.h < top) continue;
    ctx.fillStyle = 'rgba(120,200,255,.06)'; ctx.fillRect(0, w.y, W, w.h);
    ctx.strokeStyle = 'rgba(160,220,255,.35)'; ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const x = (((t * 140 * w.dir + i * 47) % W) + W) % W, y = w.y + 12 + (i * 37) % (w.h - 24);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w.dir * 22, y); ctx.moveTo(x + w.dir * 14, y - 5); ctx.lineTo(x + w.dir * 22, y); ctx.lineTo(x + w.dir * 14, y + 5); ctx.stroke();
    }
  }
  // voids
  for (const v of voids) {
    if (v.y < top - 100 || v.y > bot + 100) continue;
    glow(v.x, v.y, 80, '#8a3dff', .5);
    ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(t * 2);
    ctx.strokeStyle = '#b57bff'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
    for (let r = 26; r <= 44; r += 9) { ctx.globalAlpha = 1 - (r - 20) / 40; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.stroke(); ctx.rotate(1); }
    ctx.restore(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(v.x, v.y, v.r, 0, 6.283); ctx.fill();
  }
  // powerups
  for (const o of pows) {
    if (o.got || o.y < top || o.y > bot) continue;
    const col = o.type === 'shield' ? '#7cffb2' : '#c58bff', bob = Math.sin(t * 3 + o.x) * 3;
    glow(o.x, o.y + bob, 30, col, .5);
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(o.x, o.y + bob, 12, 0, 6.283); ctx.stroke();
    ctx.beginPath();
    if (o.type === 'shield') { for (let i = 0; i < 6; i++) { const a = i * 1.047; ctx.lineTo(o.x + Math.cos(a) * 6, o.y + bob + Math.sin(a) * 6); } ctx.closePath(); ctx.fillStyle = col; ctx.fill(); }
    else { ctx.moveTo(o.x, o.y + bob - 7); ctx.lineTo(o.x, o.y + bob); ctx.lineTo(o.x + 5, o.y + bob + 3); ctx.stroke(); }
  }

  // magnets
  for (const m of magnets) {
    if (m.y < top - 120 || m.y > bot + 120) continue;
    const col = m.q > 0 ? RED : BLUE, R = 120 * m.s, attract = p.s * m.q < 0;
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const ph = (t * .5 + i / 3) % 1, r = (attract ? 1 - ph : ph) * R + 10;
      ctx.globalAlpha = Math.sin(ph * Math.PI) * .45;
      ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, 6.283); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    glow(m.x, m.y, 48 * m.s, col, .55);
    ctx.fillStyle = '#0a0a22'; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 6.283); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = col; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(m.q > 0 ? '+' : '−', m.x, m.y + 1);
  }

  // shards
  for (const s of shards) {
    if (s.got || s.y < top || s.y > bot) continue;
    const bob = Math.sin(t * 3 + s.x) * 2;
    glow(s.x, s.y + bob, 26, GOLD, .5);
    ctx.save(); ctx.translate(s.x, s.y + bob); ctx.rotate(t * 1.5);
    ctx.fillStyle = GOLD; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(8, 0); ctx.lineTo(0, 10); ctx.lineTo(-8, 0); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // mines
  for (const m of mines) {
    if (m.dead || m.y < top || m.y > bot) continue;
    ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(-t * 1.2);
    glow(0, 0, 28, ORANGE, .4);
    ctx.fillStyle = ORANGE; ctx.beginPath();
    for (let i = 0; i < 12; i++) { const r = i % 2 ? 7 : 14, a = i / 12 * 6.283; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#07071a'; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, 6.283); ctx.fill();
    ctx.restore();
  }

  // trail
  const pc = p.s > 0 ? RED : BLUE;
  for (const q of trail) { glow(q.x, q.y, 9 * q.life + 2, pc, q.life * .5); }

  // particles
  for (const q of parts) { ctx.globalAlpha = Math.min(1, q.life * 2); ctx.fillStyle = q.col; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.283); ctx.fill(); }
  ctx.globalAlpha = 1;

  // player
  if (state === 'play') {
    if (p.inv > 0 && Math.floor(t * 20) % 2) ctx.globalAlpha = .4;
    glow(p.x, p.y, 34 + p.flip * 22, pc, .75);
    if (p.shield) { ctx.strokeStyle = '#7cffb2'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(p.x, p.y, 17 + Math.sin(t * 8) * 1.5, 0, 6.283); ctx.stroke(); }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 6.283); ctx.fill();
    ctx.strokeStyle = pc; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.fillStyle = pc; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.s > 0 ? '+' : '−', p.x, p.y + 1);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // HUD
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#eaf0ff'; ctx.textAlign = 'left'; ctx.font = '800 34px sans-serif';
  ctx.fillText(score(), 16, 46);
  ctx.textAlign = 'right'; ctx.font = '600 13px sans-serif'; ctx.globalAlpha = .6;
  ctx.fillText('РЕКОРД ' + Math.max(best, score()), W - 16, 28);
  ctx.fillText(mode === 'daily' ? 'ВЫЗОВ ДНЯ' : '', W - 16, 46);
  ctx.globalAlpha = 1;
  if (combo > 1) {
    ctx.textAlign = 'center'; ctx.fillStyle = GOLD; ctx.font = '800 22px sans-serif';
    ctx.globalAlpha = Math.min(1, comboT);
    ctx.fillText('КОМБО ×' + Math.min(combo, 10), W / 2, 84);
    ctx.fillRect(W / 2 - 40, 92, 80 * Math.min(1, comboT / 3), 3);
    ctx.globalAlpha = 1;
  }
  if (bannerT > 0 && state === 'play') {
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '800 30px sans-serif';
    ctx.globalAlpha = Math.min(1, bannerT) * .9;
    ctx.fillText('ЗОНА: ' + ZONES[curZone % 4].n, W / 2, H * 0.3); ctx.globalAlpha = 1;
  }
  if (slowT > 0 && state === 'play') {
    ctx.textAlign = 'left'; ctx.fillStyle = '#c58bff'; ctx.font = '700 13px sans-serif';
    ctx.fillText('ЗАМЕДЛЕНИЕ ' + slowT.toFixed(1), 16, 68);
  }
  if (state === 'play' && t < 5) {
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '600 14px sans-serif';
    ctx.globalAlpha = Math.min(1, 5 - t);
    ctx.fillText('ТАП слева / справа — смена заряда; держи палец — движение в сторону', W / 2, H * 0.88);
    ctx.font = '13px sans-serif'; ctx.fillText('разные заряды притягиваются', W / 2, H * 0.88 + 22);
    ctx.globalAlpha = 1;
  }
}

function drawMenuBg() {
  const m = [{ x: 90, y: H * .3, q: 1 }, { x: 310, y: H * .62, q: -1 }];
  for (const o of m) {
    const col = o.q > 0 ? RED : BLUE;
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) { const ph = (t * .4 + i / 3) % 1; ctx.globalAlpha = Math.sin(ph * Math.PI) * .4; ctx.beginPath(); ctx.arc(o.x, o.y, ph * 120, 0, 6.283); ctx.stroke(); }
    ctx.globalAlpha = 1; glow(o.x, o.y, 50, col, .6);
    ctx.fillStyle = '#0a0a22'; ctx.beginPath(); ctx.arc(o.x, o.y, 15, 0, 6.283); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
  }
}

// ---------- loop ----------
let last = performance.now(), paused = false;
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  if (!paused) {
    if (state === 'menu') t += dt;
    else { const ts = slowT > 0 ? 0.6 : 1; if (slowT > 0) slowT -= dt; step(dt * ts / 2); step(dt * ts / 2); stepParts(dt); }
  }
  render();
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => { paused = document.hidden; last = performance.now(); });

// ---------- input ----------
cv.addEventListener('pointerdown', e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  held = e.clientX < r.left + r.width / 2 ? -1 : 1;
  flip(held);
});
cv.addEventListener('pointermove', e => {
  if (!held) return;
  const r = cv.getBoundingClientRect();
  held = e.clientX < r.left + r.width / 2 ? -1 : 1;
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(n => cv.addEventListener(n, () => { held = 0; }));
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyZ', 'KeyX'].includes(e.code)) {
    e.preventDefault();
    if (state === 'play') flip(e.code === 'ArrowLeft' ? -1 : e.code === 'ArrowRight' ? 1 : 0);
    else if (state === 'over') startGame(mode);
    else if (state === 'menu') startGame('random');
  }
});
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());

// ---------- UI ----------
function refreshMenu() {
  $('bestInfo').textContent = best ? 'Рекорд: ' + best : 'Рекорда пока нет';
  const d = store.get('daily.' + todayKey(), 0);
  $('dailyBest').textContent = d ? 'сегодня лучший: ' + d : 'одинаковый уровень для всех — сегодня';
  $('snd').textContent = 'Звук: ' + (soundOn ? 'вкл' : 'выкл');
}
$('play').onclick = () => { beep(440, .1, 'triangle'); startGame('random'); };
$('daily').onclick = () => { beep(440, .1, 'triangle'); startGame('daily'); };
$('again').onclick = () => startGame(mode);
$('toMenu').onclick = () => { state = 'menu'; $('over').classList.add('hidden'); $('menu').classList.remove('hidden'); refreshMenu(); };
$('snd').onclick = () => { soundOn = !soundOn; store.set('sound', soundOn); refreshMenu(); beep(500, .08); };
$('share').onclick = async () => {
  const text = `POLARITY: ${score()} очков` + (mode === 'daily' ? ` (вызов дня ${todayKey()})` : '') + ' — побьёшь? ' + location.href;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); $('share').textContent = 'Скопировано ✓'; setTimeout(() => $('share').textContent = 'Поделиться', 1500); }
  } catch {}
};
refreshMenu();
requestAnimationFrame(frame);
})();
