'use strict';

/* ---------- Doimiylar va holat ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const STEPS = 16;
const DR = ['Kick', 'Snare', 'Hat', 'Clap', 'Bas'];
const COL = ['#ff7a2f', '#ff8fc1', '#ffd23f', '#7ef0c4', '#c7b6ff'];
const SC = [0, 3, 5, 7, 10, 12, 15, 17];          // minor pentatonika (yarim tonlar)
const ROOT = 57;                                   // A3
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const noteName = (m) => NOTES[m % 12] + (Math.floor(m / 12) - 1);
const melMidi = (r) => ROOT + 12 + SC[r];

const empty = () => ({ d: DR.map(() => Array(STEPS).fill(0)), m: SC.map(() => Array(STEPS).fill(0)) });
let st = empty();
let bpm = 100, swing = 0, vol = 0.8, echo = 0.25;
let playing = false, step = 0, nextT = 0, timer = 0, curCol = -1;
const queue = [];
const P = { wave: 'sawtooth', cut: 2400, rel: 0.3 };
let ac, master, analyser, delay, wet, noiseBuf;

/* ---------- Audio ---------- */
function init() {
  if (ac) return;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  master = ac.createGain(); master.gain.value = vol;
  const comp = ac.createDynamicsCompressor();
  analyser = ac.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.8;
  delay = ac.createDelay(1);
  const fb = ac.createGain(); fb.gain.value = 0.38;
  wet = ac.createGain(); wet.gain.value = echo;
  delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);
  master.connect(comp); comp.connect(analyser); analyser.connect(ac.destination);
  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  updateDelay();
}
const updateDelay = () => { if (delay) delay.delayTime.value = (60 / bpm) * 0.75; }; // nuqtali sakkizlik

function env(g, t, a, d, peak) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function noise(t, dur, type, f, peak) {
  const s = ac.createBufferSource(); s.buffer = noiseBuf;
  const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f;
  const g = ac.createGain(); env(g, t, 0.002, dur, peak);
  s.connect(fl).connect(g).connect(master);
  s.start(t); s.stop(t + dur + 0.05);
}
function tone(t, type, f0, f1, dur, peak) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
  env(g, t, 0.003, dur, peak);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function note(t, midi, dur, peak) {
  const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
  o.type = P.wave; o.frequency.value = mtof(midi);
  f.type = 'lowpass'; f.frequency.value = P.cut;
  env(g, t, 0.01, dur, peak || 0.22);
  o.connect(f).connect(g); g.connect(master); g.connect(delay);
  o.start(t); o.stop(t + dur + 0.1);
}
const VOICES = [
  (t) => tone(t, 'sine', 160, 42, 0.38, 1),
  (t) => { noise(t, 0.18, 'highpass', 1800, 0.55); tone(t, 'triangle', 200, 120, 0.1, 0.5); },
  (t) => noise(t, 0.05, 'highpass', 7500, 0.3),
  (t) => { [0, 0.012, 0.024].forEach((o) => noise(t + o, 0.02, 'bandpass', 1300, 0.5)); noise(t + 0.036, 0.16, 'bandpass', 1300, 0.45); },
  (t) => { const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'sawtooth'; o.frequency.value = mtof(ROOT - 24);
    f.type = 'lowpass'; f.frequency.value = 320; env(g, t, 0.01, 0.28, 0.6);
    o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 0.4); }
];

/* ---------- Rejalashtiruvchi ---------- */
function schedule(s, t) {
  const sd = 60 / bpm / 4;
  const tt = s % 2 ? t + swing * sd * 0.6 : t;
  DR.forEach((_, i) => { if (st.d[i][s]) VOICES[i](tt); });
  SC.forEach((_, r) => { if (st.m[r][s]) note(tt, melMidi(r), P.rel, 0.2); });
  queue.push({ s, t: tt });
}
function tick() {
  while (nextT < ac.currentTime + 0.12) {
    schedule(step, nextT);
    nextT += 60 / bpm / 4;
    step = (step + 1) % STEPS;
  }
  timer = setTimeout(tick, 25);
}
function toggle() {
  init(); ac.resume();
  playing = !playing;
  const b = $('#play');
  if (playing) { step = 0; nextT = ac.currentTime + 0.06; tick(); b.textContent = "To'xtatish"; }
  else { clearTimeout(timer); queue.length = 0; head(-1); b.textContent = 'Boshlash'; }
  b.setAttribute('aria-pressed', playing);
}

