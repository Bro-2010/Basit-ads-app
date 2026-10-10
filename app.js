/* Basit Ads – Pro Video Ad Editor. Everything runs in the browser: no API, no backend. */
(() => {
'use strict';

/* ---------- Setup ---------- */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const canvas = $('#canvas');
const ctx = canvas.getContext('2d');
const mediaHost = $('#mediaHost');
const tlScroll = $('#tlScroll');
const tlInner = $('#tlInner');
const bgCanvas = document.createElement('canvas');
const bgCtx = bgCanvas.getContext('2d');

const FILTERS = {
  none: 'none',
  vivid: 'saturate(1.6) contrast(1.1)',
  punch: 'contrast(1.25) saturate(1.1) brightness(1.02)',
  warm: 'sepia(0.25) saturate(1.25) brightness(1.05)',
  cool: 'hue-rotate(-14deg) saturate(1.15) brightness(1.04)',
  vintage: 'sepia(0.45) contrast(0.9) brightness(0.95)',
  bw: 'grayscale(1) contrast(1.15)'
};
const FONTS = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  impact: 'Impact, "Arial Narrow Bold", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace'
};
const DIMS = { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [1080, 1080], '4:5': [1080, 1350] };
const ASPECT_NOTES = { '9:16': 'Shorts, Reels, TikTok', '16:9': 'YouTube, web, landscape', '1:1': 'Feed, square posts', '4:5': 'Instagram feed, portrait' };
const BITRATE = { draft: 2500000, standard: 6000000, high: 12000000 };
const CAT_LABEL = { sfx: 'Sound effect', loop: 'Loop', ambient: 'Ambient', mine: 'My upload' };

/* ---------- State ---------- */
// Timeline time (S.t) runs across the whole sequence. Clips sit back to back.
const S = {
  clips: [], selClip: null, activeClip: null, sounds: [], customSounds: [],
  total: 0, outFull: true,
  t: 0, inT: 0, outT: 0, playing: false, loop: true, zoom: 40,
  aspect: '9:16', fit: 'fit', filter: 'none', bright: 1, contrast: 1, sat: 1,
  clipVol: 1, fadeIn: 0, fadeOut: 0,
  kenBurns: true, xfade: 0.5, imgDur: 3,
  layers: [], selLayer: null,
  logo: null, logoUrl: null, logoPos: 'tr', logoW: 18, logoOp: 0.9,
  overlays: [], undo: [],
  ec: { on: false, dur: 3, head: 'Your brand, one tap away', sub: 'Start today', cta: 'Shop now', url: 'yourwebsite.com', color: '#7c5cff' },
  quality: 'standard', fps: 30, showSafe: false, showThirds: false,
  exporting: false, objectUrl: null
};

let audioCtx = null, audioMix = null, clipGain = null, soundGain = null;
let beatTimer = null, activeSrc = [];
let rec = null, chunks = [], recDest = null, recMime = '';
let toastTimer;
let lastNow = performance.now();
let needFrame = true, lastDraw = 0;
// A video finishing a seek or loading a frame means the picture needs one redraw.
['seeked', 'loadeddata'].forEach(ev => document.addEventListener(ev, () => { needFrame = true; }, true));

/* ---------- Helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const fmt = s => {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};
const rr = (c, x, y, w, h, r) => {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
};
function label(c, str, x, y, px, color = '#fff', weight = 800) {
  c.fillStyle = color;
  c.font = `${weight} ${px}px ${FONTS.sans}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(str, x, y);
}
function wrap(c, text, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (line && c.measureText(test).width > maxW) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
function drawImageFit(c, img, iw, ih, W, H, mode) {
  const k = mode === 'cover' ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
  const dw = iw * k, dh = ih * k;
  c.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const getPath = (o, p) => p.split('.').reduce((a, k) => a[k], o);
function setPath(o, p, v) {
  const ks = p.split('.');
  const last = ks.pop();
  ks.reduce((a, k) => a[k], o)[last] = v;
}
function fadeFactor(rel, len, fi, fo) {
  let f = 1;
  if (fi > 0) f = Math.min(f, clamp(rel / fi));
  if (fo > 0) f = Math.min(f, clamp((len - rel) / fo));
  return f;
}

/* ---------- Audio graph ---------- */
function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioMix = audioCtx.createGain();
    audioMix.connect(audioCtx.destination);
    clipGain = audioCtx.createGain();
    clipGain.connect(audioMix);
    soundGain = audioCtx.createGain();
    soundGain.connect(audioMix);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  S.clips.forEach(attachAudio);
}
function attachAudio(c) {
  if (audioCtx && c.type === 'video' && !c.node) {
    c.node = audioCtx.createMediaElementSource(c.el);
    c.node.connect(clipGain);
  }
}
function applyAudioLevels() {
  const rel = Math.max(0, S.t - S.inT), len = Math.max(0.01, S.outT - S.inT);
  clipGain.gain.value = S.clipVol * fadeFactor(rel, len, S.fadeIn, S.fadeOut);
}

// Sample clips have no audio element, so they get a soft beat while playing.
function startBeat() {
  stopBeat();
  beatTimer = setInterval(() => {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'triangle';
    o.frequency.value = 180;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.3, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    o.connect(g).connect(clipGain);
    o.start(now);
    o.stop(now + 0.2);
  }, 500);
}
function stopBeat() { clearInterval(beatTimer); beatTimer = null; }

/* ---------- Built-in sound library (generated in the browser) ---------- */
function tone(c, type, f, t0, dur, vol = 0.5, fEnd = null) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}
function noise(c, t0, dur, vol, type = 'highpass', freq = 1000, sustain = false) {
  const len = Math.max(1, Math.ceil(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource();
  s.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = c.createGain();
  if (sustain) {
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.5);
    g.gain.setValueAtTime(vol, t0 + dur - 0.5);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
  } else {
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  s.connect(f).connect(g).connect(c.destination);
  s.start(t0);
  s.stop(t0 + dur);
}
function sweepNoise(c, t0, dur, f0, f1, vol) {
  const len = Math.ceil(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource();
  s.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(f0, t0);
  bp.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(bp).connect(g).connect(c.destination);
  s.start(t0);
  s.stop(t0 + dur);
}
function drumBar(c) {
  [0, 0.5, 1, 1.5].forEach(t => tone(c, 'sine', 150, t, 0.25, 0.9, 45));
  [0.5, 1.5].forEach(t => noise(c, t, 0.18, 0.4, 'highpass', 1800));
  for (let i = 0; i < 8; i++) noise(c, i * 0.25, 0.04, 0.18, 'highpass', 7000);
}
function upbeatLoop(c) {
  const chords = [[261, 329, 392], [196, 247, 293], [220, 262, 329], [175, 220, 262]];
  const order = [0, 1, 2, 1];
  chords.forEach((ch, bar) => {
    tone(c, 'square', ch[0] / 2, bar, 0.9, 0.07);
    for (let i = 0; i < 4; i++) tone(c, 'sine', ch[order[i]] * 2, bar + i * 0.25, 0.22, 0.18);
  });
}
function padLoop(c) {
  const a = [262, 330, 392, 494], b = [220, 277, 330, 415];
  [a, b].forEach((chord, half) => {
    chord.forEach(f => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const t0 = half * 4;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.06, t0 + 1.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 4.5);
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + 4.6);
    });
  });
}

