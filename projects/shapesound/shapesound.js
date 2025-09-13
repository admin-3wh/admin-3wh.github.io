// NOTE: index.html should include this with: <script type="module" src="shapesound.js"></script>

// TinyGPT is loaded separately and exposed as window.TinyGPT by tinygpt.js.
// Do NOT import it here.

// ------------------------------
// Notes / Frequencies
// ------------------------------
const noteMap = {
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23,
  G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25,
  F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77
};

// ------------------------------
// Global runtime state
// ------------------------------
let tempoBPM = 100;
let animations = [];        // active animation tweens (shapes & sprites)
let timeline = [];          // scheduled events (sorted by time asc)
let ALL_EVENTS = [];        // immutable copy for scrubbing
let currentScene = { duration: 10, code: "" };

let paused = false;
let pauseOffset = 0;        // ms since scene start
let startTime = null;       // performance.now() when (re)started
let lastNow = null;

// Retained drawing state so shapes persist across frames
let CURRENT_BG = "#000000";
let BG_NOISE = null; // {scale, speed, colors:[c1,c2], phase}
const DRAWN_OBJECTS = []; // array of {type, id?, z?, ...shapeProps}

// ------------------------------
// Deterministic RNG (seed)
// ------------------------------
let SEED = 1337, RNG = mulberry32(SEED);
function mulberry32(a){ return function(){ let t=a+=0x6D2B79F5; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; } }
function setSeed(n){ SEED = (n>>>0)||1337; RNG = mulberry32(SEED); }

// ------------------------------
// Assets + Sprites (with preloader gate)
// ------------------------------
const ASSETS = {
  images: {},  // key -> HTMLImageElement
  sheets: {}   // key -> { img, frameW, frameH, frames, fps }
};
const PENDING_ASSET_PROMISES = new Set();
const SPRITES = {};        // id -> sprite object

function loadImage(src) {
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
  PENDING_ASSET_PROMISES.add(p);
  p.finally(() => PENDING_ASSET_PROMISES.delete(p));
  return p;
}

async function waitAssetsReady() {
  if (PENDING_ASSET_PROMISES.size === 0) return;
  await Promise.allSettled([...PENDING_ASSET_PROMISES]);
}

// Sprite animation step
function stepSpriteAnimation(s, dtSec) {
  if (s.type !== 'sheet' || !s.playing) return;
  const sheet = ASSETS.sheets[s.key];
  if (!sheet) return;
  const fps = s.fps || sheet.fps || 8;
  s.frame = (s.frame || 0) + fps * dtSec;
}

// Easing
function applyEase(t, ease) {
  switch ((ease || "linear").toLowerCase()) {
    case "in":      return t * t;
    case "out":     return t * (2 - t);
    case "in-out":  return t < 0.5 ? 2*t*t : -1 + (4 - 2*t) * t;
    default:        return t; // linear
  }
}

// ------------------------------
// Audio (shared AudioContext) + Accurate Scheduler
// ------------------------------
let AC = null;
let audioUnlocked = false;

// Master chain
let MASTER = {
  gain: null,
  analyser: null,
  levelBuf: null,
  volume: 1.0
};

function getAC() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === 'suspended') {
    AC.resume().catch(() => {});
  }
  ensureMasterChain();
  return AC;
}

function ensureMasterChain() {
  const ctx = AC || new (window.AudioContext || window.webkitAudioContext)();
  AC = ctx;
  if (!MASTER.gain) {
    MASTER.gain = ctx.createGain();
    MASTER.gain.gain.value = MASTER.volume;

    MASTER.analyser = ctx.createAnalyser();
    MASTER.analyser.fftSize = 512;
    MASTER.analyser.smoothingTimeConstant = 0.7;
    MASTER.levelBuf = new Float32Array(MASTER.analyser.fftSize / 2);

    MASTER.gain.connect(MASTER.analyser);
    MASTER.analyser.connect(ctx.destination);
  }
}

function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try { getAC(); } catch (_) {}
}
['click','touchstart','keydown'].forEach(evt =>
  window.addEventListener(evt, unlockAudioOnce, { once: true, passive: true })
);

// Simple synth voice routed through MASTER
function scheduleTone(atAcTime, freq, duration = 0.2) {
  const ctx = getAC();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, atAcTime);
  osc.connect(gain);
  gain.connect(MASTER.gain);

  const a = atAcTime;
  const d = Math.max(0.05, duration);
  gain.gain.setValueAtTime(0.0, a);
  gain.gain.linearRampToValueAtTime(0.9, a + 0.01);
  gain.gain.linearRampToValueAtTime(0.0, a + d);

  osc.start(a);
  osc.stop(a + d + 0.01);
}

// --- Look-ahead scheduler (AC-clock accurate)
const AudioScheduler = (() => {
  const queue = []; // { whenMs, note?:'C4', freq?:Hz, durSec }
  const LOOKAHEAD_MS = 50;   // check every 50ms
  const SCHEDULE_AHEAD_MS = 200; // schedule 200ms into future
  let timer = null;

  function msToAcTime(whenMs) {
    const ctx = getAC();
    // Map wall clock (performance.now) to AC time using (scene startTime + pauseOffset)
    const sceneStartPerf = startTime ?? performance.now();
    const nowPerf = performance.now();
    const elapsedSinceStart = nowPerf - sceneStartPerf;
    const nowAc = ctx.currentTime;
    // assume AC time progressed equal to wall time since we started; compute offset once
    const acAtStart = nowAc - (elapsedSinceStart / 1000);
    return acAtStart + (whenMs / 1000);
  }

  function tick() {
    const nowMs = (performance.now() - (startTime || performance.now())) + (pauseOffset || 0);
    const horizon = nowMs + SCHEDULE_AHEAD_MS;
    // schedule all events within [nowMs, horizon]
    while (queue.length && queue[0].whenMs <= horizon) {
      const ev = queue.shift();
      if (ev.freq || ev.note) {
        const freq = ev.freq || noteMap[ev.note];
        if (freq) scheduleTone(msToAcTime(ev.whenMs), freq, ev.durSec || 60/tempoBPM*0.9);
      }
    }
  }

  function start() {
    stop();
    timer = setInterval(tick, LOOKAHEAD_MS);
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }
  function clear() { queue.length = 0; }
  function push(ev) {
    // keep queue sorted by whenMs
    const i = queue.findIndex(e => e.whenMs > ev.whenMs);
    if (i === -1) queue.push(ev); else queue.splice(i, 0, ev);
  }
  return { start, stop, clear, push };
})();