/* ---------- Sekvenser interfeysi ---------- */
const cols = Array.from({ length: STEPS }, () => []);
function build() {
  const seq = $('#seq'); seq.innerHTML = '';
  cols.forEach((c) => (c.length = 0));
  const addRow = (label, color, kind, r, gap) => {
    const row = document.createElement('div');
    row.className = 'row' + (gap ? ' gap' : ''); row.style.setProperty('--c', color);
    const l = document.createElement('span'); l.textContent = label; row.append(l);
    for (let c = 0; c < STEPS; c++) {
      const b = document.createElement('button');
      b.className = 'cell' + (c % 4 === 0 ? ' q' : '');
      b.dataset.k = kind; b.dataset.r = r; b.dataset.c = c;
      b.setAttribute('aria-label', label + ', ' + (c + 1) + '-qadam');
      row.append(b); cols[c].push(b);
    }
    seq.append(row);
  };
  DR.forEach((n, i) => addRow(n, COL[i], 'd', i, false));
  for (let r = SC.length - 1; r >= 0; r--) addRow(noteName(melMidi(r)), '#8fd3ff', 'm', r, r === SC.length - 1);
  refresh();
}
function refresh() {
  $$('.cell').forEach((b) => {
    const on = st[b.dataset.k][b.dataset.r][b.dataset.c];
    b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', !!on);
  });
}
function head(c) {
  if (curCol >= 0) cols[curCol].forEach((b) => b.classList.remove('now'));
  if (c >= 0) cols[c].forEach((b) => b.classList.add('now'));
  curCol = c;
}
$('#seq').addEventListener('click', (e) => {
  const b = e.target.closest('.cell'); if (!b) return;
  const { k, r, c } = b.dataset;
  st[k][r][c] = st[k][r][c] ? 0 : 1;
  b.classList.toggle('on', !!st[k][r][c]);
  b.setAttribute('aria-pressed', !!st[k][r][c]);
  if (st[k][r][c]) { init(); ac.resume(); const t = ac.currentTime; k === 'd' ? VOICES[r](t) : note(t, melMidi(+r), P.rel); }
});

/* ---------- Tayyor ritmlar ---------- */
const PRE = {
  'Lo-fi':   { bpm: 76,  sw: 35, d: ['x.....x..x......', '....x.......x...', 'x.x.x.x.x.x.x.x.', '................', 'x.....x..x......'],
               m: [[4, 0], [3, 3], [2, 6], [4, 8], [1, 10], [2, 12], [0, 14]] },
  'Hip-hop': { bpm: 92,  sw: 20, d: ['x...x...x..x....', '....x.......x...', 'x.xxx.xxx.xxx.x.', '................', 'x.....x...x.....'],
               m: [[5, 2], [3, 5], [4, 7], [2, 10], [3, 13], [1, 15]] },
  'Texno':   { bpm: 128, sw: 0,  d: ['x...x...x...x...', '................', '..x...x...x...x.', '....x.......x...', '.xx..xx..xx..xx.'],
               m: [[7, 0], [5, 2], [7, 4], [4, 6], [7, 8], [5, 10], [6, 12], [4, 14]] },
  'Disko':   { bpm: 118, sw: 10, d: ['x...x...x...x...', '................', '.x.x.x.x.x.x.x.x', '....x.......x...', 'x.x.x.x.x.x.x.x.'],
               m: [[3, 1], [5, 3], [6, 5], [5, 7], [3, 9], [4, 11], [6, 13], [7, 15]] }
};
function setCtl(id, v) { const el = $('#' + id); el.value = v; el.dispatchEvent(new Event('input')); }
function loadPreset(name) {
  const p = PRE[name]; st = empty();
  p.d.forEach((s, i) => [...s].forEach((ch, c) => (st.d[i][c] = ch === 'x' ? 1 : 0)));
  p.m.forEach(([r, c]) => (st.m[r][c] = 1));
  setCtl('bpm', p.bpm); setCtl('swing', p.sw);
  $$('#presets .btn').forEach((b) => b.classList.toggle('sel', b.textContent === name));
  refresh();
}
Object.keys(PRE).forEach((n) => {
  const b = document.createElement('button');
  b.className = 'btn'; b.textContent = n; b.onclick = () => loadPreset(n);
  $('#presets').append(b);
});

/* ---------- Tugmalar ---------- */
const say = (t) => { $('#msg').textContent = t; clearTimeout(say.t); say.t = setTimeout(() => ($('#msg').textContent = ''), 2200); };
$('#play').onclick = toggle;
$('#clr').onclick = () => { st = empty(); refresh(); $$('#presets .btn').forEach((b) => b.classList.remove('sel')); };
$('#rnd').onclick = () => {
  const p = [0.32, 0.2, 0.55, 0.15, 0.3]; st = empty();
  st.d.forEach((r, i) => { for (let c = 0; c < STEPS; c++) r[c] = Math.random() < p[i] * (c % 4 === 0 && i !== 2 ? 1.7 : 1) ? 1 : 0; });
  st.d[0][0] = 1;
  for (let n = 0; n < 7;) {
    const c = Math.floor(Math.random() * STEPS), r = Math.floor(Math.random() * SC.length);
    if (!st.m[r][c]) { st.m[r][c] = 1; n++; }
  }
  $$('#presets .btn').forEach((b) => b.classList.remove('sel')); refresh();
};
$('#save').onclick = () => {
  try { localStorage.setItem('ritm.v1', JSON.stringify({ st, bpm, swing })); say('Saqlandi'); }
  catch (e) { say('Saqlab bo\'lmadi'); }
};