const BUILTIN = [
  { id: 'whoosh', name: 'Whoosh', cat: 'sfx', tags: 'swoosh transition sweep wind fast move', dur: 1.2, loop: false,
    synth: c => sweepNoise(c, 0, 1.2, 300, 3000, 0.9) },
  { id: 'ding', name: 'Ding bell', cat: 'sfx', tags: 'bell notification notice alert correct', dur: 1.6, loop: false,
    synth: c => { tone(c, 'sine', 1320, 0, 1.2, 0.4); tone(c, 'sine', 2640, 0, 0.8, 0.15); } },
  { id: 'pop', name: 'Pop', cat: 'sfx', tags: 'bubble button press tap bounce', dur: 0.4, loop: false,
    synth: c => tone(c, 'sine', 600, 0, 0.15, 0.6, 150) },
  { id: 'click', name: 'Click', cat: 'sfx', tags: 'tap button ui keyboard mouse', dur: 0.1, loop: false,
    synth: c => noise(c, 0, 0.03, 0.6, 'highpass', 3000) },
  { id: 'tick', name: 'Clock tick', cat: 'sfx', tags: 'clock timer countdown second time', dur: 0.2, loop: false,
    synth: c => tone(c, 'square', 1000, 0, 0.03, 0.2) },
  { id: 'cash', name: 'Cash register', cat: 'sfx', tags: 'money sale price buy shop purchase ka-ching', dur: 0.8, loop: false,
    synth: c => { tone(c, 'square', 2000, 0, 0.08, 0.25); tone(c, 'square', 2600, 0.1, 0.5, 0.25); noise(c, 0.1, 0.05, 0.3, 'highpass', 4000); } },
  { id: 'bass', name: 'Bass hit', cat: 'sfx', tags: 'boom impact hit drop cinematic kick', dur: 0.8, loop: false,
    synth: c => { tone(c, 'sine', 120, 0, 0.6, 0.9, 40); noise(c, 0, 0.2, 0.4, 'lowpass', 400); } },
  { id: 'chime', name: 'Success chime', cat: 'sfx', tags: 'success win done complete achievement ok positive', dur: 1.2, loop: false,
    synth: c => [523, 659, 784, 1047].forEach((f, i) => tone(c, 'sine', f, i * 0.12, 0.6, 0.3)) },
  { id: 'sparkle', name: 'Sparkle', cat: 'sfx', tags: 'magic shine glitter reveal star twinkle', dur: 1.6, loop: false,
    synth: c => { for (let i = 0; i < 8; i++) tone(c, 'sine', 1500 + Math.random() * 2000, i * 0.18 + Math.random() * 0.05, 0.3, 0.15); } },
  { id: 'rise', name: 'Riser', cat: 'sfx', tags: 'build up tension suspense rise intro', dur: 2, loop: false,
    synth: c => tone(c, 'triangle', 200, 0, 2, 0.25, 1200) },
  { id: 'applause', name: 'Crowd applause', cat: 'sfx', tags: 'clap cheer crowd celebration audience', dur: 3, loop: false,
    synth: c => { for (let i = 0; i < 70; i++) noise(c, Math.random() * 2.8 * (1 - i / 140), 0.03, 0.05 + Math.random() * 0.25, 'bandpass', 2200); } },
  { id: 'drums', name: 'Drum loop 120 BPM', cat: 'loop', tags: 'beat drums rhythm groove kick hihat percussion hip hop', dur: 2, loop: true,
    synth: drumBar },
  { id: 'upbeat', name: 'Upbeat synth loop', cat: 'loop', tags: 'happy energetic summer fun promo upbeat synth arpeggio', dur: 4, loop: true,
    synth: upbeatLoop },
  { id: 'pad', name: 'Chill pad', cat: 'ambient', tags: 'calm soft relaxed ambient background pad luxury', dur: 8, loop: true,
    synth: padLoop },
  { id: 'rain', name: 'Rain', cat: 'ambient', tags: 'rain weather nature storm ambient hiss', dur: 6, loop: true,
    synth: c => noise(c, 0, 6, 0.12, 'lowpass', 900, true) }
];

const bufferCache = new Map();
function renderDef(def) {
  if (!bufferCache.has(def.id)) {
    const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new Off(1, Math.ceil(44100 * def.dur), 44100);
    def.synth(off);
    bufferCache.set(def.id, off.startRendering());
  }
  return bufferCache.get(def.id);
}

/* ---------- Sound track playback ---------- */
function stopSounds() {
  activeSrc.forEach(n => { try { n.stop(); } catch (_) {} });
  activeSrc = [];
}
function scheduleSounds() {
  stopSounds();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  for (const s of S.sounds) {
    if (!s.buffer) continue;
    const end = s.start + s.length;
    if (end <= S.t) continue;
    const into = S.t - s.start;
    if (into > 0 && !s.loop && into >= s.buffer.duration) continue;
    const src = audioCtx.createBufferSource();
    src.buffer = s.buffer;
    src.loop = s.loop;
    const g = audioCtx.createGain();
    g.gain.value = s.vol;
    src.connect(g).connect(soundGain);
    if (s.start > S.t) {
      src.start(now + (s.start - S.t));
    } else {
      src.start(now, s.loop ? into % s.buffer.duration : into);
    }
    src.stop(now + (end - S.t));
    activeSrc.push(src);
  }
}

function addSoundItem({ name, buffer, defId, loop, length }) {
  const start = Math.round(Math.max(0, S.t) * 10) / 10;
  S.sounds.push({
    id: uid(), name, buffer, defId: defId || null, start,
    length: length || buffer.duration, vol: 1, loop: !!loop
  });
  renderSoundList();
  soundsChanged();
}
function soundsChanged() {
  if (S.playing) scheduleSounds();
  renderTimelineAll();
  refreshChecks();
}

async function addFromLibrary(d) {
  try {
    ensureAudio();
    const buffer = d.cat === 'mine' ? d.buffer : await renderDef(d);
    const length = d.loop ? Math.max(5, S.total - S.t) : undefined;
    addSoundItem({ name: d.name, buffer, defId: d.cat === 'mine' ? null : d.id, loop: d.loop, length });
    toast(`Added "${d.name}" at ${fmt(S.t)}`);
  } catch (err) {
    toast('That sound could not be added.');
  }
}

function renderLibrary() {
  const q = $('#libSearch').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const cat = $('#libCat').value;
  const all = [...BUILTIN, ...S.customSounds];
  const items = all.filter(d => {
    if (cat !== 'all' && d.cat !== cat) return false;
    const hay = (d.name + ' ' + d.tags + ' ' + CAT_LABEL[d.cat]).toLowerCase();
    return q.every(w => hay.includes(w));
  });
  const list = $('#libList');
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<p class="hint">No sounds match. Try "bell", "beat", "rain" or "cash", or upload your own.</p>';
    return;
  }
  items.forEach(d => {
    const row = document.createElement('div');
    row.className = 'lib-row';
    row.innerHTML = '<div><b></b><span></span></div><button type="button">+ Add</button>';
    row.querySelector('b').textContent = d.name;
    row.querySelector('span').textContent = `${CAT_LABEL[d.cat]} · ${d.dur.toFixed(1)}s${d.loop ? ' · loops' : ''}`;
    row.querySelector('button').onclick = () => addFromLibrary(d);
    list.appendChild(row);
  });
}

function renderSoundList() {
  const el = $('#soundList');
  el.innerHTML = '';
  if (!S.sounds.length) {
    el.innerHTML = '<p class="hint">No sounds on the track yet. Add one from the library.</p>';
    return;
  }
  S.sounds.forEach(s => {
    const row = document.createElement('div');
    row.className = 'snd-row';
    row.innerHTML = `
      <div class="snd-head"><b></b><button type="button" class="x" title="Remove">✕</button></div>
      <div class="snd-grid">
        <label>Start (s)<input type="number" min="0" step="0.1" class="f-start"></label>
        <label>Length (s)<input type="number" min="0.1" step="0.1" class="f-len"></label>
        <label>Volume<input type="range" min="0" max="1.5" step="0.05" class="f-vol"></label>
        <label class="chk"><input type="checkbox" class="f-loop"> Loop</label>
      </div>`;
    const q = sel => row.querySelector(sel);
    q('b').textContent = s.name;
    q('.f-start').value = s.start.toFixed(1);
    q('.f-len').value = s.length.toFixed(1);
    q('.f-vol').value = s.vol;
    q('.f-loop').checked = s.loop;
    const update = () => {
      s.start = Math.max(0, parseFloat(q('.f-start').value) || 0);
      s.length = Math.max(0.1, parseFloat(q('.f-len').value) || 1);
      s.vol = parseFloat(q('.f-vol').value);
      s.loop = q('.f-loop').checked;
      soundsChanged();
    };
    q('.f-start').addEventListener('change', update);
    q('.f-len').addEventListener('change', update);
    q('.f-vol').addEventListener('input', update);
    q('.f-loop').addEventListener('change', update);
    q('.x').onclick = () => {
      S.sounds = S.sounds.filter(x => x.id !== s.id);
      renderSoundList();
      soundsChanged();
    };
    el.appendChild(row);
  });
}

$('#libSearch').addEventListener('input', renderLibrary);
$('#libCat').addEventListener('change', renderLibrary);
$('#soundUpload').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    ensureAudio();
    const buf = await audioCtx.decodeAudioData(await f.arrayBuffer());
    S.customSounds.push({
      id: uid(), name: f.name.replace(/\.[^.]+$/, ''), cat: 'mine', tags: 'my upload',
      dur: buf.duration, buffer: buf, loop: false
    });
    $('#libCat').value = 'mine';
    renderLibrary();
    toast('Sound added to My uploads. Click + Add to place it.');
  } catch (err) {
    toast('Could not read that audio file. Try MP3, WAV or M4A.');
  }
});

/* ---------- Clips ---------- */
function makeEl(url) {
  const el = document.createElement('video');
  el.playsInline = true;
  el.preload = 'auto';
  el.src = url;
  mediaHost.appendChild(el);
  return el;
}

