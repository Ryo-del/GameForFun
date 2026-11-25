(() => {
'use strict';
const KEY = 'chikava-save-v1';
const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
const stage = $('stage');

// ---------- state ----------
const RATES = { hunger: 100/ (4*3600), fun: 100/(5*3600), clean: 100/(6*3600), energy: 100/(8*3600) }; // per second
let S = load() || { hunger: 80, fun: 80, clean: 80, energy: 80, sleeping: false, poops: 0, born: Date.now(), last: Date.now(), sound: true };

function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function save() { S.last = Date.now(); localStorage.setItem(KEY, JSON.stringify(S)); }
const clamp = v => Math.max(0, Math.min(100, v));

function tick(sec) {
  if (S.sleeping) {
    S.energy = clamp(S.energy + sec * 100/1800);
    S.hunger = clamp(S.hunger - sec * RATES.hunger * .4);
    S.fun = clamp(S.fun - sec * RATES.fun * .3);
    if (S.energy >= 100) S.sleeping = false;
  } else {
    S.hunger = clamp(S.hunger - sec * RATES.hunger);
    S.fun = clamp(S.fun - sec * RATES.fun * (S.poops ? 1.5 : 1));
    S.energy = clamp(S.energy - sec * RATES.energy);
    S.clean = clamp(S.clean - sec * RATES.clean * (1 + S.poops * .5));
    if (Math.random() < sec / 2400 && S.poops < 3) S.poops++;
  }
}
// offline progress (capped at 12h, no random poops explosion)
{ const away = Math.min(12*3600, (Date.now() - S.last) / 1000); if (away > 5) { for (let i = 0; i < 60; i++) tick(away / 60); } }

// ---------- audio ----------
let ac;
function beep(f, d = .12, type = 'sine', vol = .08, slide = 0) {
  if (!S.sound) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f;
    if (slide) o.frequency.linearRampToValueAtTime(f + slide, ac.currentTime + d);
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + d);
    o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + d);
  } catch {}
}
const sfx = {
  eat: () => { beep(520, .08); setTimeout(() => beep(660, .1), 90); },
  love: () => { beep(700, .15, 'sine', .08, 300); },
  splash: () => { beep(300, .2, 'triangle', .06, 400); },
  sad: () => beep(300, .3, 'sine', .08, -120),
  pop: () => beep(900, .06, 'square', .04),
};

// ---------- fx ----------
let W = 0, H = 0, DPR = 1;
const parts = [];     // floating emoji / bubbles
let anim = null;      // current action animation {type, t, dur}
let t0 = performance.now(), blinkAt = 0, bounce = 0;
const pet = { x: 0, y: 0, vx: 0, tx: 0, dir: 1 };

function say(text, ms = 1800) {
  const m = $('msg'); m.textContent = text; m.classList.add('show');
  clearTimeout(say.t); say.t = setTimeout(() => m.classList.remove('show'), ms);
}
function spawn(ch, x, y, o = {}) {
  parts.push({ ch, x, y, vx: o.vx ?? (Math.random() - .5) * 40, vy: o.vy ?? -50 - Math.random() * 30, life: o.life ?? 1.4, age: 0, size: o.size ?? 26, g: o.g ?? 0 });
}
function start(type, dur) { anim = { type, t: 0, dur }; }

// ---------- actions ----------
function act(name) {
  if (S.sleeping && name !== 'sleep') { say('Тсс… Чикава спит 💤'); return; }
  if (name === 'feed') {
    if (S.hunger > 95) { say('Чикава не голодна'); return; }
    const food = ['🍙', '🍓', '🍪', '🍡'][Math.random() * 4 | 0];
    start('feed', 1.2);
    spawn(food, pet.x, pet.y - H * .35, { vx: 0, vy: 90, g: 0, life: .7, size: 34 });
    setTimeout(() => { S.hunger = clamp(S.hunger + 28); S.fun = clamp(S.fun + 4); sfx.eat(); for (let i = 0; i < 4; i++) spawn('✨', pet.x, pet.y - H * .12); say('Ням-ням!'); update(); }, 700);
  } else if (name === 'play') {
    if (S.energy < 12) { say('Слишком устала…'); return; }
    start('play', 1.6);
    spawn('🎾', pet.x + 50, pet.y - 20, { vx: 0, vy: 0, life: 1.6, size: 30 });
    setTimeout(() => { S.fun = clamp(S.fun + 26); S.energy = clamp(S.energy - 10); S.hunger = clamp(S.hunger - 5); sfx.love(); for (let i = 0; i < 5; i++) spawn('💖', pet.x, pet.y - H * .15); say('Ура, играем!'); update(); }, 900);
  } else if (name === 'wash') {
    if (S.clean > 95 && !S.poops) { say('Чикава и так чистая'); return; }
    start('wash', 1.6);
    for (let i = 0; i < 14; i++) setTimeout(() => spawn('🫧', pet.x + (Math.random() - .5) * 120, pet.y - Math.random() * H * .2, { vy: -30, life: 1.2, size: 20 + Math.random() * 14 }), i * 80);
    setTimeout(() => { S.clean = clamp(S.clean + 45); S.fun = clamp(S.fun - 3); sfx.splash(); say('Чистенькая!'); update(); }, 1200);
  } else if (name === 'sleep') {
    S.sleeping = !S.sleeping; sfx.pop();
    say(S.sleeping ? 'Спокойной ночи 🌙' : 'Доброе утро!');
  }
  update(); save();
}
document.querySelectorAll('#actions button').forEach(b => b.addEventListener('click', () => act(b.dataset.act)));
$('sound').addEventListener('click', () => { S.sound = !S.sound; update(); save(); sfx.pop(); });