/* Sliderlar */
function bind(id, fn, fmt) {
  const el = $('#' + id), out = el.parentElement.querySelector('output');
  const run = () => { fn(+el.value); out.textContent = fmt(+el.value); };
  el.addEventListener('input', run); run();
}
bind('bpm', (v) => { bpm = v; updateDelay(); }, (v) => v);
bind('swing', (v) => (swing = v / 100), (v) => v + '%');
bind('vol', (v) => { vol = v / 100; if (master) master.gain.value = vol; }, (v) => v + '%');
bind('echo', (v) => { echo = v / 100; if (wet) wet.gain.value = echo; }, (v) => v + '%');
bind('cut', (v) => (P.cut = v), (v) => v);
bind('rel', (v) => (P.rel = v / 100), (v) => (v / 100).toFixed(2) + 's');

/* Sintezator tovushi */
const WAVES = { sawtooth: 'Arra', square: "To'rtburchak", triangle: 'Uchburchak', sine: 'Sinus' };
Object.entries(WAVES).forEach(([k, n]) => {
  const b = document.createElement('button');
  b.className = 'btn' + (k === P.wave ? ' sel' : ''); b.textContent = n;
  b.onclick = () => { P.wave = k; $$('#waves .btn').forEach((x) => x.classList.toggle('sel', x === b)); };
  $('#waves').append(b);
});

/* Klaviatura */
const KEYS = 'asdfghjk';
const keyBtns = [...KEYS].map((ch, i) => {
  const b = document.createElement('button');
  b.className = 'key'; b.innerHTML = ch.toUpperCase() + '<small>' + noteName(melMidi(i)) + '</small>';
  b.addEventListener('pointerdown', () => press(i));
  $('#keys').append(b); return b;
});
function press(i) {
  init(); ac.resume(); note(ac.currentTime, melMidi(i), P.rel, 0.28);
  keyBtns[i].classList.add('hit'); setTimeout(() => keyBtns[i].classList.remove('hit'), 120);
}
addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey) return;
  const i = KEYS.indexOf(e.key.toLowerCase());
  if (i >= 0 && e.key.length === 1) return press(i);
  if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); toggle(); }
});

/* ---------- Vizualizatsiya ---------- */
const cv = $('#viz'), cx = cv.getContext('2d');
function fit() { const d = Math.min(devicePixelRatio || 1, 2); cv.width = cv.clientWidth * d; cv.height = cv.clientHeight * d; cx.setTransform(d, 0, 0, d, 0, 0); }
addEventListener('resize', fit); fit();

function frame() {
  if (ac) {
    while (queue.length && queue[0].t <= ac.currentTime) head(queue.shift().s);
  }
  const w = cv.clientWidth, h = cv.clientHeight;
  cx.clearRect(0, 0, w, h);
  if (analyser) {
    const f = new Uint8Array(analyser.frequencyBinCount), t = new Uint8Array(analyser.fftSize);
    analyser.getByteFrequencyData(f); analyser.getByteTimeDomainData(t);
    const n = 40, bw = w / n;
    for (let i = 0; i < n; i++) {
      const v = f[Math.floor(Math.pow(i / n, 1.6) * 260) + 1] / 255;
      cx.fillStyle = COL[i % COL.length]; cx.globalAlpha = 0.9;
      const bh = Math.max(3, v * h * 0.85);
      cx.beginPath(); cx.roundRect(i * bw + 2, h - bh - 8, bw - 4, bh, 4); cx.fill();
    }
    cx.globalAlpha = 1; cx.strokeStyle = '#fff'; cx.lineWidth = 2; cx.beginPath();
    for (let i = 0; i < t.length; i += 4) {
      const x = i / t.length * w, y = h / 2 + (t[i] - 128) / 128 * h * 0.3;
      i ? cx.lineTo(x, y) : cx.moveTo(x, y);
    }
    cx.stroke();
  } else {
    cx.strokeStyle = 'rgba(255,255,255,.5)'; cx.lineWidth = 2;
    cx.beginPath(); cx.moveTo(16, h / 2); cx.lineTo(w - 16, h / 2); cx.stroke();
    cx.fillStyle = '#fff'; cx.font = '600 14px Outfit, sans-serif'; cx.textAlign = 'center';
    cx.fillText('Boshlash tugmasini bosing', w / 2, h / 2 - 14);
  }
  requestAnimationFrame(frame);
}

/* ---------- Ishga tushirish ---------- */
build();
let saved = null;
try { saved = JSON.parse(localStorage.getItem('ritm.v1')); } catch (e) { /* yo'q */ }
if (saved && saved.st) { st = saved.st; setCtl('bpm', saved.bpm); setCtl('swing', Math.round(saved.swing * 100)); refresh(); }
else loadPreset('Lo-fi');
requestAnimationFrame(frame);