function clipReady(c, dur) {
  c.duration = dur;
  if (!c.ready) {
    c.inT = 0;
    c.outT = dur;
    c.ready = true;
  }
  attachAudio(c);
  layout();
  renderClips();
  renderTimelineAll();
  renderFrame();
  refreshChecks();
}

function makeVideoClip(file) {
  const url = URL.createObjectURL(file);
  const el = makeEl(url);
  const c = { id: uid(), name: file.name, type: 'video', el, url, node: null, duration: 0,
    inT: 0, outT: 0, start: 0, len: 0.05, ready: false, draw: null };
  el.onloadedmetadata = () => {
    if (isFinite(el.duration) && el.duration > 0) return clipReady(c, el.duration);
    // Some recorded WebM files report Infinity; force the real length to be computed.
    el.onseeked = () => { el.onseeked = null; el.currentTime = 0; clipReady(c, el.duration); };
    el.currentTime = 1e101;
  };
  el.onerror = () => toast(`Could not play ${file.name}. Try MP4 (H.264) or WebM.`);
  return c;
}

$('#clipFileInput').addEventListener('change', e => {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (S.exporting) return toast('Finish the export first.');
  let added = 0;
  files.forEach(f => {
    if (!f.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v)$/i.test(f.name)) {
      toast(`Skipped ${f.name}: not a video file.`);
      return;
    }
    S.clips.push(makeVideoClip(f));
    added++;
  });
  if (added) {
    toast(`Added ${added} video${added > 1 ? 's' : ''}. Each one shows Loading… until it is ready.`);
    if (!S.selClip) S.selClip = S.clips[0].id;
    layout();
    renderClips();
    renderTimelineAll();
    renderFrame();
    refreshChecks();
  }
});

function makeImageClip(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  const c = { id: uid(), name: file.name, type: 'image', el: null, img, url, node: null,
    duration: S.imgDur, inT: 0, outT: S.imgDur, start: 0, len: S.imgDur, ready: false, draw: null };
  img.onload = () => {
    c.ready = true;
    layout();
    renderClips();
    renderTimelineAll();
    renderFrame();
    refreshChecks();
  };
  img.onerror = () => {
    toast(`Could not read ${file.name}.`);
    S.clips = S.clips.filter(x => x !== c);
    layout();
    renderClips();
    renderTimelineAll();
  };
  img.src = url;
  return c;
}

$('#imgFileInput').addEventListener('change', e => {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (S.exporting) return toast('Finish the export first.');
  let added = 0;
  files.forEach(f => {
    if (!f.type.startsWith('image/') && !/\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name)) {
      toast(`Skipped ${f.name}: not an image.`);
      return;
    }
    S.clips.push(makeImageClip(f));
    added++;
  });
  if (added) {
    toast(`Added ${added} image${added > 1 ? 's' : ''} as slides.`);
    if (!S.selClip) S.selClip = S.clips[0].id;
    layout();
    renderClips();
    renderTimelineAll();
    renderFrame();
    refreshChecks();
  }
});

/* ---------- Image and video overlays (layers above the sequence) ---------- */
const LAYER_POS = { tl: [18, 14], tr: [82, 14], c: [50, 50], bl: [18, 86], bc: [50, 86], br: [82, 86] };

function currentLayer() { return S.layers.find(L => L.id === S.selLayer) || null; }

function makeImageLayer(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  const L = { id: uid(), kind: 'image', name: file.name, img, url, el: null,
    start: Math.round(S.t * 10) / 10, end: 0, x: 50, y: 50, w: 30, op: 1, ready: false, loop: false };
  L.end = L.start + 5;
  img.onload = () => { L.ready = true; renderFrame(); };
  img.onerror = () => {
    toast(`Could not read ${file.name}.`);
    S.layers = S.layers.filter(x => x !== L);
    renderLayerList();
    renderTimelineAll();
  };
  img.src = url;
  return L;
}

function makeVideoLayer(file) {
  const url = URL.createObjectURL(file);
  const el = makeEl(url);
  el.muted = true;
  const L = { id: uid(), kind: 'video', name: file.name, img: null, url, el,
    start: Math.round(S.t * 10) / 10, end: 0, x: 50, y: 50, w: 40, op: 1, ready: false, loop: true };
  L.end = L.start + 5;
  el.onloadedmetadata = () => {
    if (isFinite(el.duration) && el.duration > 0) L.end = L.start + el.duration;
    L.ready = true;
    renderLayerList();
    renderLayerEditor();
    renderTimelineAll();
    renderFrame();
  };
  el.onerror = () => toast(`Could not play ${file.name}.`);
  return L;
}

function addLayer(L) {
  S.layers.push(L);
  S.selLayer = L.id;
  renderLayerList();
  renderLayerEditor();
  renderTimelineAll();
  renderFrame();
  refreshChecks();
}

function renderLayerList() {
  const el = $('#layerList');
  el.innerHTML = '';
  if (!S.layers.length) {
    el.innerHTML = '<p class="hint">No overlays yet. Add an image or a video above.</p>';
    return;
  }
  S.layers.forEach(L => {
    const row = document.createElement('div');
    row.className = 'clip-item' + (L.id === S.selLayer ? ' sel' : '');
    row.innerHTML = '<span class="ci-n"></span><span class="ci-l"></span>';
    row.querySelector('.ci-n').textContent = `${L.kind === 'video' ? '🎬' : '🖼'} ${L.name}`;
    row.querySelector('.ci-l').textContent = `${fmt(L.start)} – ${fmt(L.end)}`;
    row.onclick = () => {
      S.selLayer = L.id;
      renderLayerList();
      renderLayerEditor();
      renderTimelineAll();
    };
    el.appendChild(row);
  });
}

function renderLayerEditor() {
  const L = currentLayer();
  $('#layerEditor').hidden = !L;
  if (!L) return;
  $('#lyStart').value = L.start.toFixed(1);
  $('#lyEnd').value = L.end.toFixed(1);
  $('#lyX').value = Math.round(L.x);
  $('#lyY').value = Math.round(L.y);
  $('#lyW').value = L.w;
  $('#lyOp').value = L.op;
  $('#lyLoopRow').hidden = L.kind !== 'video';
  $('#lyLoop').checked = !!L.loop;
}

function removeLayer() {
  const L = currentLayer();
  if (!L) return;
  if (L.kind === 'video') {
    L.el.pause();
    L.el.removeAttribute('src');
    L.el.load();
    L.el.remove();
  }
  S.layers = S.layers.filter(x => x !== L);
  S.selLayer = null;
  renderLayerList();
  renderLayerEditor();
  renderTimelineAll();
  renderFrame();
  refreshChecks();
}

// Keeps video overlays in step with the playhead, like the main clips.
function syncLayers() {
  for (const L of S.layers) {
    if (L.kind !== 'video' || !L.ready) continue;
    const el = L.el;
    const active = S.t >= L.start && S.t <= L.end;
    if (!active) { if (!el.paused) el.pause(); continue; }
    let want = S.t - L.start;
    if (L.loop && isFinite(el.duration) && el.duration > 0) want = want % el.duration;
    if (!el.seeking && el.readyState >= 1 && Math.abs(el.currentTime - want) > (S.playing ? 0.25 : 0.03)) el.currentTime = want;
    if (S.playing) {
      if (el.paused) { const p = el.play(); if (p && p.catch) p.catch(() => {}); }
    } else if (!el.paused) {
      el.pause();
    }
  }
}

function drawLayers(W, H) {
  for (const L of S.layers) {
    if (!L.ready || S.t < L.start || S.t > L.end) continue;
    let src, sw, sh;
    if (L.kind === 'image') {
      if (!L.img.complete || !L.img.naturalWidth) continue;
      src = L.img; sw = L.img.naturalWidth; sh = L.img.naturalHeight;
    } else {
      if (L.el.readyState < 2 || !L.el.videoWidth) continue;
      src = L.el; sw = L.el.videoWidth; sh = L.el.videoHeight;
    }
    const w = W * L.w / 100, h = w * sh / sw;
    const cx = W * L.x / 100, cy = H * L.y / 100;
    ctx.save();
    ctx.globalAlpha = L.op;
    ctx.drawImage(src, cx - w / 2, cy - h / 2, w, h);
    ctx.restore();
  }
}

