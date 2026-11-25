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
  dpr = Math.min(window.devicePixelRatio || 1, 2);
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
let held = 0, p, magnets, shards, mines, parts, trail;
const stars = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * 1000, d: 0.1 + Math.random() * 0.5, r: Math.random() * 1.4 + .4 }));

const K = 3.0e6, SOFT = 2500, FMAX = 1500, VMAX = 560, DRAG = 0.55;
const diff = () => Math.min(1, dist / 7000);
const score = () => Math.floor(dist / 10) + bonus;

function startGame(m) {
  mode = m;
  seed = m === 'daily' ? hashStr(todayKey()) : (Math.random() * 4294967296) >>> 0;
  rng = mulberry32(seed);
  held = 0; t = 0; camY = 0; dist = 0; bonus = 0; combo = 0; comboT = 0; shake = 0; deadT = 0; shardCount = 0;
  p = { x: W / 2, y: H * 0.72, vx: 0, vy: 0, s: 1, flip: 0 };
  magnets = []; shards = []; mines = []; parts = []; trail = [];
  // tutorial magnet
  magnets.push({ x: W / 2 + 55, y: p.y - 190, q: -1, s: 1, r: 15 });
  shards.push({ x: W / 2 - 40, y: p.y - 250, got: false });
  genY = p.y - 330;
  generate();
  state = 'play';
  $('menu').classList.add('hidden'); $('over').classList.add('hidden');
}

function generate() {
  while (genY > camY - 300) {
    const d = diff();
    genY -= 140 + rng() * 80 - d * 30;
    const n = rng() < 0.35 + d * 0.3 ? 2 : 1;
    const rowM = [];
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 70 + rng() * 260 : (i === 0 ? 60 + rng() * 120 : 220 + rng() * 120);
      const m = { x, y: genY + (rng() - .5) * 50, q: rng() < .5 ? 1 : -1, s: .75 + rng() * .6, r: 15 };
      magnets.push(m); rowM.push(m);
    }
    // shard orbiting a magnet or between them
    const base = rowM[(rng() * rowM.length) | 0];
    const a = rng() * Math.PI * 2, rr = 55 + rng() * 40;
    const sx = Math.max(25, Math.min(W - 25, base.x + Math.cos(a) * rr));
    const sy = base.y + Math.sin(a) * rr;
    shards.push({ x: sx, y: sy, got: false });
    // mines
    if (rng() < 0.2 + d * 0.55) {
      for (let tries = 0; tries < 6; tries++) {
        const mx = 40 + rng() * 320, my = genY + (rng() - .5) * 140;
        const ok = magnets.every(m => Math.hypot(m.x - mx, m.y - my) > 70) && shards.every(s => Math.hypot(s.x - mx, s.y - my) > 55);
        if (!ok) continue;
        const moving = rng() < 0.2 + d * 0.6;
        mines.push({ x0: mx, y: my, amp: moving ? 40 + rng() * 70 : 0, ph: rng() * 6.28, sp: 1 + rng() * 1.6, r: 11, x: mx });
        break;
      }
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
  if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 0; }

  // mines
  for (const m of mines) {
    m.x = m.x0 + Math.sin(t * m.sp + m.ph) * m.amp;
    if (Math.hypot(m.x - p.x, m.y - p.y) < m.r + 7) { die(); return; }
  }
  if (p.y > camY + H + 12) { die(); return; }

  // cleanup
  const lim = camY + H + 150;
  if (magnets.length > 40) magnets = magnets.filter(m => m.y < lim);
  if (shards.length > 40) shards = shards.filter(s => !s.got && s.y < lim);
  if (mines.length > 30) mines = mines.filter(m => m.y < lim);
}

function stepParts(dt) {
  for (const q of parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= .96; q.vy *= .96; q.life -= dt; }
  parts = parts.filter(q => q.life > 0);
  for (const q of trail) q.life -= dt * 1.6;
  trail = trail.filter(q => q.life > 0);
  if (shake > 0) shake = Math.max(0, shake - dt * 30);
}

// ---------- render ----------
function glow(x, y, r, col, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = a; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1;
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#07071a'; ctx.fillRect(0, 0, cv.width, cv.height);
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
    if (m.y < top || m.y > bot) continue;
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
    glow(p.x, p.y, 34 + p.flip * 22, pc, .75);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 6.283); ctx.fill();
    ctx.strokeStyle = pc; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.fillStyle = pc; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.s > 0 ? '+' : '−', p.x, p.y + 1);
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
    else { step(dt / 2); step(dt / 2); stepParts(dt); }
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