// Optional lightweight output metering
function getLevels() {
  if (!MASTER.analyser) return { rms: 0, peak: 0, spectrum: null };
  MASTER.analyser.getFloatFrequencyData(MASTER.levelBuf);
  let sum = 0, peak = -Infinity, n = 0;
  for (let i = 4; i < MASTER.levelBuf.length - 4; i++) {
    const db = MASTER.levelBuf[i];
    if (!isFinite(db)) continue;
    const lin = Math.pow(10, db / 20);
    sum += lin * lin;
    if (db > peak) peak = db;
    n++;
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  const peakLin = Math.pow(10, (isFinite(peak) ? peak : -100) / 20);
  return { rms, peak: peakLin, spectrum: null };
}

function setMasterVolume(v) {
  ensureMasterChain();
  MASTER.volume = Math.max(0, Math.min(1, Number(v) || 0));
  MASTER.gain.gain.value = MASTER.volume;
}

// ------------------------------
// Utils
// ------------------------------
function interpolateColor(c1, c2, t) {
  const hexToRgb = hex => {
    const bigint = parseInt(hex.slice(1), 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
  };
  const rgbToHex = rgb => `#${rgb.map(x => x.toString(16).padStart(2, '0')).join('')}`;
  const rgb1 = hexToRgb(c1), rgb2 = hexToRgb(c2);
  const mix = rgb1.map((v, i) => Math.round(v + (rgb2[i] - v) * t));
  return rgbToHex(mix);
}
function randRange(a,b){ return a + RNG()*(b-a); }
function clamp01(x){ return x<0?0:(x>1?1:x); }

// HiDPI canvas scaling
function setCanvasSize(canvas, cssW, cssH) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ------------------------------
// Procedural Turtle
// ------------------------------
function drawTurtle(ctx, x, y, scale = 1, colorVariant = null) {
  const greens = ["#228B22", "#2E8B57", "#006400"];
  const shellColor = colorVariant || greens[Math.floor(RNG()*greens.length)];
  const bellyColor = "#654321";
  const eyeColor = "#000000";
  const s = scale;

  ctx.fillStyle = shellColor;
  ctx.beginPath(); ctx.arc(x, y, 40 * s, 0, 2 * Math.PI); ctx.fill();

  ctx.fillStyle = bellyColor;
  ctx.beginPath(); ctx.ellipse(x, y + 5 * s, 28 * s, 20 * s, 0, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = shellColor;
  ctx.fillRect(x + 32 * s, y - 12 * s, 18 * s, 18 * s);

  ctx.fillStyle = eyeColor;
  ctx.beginPath(); ctx.arc(x + 46 * s, y - 4 * s, 2.5 * s, 0, 2 * Math.PI); ctx.fill();

  ctx.fillStyle = shellColor;
  ctx.fillRect(x - 36 * s, y - 40 * s, 14 * s, 18 * s);
  ctx.fillRect(x + 20 * s, y - 40 * s, 14 * s, 18 * s);
  ctx.fillRect(x - 36 * s, y + 22 * s, 14 * s, 18 * s);
  ctx.fillRect(x + 20 * s, y + 22 * s, 14 * s, 18 * s);

  ctx.beginPath();
  ctx.moveTo(x - 42 * s, y + 6 * s);
  ctx.lineTo(x - 56 * s, y);
  ctx.lineTo(x - 42 * s, y - 6 * s);
  ctx.fill();
}

// ------------------------------
// Physics
// ------------------------------
const PHYSICS = {
  enabled: false,
  gravity: { x: 0, y: 0 }, // px/s^2
  damping: 1.0,
  bounds: 'none' // 'none' | 'canvas'
};
function stepPhysics(dtSec, canvas) {
  if (!PHYSICS.enabled) return;
  for (const id in SPRITES) {
    const s = SPRITES[id];
    if (!s.physics) continue;

    const ax = (s.ax || 0) + PHYSICS.gravity.x;
    const ay = (s.ay || 0) + PHYSICS.gravity.y;

    s.vx = (s.vx || 0) + ax * dtSec;
    s.vy = (s.vy || 0) + ay * dtSec;

    s.vx *= PHYSICS.damping;
    s.vy *= PHYSICS.damping;

    s.x += s.vx * dtSec;
    s.y += s.vy * dtSec;

    if (PHYSICS.bounds === 'canvas') {
      const pad = 10 * (s.scale || 1);
      if (s.x < pad) { s.x = pad; s.vx = -s.vx; }
      if (s.y < pad) { s.y = pad; s.vy = -s.vy; }
      if (s.x > canvas.width / (window.devicePixelRatio||1) - pad) { s.x = canvas.width/(window.devicePixelRatio||1) - pad; s.vx = -s.vx; }
      if (s.y > canvas.height / (window.devicePixelRatio||1) - pad) { s.y = canvas.height/(window.devicePixelRatio||1) - pad; s.vy = -s.vy; }
    }
  }
}

// ------------------------------
// Generative Shapes
// ------------------------------
function drawStar(ctx, cx, cy, rOuter, rInner, points, color, rotDeg=0){
  const rot = (rotDeg*Math.PI)/180;
  ctx.beginPath();
  for(let i=0;i<points*2;i++){
    const r = i%2===0 ? rOuter : rInner;
    const a = rot + (i*Math.PI)/points;
    const x = cx + Math.cos(a)*r;
    const y = cy + Math.sin(a)*r;
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
function drawPoly(ctx,cx,cy,rad,sides,color,rotDeg=0){
  const rot = (rotDeg*Math.PI)/180;
  ctx.beginPath();
  for(let i=0;i<sides;i++){
    const a = rot + (i*2*Math.PI)/sides;
    const x = cx + Math.cos(a)*rad;
    const y = cy + Math.sin(a)*rad;
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
function drawBlob(ctx, obj, timeSec){
  const {x,y,r,points,jitter,color,phase=0,speed=0.4} = obj;
  const P = points||18, J = jitter||r*0.25;
  const t = phase + timeSec*(speed||0);
  ctx.beginPath();
  for(let i=0;i<P;i++){
    const a = (i/P)*Math.PI*2;
    const n = Math.sin(a*3 + t)*0.5 + Math.sin(a*5 - t*1.3)*0.5;
    const rr = r + n*J;
    const px = x + Math.cos(a)*rr;
    const py = y + Math.sin(a)*rr;
    i===0?ctx.moveTo(px,py):ctx.lineTo(px,py);
  }
  ctx.closePath();
  ctx.fillStyle = color || "#77ffaa";
  ctx.fill();
}

// ------------------------------
// Fields & Behaviors
// ------------------------------
const FIELDS = {}; // id -> {type, ...params}
function fieldVelocity(f, x, y, t){
  if(!f) return {vx:0, vy:0};
  if(f.type === 'noise'){
    const ang = Math.sin((x*(f.scale||0.005)) + t*(f.speed||0.25))*1.7
              + Math.cos((y*(f.scale||0.005)) - t*(f.speed||0.25)*1.3)*1.3;
    return { vx: Math.cos(ang)*(f.strength||40), vy: Math.sin(ang)*(f.strength||40) };
  }
  if(f.type === 'attractor'){
    const dx = (f.x||400) - x, dy = (f.y||300) - y;
    const d = Math.hypot(dx,dy) + 1e-3;
    const k = (f.strength||60) / Math.pow(d, 1 + (f.falloff ?? 0.8));
    return { vx: dx*k, vy: dy*k };
  }
  return {vx:0,vy:0};
}

// ------------------------------
// Sprite drawing with wiggle + fallbacks (z-order aware)
// ------------------------------
function drawSpriteFallback(ctx, s, x, y) {
  const looksLikeTurtle = (s.key && /turtle/i.test(s.key)) || (s.id && /turtle/i.test(s.id));
  if (looksLikeTurtle) { drawTurtle(ctx, x, y, s.scale || 1, null); return; }
  const w = 60 * (s.scale || 1);
  const h = 60 * (s.scale || 1);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#5559ff";
  ctx.fillRect(-w/2, -h/2, w, h);
  ctx.fillStyle = "#111";
  ctx.fillRect(-w/2+6, -h/2+6, w-12, h-12);
  ctx.restore();
}

function drawSprite(ctx, s) {
  let dx = 0, dy = 0;
  if (s.wiggle && lastNow != null && startTime != null) {
    const t = (lastNow - startTime) / 1000;
    const freq = s.wiggle.freq || 1;
    const ampX = s.wiggle.ampX || s.wiggle.amp || 0;
    const ampY = s.wiggle.ampY || s.wiggle.amp || 0;
    dx = Math.sin(t * Math.PI * 2 * freq) * ampX;
    dy = Math.cos(t * Math.PI * 2 * freq) * ampY;
  }
  const tx = (s.x || 0) + dx;
  const ty = (s.y || 0) + dy;

  if (s.type === 'proc-turtle') {
    drawTurtle(ctx, tx, ty, s.scale || 1, s.color || null);
    return;
  }

  if (s.type === 'genshape' && s.ref) {
    const o = s.ref, kind = o.type;
    if (kind === 'star') { drawStar(ctx, tx, ty, o.rOuter, o.rInner, o.points, o.color, o.rot || 0); return; }
    if (kind === 'poly') { drawPoly(ctx, tx, ty, o.radius, o.sides, o.color, o.rot || 0); return; }
    if (kind === 'blob') { drawBlob(ctx, { ...o, x: tx, y: ty }, (lastNow - startTime)/1000); return; }
    if (kind === 'circle') { ctx.beginPath(); ctx.arc(tx, ty, o.r, 0, Math.PI*2); ctx.fillStyle = o.color || "#FFF"; ctx.fill(); return; }
    if (kind === 'rect') { ctx.fillStyle = o.color || "#FFF"; ctx.fillRect(tx, ty, o.w, o.h); return; }
  }

  if (s.type === 'image') {
    const img = ASSETS.images[s.key];
    if (!img) { drawSpriteFallback(ctx, s, tx, ty); return; }
    const w = img.width * (s.scale || 1);
    const h = img.height * (s.scale || 1);
    ctx.save();
    ctx.translate(tx, ty);
    if (s.rot) ctx.rotate((s.rot * Math.PI) / 180);
    ctx.scale(s.flipX ? -1 : 1, s.flipY ? -1 : 1);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  } else if (s.type === 'sheet') {
    const sheet = ASSETS.sheets[s.key];
    if (!sheet) { drawSpriteFallback(ctx, s, tx, ty); return; }
    const { img, frameW, frameH, frames } = sheet;
    const frame = Math.floor(s.frame || 0) % frames;
    const perRow = Math.max(1, Math.floor(img.width / frameW));
    const sx = (frame % perRow) * frameW;
    const sy = Math.floor(frame / perRow) * frameH;
    const w = frameW * (s.scale || 1);
    const h = frameH * (s.scale || 1);
    ctx.save();
    ctx.translate(tx, ty);
    if (s.rot) ctx.rotate((s.rot * Math.PI) / 180);
    ctx.scale(s.flipX ? -1 : 1, s.flipY ? -1 : 1);
    ctx.drawImage(img, sx, sy, frameW, frameH, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

// ------------------------------
// Parser + Runner (with better errors + inline comments)
// ------------------------------
function parseAndSchedule(script, ctx, canvas, forScrub=false) {
  const rawLines = script.split("\n");
  const lines = rawLines
    .map(l => l.replace(/\/\/.*$/,"").trim())
    .filter(l => l !== "");

  // reset state
  animations = [];
  timeline = [];
  ALL_EVENTS = [];
  DRAWN_OBJECTS.length = 0;
  CURRENT_BG = "#000000";
  BG_NOISE = null;
  tempoBPM = 100;
  for (const k in SPRITES) delete SPRITES[k];
  setSeed(SEED);
  for (const f in FIELDS) delete FIELDS[f];

  PHYSICS.enabled = false;
  PHYSICS.gravity = { x: 0, y: 0 };
  PHYSICS.damping = 1.0;
  PHYSICS.bounds = 'none';

  let currentTime = 0;
  let inSequence = false;
  let sequenceNotes = [];

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  function pushEvent(ev) {
    timeline.push(ev);
    ALL_EVENTS.push({...ev}); // immutable copy for scrubbing
  }

  try {
    for (let li = 0; li < lines.length; li++) {
      const raw = lines[li];
      let line = raw;
      if (line.startsWith("sequence {")) { inSequence = true; sequenceNotes = []; continue; }
      if (line === "}" && inSequence) {
        pushEvent({ type: "sequence", notes: sequenceNotes, time: currentTime });
        currentTime += sequenceNotes.length * (60 / tempoBPM) * 1000;
        inSequence = false; continue;
      }
      if (inSequence) { sequenceNotes.push(...line.split(/\s+/)); continue; }

      const parts = line.split(/\s+/);
      const cmd = parts[0];
      const kvPairs = Object.fromEntries(parts.slice(1).filter(p=>p.includes("=")).map(p=>p.split("=")));
      function getId(){ return kvPairs.id || null; }
      function getZ(){ return Number(kvPairs.z ?? 0) || 0; }

      switch (cmd) {
        case "seed": {
          const n = parseInt(parts[1],10);
          if (Number.isFinite(n)) setSeed(n);
          break;
        }
        case "canvas": {
          const cssW = parseInt(parts[1]), cssH = parseInt(parts[2]);
          setCanvasSize(canvas, cssW, cssH);
          break;
        }
        case "background":
          CURRENT_BG = parts[1];
          pushEvent({ type: "background", color: parts[1], time: currentTime });
          break;

        case "backgroundnoise": {
          const scale = parseFloat(parts[1]) || 1.2;
          const speed = parseFloat(parts[2]) || 0.15;
          const c1 = parts[4] || "#0a0f1a";
          const c2 = parts[5] || "#162035";
          BG_NOISE = { scale, speed, colors:[c1,c2], phase: 0 };
          break;
        }

        case "tempo": {
          const bpm = parseInt(parts[1]);
          if (!Number.isFinite(bpm) || bpm <= 0) throw new Error("tempo must be a positive number");
          tempoBPM = bpm;
          break;
        }

        // Shapes (mirror as live genshape if id exists), support z=
        case "circle": {
          const [x, y, r] = parts.slice(1, 4).map(Number);
          const color = parts.includes("color") ? parts[parts.indexOf("color") + 1] : "#FFF";
          const id = getId(); const z = getZ();
          const shape = { type: "circle", id, z, x, y, r, color };
          DRAWN_OBJECTS.push(shape);
          pushEvent({ type: "draw", shape: "circle", ...shape, time: currentTime });
          if (id) SPRITES[id] = { id, z, type: 'genshape', ref: shape, x, y, scale: 1 };
          break;
        }
        case "rect": {
          const [x, y, w, h] = parts.slice(1, 5).map(Number);
          const color = parts.includes("color") ? parts[parts.indexOf("color") + 1] : "#FFF";
          const id = getId(); const z = getZ();
          const shape = { type: "rect", id, z, x, y, w, h, color };
          DRAWN_OBJECTS.push(shape);
          pushEvent({ type: "draw", shape: "rect", ...shape, time: currentTime });
          if (id) SPRITES[id] = { id, z, type: 'genshape', ref: shape, x, y, scale: 1 };
          break;
        }
        case "line": {
          const [x1, y1, x2, y2] = parts.slice(1, 5).map(Number);
          const color = parts.includes("color") ? parts[parts.indexOf("color") + 1] : "#FFF";
          const width = parts.includes("width") ? parseFloat(parts[parts.indexOf("width") + 1]) : 1;
          const id = getId(); const z = getZ();
          const shape = { type: "line", id, z, x1, y1, x2, y2, width, color };
          DRAWN_OBJECTS.push(shape);
          pushEvent({ type: "draw", shape: "line", ...shape, time: currentTime });
          break;
        }
        case "blob": {
          const [x,y,r,points,jitter] = parts.slice(1,6).map(Number);
          const color = parts.includes("color") ? parts[parts.indexOf("color")+1] : "#77ffaa";
          const id = getId(); const z = getZ();
          const speed = parseFloat(kvPairs.speed||"0.4");
          const phase = randRange(0,Math.PI*2);
          const shape = { type:"blob", id, z, x, y, r, points, jitter, color, speed, phase };
          DRAWN_OBJECTS.push(shape);
          pushEvent({ type:"draw", shape:"blob", ...shape, time: currentTime });
          if (id) SPRITES[id] = { id, z, type: 'genshape', ref: shape, x, y, scale: 1 };
          break;
        }
        case "star": {
          const [x,y,rO,rI,pts] = parts.slice(1,6).map(Number);
          const color = parts.includes("color") ? parts[parts.indexOf("color")+1] : "#ffd84a";
          const id = getId(); const z = getZ();
          const rot = parseFloat(kvPairs.rot||"0");
          const shape = { type:"star", id, z, x, y, rOuter:rO, rInner:rI, points:pts, color, rot };
          DRAWN_OBJECTS.push(shape);
          pushEvent({ type:"draw", shape:"star", ...shape, time: currentTime });
          if (id) SPRITES[id] = { id, z, type: 'genshape', ref: shape, x, y, scale: 1 };
          break;
        }
        case "poly": {
          const [x,y,rad,sides] = parts.slice(1,5).map(Number);
          const color = parts.includes("color") ? parts[parts.indexOf("color")+ 1] : "#a0c";
          const id = getId(); const z = getZ();
          const rot = parseFloat(kvPairs.rot||"0");
          const shape = { type:"poly", id, z, x, y, radius:rad, sides, color, rot };
          DRAWN_OBJECTS.push(shape);
          pushEvent({ type:"draw", shape:"poly", ...shape, time: currentTime });
          if (id) SPRITES[id] = { id, z, type: 'genshape', ref: shape, x, y, scale: 1 };
          break;
        }

        // Fields & Behaviors
        case "field": {
          const type = parts[1];
          const kv = Object.fromEntries(parts.slice(2).filter(p=>p.includes("=")).map(p=>p.split("=")));
          const id = kv.id || `f${Object.keys(FIELDS).length+1}`;
          if (type === "noise") {
            FIELDS[id] = { id, type: 'noise',
              scale: parseFloat(kv.scale || "0.005"),
              speed: parseFloat(kv.speed || "0.25"),
              strength: parseFloat(kv.strength || "40") };
          } else if (type === "attractor") {
            FIELDS[id] = { id, type: 'attractor',
              x: parseFloat(kv.x || "400"),
              y: parseFloat(kv.y || "300"),
              strength: parseFloat(kv.strength || "60"),
              falloff: parseFloat(kv.falloff || "0.8") };
          } else throw new Error("unknown field type");
          break;
        }
        case "behavior": {
          const targetId = parts[1];
          const tgt = SPRITES[targetId] || DRAWN_OBJECTS.find(o=>o.id===targetId);
          if(!tgt){ console.warn("behavior target not found", targetId); break; }
          if (parts.includes("use")) {
            const fId = parts[parts.indexOf("use")+1];
            const mix = parts.includes("mix") ? parseFloat(parts[parts.indexOf("mix")+1]) : 1.0;
            tgt.behavior = { mode:'field', fieldId:fId, mix: isFinite(mix)?mix:1.0 };
          } else if (parts[2] === "orbit") {
            const cx = parseFloat(parts[3]), cy = parseFloat(parts[4]);
            const radius = parseFloat(parts[5]), speed = parseFloat(parts[6]||"0.6");
            tgt.behavior = { mode:'orbit', cx, cy, radius, speed, theta: RNG()*Math.PI*2 };
          }
          break;
        }
        case "drift": {
          const id = parts[1]; const ax = parseFloat(parts[2]), ay = parseFloat(parts[3]), f = parseFloat(parts[4]);
          const s = SPRITES[id] || DRAWN_OBJECTS.find(o=>o.id===id);
          if(s) s.wiggle = { ampX:ax, ampY:ay, freq:f };
          break;
        }

        // Audio – push into scheduler queue (not scheduled yet; AudioScheduler consumes by wallclock)
        case "sound": {
          const freq = parseFloat(parts[1]);
          const durSecs = parseFloat(parts[2]);
          if (!Number.isFinite(freq) || !Number.isFinite(durSecs))
            throw new Error("sound expects: sound FREQ SECONDS");
          pushEvent({ type: "sound", freq, dur: durSecs, time: currentTime });
          currentTime += durSecs * 1000;
          break;
        }
        case "play": {
          const note = parts[1];
          if (!noteMap[note]) throw new Error(`unknown note: ${note}`);
          pushEvent({ type: "play", note, time: currentTime });
          currentTime += (60 / tempoBPM) * 1000;
          break;
        }
        case "delay": {
          const ms = parseInt(parts[1]);
          if (!Number.isFinite(ms) || ms < 0) throw new Error("delay expects milliseconds");
          currentTime += ms;
          break;
        }

        // Procedural sprite turtle
        case "sprite": {
          const name = parts[1];
          const action = parts[2] || "";
          const kv = Object.fromEntries(parts.slice(3).map(tok => tok.split("=")).filter(a => a.length === 2));
          const x = Number(kv.x ?? 100);
          const y = Number(kv.y ?? 520);
          const scale = Number(kv.scale ?? 1);
          const color = kv.color || null;
          const id = kv.id || 'turtle';
          const z = Number(kv.z ?? 0) || 0;
          if (name !== "turtle") throw new Error(`unknown sprite: ${name}`);
          SPRITES[id] = { id, z, type: 'proc-turtle', x, y, scale, color, action, physics: false, playing: false };
          pushEvent({ type: "drawsprite", id, time: currentTime });
          break;
        }

        // Assets
        case "asset": {
          const kind = parts[1];
          if (kind === "image") {
            const key = parts[2];
            const src = line.match(/"([^"]+)"/)?.[1];
            if (!src) throw new Error('asset image missing "src"');
            loadImage(src).then(img => (ASSETS.images[key] = img));
          } else if (kind === "spritesheet") {
            const key = (parts[2] || "sheet") + (parts[3] ? "_" + parts[3] : "");
            const src = line.match(/"([^"]+)"/)?.[1];
            const fIdx = parts.indexOf("frame");
            const framesIdx = parts.indexOf("frames");
            const fpsIdx = parts.indexOf("fps");
            if (fIdx === -1 || framesIdx === -1) throw new Error("spritesheet requires frame WxH and frames N");
            const [fw, fh] = parts[fIdx + 1].split("x").map(Number);
            const frames = parseInt(parts[framesIdx + 1]);
            const fps = fpsIdx !== -1 ? parseInt(parts[fpsIdx + 1]) : 8;
            loadImage(src).then(img => { ASSETS.sheets[key] = { img, frameW: fw, frameH: fh, frames, fps }; });
          } else throw new Error("unknown asset kind");
          break;
        }

        // Sprite instances from assets
        case "spriteimg": {
          const id = parts[1];
          if (!id) throw new Error("spriteimg requires an id");
          const fromIdx = parts.indexOf("from");
          const atIdx = parts.indexOf("at");
          if (fromIdx === -1 || atIdx === -1) throw new Error("spriteimg missing 'from' or 'at'");
          const kind = parts[fromIdx + 1];
          const key = parts[fromIdx + 2];
          const x = parseFloat(parts[atIdx + 1]);
          const y = parseFloat(parts[atIdx + 2]);
          const scaleIdx = parts.indexOf("scale");
          const scale = scaleIdx !== -1 ? parseFloat(parts[scaleIdx + 1]) : 1;
          const z = Number((parts.find(p=>p.startsWith("z="))||"").split("=")[1]||0) || 0;

          if (kind === "image") {
            if (!ASSETS.images[key]) console.warn(`image asset '${key}' not loaded yet`);
            SPRITES[id] = { id, z, type: 'image', key, x, y, scale, physics: false };
          } else if (kind === "spritesheet") {
            if (!ASSETS.sheets[key]) console.warn(`spritesheet asset '${key}' not loaded yet`);
            SPRITES[id] = { id, z, type: 'sheet', key, x, y, scale, frame: 0, playing: false, physics: false };
          } else throw new Error("spriteimg 'from' must be 'image' or 'spritesheet'");
          pushEvent({ type: "drawsprite", id, time: currentTime });
          break;
        }

        case "playframes": { const id = parts[1]; if (SPRITES[id]) SPRITES[id].playing = true; break; }
        case "stopframes": { const id = parts[1]; if (SPRITES[id]) SPRITES[id].playing = false; break; }
        case "setfps":    { const id = parts[1]; const fps = parseFloat(parts[2]); if (SPRITES[id]) SPRITES[id].fps = fps; break; }

        // Physics toggles and params
        case "physics": { PHYSICS.enabled = (parts[1] === "on"); break; }
        case "gravity": { PHYSICS.gravity.x = parseFloat(parts[1]); PHYSICS.gravity.y = parseFloat(parts[2]); break; }
        case "damping": { PHYSICS.damping = parseFloat(parts[1]); break; }
        case "bounds":  { PHYSICS.bounds = parts[1]; break; }
        case "setvel":  { const id = parts[1]; const vx = parseFloat(parts[2]), vy = parseFloat(parts[3]); if (SPRITES[id]) { SPRITES[id].physics = true; SPRITES[id].vx = vx; SPRITES[id].vy = vy; } break; }
        case "impulse": { const id = parts[1]; const ix = parseFloat(parts[2]), iy = parseFloat(parts[3]); if (SPRITES[id]) { SPRITES[id].physics = true; SPRITES[id].vx = (SPRITES[id].vx || 0) + ix; SPRITES[id].vy = (SPRITES[id].vy || 0) + iy; } break; }

        // Wiggle
        case "wiggle": {
          const id = parts[1];
          const a2 = parseFloat(parts[2]), a3 = parseFloat(parts[3]), a4 = parseFloat(parts[4]);
          if (SPRITES[id]) {
            if (isFinite(a2) && isFinite(a3) && isFinite(a4)) SPRITES[id].wiggle = { ampX:a2, ampY:a3, freq:a4 };
            else if (isFinite(a2) && isFinite(a3)) SPRITES[id].wiggle = { amp:a2, freq:a3 };
            else throw new Error("wiggle expects: wiggle <id> ampX ampY freq  OR  wiggle <id> amp freq");
            break;
          }
          const obj = DRAWN_OBJECTS.find(o => o.id === id);
          if (obj) {
            if (isFinite(a2) && isFinite(a3) && isFinite(a4)) obj.wiggle = { ampX:a2, ampY:a3, freq:a4 };
            else if (isFinite(a2) && isFinite(a3)) obj.wiggle = { amp:a2, freq:a3 };
            else throw new Error("wiggle expects: wiggle <id> ampX ampY freq  OR  wiggle <id> amp freq");
            break;
          }
          console.warn("wiggle: no sprite or shape with id", id);
          break;
        }

        // Path shorthand -> animatesprite
        case "path": {
          const id = parts[1];
          const arrow = parts.indexOf("->");
          if (arrow === -1) throw new Error("path missing '->'");
          const p1 = parts[2].replace(/[()]/g, "").split(",");
          const p2 = parts[arrow + 1].replace(/[()]/g, "").split(",");
          const durKey = parts.indexOf("duration");
          if (durKey === -1) throw new Error("path missing duration");
          const duration = parseFloat(parts[durKey + 1].replace("s", "")) * 1000;
          let ease = "linear";
          const easeIdx = parts.indexOf("ease"); if (easeIdx !== -1) ease = (parts[easeIdx + 1] || "linear");
          const s = SPRITES[id]; const scale = s?.scale ?? 1;
          const from = [parseFloat(p1[0]), parseFloat(p1[1]), scale];
          const to   = [parseFloat(p2[0]), parseFloat(p2[1]), scale];
          pushEvent({ type: "animatesprite", id, from, to, duration, ease, time: currentTime });
          currentTime += duration;
          currentScene.duration = Math.max(currentScene.duration || 0, currentTime / 1000);
          break;
        }

        // Animate
        case "animate": {
          const shape = parts[1];
          if (shape === "sprite") {
            const id = parts[2];
            const arrowIndex = parts.indexOf("->");
            if (arrowIndex === -1) throw new Error("animate sprite missing '->'");
            const from = parts.slice(3, arrowIndex).map(Number);
            const to = parts.slice(arrowIndex + 1, arrowIndex + 4).map(Number);
            const durKey = parts.indexOf("duration");
            if (durKey === -1) throw new Error("animate missing duration");
            const duration = parseFloat(parts[durKey + 1].replace("s", "")) * 1000;
            let ease = "linear";
            const easeIdx = parts.indexOf("ease"); if (easeIdx !== -1) ease = (parts[easeIdx + 1] || "linear");
            pushEvent({ type: "animatesprite", id, from, to, duration, ease, time: currentTime });
            currentTime += duration;
            currentScene.duration = Math.max(currentScene.duration || 0, currentTime / 1000);
            break;
          }
          const from = parts.slice(2, 5).map(Number);
          const to = parts.slice(6, 9).map(Number);
          const durKey = parts.indexOf("duration");
          if (durKey === -1) throw new Error("animate missing duration");
          const duration = parseFloat(parts[durKey + 1].replace("s", "")) * 1000;
          const fromColor = parts.includes("fromColor") ? parts[parts.indexOf("fromColor") + 1] : null;
          const toColor = parts.includes("toColor") ? parts[parts.indexOf("toColor") + 1] : null;
          let ease = "linear";
          const easeIdx = parts.indexOf("ease"); if (easeIdx !== -1) ease = (parts[easeIdx + 1] || "linear");
          pushEvent({ type: "animate", shape, from, to, duration, fromColor, toColor, ease, time: currentTime });
          currentTime += duration;
          currentScene.duration = Math.max(currentScene.duration || 0, currentTime / 1000);
          break;
        }

        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    }
  } catch (err) {
    const idx = rawLines.findIndex(l => l.replace(/\/\/.*$/,"").trim() === lines[timeline.length]?.trim());
    const lineNum = isFinite(idx) && idx >= 0 ? (idx+1) : "?";
    throw new Error(`${err.message} (at line ${lineNum})`);
  }
}

// ------------------------------
// Play loop / drawing
// ------------------------------
function startScene(ctx, canvas) {
  animations = [];
  startTime = performance.now();
  lastNow = startTime;
  // Audio queue based on ALL_EVENTS
  AudioScheduler.clear();
  for (const ev of ALL_EVENTS) {
    if (ev.type === "play") {
      AudioScheduler.push({ whenMs: ev.time, note: ev.note, durSec: 60/tempoBPM*0.9 });
    } else if (ev.type === "sound") {
      AudioScheduler.push({ whenMs: ev.time, freq: ev.freq, durSec: ev.dur });
    } else if (ev.type === "sequence") {
      const beat = 60/tempoBPM*1000;
      ev.notes.forEach((n, i) => {
        if (noteMap[n]) AudioScheduler.push({ whenMs: ev.time + i*beat, note: n, durSec: beat/1000*0.9 });
      });
    }
  }
  AudioScheduler.start();

  pauseOffset = 0;
  paused = false;
  requestAnimationFrame(now => loop(now, ctx, canvas));
}

function loop(now, ctx, canvas) {
  if (paused) return;

  const elapsed = now - startTime;
  const timeSec = elapsed / 1000;
  const dtSec = Math.min(0.05, (now - (lastNow || now)) / 1000);
  lastNow = now;

  // Physics + frame stepping
  stepPhysics(dtSec, canvas);
  for (const id in SPRITES) stepSpriteAnimation(SPRITES[id], dtSec);

  // Process timeline events whose time has arrived
  while (timeline.length && elapsed >= timeline[0].time) {
    const item = timeline.shift();
    switch (item.type) {
      case "background": CURRENT_BG = item.color; break;
      case "draw":
      case "drawsprite": break;
      case "animate":
      case "animatesprite": animations.push({ ...item, start: now }); break;
      // audio events are handled by AudioScheduler; skip here
    }
  }

  // Behaviors
  const t = timeSec;
  function applyBehaviorTo(obj, dt){
    const b = obj.behavior; if(!b) return;
    if (typeof obj.x !== "number" || typeof obj.y !== "number") return;
    if (b.mode === 'field'){
      const f = FIELDS[b.fieldId];
      const {vx,vy} = fieldVelocity(f, obj.x, obj.y, t);
      const mix = clamp01(b.mix ?? 1.0);
      obj.x += vx * mix * dt;
      obj.y += vy * mix * dt;
    } else if (b.mode === 'orbit'){
      b.theta = (b.theta ?? 0) + (b.speed ?? 0.6) * dt;
      obj.x = b.cx + Math.cos(b.theta)*b.radius;
      obj.y = b.cy + Math.sin(b.theta)*b.radius;
    }
  }
  for (const o of DRAWN_OBJECTS) applyBehaviorTo(o, dtSec);
  for (const sid in SPRITES) applyBehaviorTo(SPRITES[sid], dtSec);

  // Clear & background
  const w = canvas.width/(window.devicePixelRatio||1), h = canvas.height/(window.devicePixelRatio||1);
  ctx.clearRect(0, 0, w, h);

  if (BG_NOISE) {
    BG_NOISE.phase += dtSec * BG_NOISE.speed;
    const g = ctx.createLinearGradient(
      0, 0,
      w * (0.6 + 0.4*Math.sin(BG_NOISE.phase*0.7)),
      h * (0.6 + 0.4*Math.cos(BG_NOISE.phase*0.9))
    );
    g.addColorStop(0, BG_NOISE.colors[0]);
    g.addColorStop(1, BG_NOISE.colors[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    const cells = Math.floor(60 * BG_NOISE.scale);
    const cw = w/cells, ch = h/cells;
    ctx.globalAlpha = 0.06;
    for(let i=0;i<cells;i++){
      for(let j=0;j<cells;j++){
        const n = 0.5 + 0.5*Math.sin((i*1.7 + j*2.3)*0.35 + BG_NOISE.phase*2.0);
        ctx.fillStyle = `rgba(255,255,255,${n})`;
        ctx.fillRect(i*cw, j*ch, cw, ch);
      }
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = CURRENT_BG; ctx.fillRect(0, 0, w, h);
  }

  // Sort and draw retained shapes by z
  const retained = DRAWN_OBJECTS.slice().sort((a,b)=>(a.z||0)-(b.z||0));
  for (const obj of retained) {
    if (obj.id && SPRITES[obj.id] && SPRITES[obj.id].type === 'genshape') continue;
    let ox = 0, oy = 0;
    if (obj.wiggle && startTime != null) {
      const freq = obj.wiggle.freq || 1;
      const ampX = obj.wiggle.ampX || obj.wiggle.amp || 0;
      const ampY = obj.wiggle.ampY || obj.wiggle.amp || 0;
      ox = Math.sin(timeSec * Math.PI * 2 * freq) * ampX;
      oy = Math.cos(timeSec * Math.PI * 2 * freq) * ampY;
    }
    if (obj.type === "circle") {
      ctx.beginPath(); ctx.arc(obj.x + ox, obj.y + oy, obj.r, 0, 2 * Math.PI);
      ctx.fillStyle = obj.color || "#FFF"; ctx.fill();
    } else if (obj.type === "rect") {
      ctx.fillStyle = obj.color || "#FFF"; ctx.fillRect(obj.x + ox, obj.y + oy, obj.w, obj.h);
    } else if (obj.type === "line") {
      ctx.beginPath(); ctx.strokeStyle = obj.color || "#FFF"; ctx.lineWidth = obj.width || 1;
      ctx.moveTo(obj.x1 + ox, obj.y1 + oy); ctx.lineTo(obj.x2 + ox, obj.y2 + oy); ctx.stroke();
    } else if (obj.type === "star") {
      drawStar(ctx, obj.x + ox, obj.y + oy, obj.rOuter, obj.rInner, obj.points, obj.color, obj.rot || 0);
    } else if (obj.type === "poly") {
      drawPoly(ctx, obj.x + ox, obj.y + oy, obj.radius, obj.sides, obj.color, obj.rot || 0);
    } else if (obj.type === "blob") {
      drawBlob(ctx, { ...obj, x: obj.x + ox, y: obj.y + oy }, timeSec);
    }
  }

  // Draw sprites by z
  const spritesSorted = Object.values(SPRITES).slice().sort((a,b)=>(a.z||0)-(b.z||0));
  for (const s of spritesSorted) drawSprite(ctx, s);

  // Active animations
  animations = animations.filter(anim => {
    let t = Math.min((now - anim.start) / anim.duration, 1);
    t = applyEase(t, anim.ease);
    if (anim.type === "animate") {
      const color = anim.fromColor && anim.toColor ? interpolateColor(anim.fromColor, anim.toColor, t) : null;
      if (anim.shape === "circle") {
        const [x1, y1, r1] = anim.from, [x2, y2, r2] = anim.to;
        const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t, r = r1 + (r2 - r1) * t;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = color || "#FF00FF"; ctx.fill();
      } else if (anim.shape === "rect") {
        const [x1, y1, w1] = anim.from, [x2, y2, w2] = anim.to;
        const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t, w2h = w1 + (w2 - w1) * t;
        ctx.fillStyle = color || "#00FFFF"; ctx.fillRect(x, y, w2h, w2h);
      }
    } else if (anim.type === "animatesprite") {
      const s = SPRITES[anim.id]; if (!s) return false;
      const [x1, y1, sc1] = anim.from, [x2, y2, sc2] = anim.to;
      s.x = x1 + (x2 - x1) * t; s.y = y1 + (y2 - y1) * t; s.scale = sc1 + (sc2 - sc1) * t;
    }
    return t < 1;
  });

  // meter warm
  if (MASTER.analyser) getLevels();

  // scrubber
  const scrubber = document.getElementById("timeline-scrubber");
  if (scrubber && currentScene.duration) {
    scrubber.value = Math.min((elapsed / (currentScene.duration * 1000)) * 100, 100);
  }

  if (timeline.length > 0 || animations.length > 0 || Object.keys(SPRITES).length > 0) {
    requestAnimationFrame(n => loop(n, ctx, canvas));
  }
}

// ------------------------------
// Scrub renderer (rebuild state at arbitrary time, no audio)
// ------------------------------
function renderAtTime(ctx, canvas, code, elapsedMs) {
  // full reset, parse, then apply events up to elapsedMs; DO NOT mutate audio
  parseAndSchedule(code, ctx, canvas, true);

  // Apply background events up to time
  const past = ALL_EVENTS.filter(ev => ev.time <= elapsedMs);
  // Apply animations by sampling their t at elapsed
  const anims = ALL_EVENTS.filter(ev => (ev.type === "animate" || ev.type === "animatesprite") && ev.time <= elapsedMs);

  // background last
  const lastBg = past.filter(e=>e.type==="background").slice(-1)[0];
  if (lastBg) CURRENT_BG = lastBg.color;

  // compute sprites positions for animatesprite
  for (const ev of anims) {
    const localT = clamp01((elapsedMs - ev.time) / ev.duration);
    const t = applyEase(localT, ev.ease);
    if (ev.type === "animatesprite") {
      const s = SPRITES[ev.id]; if (!s) continue;
      const [x1, y1, sc1] = ev.from, [x2, y2, sc2] = ev.to;
      s.x = x1 + (x2 - x1) * t;
      s.y = y1 + (y2 - y1) * t;
      s.scale = sc1 + (sc2 - sc1) * t;
    }
  }

  // one still frame draw
  const w = canvas.width/(window.devicePixelRatio||1), h = canvas.height/(window.devicePixelRatio||1);
  const timeSec = elapsedMs/1000;

  // bg
  const gctx = ctx;
  gctx.clearRect(0,0,w,h);
  if (BG_NOISE) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, BG_NOISE.colors[0]); g.addColorStop(1, BG_NOISE.colors[1]);
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
  } else {
    ctx.fillStyle = CURRENT_BG; ctx.fillRect(0,0,w,h);
  }

  // shapes by z
  const retained = DRAWN_OBJECTS.slice().sort((a,b)=>(a.z||0)-(b.z||0));
  for (const obj of retained) {
    if (obj.id && SPRITES[obj.id] && SPRITES[obj.id].type === 'genshape') continue;
    if (obj.type === "circle") { ctx.beginPath(); ctx.arc(obj.x, obj.y, obj.r, 0, 2*Math.PI); ctx.fillStyle = obj.color||"#FFF"; ctx.fill(); }
    else if (obj.type === "rect") { ctx.fillStyle = obj.color||"#FFF"; ctx.fillRect(obj.x, obj.y, obj.w, obj.h); }
    else if (obj.type === "line") { ctx.beginPath(); ctx.strokeStyle = obj.color||"#FFF"; ctx.lineWidth = obj.width||1; ctx.moveTo(obj.x1, obj.y1); ctx.lineTo(obj.x2, obj.y2); ctx.stroke(); }
    else if (obj.type === "star") { drawStar(ctx, obj.x, obj.y, obj.rOuter, obj.rInner, obj.points, obj.color, obj.rot||0); }
    else if (obj.type === "poly") { drawPoly(ctx, obj.x, obj.y, obj.radius, obj.sides, obj.color, obj.rot||0); }
    else if (obj.type === "blob") { drawBlob(ctx, obj, timeSec); }
  }
  const spritesSorted = Object.values(SPRITES).slice().sort((a,b)=>(a.z||0)-(b.z||0));
  for (const s of spritesSorted) drawSprite(ctx, s);
}

// ------------------------------
// Public API (global) + UI wiring
// ------------------------------
function getCanvasAndCtx() {
  const canvas = document.getElementById("canvas");
  if (!canvas) return {};
  const ctx = canvas.getContext("2d");
  return { canvas, ctx };
}

async function runFromText(code) {
  const { canvas, ctx } = getCanvasAndCtx();
  if (!canvas || !ctx) return;

  // show loading
  const box = document.getElementById("error-box");
  box && (box.style.display = 'none', box.textContent = '');

  // Parse immediately (will queue asset loads)
  try {
    parseAndSchedule(code, ctx, canvas);
  } catch (err) {
    if (box) { box.style.display = 'block'; box.textContent = `Parse error: ${err.message}`; }
    throw err;
  }

  // Wait for assets deterministically before starting
  const loadingEl = document.getElementById("loading-indicator");
  if (loadingEl) { loadingEl.style.display = 'block'; loadingEl.textContent = 'Loading assets…'; }
  await waitAssetsReady().catch(()=>{});
  if (loadingEl) loadingEl.style.display = 'none';

  // Kick the scene
  currentScene.code = code || "";
  startScene(ctx, canvas);
}

function renderInitial() {
  const { canvas, ctx } = getCanvasAndCtx();
  if (!canvas || !ctx) return;
  const w = canvas.width/(window.devicePixelRatio||1), h = canvas.height/(window.devicePixelRatio||1);
  ctx.clearRect(0, 0, w, h);
  if (BG_NOISE) {
    const g = ctx.createLinearGradient(0,0,w,h);
    g.addColorStop(0, BG_NOISE.colors[0]); g.addColorStop(1, BG_NOISE.colors[1]);
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
  } else {
    ctx.fillStyle = CURRENT_BG; ctx.fillRect(0, 0, w, h);
  }
  const retained = DRAWN_OBJECTS.slice().sort((a,b)=>(a.z||0)-(b.z||0));
  for (const obj of retained) {
    if (obj.id && SPRITES[obj.id] && SPRITES[obj.id].type === 'genshape') continue;
    if (obj.type === "circle") { ctx.beginPath(); ctx.arc(obj.x, obj.y, obj.r, 0, 2 * Math.PI); ctx.fillStyle = obj.color || "#FFF"; ctx.fill(); }
    else if (obj.type === "rect") { ctx.fillStyle = obj.color || "#FFF"; ctx.fillRect(obj.x, obj.y, obj.w, obj.h); }
    else if (obj.type === "line") { ctx.beginPath(); ctx.strokeStyle = obj.color || "#FFF"; ctx.lineWidth = obj.width || 1; ctx.moveTo(obj.x1, obj.y1); ctx.lineTo(obj.x2, obj.y2); ctx.stroke(); }
    else if (obj.type === "star") { drawStar(ctx, obj.x, obj.y, obj.rOuter, obj.rInner, obj.points, obj.color, obj.rot||0); }
    else if (obj.type === "poly") { drawPoly(ctx, obj.x, obj.y, obj.radius, obj.sides, obj.color, obj.rot||0); }
    else if (obj.type === "blob") { drawBlob(ctx, obj, 0); }
  }
}

// ---------- NL → DSL (unchanged, left as-is) ----------
const COLOR_WORDS = {
  red:"#FF3B30", green:"#34C759", blue:"#0A84FF", yellow:"#FFD60A", purple:"#BF5AF2",
  white:"#FFFFFF", black:"#000000", pink:"#FF2D55", orange:"#FF9F0A", cyan:"#32ADE6"
};
const PALETTES = {
  neon: ["#13F1FF","#00E1B4","#FF3CAC","#784BA0","#FAFF00"],
  pastel: ["#A3E4DB","#F9D5E5","#E2F0CB","#B5EAEA","#FFCFDF"],
  synth: ["#3A0CA3","#7209B7","#F72585","#4CC9F0","#4361EE"]
};
function pickPalette(name){ const p = PALETTES[name]; if(!p) return null; return [...p]; }
function naturalToDSL(input){
  const txt = input.toLowerCase().trim();
  const dsl = [];
  const w = 800, h = 600;
  dsl.push(`canvas ${w} ${h}`);
  const seedMatch = txt.match(/seed\s*(\d+)/);
  if (seedMatch) dsl.push(`seed ${parseInt(seedMatch[1],10)}`);
  const slow = /\bslow(ly)?\b/.test(txt);
  const fast = /\bfast\b/.test(txt);
  const tempo = slow?60: fast?140: 100;
  dsl.push(`tempo ${tempo}`);

  let palette = null;
  if (/\bneon\b/.test(txt)) palette = pickPalette("neon");
  else if (/\bpastel\b/.test(txt)) palette = pickPalette("pastel");
  else if (/\bsynth(wave)?\b/.test(txt)) palette = pickPalette("synth");

  if (/\b(noise|grain|texture|atmosphere|atmospheric)\b/.test(txt)) {
    const c1 = palette ? palette[Math.floor(RNG()*palette.length)] : "#0b1022";
    const c2 = palette ? palette[Math.floor(RNG()*palette.length)] : "#1c2a4a";
    dsl.push(`backgroundnoise 1.2 ${slow?0.08:0.18} color ${c1} ${c2}`);
  } else {
    dsl.push(`background ${palette ? palette[0] : "#000000"}`);
  }

  const count = Math.max(1, parseInt((txt.match(/(\d+)\s+(blob|star|poly|polygon|circle|square|rect)/)||[])[1]||0,10)) || (/\bseveral|many\b/.test(txt)?8: /\bfew\b/.test(txt)?3: 1);
  const hasTurtle = /turtle/.test(txt);
  const wantBlobs = /blob|organic|amoeba|wobbly/.test(txt);
  const wantStars = /star/.test(txt);
  const wantPoly  = /poly(gon)?/.test(txt);
  const wantCircles = /circle/.test(txt);
  const wantRects   = /(rect|square)/.test(txt);

  const drift = /\bdrift(ing)?\b/.test(txt) || /\bfloating?\b/.test(txt) || /\bbob(bing)?\b/.test(txt);
  const wiggle = /\bwiggl(ing|y)?\b/.test(txt);

  const leftToRight = /(left\s*to\s*right|across)/.test(txt);
  const rightToLeft = /(right\s*to\s*left)/.test(txt);

  const spacing = w/(count+1);
  for (let i=0;i<count;i++){
    const cx = Math.round(spacing*(i+1));
    const cy = Math.round(h*0.5 + Math.sin(i)*60);
    const color = palette ? palette[i%palette.length] :
      (COLOR_WORDS[(txt.match(/\b(red|green|blue|yellow|purple|white|black|pink|orange|cyan)\b/)||[])[1]] || "#FFFFFF");

    if (wantBlobs) {
      const r = randRange(30, 70);
      const points = Math.floor(randRange(12, 22));
      const jitter = r*randRange(0.2, 0.45);
      const speed = slow?0.15:fast?0.5:0.3;
      const id = `blob${i+1}`;
      dsl.push(`blob ${cx} ${cy} ${Math.round(r)} ${points} ${Math.round(jitter)} color ${color} id=${id} speed ${speed}`);
      if (wiggle) dsl.push(`wiggle ${id} ${Math.round(randRange(4,16))} ${Math.round(randRange(4,16))} ${randRange(0.15,0.5).toFixed(2)}`);
    } else if (wantStars) {
      const rO = randRange(35,70), rI = rO*randRange(0.35,0.55);
      const pts = Math.floor(randRange(5,8));
      const id = `star${i+1}`;
      dsl.push(`star ${cx} ${cy} ${Math.round(rO)} ${Math.round(rI)} ${pts} color ${color} id=${id} rot ${Math.round(randRange(0,45))}`);
      if (wiggle) dsl.push(`wiggle ${id} ${Math.round(randRange(3,10))} ${Math.round(randRange(3,10))} ${randRange(0.2,0.6).toFixed(2)}`);
    } else if (wantPoly) {
      const rad = randRange(30,70);
      const sides = Math.floor(randRange(5,8));
      const id = `poly${i+1}`;
      dsl.push(`poly ${cx} ${cy} ${Math.round(rad)} ${sides} color ${color} id=${id} rot ${Math.round(randRange(0,45))}`);
      if (wiggle) dsl.push(`wiggle ${id} ${Math.round(randRange(2,12))} ${Math.round(randRange(2,12))} ${randRange(0.2,0.6).toFixed(2)}`);
    } else if (wantCircles) {
      dsl.push(`circle ${cx} ${cy} ${Math.round(randRange(24,50))} color ${color} id=c${i+1}`);
      if (wiggle) dsl.push(`wiggle c${i+1} ${Math.round(randRange(3,10))} ${Math.round(randRange(3,10))} ${randRange(0.2,0.6).toFixed(2)}`);
    } else if (wantRects) {
      dsl.push(`rect ${cx-25} ${cy-25} 50 50 color ${color} id=r${i+1}`);
      if (wiggle) dsl.push(`wiggle r${i+1} ${Math.round(randRange(3,10))} ${Math.round(randRange(3,10))} ${randRange(0.2,0.6).toFixed(2)}`);
    }
  }

  if (hasTurtle) {
    dsl.push(`sprite turtle crawling x=80 y=520 scale=1 id=t1`);
    const toX = rightToLeft? 80 : 720;
    const fromX = rightToLeft? 720 : 80;
    const dur = slow?10:fast?5:8;
    dsl.push(`animate sprite t1 ${fromX} 520 1 -> ${toX} 520 1 duration ${dur}s ease in-out`);
    if (slow) dsl.push(`sequence { C3 E3 G3 }`);
    else if (fast) dsl.push(`sequence { C4 E4 G4 C5 }`);
    else dsl.push(`sequence { C4 D4 E4 }`);
  }

  if ((/\bwiggl(ing|y)?\b/.test(txt) || /\bdrift(ing)?\b/.test(txt)) && !hasTurtle && count>0) {
    dsl.push(`field noise id=f1 scale ${slow?0.004:fast?0.008:0.006} speed ${slow?0.14:fast?0.3:0.22} strength ${slow?25:fast?45:35}`);
    const ids1 = dsl.filter(l=>/ id=/.test(l)).map(l=>l.match(/id=([a-z0-9]+)/i)[1]);
    ids1.forEach(id => dsl.push(`behavior ${id} use f1 mix 0.8`));
  }
  if ((/(left\s*to\s*right|across)/.test(txt) || /(right\s*to\s*left)/.test(txt) || /\bdrift(ing)?\b/.test(txt)) && !hasTurtle && count>0) {
    const ids = dsl.filter(l=>/ id=/.test(l)).map(l=>l.match(/id=([a-z0-9]+)/i)[1]);
    const dur = slow?12:fast?6:9;
    const rightToLeft = /(right\s*to\s*left)/.test(txt);
    const fromX = rightToLeft ? 780 : 20;
    const toX   = rightToLeft ? 20 : 780;
    ids.forEach((id,idx)=>{
      const y = 120 + (idx % 8)*50;
      dsl.push(`animate sprite ${id} ${fromX} ${y} 1 -> ${toX} ${y} 1 duration ${dur}s ease in-out`);
    });
  }

  if (!dsl.some(l=>/^(blob|star|poly|circle|rect|sprite)/.test(l))) {
    const pal = palette || pickPalette("neon");
    dsl.push(`backgroundnoise 1.2 ${slow?0.08:0.18} color ${pal[0]} ${pal[1]}`);
    const xs = [200,400,600], cs = [pal[2], pal[3], pal[4]];
    for(let i=0;i<3;i++){
      dsl.push(`blob ${xs[i]} 300 50 18 18 color ${cs[i]} id=b${i+1} speed ${slow?0.12:0.28}`);
      if (/\bwiggl(ing|y)?\b/.test(txt)) dsl.push(`wiggle b${i+1} 6 6 0.3`);
    }
    dsl.push(`field noise id=f1 scale 0.006 speed 0.22 strength 35`);
    ['b1','b2','b3'].forEach(id => dsl.push(`behavior ${id} use f1 mix 0.8`));
  }
  return dsl.join("\n");
}

// ------------------------------
// Public API exposure
// ------------------------------
window.ShapeSound = {
  // Primary entry point
  async loadFromText(code) { await runFromText(code || ""); },
  // Aliases
  async parseAndRun(code) { await runFromText(code || ""); },
  async run(code) { await runFromText(code || ""); },

  // Playback controls
  play() {
    paused = false;
    startTime = performance.now() - (pauseOffset || 0);
    lastNow = startTime;
    AudioScheduler.start();
    const { canvas, ctx } = getCanvasAndCtx();
    if (!ctx || !canvas) return;
    requestAnimationFrame(now => { if (!paused) loop(now, ctx, canvas); });
  },
  pause() {
    if (!paused && startTime != null) {
      pauseOffset = performance.now() - startTime;
    }
    paused = true;
    AudioScheduler.stop();
  },
  resume() { this.play(); },

  // True scrubbing: rebuild & draw a still frame at % (no audio)
  seek(percent01) {
    if (!currentScene.duration) return;
    percent01 = clamp01(percent01||0);
    pauseOffset = currentScene.duration * 1000 * percent01;
    paused = true;
    const { canvas, ctx } = getCanvasAndCtx();
    if (canvas && ctx && currentScene.code) {
      renderAtTime(ctx, canvas, currentScene.code, pauseOffset);
    }
    const scrubber = document.getElementById("timeline-scrubber");
    if (scrubber) scrubber.value = percent01 * 100;
  },

  render: renderInitial,

  // internals
  _state: () => ({ tempoBPM, CURRENT_BG, BG_NOISE, DRAWN_OBJECTS, timeline, animations, SPRITES, SEED, FIELDS, ALL_EVENTS }),

  // hooks
  hooks: {
    // audio
    getAC: () => getAC(),
    setMasterVolume: (v) => setMasterVolume(v),
    getLevels: () => getLevels(),
    initAudio: () => { try { unlockAudioOnce(); } catch(_) {} },

    // tempo/seed
    setTempo: (bpm) => { bpm = Number(bpm); if (isFinite(bpm) && bpm > 0) tempoBPM = bpm; },
    setSeed: (n) => setSeed(n),

    // physics
    setPhysics: (on=true) => { PHYSICS.enabled = !!on; },
    setGravity: (x=0, y=0) => { PHYSICS.gravity.x = Number(x)||0; PHYSICS.gravity.y = Number(y)||0; },
    setDamping: (d=1) => { PHYSICS.damping = Number(d)||1; },
    setBounds: (mode='none') => { PHYSICS.bounds = (mode==='canvas')?'canvas':'none'; },

    // sprite nudges
    impulse: (id, ix=0, iy=0) => { const s = SPRITES[id]; if (s){ s.physics = true; s.vx = (s.vx||0)+Number(ix)||0; s.vy = (s.vy||0)+Number(iy)||0; } },
    setVel: (id, vx=0, vy=0) => { const s = SPRITES[id]; if (s){ s.physics = true; s.vx = Number(vx)||0; s.vy = Number(vy)||0; } },
  },

  initAudio() { try { unlockAudioOnce(); } catch(_) {} }
};

// ------------------------------
// DOM wiring
// ------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("canvas");
  if (canvas) {
    // ensure HiDPI is applied to initial size
    const cssW = Number(canvas.getAttribute("width") || 800);
    const cssH = Number(canvas.getAttribute("height") || 600);
    setCanvasSize(canvas, cssW, cssH);
    window.addEventListener("resize", () => {
      // keep CSS size; only reset transform on DPR changes
      setCanvasSize(canvas, cssW, cssH);
    });
  }
  const codeArea = document.getElementById("code");

  document.getElementById("run")?.addEventListener("click", async () => {
    unlockAudioOnce();
    await window.ShapeSound.loadFromText(codeArea?.value || "");
  });

  document.getElementById("play-scene")?.addEventListener("click", () => {
    unlockAudioOnce();
    window.ShapeSound.play();
  });
  document.getElementById("pause-scene")?.addEventListener("click", () => {
    window.ShapeSound.pause();
  });
  document.getElementById("resume-scene")?.addEventListener("click", () => {
    unlockAudioOnce();
    window.ShapeSound.resume();
  });
  document.getElementById("timeline-scrubber")?.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value) / 100;
    window.ShapeSound.seek(isFinite(val) ? val : 0);
  });

  document.getElementById("convert-prompt")?.addEventListener("click", () => {
    const input = document.getElementById("natural-prompt")?.value || "";
    const dsl = naturalToDSL(input);
    if (codeArea) codeArea.value = dsl;
  });

  document.getElementById("example-picker")?.addEventListener("change", (e) => {
    const val = e.target.value;
    const examples = {
      example1: `canvas 800 600
backgroundnoise 1.2 0.18 color #0b1022 #1c2a4a
seed 7
blob 200 300 50 18 18 color #13F1FF id=b1 speed 0.28
blob 400 300 56 20 22 color #00E1B4 id=b2 speed 0.28
blob 600 300 44 16 16 color #FF3CAC id=b3 speed 0.28
wiggle b1 6 4 0.35
wiggle b2 8 6 0.25
wiggle b3 5 7 0.30
field noise id=f1 scale 0.006 speed 0.22 strength 35
behavior b1 use f1 mix 0.8
behavior b2 use f1 mix 0.8
behavior b3 use f1 mix 0.8`,
      example2: `canvas 800 600
background #111
poly 200 300 60 6 color #FF00FF id=p1 rot 15
star 400 300 70 28 7 color #00FFFF id=s1 rot 0
poly 600 300 50 5 color #FFFF00 id=p2 rot -10
wiggle p1 6 6 0.4
wiggle s1 4 8 0.3
wiggle p2 6 6 0.5
field noise id=f1 scale 0.005 speed 0.2 strength 30
behavior p1 use f1 mix 0.8
behavior s1 use f1 mix 0.8
behavior p2 use f1 mix 0.8`,
      example3: `canvas 800 600
backgroundnoise 1.2 0.12 color #0b1022 #1c2a4a
tempo 60
sprite turtle crawling x=100 y=520 scale=1 id=t1
animate sprite t1 100 520 1 -> 700 520 1 duration 8s ease in-out
sequence { C3 E3 G3 }`
    };
    const area = document.getElementById("code");
    if (area) area.value = examples[val] || "";
  });

  document.getElementById("help-toggle")?.addEventListener("click", () => {
    const panel = document.getElementById("help-panel");
    if (!panel) return;
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });

  function updateSavedScenes() {
    const dropdown = document.getElementById("saved-scenes");
    if (!dropdown) return;
    dropdown.innerHTML = "<option value=''>Select Saved Scene</option>";
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith("ss-")) {
        const name = key.slice(3);
        const option = document.createElement("option");
        option.value = name; option.textContent = name;
        dropdown.appendChild(option);
      }
    });
  }
  document.getElementById("save-scene")?.addEventListener("click", () => {
    const name = prompt("Enter name for this scene:");
    if (name) { localStorage.setItem("ss-" + name, document.getElementById("code")?.value || ""); updateSavedScenes(); }
  });
  document.getElementById("delete-scene")?.addEventListener("click", () => {
    const dropdown = document.getElementById("saved-scenes");
    const name = dropdown?.value;
    if (name && confirm("Delete scene '" + name + "'?")) { localStorage.removeItem("ss-" + name); updateSavedScenes(); }
  });
  document.getElementById("saved-scenes")?.addEventListener("change", (e) => {
    const name = e.target.value;
    if (name) {
      const val = localStorage.getItem("ss-" + name);
      const area = document.getElementById("code");
      if (area) area.value = val || "";
    }
  });
  updateSavedScenes();

  document.getElementById("export-png")?.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = "shapesound.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  });
  document.getElementById("copy-code")?.addEventListener("click", () => {
    const area = document.getElementById("code");
    navigator.clipboard.writeText(area?.value || "").then(() => { alert("Code copied to clipboard!"); });
  });
});