function bindLayerEditor() {
  const fields = [['#lyStart', 'start'], ['#lyEnd', 'end'], ['#lyX', 'x'], ['#lyY', 'y'], ['#lyW', 'w'], ['#lyOp', 'op']];
  fields.forEach(([sel, key]) => {
    const evt = (sel === '#lyW' || sel === '#lyOp') ? 'input' : 'change';
    $(sel).addEventListener(evt, e => {
      const L = currentLayer();
      if (!L) return;
      let v = parseFloat(e.target.value);
      if (isNaN(v)) return;
      if (key === 'start') { v = Math.max(0, v); L.start = v; if (L.end <= v) L.end = v + 1; }
      else if (key === 'end') L.end = Math.max(L.start + 0.1, v);
      else if (key === 'x' || key === 'y') L[key] = clamp(v, 0, 100);
      else if (key === 'w') L.w = clamp(v, 2, 100);
      else if (key === 'op') L.op = clamp(v, 0, 1);
      renderLayerEditor();
      renderLayerList();
      renderTimelineAll();
      renderFrame();
      refreshChecks();
    });
  });
  $('#lyLoop').addEventListener('change', e => {
    const L = currentLayer();
    if (L) L.loop = e.target.checked;
    renderFrame();
  });
  document.querySelectorAll('[data-lypos]').forEach(b => b.onclick = () => {
    const L = currentLayer();
    if (!L) return;
    [L.x, L.y] = LAYER_POS[b.dataset.lypos];
    renderLayerEditor();
    renderFrame();
  });
  $('#lyDel').onclick = removeLayer;
}

$('#layerImgInput').addEventListener('change', e => {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  files.forEach(f => {
    if (!f.type.startsWith('image/') && !/\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name)) {
      toast(`Skipped ${f.name}: not an image.`);
      return;
    }
    addLayer(makeImageLayer(f));
  });
});
$('#layerVidInput').addEventListener('change', e => {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  files.forEach(f => {
    if (!f.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v)$/i.test(f.name)) {
      toast(`Skipped ${f.name}: not a video.`);
      return;
    }
    addLayer(makeVideoLayer(f));
  });
});

function setImageLength(c, v) {
  c.duration = v;
  c.inT = 0;
  c.outT = v;
}
$('#imgLen').addEventListener('change', e => {
  const c = currentClip();
  if (!c || c.type !== 'image') return;
  setImageLength(c, clamp(parseFloat(e.target.value) || S.imgDur, 0.5, 60));
  editClipDone();
});
$('#imgLenAll').onclick = () => {
  const v = clamp(parseFloat($('#imgLen').value) || S.imgDur, 0.5, 60);
  S.clips.forEach(c => { if (c.type === 'image') setImageLength(c, v); });
  editClipDone();
  toast('Length applied to every image.');
};

function addSampleClip(def) {
  if (S.exporting) return toast('Finish the export first.');
  const c = { id: uid(), name: def.name, type: 'sample', el: null, url: null, node: null,
    duration: def.duration, inT: 0, outT: def.duration, start: 0, len: def.duration,
    ready: true, draw: def.draw };
  S.clips.push(c);
  if (!S.selClip) S.selClip = c.id;
  layout();
  renderClips();
  renderTimelineAll();
  renderFrame();
  refreshChecks();
}

function renderSampleButtons() {
  const wrapEl = $('#samples');
  window.BasitScenes.samples.forEach(def => {
    const b = document.createElement('button');
    b.className = 'sample';
    b.innerHTML = '<strong></strong><span></span>';
    b.querySelector('strong').textContent = '+ ' + def.name;
    b.querySelector('span').textContent = `${def.duration}s animated clip`;
    b.onclick = () => addSampleClip(def);
    wrapEl.appendChild(b);
  });
}

// Recompute each clip's start on the sequence and the sequence length.
function layout() {
  let acc = 0;
  S.clips.forEach(c => {
    c.start = acc;
    c.len = Math.max(0.05, c.outT - c.inT);
    acc += c.len;
  });
  S.total = acc;
  if (S.outFull) S.outT = S.total;
  else S.outT = Math.min(S.outT, S.total);
  S.inT = clamp(S.inT, 0, Math.max(0, S.total - 0.1));
  if (S.outT <= S.inT) S.outT = S.total;
  if (S.t > S.total) S.t = S.total;
}

function clipAt(T) {
  if (!S.clips.length) return null;
  for (const c of S.clips) {
    if (T < c.start + c.len) return { clip: c, local: c.inT + Math.max(0, T - c.start) };
  }
  const last = S.clips[S.clips.length - 1];
  return { clip: last, local: last.outT };
}

function currentClip() { return S.clips.find(c => c.id === S.selClip) || null; }

function selectClip(id) {
  S.selClip = id;
  renderClips();
  renderTimelineAll();
}

function renderClips() {
  $('#emptyState').hidden = S.clips.length > 0;
  const el = $('#clipList');
  el.innerHTML = '';
  if (!S.clips.length) el.innerHTML = '<p class="hint">No clips yet. Add a video or a sample above.</p>';
  S.clips.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'clip-item' + (c.id === S.selClip ? ' sel' : '');
    row.innerHTML = '<span class="ci-n"></span><span class="ci-l"></span>';
    row.querySelector('.ci-n').textContent = `${i + 1}. ${c.name}`;
    row.querySelector('.ci-l').textContent = c.ready ? fmt(c.len) : 'Loading…';
    row.onclick = () => selectClip(c.id);
    el.appendChild(row);
  });
  const cur = currentClip();
  $('#clipEditor').hidden = !cur;
  const isImg = !!(cur && cur.type === 'image');
  $('#imgRow').hidden = !isImg;
  if (isImg) $('#imgLen').value = cur.duration.toFixed(1);
  if (cur) {
    $('#clipIn').value = cur.inT.toFixed(2);
    $('#clipOut').value = cur.outT.toFixed(2);
  }
}

function editClipDone() {
  pause();
  layout();
  renderClips();
  renderTimelineAll();
  renderFrame();
  refreshChecks();
}

$('#clipIn').addEventListener('change', e => {
  const c = currentClip();
  if (!c || !c.ready) return;
  c.inT = clamp(parseFloat(e.target.value) || 0, 0, Math.max(0, c.duration - 0.1));
  if (c.outT <= c.inT + 0.1) c.outT = Math.min(c.duration, c.inT + 0.1);
  editClipDone();
});
$('#clipOut').addEventListener('change', e => {
  const c = currentClip();
  if (!c || !c.ready) return;
  c.outT = clamp(parseFloat(e.target.value) || c.duration, c.inT + 0.1, c.duration);
  editClipDone();
});

function moveClip(d) {
  pause();
  const i = S.clips.findIndex(c => c.id === S.selClip);
  const j = i + d;
  if (i < 0 || j < 0 || j >= S.clips.length) return;
  [S.clips[i], S.clips[j]] = [S.clips[j], S.clips[i]];
  editClipDone();
}
$('#clipUp').onclick = () => moveClip(-1);
$('#clipDown').onclick = () => moveClip(1);

function deleteClip() {
  pause();
  const c = currentClip();
  if (!c) return;
  if (c.type === 'video') {
    c.el.pause();
    c.el.removeAttribute('src');
    c.el.load();
    c.el.remove();
    if (c.node) { try { c.node.disconnect(); } catch (_) {} }
  }
  S.clips = S.clips.filter(x => x !== c);
  if (S.activeClip === c) S.activeClip = null;
  S.selClip = S.clips.length ? S.clips[0].id : null;
  editClipDone();
}
$('#clipDelete').onclick = deleteClip;

function splitAtPlayhead() {
  pause();
  const c = currentClip();
  if (!c) return toast('Select a clip first.');
  if (!(S.t > c.start + 0.1 && S.t < c.start + c.len - 0.1)) {
    return toast('Move the playhead inside the selected clip to split it.');
  }
  const local = c.inT + (S.t - c.start);
  const b = { id: uid(), name: c.name + ' (2)', type: c.type, el: null, url: c.url, node: null,
    duration: c.duration, inT: local, outT: c.outT, start: 0, len: 0, ready: true, draw: c.draw };
  if (c.type === 'video') {
    b.el = makeEl(c.url);
    attachAudio(b);
  }
  if (c.type === 'image') b.img = c.img;
  c.outT = local;
  S.clips.splice(S.clips.indexOf(c) + 1, 0, b);
  S.selClip = b.id;
  editClipDone();
  toast('Clip split. Both halves are now in the sequence.');
}

/* ---------- Easy start buttons ---------- */
$('#emptyAddVid').onclick = () => $('#clipFileInput').click();
$('#emptyAddImg').onclick = () => $('#imgFileInput').click();
$('#emptySample').onclick = () => addSampleClip(window.BasitScenes.samples[0]);

/* ---------- Playback ---------- */
function syncMedia() {
  const at = clipAt(S.t);
  const cur = at ? at.clip : null;
  if (S.activeClip && S.activeClip !== cur && S.activeClip.type === 'video') S.activeClip.el.pause();
  S.activeClip = cur;

  if (!(cur && cur.type === 'sample' && S.playing)) stopBeat();
  if (cur && cur.type === 'sample' && S.playing && !beatTimer) startBeat();
  if (!cur || cur.type !== 'video') return;

  const el = cur.el;
  const tol = S.playing ? 0.25 : 0.03;
  if (!el.seeking && el.readyState >= 1 && Math.abs(el.currentTime - at.local) > tol) el.currentTime = at.local;
  if (S.playing) {
    if (el.paused) { const p = el.play(); if (p && p.catch) p.catch(() => {}); }
  } else if (!el.paused) {
    el.pause();
  }
}