cv.addEventListener('pointerdown', e => {
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  // poop cleanup
  for (let i = 0; i < S.poops; i++) {
    const px = W * (.18 + i * .2), py = H * .8;
    if (Math.hypot(x - px, y - py) < 36) { S.poops--; S.clean = clamp(S.clean + 6); sfx.pop(); spawn('✨', px, py); update(); save(); return; }
  }
  if (Math.hypot(x - pet.x, y - (pet.y - H * .12)) < H * .2 && !S.sleeping) {
    bounce = 1; S.fun = clamp(S.fun + 2); sfx.love();
    spawn('💗', pet.x + (Math.random() - .5) * 40, pet.y - H * .3);
    update();
  }
});

// ---------- ui ----------
function update() {
  const set = (id, v) => { $(id).style.width = v + '%'; $(id).parentElement.parentElement.classList.toggle('low', v < 25); };
  set('s-hunger', S.hunger); set('s-fun', S.fun); set('s-energy', S.energy); set('s-clean', S.clean);
  const days = Math.floor((Date.now() - S.born) / 864e5) + 1;
  $('age').textContent = `день ${days}`;
  $('sound').textContent = S.sound ? '🔊' : '🔇';
  stage.classList.toggle('night', S.sleeping);
  document.querySelector('[data-act=sleep]').classList.toggle('on', S.sleeping);
  document.querySelector('[data-act=sleep] em').textContent = S.sleeping ? '☀️' : '🌙';
}

function mood() {
  if (S.sleeping) return 'sleep';
  const m = Math.min(S.hunger, S.fun, S.clean, S.energy);
  if (m < 20) return 'sad';
  if (S.hunger < 35) return 'hungry';
  if (S.energy < 25) return 'tired';
  if (m > 60) return 'happy';
  return 'ok';
}

// ---------- render ----------
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  const r = stage.getBoundingClientRect(); W = r.width; H = r.height;
  cv.width = W * DPR; cv.height = H * DPR;
  pet.x = pet.tx = W / 2; pet.y = H * .76;
}
window.addEventListener('resize', resize);