function play() {
  if (!S.clips.length) return toast('Add a video or sample clip first.');
  ensureAudio();
  if (S.t >= S.outT - 0.05 || S.t < S.inT - 0.05) S.t = S.inT;
  S.playing = true;
  syncMedia();
  scheduleSounds();
  $('#playBtn').textContent = '❚❚';
}

function pause() {
  S.playing = false;
  S.clips.forEach(c => { if (c.type === 'video' && c.el) c.el.pause(); });
  stopBeat();
  stopSounds();
  S.layers.forEach(L => { if (L.kind === 'video' && L.el) L.el.pause(); });
  $('#playBtn').textContent = '▶';
}

function seek(t) {
  S.t = clamp(t, 0, S.total);
  syncMedia();
  if (S.playing) scheduleSounds();
  renderFrame();
  updateTimeline();
}

function followPlayhead() {
  const x = S.t * S.zoom, sl = tlScroll.scrollLeft, w = tlScroll.clientWidth;
  if (x < sl + 20 || x > sl + w - 60) tlScroll.scrollLeft = Math.max(0, x - w * 0.3);
}

function loop(now) {
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  if (S.playing) {
    S.t += dt;
    if (S.t >= S.outT) {
      if (S.exporting) stopExport();
      else if (S.loop) seek(S.inT);
      else pause();
    }
    followPlayhead();
  }
  if (S.clips.length) syncMedia();
  syncLayers();
  if (audioCtx && clipGain) applyAudioLevels();
  // Redraw while playing (about 30 times a second, which keeps phones cool),
  // and once after any change while paused. Idle paused screens are not redrawn.
  if (S.playing || S.exporting) {
    if (now - lastDraw >= 33) { renderFrame(); lastDraw = now; needFrame = false; }
  } else if (needFrame) {
    renderFrame(); needFrame = false;
  }
  updateTimeline();
  if (S.exporting) {
    const pct = clamp((S.t - S.inT) / Math.max(0.01, S.outT - S.inT));
    $('#expBar').style.width = (pct * 100) + '%';
  }
  requestAnimationFrame(loop);
}

function setIn() {
  if (!S.clips.length) return toast('Add a clip first.');
  S.inT = Math.max(0, Math.min(S.t, S.outT - 0.1));
  S.outFull = S.outT >= S.total;
  updateTimeline();
  refreshChecks();
}
function setOut() {
  if (!S.clips.length) return toast('Add a clip first.');
  S.outT = Math.min(S.total, Math.max(S.t, S.inT + 0.1));
  S.outFull = false;
  updateTimeline();
  refreshChecks();
}

/* ---------- Rendering ---------- */
function colorFilter() {
  const parts = [];
  const preset = FILTERS[S.filter];
  if (preset && preset !== 'none') parts.push(preset);
  if (S.bright !== 1) parts.push(`brightness(${S.bright})`);
  if (S.contrast !== 1) parts.push(`contrast(${S.contrast})`);
  if (S.sat !== 1) parts.push(`saturate(${S.sat})`);
  return parts.length ? parts.join(' ') : 'none';
}

function drawVideo(el, W, H, f) {
  const vw = el.videoWidth, vh = el.videoHeight;
  if (S.fit === 'fill') {
    ctx.filter = f;
    drawImageFit(ctx, el, vw, vh, W, H, 'cover');
  } else {
    // Blurred backdrop: a tiny cover copy scaled up, which is cheap and looks soft.
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    drawImageFit(bgCtx, el, vw, vh, bgCanvas.width, bgCanvas.height, 'cover');
    ctx.filter = f;
    ctx.drawImage(bgCanvas, 0, 0, W, H);
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);
    ctx.filter = f;
    drawImageFit(ctx, el, vw, vh, W, H, 'contain');
  }
  ctx.filter = 'none';
}

function drawEndCard(W, H) {
  const len = S.outT - S.inT;
  const d = Math.min(S.ec.dur, len * 0.5);
  const start = S.outT - d;
  if (S.t < start) return;
  const a = clamp((S.t - start) / 0.4);
  const u = Math.min(W, H) / 100, ec = S.ec;
  ctx.save();
  ctx.globalAlpha = a;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, ec.color);
  g.addColorStop(1, '#05070d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = `900 ${u * 7}px ${FONTS.sans}`;
  ctx.fillStyle = '#fff';
  const lines = wrap(ctx, ec.head, W * 0.84);
  const lh = u * 8;
  let y = H * 0.42 - ((lines.length - 1) * lh) / 2;
  lines.forEach(l => { ctx.fillText(l, W / 2, y); y += lh; });

  const subY = y + u * 3;
  if (ec.sub) {
    ctx.font = `600 ${u * 3.8}px ${FONTS.sans}`;
    ctx.globalAlpha = a * 0.85;
    ctx.fillText(ec.sub, W / 2, subY);
    ctx.globalAlpha = a;
  }
  if (ec.cta) {
    ctx.font = `900 ${u * 4}px ${FONTS.sans}`;
    const tw = ctx.measureText(ec.cta).width + u * 10;
    const cy = subY + u * 11;
    ctx.fillStyle = '#fff';
    rr(ctx, W / 2 - tw / 2, cy - u * 4.5, tw, u * 9, u * 4.5);
    ctx.fill();
    ctx.fillStyle = ec.color;
    ctx.fillText(ec.cta, W / 2, cy);
  }
  if (ec.url) {
    ctx.font = `600 ${u * 3}px ${FONTS.sans}`;
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillText(ec.url, W / 2, H * 0.9);
  }
  ctx.restore();
}

function drawLogo(W, H) {
  if (!S.logo) return;
  const w = W * S.logoW / 100;
  const h = w * S.logo.naturalHeight / S.logo.naturalWidth;
  const m = W * 0.04;
  let x, y;
  switch (S.logoPos) {
    case 'tl': x = m; y = m; break;
    case 'tr': x = W - w - m; y = m; break;
    case 'bl': x = m; y = H - h - m; break;
    case 'br': x = W - w - m; y = H - h - m; break;
    default: x = (W - w) / 2; y = (H - h) / 2;
  }
  ctx.save();
  ctx.globalAlpha = S.logoOp;
  ctx.drawImage(S.logo, x, y, w, h);
  ctx.restore();
}

function drawOverlays(W, H) {
  const u = Math.min(W, H) / 100;
  for (const o of S.overlays) {
    if (S.t < o.start || S.t > o.end) continue;
    const size = u * o.size;
    ctx.font = `800 ${size}px ${FONTS[o.font] || FONTS.sans}`;
    const lines = wrap(ctx, o.text, W * 0.84);
    const lh = size * 1.2, total = lines.length * lh;
    const animated = o.anim !== 'none';
    const inA = animated ? clamp((S.t - o.start) / 0.4) : 1;
    const outA = animated ? clamp((o.end - S.t) / 0.4) : 1;
    let y0 = o.pos === 'top' ? H * 0.1 : o.pos === 'bottom' ? H * 0.9 - total : (H - total) / 2;
    if (o.anim === 'slide') y0 += (1 - inA) * size * 2;
    const x = o.align === 'left' ? W * 0.06 : o.align === 'right' ? W * 0.94 : W / 2;
    ctx.globalAlpha = Math.min(inA, outA);
    ctx.textAlign = o.align;
    ctx.textBaseline = 'top';
    if (o.bg) {
      const bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + size * 0.8;
      const bx = o.align === 'left' ? x - size * 0.4 : o.align === 'right' ? x - bw + size * 0.4 : x - bw / 2;
      rr(ctx, bx, y0 - size * 0.3, bw, total + size * 0.6, size * 0.3);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fill();
    }
    ctx.fillStyle = o.color;
    lines.forEach((ln, i) => ctx.fillText(ln, x, y0 + i * lh));
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
}

function zoomAround(W, H, z) {
  ctx.translate(W / 2, H / 2);
  ctx.scale(z, z);
  ctx.translate(-W / 2, -H / 2);
}

function drawImageClip(c, offset, W, H, f) {
  const iw = c.img.naturalWidth, ih = c.img.naturalHeight;
  const p = clamp(offset / Math.max(0.01, c.len));
  const z = S.kenBurns ? 1 + 0.08 * p : 1;
  if (S.fit === 'fill') {
    ctx.filter = f;
    ctx.save();
    zoomAround(W, H, z);
    drawImageFit(ctx, c.img, iw, ih, W, H, 'cover');
    ctx.restore();
  } else {
    // Flyers keep their full artwork; the blurred copy fills the empty space.
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    drawImageFit(bgCtx, c.img, iw, ih, bgCanvas.width, bgCanvas.height, 'cover');
    ctx.filter = f;
    ctx.drawImage(bgCanvas, 0, 0, W, H);
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);
    ctx.filter = f;
    ctx.save();
    zoomAround(W, H, z);
    drawImageFit(ctx, c.img, iw, ih, W, H, 'contain');
    ctx.restore();
  }
  ctx.filter = 'none';
}

// Draws one clip's picture. offset is seconds into that clip.
function clipFrame(c, offset, W, H, f) {
  if (c.type === 'video') {
    if (c.el.readyState >= 2 && c.el.videoWidth) drawVideo(c.el, W, H, f);
  } else if (c.type === 'image') {
    if (c.img.complete && c.img.naturalWidth) drawImageClip(c, offset, W, H, f);
  } else {
    ctx.filter = f;
    c.draw(ctx, W, H, offset);
    ctx.filter = 'none';
  }
}

function renderFrame() {
  const W = canvas.width, H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const at = clipAt(S.t);
  if (!at) {
    label(ctx, 'Add a video, image or sample clip to begin', W / 2, H / 2, Math.min(W, H) * 0.045, '#8c98b4', 600);
    return;
  }

  const rel = Math.max(0, S.t - S.inT), len = Math.max(0.01, S.outT - S.inT);
  const f = colorFilter();
  const c = at.clip;
  const offset = at.local - c.inT;
  const idx = S.clips.indexOf(c);
  const xf = Math.min(S.xfade, c.len / 2);

  if (xf > 0 && idx > 0 && offset < xf) {
    // Crossfade: previous clip underneath, current clip fading in on top.
    const prev = S.clips[idx - 1];
    clipFrame(prev, prev.len, W, H, f);
    ctx.globalAlpha = clamp(offset / xf);
    clipFrame(c, offset, W, H, f);
    ctx.globalAlpha = 1;
  } else {
    clipFrame(c, offset, W, H, f);
  }

  drawLayers(W, H);
  if (S.ec.on) drawEndCard(W, H);
  drawLogo(W, H);
  drawOverlays(W, H);

  const ff = fadeFactor(rel, len, S.fadeIn, S.fadeOut);
  if (ff < 1) {
    ctx.globalAlpha = 1 - ff;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

function setAspect(a) {
  if (S.exporting) return toast('You cannot change the canvas while exporting.');
  if (!DIMS[a]) return;
  S.aspect = a;
  const [w, h] = DIMS[a];
  canvas.width = w;
  canvas.height = h;
  bgCanvas.width = 48;
  bgCanvas.height = Math.round(48 * h / w);
  $$('[data-aspect]').forEach(b => b.classList.toggle('active', b.dataset.aspect === a));
  $('#aspectHint').textContent = `${w} × ${h} px · ${ASPECT_NOTES[a]}`;
  renderFrame();
  refreshChecks();
}

/* ---------- Timeline ---------- */
function renderTimelineAll() {
  const z = S.zoom;
  tlInner.style.width = Math.max(tlScroll.clientWidth, (S.total + 5) * z) + 'px';
  const cl = $('#clipLane'), sl = $('#soundLane'), ol = $('#ovLane');
  cl.innerHTML = '';
  sl.innerHTML = '';
  ol.innerHTML = '';

  S.clips.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'clip-block' + (c.id === S.selClip ? ' sel' : '');
    d.style.left = (c.start * z) + 'px';
    d.style.width = Math.max(4, c.len * z - 2) + 'px';
    d.textContent = `${i + 1}. ${c.name}`;
    d.title = c.name;
    d.onclick = e => { e.stopPropagation(); selectClip(c.id); };
    cl.appendChild(d);
  });
  S.sounds.forEach(s => {
    const d = document.createElement('div');
    d.className = 'sound-block';
    d.style.left = (s.start * z) + 'px';
    d.style.width = Math.max(4, s.length * z - 2) + 'px';
    d.textContent = (s.loop ? '↻ ' : '♪ ') + s.name;
    sl.appendChild(d);
  });
  S.overlays.forEach(o => {
    const d = document.createElement('div');
    d.className = 'ov-bar';
    d.style.left = (o.start * z) + 'px';
    d.style.width = Math.max(4, (o.end - o.start) * z) + 'px';
    d.title = o.text;
    d.textContent = o.text;
    ol.appendChild(d);
  });
  const ll = $('#layerLane');
  ll.innerHTML = '';
  S.layers.forEach(L => {
    const d = document.createElement('div');
    d.className = 'layer-block' + (L.id === S.selLayer ? ' sel' : '');
    d.style.left = (L.start * z) + 'px';
    d.style.width = Math.max(4, (L.end - L.start) * z) + 'px';
    d.textContent = (L.kind === 'video' ? '🎬 ' : '🖼 ') + L.name;
    d.title = L.name;
    d.onclick = e => {
      e.stopPropagation();
      S.selLayer = L.id;
      renderLayerList();
      renderLayerEditor();
      renderTimelineAll();
    };
    ll.appendChild(d);
  });
  $('#zoomVal').textContent = `${Math.round(z)} px/s`;
  updateTimeline();
}

function updateTimeline() {
  const z = S.zoom, D = S.total || 1;
  $('#timecode').textContent = `${fmt(S.t)} / ${fmt(S.total)}`;
  $('#playhead').style.left = (S.t * z) + 'px';
  $('#trimZone').style.left = (S.inT * z) + 'px';
  $('#trimZone').style.width = ((S.outT - S.inT) * z) + 'px';

  const ecBar = $('#ecBar');
  if (S.ec.on && S.clips.length) {
    const d = Math.min(S.ec.dur, (S.outT - S.inT) * 0.5);
    ecBar.hidden = false;
    ecBar.style.left = ((S.outT - d) * z) + 'px';
    ecBar.style.width = (d * z) + 'px';
  } else {
    ecBar.hidden = true;
  }

  const inR = $('#inR'), outR = $('#outR');
  inR.max = outR.max = D;
  if (document.activeElement !== inR) inR.value = S.inT;
  if (document.activeElement !== outR) outR.value = S.outT;
  $('#trimInfo').textContent = S.clips.length
    ? `Export ${fmt(S.outT - S.inT)} · ${fmt(S.inT)} → ${fmt(S.outT)} · sequence ${fmt(S.total)}`
    : 'Add a clip to begin.';
}

let dragging = false;
function seekFromEvent(e) {
  const r = tlInner.getBoundingClientRect();
  seek((e.clientX - r.left) / S.zoom);
}
tlInner.addEventListener('pointerdown', e => {
  if (!S.clips.length) return;
  dragging = true;
  tlInner.setPointerCapture(e.pointerId);
  seekFromEvent(e);
});
tlInner.addEventListener('pointermove', e => { if (dragging) seekFromEvent(e); });
['pointerup', 'pointercancel'].forEach(ev => tlInner.addEventListener(ev, () => { dragging = false; }));

$('#zoom').addEventListener('input', e => {
  S.zoom = parseFloat(e.target.value);
  renderTimelineAll();
});
$('#fitBtn').onclick = () => {
  if (!S.total) return;
  S.zoom = clamp((tlScroll.clientWidth - 16) / S.total, 5, 200);
  $('#zoom').value = S.zoom;
  tlScroll.scrollLeft = 0;
  renderTimelineAll();
};
$('#inR').addEventListener('input', e => {
  S.inT = Math.max(0, Math.min(parseFloat(e.target.value), S.outT - 0.1));
  S.outFull = S.outT >= S.total;
  updateTimeline();
  refreshChecks();
});
$('#outR').addEventListener('input', e => {
  S.outT = Math.max(parseFloat(e.target.value), S.inT + 0.1);
  S.outFull = false;
  updateTimeline();
  refreshChecks();
});
$('#setIn').onclick = setIn;
$('#setOut').onclick = setOut;
$('#resetTrim').onclick = () => {
  S.inT = 0;
  S.outFull = true;
  layout();
  updateTimeline();
  refreshChecks();
};
$('#playBtn').onclick = () => (S.playing ? pause() : play());
$('#loopChk').onchange = e => { S.loop = e.target.checked; };