function drawChikava(time) {
  const m = mood(), s = Math.min(W, H * .85) / 340 * 1.35;
  const breathe = Math.sin(time * 2) * (m === 'sleep' ? 4 : 2);
  let jump = 0, tilt = 0, sx = 1, sy = 1;
  if (bounce > 0) { jump += Math.sin((1 - bounce) * Math.PI) * 30; bounce = Math.max(0, bounce - .05); }
  if (anim) {
    const p = anim.t / anim.dur;
    if (anim.type === 'play') jump += Math.abs(Math.sin(p * Math.PI * 4)) * 40;
    if (anim.type === 'wash') tilt = Math.sin(time * 30) * .06;
    if (anim.type === 'feed') { sy = 1 + Math.sin(p * Math.PI * 6) * .04; }
  }
  if (m === 'happy' && !anim) jump += Math.max(0, Math.sin(time * 3)) * 6;

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.12)';
  ctx.beginPath(); ctx.ellipse(pet.x, pet.y + 6, 70 * s * (1 - jump / 200), 12 * s, 0, 0, 7); ctx.fill();

  ctx.save();
  ctx.translate(pet.x, pet.y - jump); ctx.rotate(tilt); ctx.scale(s * sx, s * sy * (1 + breathe / 100));
  ctx.lineWidth = 4; ctx.strokeStyle = '#6b4a55'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const white = '#fffaf6';

  // ears
  ctx.fillStyle = white;
  for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(d * 42, -128, 18, 26, d * .25, 0, 7); ctx.fill(); ctx.stroke(); }
  // tail-ish feet
  for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(d * 32, -4, 24, 14, 0, 0, 7); ctx.fill(); ctx.stroke(); }
  // body
  ctx.beginPath();
  ctx.moveTo(-62, -30); ctx.bezierCurveTo(-90, -90, -70, -150, 0, -152);
  ctx.bezierCurveTo(70, -150, 90, -90, 62, -30); ctx.bezierCurveTo(40, -8, -40, -8, -62, -30);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // arms
  const wave = m === 'happy' ? Math.sin(time * 6) * .3 : 0;
  for (const d of [-1, 1]) { ctx.save(); ctx.translate(d * 62, -78); ctx.rotate(d * (.5 + (d > 0 ? wave : 0))); ctx.beginPath(); ctx.ellipse(0, 6, 12, 20, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore(); }

  // face
  const face = '#4a3038';
  const blink = (time % 4 < .15);
  ctx.fillStyle = face; ctx.strokeStyle = face; ctx.lineWidth = 4;
  const ey = -92;
  if (m === 'sleep' || blink) {
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.arc(d * 26, ey, 8, .15 * Math.PI, .85 * Math.PI); ctx.stroke(); }
  } else if (m === 'happy') {
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.arc(d * 26, ey + 6, 9, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke(); }
  } else {
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(d * 26, ey, 5.5, m === 'tired' ? 3 : 8, 0, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#fff';
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.arc(d * 26 + 2, ey - 2, 2, 0, 7); ctx.fill(); }
    if (m === 'sad') { ctx.strokeStyle = '#7bb7ff'; ctx.lineWidth = 3; for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(d * 30, ey + 10); ctx.quadraticCurveTo(d * 34, ey + 26, d * 30, ey + 34); ctx.stroke(); } }
  }
  // blush
  ctx.fillStyle = 'rgba(255,140,170,.55)';
  for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(d * 46, -68, 11, 7, 0, 0, 7); ctx.fill(); }
  // mouth
  ctx.strokeStyle = face; ctx.lineWidth = 3.5; ctx.fillStyle = '#ff9aa8';
  const eating = anim && anim.type === 'feed' && anim.t > .5;
  ctx.beginPath();
  if (eating) { ctx.ellipse(0, -66, 9, 7 + Math.abs(Math.sin(time * 18)) * 5, 0, 0, 7); ctx.fill(); ctx.stroke(); }
  else if (m === 'happy') { ctx.arc(0, -72, 11, .1 * Math.PI, .9 * Math.PI); ctx.stroke(); }
  else if (m === 'sad' || m === 'hungry') { ctx.arc(0, -56, 9, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke(); }
  else if (m === 'sleep') { ctx.ellipse(0, -64, 4, 3, 0, 0, 7); ctx.stroke(); }
  else { ctx.arc(0, -70, 7, .15 * Math.PI, .85 * Math.PI); ctx.stroke(); }
  // dirt
  if (S.clean < 35) { ctx.fillStyle = 'rgba(120,90,60,.35)'; [[-40,-40,8],[30,-30,6],[48,-100,5],[-10,-20,7]].forEach(([x,y,r]) => { ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill(); }); }
  ctx.restore();

  if (m === 'sleep' && Math.random() < .02) spawn('💤', pet.x + 50, pet.y - H * .35, { vx: 10, vy: -25, life: 2, size: 22 });
  if (m === 'sad' && Math.random() < .01) spawn('💧', pet.x + 30, pet.y - H * .25, { vy: 20, life: 1 });
}

function frame(now) {
  const dt = Math.min(.05, (now - t0) / 1000); t0 = now;
  const time = now / 1000;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // decoration
  ctx.font = '28px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (S.sleeping) { ctx.fillText('🌙', W * .8, H * .14); ctx.font = '14px serif'; [[.2,.1],[.4,.2],[.65,.08],[.9,.3],[.1,.35]].forEach(([a,b],i)=>{ctx.globalAlpha=.5+.5*Math.sin(time*2+i);ctx.fillText('✦',W*a,H*b)}); ctx.globalAlpha = 1; }
  else { ctx.fillText('☀️', W * .82, H * .13); ctx.font = '34px serif'; ctx.fillText('☁️', ((time * 8) % (W + 100)) - 50, H * .2); }
  ctx.font = '22px serif'; ctx.fillText('🌷', W * .08, H * .66); ctx.fillText('🌼', W * .93, H * .7); ctx.fillText('🌱', W * .88, H * .9);

  if (anim) { anim.t += dt; if (anim.t >= anim.dur) anim = null; }
  tick(dt);
  if (Math.floor(time) !== frame.sec) { frame.sec = Math.floor(time); update(); if (frame.sec % 5 === 0) save(); }

  // poops
  ctx.font = '30px serif';
  for (let i = 0; i < S.poops; i++) ctx.fillText('💩', W * (.18 + i * .2), H * .8);

  drawChikava(time);

  // particles
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.age += dt;
    if (p.age > p.life) { parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt;
    ctx.globalAlpha = Math.min(1, (p.life - p.age) * 2);
    ctx.font = p.size + 'px serif'; ctx.fillText(p.ch, p.x, p.y);
  }
  ctx.globalAlpha = 1;

  // idle chatter
  if (!frame.nextSay || now > frame.nextSay) {
    frame.nextSay = now + 9000 + Math.random() * 6000;
    const lines = { hungry: 'Хочу кушать… 🍙', sad: 'Мне грустно…', tired: 'Так хочется спать…', happy: 'Чика-чика! ♪', ok: 'Привет!' };
    const m = mood(); if (lines[m] && now > 3000) say(lines[m]);
    if (m === 'sad' || m === 'hungry') sfx.sad();
  }
  requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else { const away = Math.min(12*3600, (Date.now() - S.last) / 1000); if (away > 5) for (let i = 0; i < 60; i++) tick(away / 60); t0 = performance.now(); } });
window.addEventListener('pagehide', save);
resize(); update();
requestAnimationFrame(t => { t0 = t; requestAnimationFrame(frame); });
})();