/* ---------- Preflight checks ---------- */
function runChecks() {
  const msgs = [];
  if (!S.clips.length) return msgs;
  if (S.clips.some(c => !c.ready)) msgs.push('… Still loading a clip. Export will be available when it finishes.');
  const len = S.outT - S.inT;
  if (len < 3) msgs.push(`⚠ Export range is only ${len.toFixed(1)} s. Most platforms expect at least 3 s.`);
  const vertical = S.aspect === '9:16' || S.aspect === '4:5';
  S.overlays.forEach(o => {
    const name = o.text.length > 24 ? o.text.slice(0, 24) + '…' : o.text;
    if (o.end <= S.inT || o.start >= S.outT) msgs.push(`⚠ "${name}" falls outside the In → Out range and will not export.`);
    else if (o.end - o.start < 1) msgs.push(`⚠ "${name}" stays on screen for under 1 second.`);
    if (vertical && (o.pos === 'top' || o.pos === 'bottom')) {
      msgs.push(`⚠ "${name}" sits in the platform UI area on vertical video. Center it or check the safe zone.`);
    }
  });
  if (S.layers.some(L => L.end <= S.inT || L.start >= S.outT)) {
    msgs.push('⚠ An image or video overlay is outside the In → Out range and will not export.');
  }
  if (S.sounds.some(s => s.start >= S.outT || s.start + s.length <= S.inT)) {
    msgs.push('⚠ A sound sits outside the In → Out range and will not export.');
  }
  return msgs;
}
function refreshChecks() {
  const msgs = runChecks();
  $('#checks').textContent = msgs.length ? msgs.join('\n') : (S.clips.length ? '✓ Ready to export.' : '');
}

/* ---------- Overlays ---------- */
function pushUndo() {
  S.undo.push(JSON.stringify(S.overlays));
  if (S.undo.length > 50) S.undo.shift();
}
function undo() {
  if (!S.undo.length) return toast('Nothing to undo.');
  S.overlays = JSON.parse(S.undo.pop());
  renderOverlayList();
  refreshChecks();
  toast('Undone.');
}
function renderOverlayList() {
  const el = $('#ovList');
  el.innerHTML = '';
  if (!S.overlays.length) el.innerHTML = '<p class="hint">No overlays yet.</p>';
  S.overlays.forEach(o => {
    const d = document.createElement('div');
    d.className = 'ov-item';
    d.innerHTML = '<div><b></b><span></span></div><button type="button" title="Delete">✕</button>';
    d.querySelector('b').textContent = o.text;
    d.querySelector('span').textContent = `${o.start.toFixed(1)}s – ${o.end.toFixed(1)}s · ${o.pos} · ${o.align}`;
    d.querySelector('button').onclick = () => {
      pushUndo();
      S.overlays = S.overlays.filter(x => x.id !== o.id);
      renderOverlayList();
      refreshChecks();
    };
    el.appendChild(d);
  });
  renderTimelineAll();
  renderFrame();
}
$('#ovTemplate').addEventListener('change', e => {
  if (e.target.value) $('#ovText').value = e.target.value;
  e.target.value = '';
});
$('#addOverlay').onclick = () => {
  const text = $('#ovText').value.trim();
  if (!text) return toast('Type overlay text first, or pick a template.');
  const start = Math.max(0, parseFloat($('#ovStart').value) || 0);
  let end = parseFloat($('#ovEnd').value);
  if (isNaN(end)) end = start + 3;
  if (end <= start) return toast('End time must be after start time.');
  pushUndo();
  S.overlays.push({
    id: uid(), text, start, end,
    pos: $('#ovPos').value,
    align: $('#ovAlign').value,
    font: $('#ovFont').value,
    anim: $('#ovAnim').value,
    size: parseFloat($('#ovSize').value),
    color: $('#ovColor').value,
    bg: $('#ovBg').checked
  });
  $('#ovText').value = '';
  renderOverlayList();
  refreshChecks();
};
function sanitizeOverlay(o) {
  if (!o || typeof o.text !== 'string') return null;
  const start = Math.max(0, Number(o.start) || 0);
  const end = Math.max(start + 0.1, Number(o.end) || start + 3);
  return {
    id: String(o.id || uid()),
    text: o.text.slice(0, 120), start, end,
    pos: ['top', 'center', 'bottom'].includes(o.pos) ? o.pos : 'center',
    align: ['left', 'center', 'right'].includes(o.align) ? o.align : 'center',
    font: FONTS[o.font] ? o.font : 'sans',
    anim: ['fade', 'slide', 'none'].includes(o.anim) ? o.anim : 'fade',
    size: clamp(Number(o.size) || 6, 2, 12),
    color: /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#ffffff',
    bg: !!o.bg
  };
}

/* ---------- Controls ---------- */
const bindings = [
  ['#fitSel', 'fit', 'select'],
  ['#filterSel', 'filter', 'select'],
  ['#brightR', 'bright', 'num'],
  ['#contrastR', 'contrast', 'num'],
  ['#satR', 'sat', 'num'],
  ['#videoVolR', 'clipVol', 'num'],
  ['#imgDur', 'imgDur', 'num'],
  ['#xfade', 'xfade', 'num'],
  ['#kenBurns', 'kenBurns', 'check'],
  ['#fadeIn', 'fadeIn', 'num'],
  ['#fadeOut', 'fadeOut', 'num'],
  ['#logoPos', 'logoPos', 'select'],
  ['#logoWidth', 'logoW', 'num'],
  ['#logoOpacity', 'logoOp', 'num'],
  ['#qualitySel', 'quality', 'select'],
  ['#fpsSel', 'fps', 'numsel'],
  ['#ecOn', 'ec.on', 'check'],
  ['#ecDur', 'ec.dur', 'num'],
  ['#ecHead', 'ec.head', 'text'],
  ['#ecSub', 'ec.sub', 'text'],
  ['#ecCta', 'ec.cta', 'text'],
  ['#ecUrl', 'ec.url', 'text'],
  ['#ecColor', 'ec.color', 'text'],
  ['#chkSafe', 'showSafe', 'check'],
  ['#chkThirds', 'showThirds', 'check']
];

function bindControls() {
  bindings.forEach(([sel, path, kind]) => {
    const el = $(sel);
    if (!el) return;
    const evt = (kind === 'select' || kind === 'check' || kind === 'numsel') ? 'change' : 'input';
    el.addEventListener(evt, () => {
      let v;
      if (kind === 'check') v = el.checked;
      else if (kind === 'num' || kind === 'numsel') v = parseFloat(el.value);
      else v = el.value;
      if (typeof v === 'number' && isNaN(v)) return;
      setPath(S, path, v);
      onSettingsChanged();
    });
  });
}
function syncControls() {
  bindings.forEach(([sel, path, kind]) => {
    const el = $(sel);
    if (!el) return;
    const v = getPath(S, path);
    if (kind === 'check') el.checked = !!v;
    else el.value = v;
  });
  $$('[data-aspect]').forEach(b => b.classList.toggle('active', b.dataset.aspect === S.aspect));
  $('#guideSafeBox').hidden = !S.showSafe;
  $('#guideThirdsBox').hidden = !S.showThirds;
  $('#zoom').value = S.zoom;
}
function onSettingsChanged() {
  $('#guideSafeBox').hidden = !S.showSafe;
  $('#guideThirdsBox').hidden = !S.showThirds;
  renderFrame();
  refreshChecks();
}
$$('[data-aspect]').forEach(b => b.onclick = () => setAspect(b.dataset.aspect));
$('#filterSel').addEventListener('change', e => { S.filter = e.target.value; renderFrame(); });
$('#resetLook').onclick = () => {
  S.filter = 'none';
  S.bright = 1;
  S.contrast = 1;
  S.sat = 1;
  syncControls();
  onSettingsChanged();
};

/* ---------- Export ---------- */
function pickMime() {
  const list = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return list.find(m => MediaRecorder.isTypeSupported(m)) || '';
}

function startExport() {
  if (!S.clips.length) return toast('Add a video or sample clip first.');
  if (S.exporting) return;
  if (S.clips.some(c => !c.ready)) return toast('Wait for all clips to finish loading.');
  if (!window.MediaRecorder || !canvas.captureStream) {
    return toast('Export needs a current Chrome, Edge, Firefox or Safari.');
  }
  const mime = pickMime();
  if (!mime) return toast('This browser cannot record video.');
  const warns = runChecks().filter(m => m.startsWith('⚠'));
  if (warns.length) toast(`Exporting with ${warns.length} warning${warns.length > 1 ? 's' : ''}. See the checks panel.`);

  ensureAudio();
  recMime = mime;
  chunks = [];
  recDest = audioCtx.createMediaStreamDestination();
  audioMix.connect(recDest);

  const videoTrack = canvas.captureStream(S.fps).getVideoTracks()[0];
  const stream = new MediaStream([videoTrack, ...recDest.stream.getAudioTracks()]);
  rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: BITRATE[S.quality] || BITRATE.standard });
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = finishExport;

  S.exporting = true;
  $('#exportBox').hidden = false;
  $('#expWrap').hidden = false;
  $('#expBar').style.width = '0%';
  pause();
  seek(S.inT);
  rec.start(250);
  play();
}

function stopExport() {
  if (!S.exporting) return;
  pause();
  if (rec && rec.state !== 'inactive') rec.stop();
  else finishExport();
}

function finishExport() {
  S.exporting = false;
  if (recDest) {
    try { audioMix.disconnect(recDest); } catch (_) {}
    recDest = null;
  }
  $('#exportBox').hidden = true;
  $('#expWrap').hidden = true;
  const blob = new Blob(chunks, { type: recMime.split(';')[0] });
  chunks = [];
  rec = null;
  if (!blob.size) return toast('Nothing was recorded. Please try again.');
  const ext = recMime.includes('mp4') ? 'mp4' : 'webm';
  download(blob, `basit-ads-${Date.now()}.${ext}`);
  toast('Export saved to your downloads.');
}

$$('.export-trigger').forEach(b => b.onclick = startExport);
$('#stopExport').onclick = stopExport;

/* ---------- Logo ---------- */
$('#logoInput').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (S.logoUrl) URL.revokeObjectURL(S.logoUrl);
  S.logoUrl = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    if (!img.naturalWidth) return toast('Could not read the logo size. Try a PNG.');
    S.logo = img;
    $('#logoName').textContent = f.name;
    $('#logoClear').hidden = false;
    renderFrame();
  };
  img.onerror = () => toast('Could not read that image.');
  img.src = S.logoUrl;
});
$('#logoClear').onclick = () => {
  S.logo = null;
  $('#logoName').textContent = 'No logo added';
  $('#logoClear').hidden = true;
  renderFrame();
};

/* ---------- Snapshot, project files, undo ---------- */
$('#snapBtn').onclick = () => {
  if (!S.clips.length) return toast('Add a clip first.');
  renderFrame();
  canvas.toBlob(b => { if (b) download(b, `basit-ads-frame-${Date.now()}.png`); }, 'image/png');
};
$('#undoBtn').onclick = undo;

$('#saveProjBtn').onclick = () => {
  const data = {
    app: 'Basit Ads', version: 3, savedAt: new Date().toISOString(),
    aspect: S.aspect, fit: S.fit, filter: S.filter, bright: S.bright, contrast: S.contrast, sat: S.sat,
    clipVol: S.clipVol, fadeIn: S.fadeIn, fadeOut: S.fadeOut,
    kenBurns: S.kenBurns, xfade: S.xfade, imgDur: S.imgDur,
    logoPos: S.logoPos, logoW: S.logoW, logoOp: S.logoOp,
    quality: S.quality, fps: S.fps, zoom: S.zoom,
    inT: S.inT, outT: S.outT, overlays: S.overlays, ec: S.ec,
    sounds: S.sounds.filter(s => s.defId).map(s => ({
      defId: s.defId, start: s.start, length: s.length, vol: s.vol, loop: s.loop
    })),
    clipNames: S.clips.map(c => c.name)
  };
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `basit-ads-project-${Date.now()}.json`);
  toast('Project saved. Clips and uploaded sounds are not stored, so re-add them when you reopen.');
};

$('#openProjInput').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'Basit Ads') throw new Error('not a project');
    const num = (v, def) => (Number.isFinite(v) ? v : def);
    const pick = (v, list, def) => (list.includes(v) ? v : def);
    S.aspect = pick(d.aspect, Object.keys(DIMS), '9:16');
    S.fit = pick(d.fit, ['fit', 'fill'], 'fit');
    S.filter = pick(d.filter, Object.keys(FILTERS), 'none');
    S.bright = clamp(num(d.bright, 1), 0.5, 1.5);
    S.contrast = clamp(num(d.contrast, 1), 0.5, 1.5);
    S.sat = clamp(num(d.sat, 1), 0, 2);
    S.clipVol = clamp(num(d.clipVol, 1), 0, 1);
    S.kenBurns = !!d.kenBurns;
    S.xfade = clamp(num(d.xfade, 0.5), 0, 2);
    S.imgDur = clamp(num(d.imgDur, 3), 0.5, 60);
    S.fadeIn = clamp(num(d.fadeIn, 0), 0, 5);
    S.fadeOut = clamp(num(d.fadeOut, 0), 0, 5);
    S.logoPos = pick(d.logoPos, ['tl', 'tr', 'bl', 'br', 'c'], 'tr');
    S.logoW = clamp(num(d.logoW, 18), 5, 50);
    S.logoOp = clamp(num(d.logoOp, 0.9), 0.1, 1);
    S.quality = pick(d.quality, ['draft', 'standard', 'high'], 'standard');
    S.fps = pick(Number(d.fps), [24, 30, 60], 30);
    S.zoom = clamp(num(d.zoom, S.zoom), 5, 200);
    S.overlays = (Array.isArray(d.overlays) ? d.overlays : []).slice(0, 200).map(sanitizeOverlay).filter(Boolean);
    S.ec = { ...S.ec, ...(d.ec || {}) };
    S.ec.dur = clamp(num(S.ec.dur, 3), 1, 10);
    S.ec.on = !!S.ec.on;
    S.undo = [];
    if (Array.isArray(d.sounds)) {
      for (const x of d.sounds.slice(0, 100)) {
        const def = BUILTIN.find(b => b.id === x.defId);
        if (!def) continue;
        const buffer = await renderDef(def);
        S.sounds.push({ id: uid(), name: def.name, buffer, defId: def.id,
          start: Math.max(0, Number(x.start) || 0), length: Math.max(0.1, Number(x.length) || def.dur),
          vol: clamp(Number(x.vol) || 1, 0, 1.5), loop: !!x.loop });
      }
    }
    setAspect(S.aspect);
    syncControls();
    renderOverlayList();
    renderSoundList();
    renderClips();
    layout();
    renderTimelineAll();
    refreshChecks();
    toast('Project settings loaded. Re-add your clips to continue editing.');
  } catch (err) {
    toast('That file is not a valid Basit Ads project.');
  }
});

/* ---------- Keyboard ---------- */
document.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  const typing = tag === 'TEXTAREA' || tag === 'SELECT' ||
    (tag === 'INPUT' && !['range', 'checkbox', 'color'].includes(e.target.type));
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
    if (!typing) { e.preventDefault(); undo(); }
    return;
  }
  if (typing) return;
  if (e.key === '?') { $('#helpModal').showModal(); return; }
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      if (!S.exporting) (S.playing ? pause() : play());
      break;
    case 'ArrowLeft': seek(S.t - (e.shiftKey ? 1 : 0.5)); break;
    case 'ArrowRight': seek(S.t + (e.shiftKey ? 1 : 0.5)); break;
    case 'KeyI': setIn(); break;
    case 'KeyO': setOut(); break;
    case 'KeyS': if (!S.exporting) splitAtPlayhead(); break;
  }
});

/* ---------- Modals ---------- */
const founderModal = $('#founderModal');
$('#founderBtn').onclick = () => founderModal.showModal();
$('#closeFounder').onclick = () => founderModal.close();
founderModal.addEventListener('click', e => { if (e.target === founderModal) founderModal.close(); });
const helpModal = $('#helpModal');
$('#helpBtn').onclick = () => helpModal.showModal();
$('#closeHelp').onclick = () => helpModal.close();
helpModal.addEventListener('click', e => { if (e.target === helpModal) helpModal.close(); });

/* ---------- Install as an app, share, offline ---------- */
const isStandalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || !!navigator.standalone;
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  if (!isStandalone) $('#installBtn').hidden = false;
});
$('#installBtn').onclick = async () => {
  if (deferredInstall) {
    deferredInstall.prompt();
    try { await deferredInstall.userChoice; } catch (_) {}
    deferredInstall = null;
    $('#installBtn').hidden = true;
  } else {
    toast('On iPhone: tap the Share button in Safari, then "Add to Home Screen".');
  }
};
window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('Basit Ads is installed. Open it from your home screen.'); });
if (isStandalone) $('#installBtn').hidden = true;
else if (/iPhone|iPad|iPod/.test(navigator.userAgent)) $('#installBtn').hidden = false;

$('#shareBtn').onclick = async () => {
  const data = { title: 'Basit Ads', text: 'Make promo and short video ads in your browser. Free, and it works offline.', url: location.href };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(location.href); toast('Link copied. Send it to your friends.'); }
  } catch (_) { /* the person closed the share sheet */ }
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden && S.playing && !S.exporting) pause();
});

if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ---------- Init ---------- */
renderSampleButtons();
bindControls();
setAspect(S.aspect);
syncControls();
renderLibrary();
renderSoundList();
renderOverlayList();
renderClips();
refreshChecks();
renderTimelineAll();
renderLayerList();
renderLayerEditor();
bindLayerEditor();
requestAnimationFrame(loop);
})();
