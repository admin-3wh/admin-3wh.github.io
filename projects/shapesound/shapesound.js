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
let currentScene = { duration: 10 };

let paused = false;
let pauseOffset = 0;
let startTime = null;
let lastNow = null;

// Retained drawing state so shapes persist across frames
let CURRENT_BG = "#000000";
let BG_NOISE = null; // {scale, speed, colors:[c1,c2], phase}
const DRAWN_OBJECTS = []; // array of {type, id?, ...shapeProps}

// ------------------------------
// Deterministic RNG (seed)
// ------------------------------
let SEED = 1337, RNG = mulberry32(SEED);
function mulberry32(a){ return function(){ let t=a+=0x6D2B79F5; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; } }
function setSeed(n){ SEED = (n>>>0)||1337; RNG = mulberry32(SEED); }

// ------------------------------
// Assets + Sprites
// ------------------------------
const ASSETS = {
  images: {},  // key -> HTMLImageElement
  sheets: {}   // key -> { img, frameW, frameH, frames, fps }
};

const SPRITES = {};        // id -> sprite object

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

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
// Audio  (shared AudioContext + unlock on first gesture)
// ------------------------------
let AC = null;
let audioUnlocked = false;

// Master chain (so TinyGPT & others can meter / control volume)
// We create lazily at first audio use.
let MASTER = {
  gain: null,        // GainNode
  analyser: null,    // AnalyserNode
  levelBuf: null,    // Float32Array for analysis
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
    MASTER.analyser.fftSize = 512;            // small & cheap
    MASTER.analyser.smoothingTimeConstant = 0.7;

    MASTER.levelBuf = new Float32Array(MASTER.analyser.fftSize / 2);

    // master: [sources]-> gain -> analyser -> destination
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

function playTone(freq, duration = 1) {
  const ctx = getAC();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  osc.connect(gain);
  // Route through master gain so analyser/volume work globally
  gain.connect(MASTER.gain);
  // quick envelope (tiny click guard)
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.9, now + 0.01);
  gain.gain.linearRampToValueAtTime(0.0, now + Math.max(0.05, duration));
  osc.start(now);
  osc.stop(now + Math.max(0.06, duration + 0.01));
}

function playSequence(notes) {
  const beat = 60 / tempoBPM;
  let time = 0;
  for (let note of notes) {
    if (noteMap[note]) {
      setTimeout(() => playTone(noteMap[note], Math.max(0.1, beat * 0.9)), time * 1000);
      time += beat;
    }
  }
}

// Optional lightweight output metering (poll on demand)
function getLevels() {
  if (!MASTER.analyser) return { rms: 0, peak: 0, spectrum: null };
  MASTER.analyser.getFloatFrequencyData(MASTER.levelBuf);
  // Convert to 0..1: analyser returns dB values (negative). We'll compute a crude RMS in linear space.
  // Map dB to linear, average a midband window (avoid DC extremes).
  let sum = 0, peak = -Infinity, n = 0;
  for (let i = 4; i < MASTER.levelBuf.length - 4; i++) {
    const db = MASTER.levelBuf[i];
    if (!isFinite(db)) continue;
    const lin = Math.pow(10, db / 20); // 1.0 at 0 dB
    sum += lin * lin;
    if (db > peak) peak = db;
    n++;
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  const peakLin = Math.pow(10, (isFinite(peak) ? peak : -100) / 20);
  return { rms: rms, peak: peakLin, spectrum: null };
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

// ------------------------------
// Procedural Turtle
// ------------------------------
function drawTurtle(ctx, x, y, scale = 1, colorVariant = null) {
  const greens = ["#228B22", "#2E8B57", "#006400"];
  const shellColor = colorVariant || greens[Math.floor(RNG()*greens.length)];
  const bellyColor = "#654321";
  const eyeColor = "#000000";
  const s = scale;

  // shell
  ctx.fillStyle = shellColor;
  ctx.beginPath();
  ctx.arc(x, y, 40 * s, 0, 2 * Math.PI);
  ctx.fill();

  // belly
  ctx.fillStyle = bellyColor;
  ctx.beginPath();
  ctx.ellipse(x, y + 5 * s, 28 * s, 20 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // head
  ctx.fillStyle = shellColor;
  ctx.fillRect(x + 32 * s, y - 12 * s, 18 * s, 18 * s);

  // eye
  ctx.fillStyle = eyeColor;
  ctx.beginPath();
  ctx.arc(x + 46 * s, y - 4 * s, 2.5 * s, 0, 2 * Math.PI);
  ctx.fill();

  // legs
  ctx.fillStyle = shellColor;
  ctx.fillRect(x - 36 * s, y - 40 * s, 14 * s, 18 * s);
  ctx.fillRect(x + 20 * s, y - 40 * s, 14 * s, 18 * s);
  ctx.fillRect(x - 36 * s, y + 22 * s, 14 * s, 18 * s);
  ctx.fillRect(x + 20 * s, y + 22 * s, 14 * s, 18 * s);

  // tail
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
      if (s.x > canvas.width - pad) { s.x = canvas.width - pad; s.vx = -s.vx; }
      if (s.y > canvas.height - pad) { s.y = canvas.height - pad; s.vy = -s.vy; }
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

// Organic blob using harmonic noise (cheap, animatable)
function drawBlob(ctx, obj, timeSec){
  const {x,y,r,points,jitter,color,phase=0,speed=0.4} = obj;
  const P = points||18, J = jitter||r*0.25;
  const t = phase + timeSec*(speed||0);
  ctx.beginPath();
  for(let i=0;i<P;i++){
    const a = (i/P)*Math.PI*2;
    // two harmonic terms for semi-organic motion
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
// Fields & Behaviors (NEW)
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
// Sprite drawing with wiggle + fallbacks
// ------------------------------
function drawSpriteFallback(ctx, s, x, y) {
  const looksLikeTurtle = (s.key && /turtle/i.test(s.key)) || (s.id && /turtle/i.test(s.id));
  if (looksLikeTurtle) {
    drawTurtle(ctx, x, y, s.scale || 1, null);
    return;
  }
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
  // wiggle offsets (idle)
  let dx = 0, dy = 0;
  if (s.wiggle && lastNow != null && startTime != null) {
    const t = (lastNow - startTime) / 1000; // seconds
    const freq = s.wiggle.freq || 1;
    const ampX = s.wiggle.ampX || s.wiggle.amp || 0;
    const ampY = s.wiggle.ampY || s.wiggle.amp || 0;
    dx = Math.sin(t * Math.PI * 2 * freq) * ampX;
    dy = Math.cos(t * Math.PI * 2 * freq) * ampY;
  }

  const tx = (s.x || 0) + dx;
  const ty = (s.y || 0) + dy;

  if (s.type === 'proc-turtle') {
    const sc = s.scale || 1;
    const col = s.color || null;
    drawTurtle(ctx, tx, ty, sc, col);
    return;
  }

  // NEW: live generative shapes as sprites, so they can wiggle & animate via animatesprite
  if (s.type === 'genshape' && s.ref) {
    const o = s.ref;
    const kind = o.type;
    if (kind === 'star') {
      drawStar(ctx, tx, ty, o.rOuter, o.rInner, o.points, o.color, o.rot || 0);
    } else if (kind === 'poly') {
      drawPoly(ctx, tx, ty, o.radius, o.sides, o.color, o.rot || 0);
    } else if (kind === 'blob') {
      // override x/y for the animated position but preserve other params
      drawBlob(ctx, { ...o, x: tx, y: ty }, (lastNow - startTime)/1000);
    } else if (kind === 'circle') {
      ctx.beginPath();
      ctx.arc(tx, ty, o.r, 0, Math.PI*2);
      ctx.fillStyle = o.color || "#FFF";
      ctx.fill();
    } else if (kind === 'rect') {
      ctx.fillStyle = o.color || "#FFF";
      ctx.fillRect(tx, ty, o.w, o.h);
    }
    return;
  }

  if (s.type === 'image') {
    const img = ASSETS.images[s.key];
    if (!img) {
      drawSpriteFallback(ctx, s, tx, ty);
      return;
    }
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
    if (!sheet) {
      drawSpriteFallback(ctx, s, tx, ty);
      return;
    }
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
// Parser + Runner
// ------------------------------
function parseAndSchedule(script, ctx, canvas) {
  const rawLines = script.split("\n");
  const lines = rawLines.map(l => l.trim()).filter(l => l !== "" && !l.startsWith("//"));

  // reset state
  animations = [];
  timeline = [];
  DRAWN_OBJECTS.length = 0;
  CURRENT_BG = "#000000";
  BG_NOISE = null;
  tempoBPM = 100;
  for (const k in SPRITES) delete SPRITES[k];
  setSeed(SEED); // maintain seed
  for (const f in FIELDS) delete FIELDS[f]; // reset fields

  PHYSICS.enabled = false;
  PHYSICS.gravity = { x: 0, y: 0 };
  PHYSICS.damping = 1.0;
  PHYSICS.bounds = 'none';

  // sequence parsing
  let currentTime = 0;
  let inSequence = false;
  let sequenceNotes = [];

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let raw of lines) {
    let line = raw;
    if (line.startsWith("sequence {")) {
      inSequence = true;
      sequenceNotes = [];
      continue;
    }
    if (line === "}" && inSequence) {
      timeline.push({ type: "sequence", notes: sequenceNotes, time: currentTime });
      currentTime += sequenceNotes.length * (60 / tempoBPM) * 1000;
      inSequence = false;
      continue;
    }
    if (inSequence) {
      sequenceNotes.push(...line.split(/\s+/));
      continue;
    }

    const parts = line.split(/\s+/);
    const cmd = parts[0];

    // helpers to read kv flags like id=foo, speed=0.5, rot=30
    const kvPairs = Object.fromEntries(parts.slice(1).filter(p=>p.includes("=")).map(p=>p.split("=")));
    function getId(){ return kvPairs.id || null; }

    switch (cmd) {
      case "seed": {
        const n = parseInt(parts[1],10);
        if (Number.isFinite(n)) setSeed(n);
        break;
      }
      case "canvas":
        canvas.width = parseInt(parts[1]);
        canvas.height = parseInt(parts[2]);
        break;

      case "background":
        CURRENT_BG = parts[1];
        timeline.push({ type: "background", color: parts[1], time: currentTime });
        break;

      case "backgroundnoise": {
        // backgroundnoise scale speed color #c1 #c2
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

      // Basic shapes (retained; now allow id=) — also mirror as live genshape sprites if id is present
      case "circle": {
        const [x, y, r] = parts.slice(1, 4).map(Number);
        const color = parts.includes("color") ? parts[parts.indexOf("color") + 1] : "#FFF";
        const id = getId();
        const shape = { type: "circle", id, x, y, r, color };
        DRAWN_OBJECTS.push(shape);
        timeline.push({ type: "draw", shape: "circle", ...shape, time: currentTime });
        if (id) SPRITES[id] = { id, type: 'genshape', ref: shape, x, y, scale: 1 };
        break;
      }
      case "rect": {
        const [x, y, w, h] = parts.slice(1, 5).map(Number);
        const color = parts.includes("color") ? parts[parts.indexOf("color") + 1] : "#FFF";
        const id = getId();
        const shape = { type: "rect", id, x, y, w, h, color };
        DRAWN_OBJECTS.push(shape);
        timeline.push({ type: "draw", shape: "rect", ...shape, time: currentTime });
        if (id) SPRITES[id] = { id, type: 'genshape', ref: shape, x, y, scale: 1 };
        break;
      }
      case "line": {
        const [x1, y1, x2, y2] = parts.slice(1, 5).map(Number);
        const color = parts.includes("color") ? parts[parts.indexOf("color") + 1] : "#FFF";
        const width = parts.includes("width") ? parseFloat(parts[parts.indexOf("width") + 1]) : 1;
        const id = getId();
        const shape = { type: "line", id, x1, y1, x2, y2, width, color };
        DRAWN_OBJECTS.push(shape);
        timeline.push({ type: "draw", shape: "line", ...shape, time: currentTime });
        break;
      }

      // New generative shapes (also mirrored as live sprites if id exists)
      case "blob": {
        // blob x y r points jitter color #hex [id=name] [speed s]
        const [x,y,r,points,jitter] = parts.slice(1,6).map(Number);
        const color = parts.includes("color") ? parts[parts.indexOf("color")+1] : "#77ffaa";
        const id = getId();
        const speed = parseFloat(kvPairs.speed||"0.4");
        const phase = randRange(0,Math.PI*2);
        const shape = { type:"blob", id, x, y, r, points, jitter, color, speed, phase };
        DRAWN_OBJECTS.push(shape);
        timeline.push({ type:"draw", shape:"blob", ...shape, time: currentTime });
        if (id) SPRITES[id] = { id, type: 'genshape', ref: shape, x, y, scale: 1 };
        break;
      }
      case "star": {
        // star x y rOuter rInner points color #hex [id=..] [rot deg]
        const [x,y,rO,rI,pts] = parts.slice(1,6).map(Number);
        const color = parts.includes("color") ? parts[parts.indexOf("color")+1] : "#ffd84a";
        const id = getId();
        const rot = parseFloat(kvPairs.rot||"0");
        const shape = { type:"star", id, x, y, rOuter:rO, rInner:rI, points:pts, color, rot };
        DRAWN_OBJECTS.push(shape);
        timeline.push({ type:"draw", shape:"star", ...shape, time: currentTime });
        if (id) SPRITES[id] = { id, type: 'genshape', ref: shape, x, y, scale: 1 };
        break;
      }
      case "poly": {
        // poly x y radius sides color #hex [id=..] [rot deg]
        const [x,y,rad,sides] = parts.slice(1,5).map(Number);
        const color = parts.includes("color") ? parts[parts.indexOf("color")+1] : "#a0c";
        const id = getId();
        const rot = parseFloat(kvPairs.rot||"0");
        const shape = { type:"poly", id, x, y, radius:rad, sides, color, rot };
        DRAWN_OBJECTS.push(shape);
        timeline.push({ type:"draw", shape:"poly", ...shape, time: currentTime });
        if (id) SPRITES[id] = { id, type: 'genshape', ref: shape, x, y, scale: 1 };
        break;
      }

      // Fields & Behaviors (NEW)
      case "field": {
        // field noise id=f1 scale 0.006 speed 0.22 strength 35
        // field attractor id=f2 x 400 y 300 strength 60 falloff 0.8
        const type = parts[1];
        const kv = Object.fromEntries(parts.slice(2).filter(p=>p.includes("=")).map(p=>p.split("=")));
        const id = kv.id || `f${Object.keys(FIELDS).length+1}`;
        if (type === "noise") {
          FIELDS[id] = {
            id, type: 'noise',
            scale: parseFloat(kv.scale || "0.005"),
            speed: parseFloat(kv.speed || "0.25"),
            strength: parseFloat(kv.strength || "40")
          };
        } else if (type === "attractor") {
          FIELDS[id] = {
            id, type: 'attractor',
            x: parseFloat(kv.x || "400"),
            y: parseFloat(kv.y || "300"),
            strength: parseFloat(kv.strength || "60"),
            falloff: parseFloat(kv.falloff || "0.8")
          };
        } else {
          throw new Error("unknown field type");
        }
        break;
      }
      case "behavior": {
        // behavior <id> use f1 mix 0.7
        // behavior <id> orbit cx cy radius speed
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
        // drift <id> ampX ampY freq   (alias for wiggle)
        const id = parts[1]; const ax = parseFloat(parts[2]), ay = parseFloat(parts[3]), f = parseFloat(parts[4]);
        const s = SPRITES[id] || DRAWN_OBJECTS.find(o=>o.id===id);
        if(s) s.wiggle = { ampX:ax, ampY:ay, freq:f };
        break;
      }

      // Audio
      case "sound": {
        const freq = parseFloat(parts[1]);
        const durSecs = parseFloat(parts[2]);
        if (!Number.isFinite(freq) || !Number.isFinite(durSecs))
          throw new Error("sound expects: sound FREQ SECONDS");
        timeline.push({ type: "sound", freq, dur: durSecs, time: currentTime });
        currentTime += durSecs * 1000;
        break;
      }
      case "play": {
        const note = parts[1];
        if (!noteMap[note]) throw new Error(`unknown note: ${note}`);
        timeline.push({ type: "play", note, time: currentTime });
        currentTime += (60 / tempoBPM) * 1000;
        break;
      }
      case "delay": {
        const ms = parseInt(parts[1]);
        if (!Number.isFinite(ms) || ms < 0) throw new Error("delay expects milliseconds");
        currentTime += ms;
        break;
      }

      // Procedural sprite turtle (live sprite with optional id=)
      case "sprite": {
        const name = parts[1];         // turtle
        const action = parts[2] || ""; // crawling
        const kv = Object.fromEntries(
          parts.slice(3).map(tok => tok.split("=")).filter(a => a.length === 2)
        );
        const x = Number(kv.x ?? 100);
        const y = Number(kv.y ?? 520);
        const scale = Number(kv.scale ?? 1);
        const color = kv.color || null;
        const id = kv.id || 'turtle';
        if (name !== "turtle") throw new Error(`unknown sprite: ${name}`);
        SPRITES[id] = { id, type: 'proc-turtle', x, y, scale, color, action, physics: false, playing: false };
        timeline.push({ type: "drawsprite", id, time: currentTime });
        break;
      }

      // Assets
      case "asset": {
        // asset image palm "assets/palm.png"
        // asset spritesheet turtle walk "assets/turtle_walk.png" frame 64x64 frames 8 fps 10
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
          loadImage(src).then(img => {
            ASSETS.sheets[key] = { img, frameW: fw, frameH: fh, frames, fps };
          });
        } else {
          throw new Error("unknown asset kind");
        }
        break;
      }

      // Sprite instances from assets
      case "spriteimg": {
        // spriteimg turtle1 from spritesheet turtle_walk at 120 520 scale 1.2
        const id = parts[1];
        if (!id) throw new Error("spriteimg requires an id");
        const fromIdx = parts.indexOf("from");
        const atIdx = parts.indexOf("at");
        if (fromIdx === -1 || atIdx === -1) throw new Error("spriteimg missing 'from' or 'at'");
        const kind = parts[fromIdx + 1]; // 'spritesheet' or 'image'
        const key = parts[fromIdx + 2];
        const x = parseFloat(parts[atIdx + 1]);
        const y = parseFloat(parts[atIdx + 2]);
        const scaleIdx = parts.indexOf("scale");
        const scale = scaleIdx !== -1 ? parseFloat(parts[scaleIdx + 1]) : 1;

        if (kind === "image") {
          if (!ASSETS.images[key]) console.warn(`image asset '${key}' not loaded yet`);
          SPRITES[id] = { id, type: 'image', key, x, y, scale, physics: false };
        } else if (kind === "spritesheet") {
          if (!ASSETS.sheets[key]) console.warn(`spritesheet asset '${key}' not loaded yet`);
          SPRITES[id] = { id, type: 'sheet', key, x, y, scale, frame: 0, playing: false, physics: false };
        } else {
          throw new Error("spriteimg 'from' must be 'image' or 'spritesheet'");
        }
        timeline.push({ type: "drawsprite", id, time: currentTime });
        break;
      }

      case "playframes": {
        const id = parts[1];
        if (SPRITES[id]) SPRITES[id].playing = true;
        break;
      }
      case "stopframes": {
        const id = parts[1];
        if (SPRITES[id]) SPRITES[id].playing = false;
        break;
      }
      case "setfps": {
        const id = parts[1];
        const fps = parseFloat(parts[2]);
        if (SPRITES[id]) SPRITES[id].fps = fps;
        break;
      }

      // Physics toggles and params
      case "physics": {
        const state = parts[1];
        PHYSICS.enabled = (state === "on");
        break;
      }
      case "gravity": {
        PHYSICS.gravity.x = parseFloat(parts[1]);
        PHYSICS.gravity.y = parseFloat(parts[2]);
        break;
      }
      case "damping": {
        PHYSICS.damping = parseFloat(parts[1]);
        break;
      }
      case "bounds": {
        PHYSICS.bounds = parts[1]; // 'canvas' or 'none'
        break;
      }
      case "setvel": {
        const id = parts[1];
        const vx = parseFloat(parts[2]), vy = parseFloat(parts[3]);
        if (SPRITES[id]) { SPRITES[id].physics = true; SPRITES[id].vx = vx; SPRITES[id].vy = vy; }
        break;
      }
      case "impulse": {
        const id = parts[1];
        const ix = parseFloat(parts[2]), iy = parseFloat(parts[3]);
        if (SPRITES[id]) { SPRITES[id].physics = true; SPRITES[id].vx = (SPRITES[id].vx || 0) + ix; SPRITES[id].vy = (SPRITES[id].vy || 0) + iy; }
        break;
      }

      // Wiggle (supports shapes and sprites via id)
      case "wiggle": {
        // wiggle <id> ampX ampY freq  OR  wiggle <id> amp freq
        const id = parts[1];
        const a2 = parseFloat(parts[2]);
        const a3 = parseFloat(parts[3]);
        const a4 = parseFloat(parts[4]);

        // try sprites first
        if (SPRITES[id]) {
          if (Number.isFinite(a2) && Number.isFinite(a3) && Number.isFinite(a4)) {
            SPRITES[id].wiggle = { ampX: a2, ampY: a3, freq: a4 };
          } else if (Number.isFinite(a2) && Number.isFinite(a3)) {
            SPRITES[id].wiggle = { amp: a2, freq: a3 };
          } else throw new Error("wiggle expects: wiggle <id> ampX ampY freq  OR  wiggle <id> amp freq");
          break;
        }
        // then shapes by id
        const obj = DRAWN_OBJECTS.find(o => o.id === id);
        if (obj) {
          if (Number.isFinite(a2) && Number.isFinite(a3) && Number.isFinite(a4)) {
            obj.wiggle = { ampX: a2, ampY: a3, freq: a4 };
          } else if (Number.isFinite(a2) && Number.isFinite(a3)) {
            obj.wiggle = { amp: a2, freq: a3 };
          } else throw new Error("wiggle expects: wiggle <id> ampX ampY freq  OR  wiggle <id> amp freq");
          break;
        }
        console.warn("wiggle: no sprite or shape with id", id);
        break;
      }

      // Path shorthand (linear) -> animatesprite (with ease)
      case "path": {
        // path <id> (x1,y1) -> (x2,y2) duration 5s [ease in|out|in-out|linear]
        const id = parts[1];
        const arrow = parts.indexOf("->");
        if (arrow === -1) throw new Error("path missing '->'");
        const p1 = parts[2].replace(/[()]/g, "").split(",");
        const p2 = parts[arrow + 1].replace(/[()]/g, "").split(",");
        const durKey = parts.indexOf("duration");
        if (durKey === -1) throw new Error("path missing duration");
        const duration = parseFloat(parts[durKey + 1].replace("s", "")) * 1000;

        let ease = "linear";
        const easeIdx = parts.indexOf("ease");
        if (easeIdx !== -1) ease = (parts[easeIdx + 1] || "linear");

        const s = SPRITES[id];
        const scale = s?.scale ?? 1;
        const from = [parseFloat(p1[0]), parseFloat(p1[1]), scale];
        const to   = [parseFloat(p2[0]), parseFloat(p2[1]), scale];
        timeline.push({ type: "animatesprite", id, from, to, duration, ease, time: currentTime });
        currentTime += duration;
        currentScene.duration = Math.max(currentScene.duration || 0, currentTime / 1000);
        break;
      }

      // Animate (shapes or sprites)
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
          const easeIdx = parts.indexOf("ease");
          if (easeIdx !== -1) ease = (parts[easeIdx + 1] || "linear");

          timeline.push({ type: "animatesprite", id, from, to, duration, ease, time: currentTime });
          currentTime += duration;
          currentScene.duration = Math.max(currentScene.duration || 0, currentTime / 1000);
          break;
        }

        // circle/rect linears with optional colors (overlay style)
        const from = parts.slice(2, 5).map(Number);
        const to = parts.slice(6, 9).map(Number);
        const durKey = parts.indexOf("duration");
        if (durKey === -1) throw new Error("animate missing duration");
        const duration = parseFloat(parts[durKey + 1].replace("s", "")) * 1000;
        const fromColor = parts.includes("fromColor") ? parts[parts.indexOf("fromColor") + 1] : null;
        const toColor = parts.includes("toColor") ? parts[parts.indexOf("toColor") + 1] : null;

        let ease = "linear";
        const easeIdx = parts.indexOf("ease");
        if (easeIdx !== -1) ease = (parts[easeIdx + 1] || "linear");

        timeline.push({ type: "animate", shape, from, to, duration, fromColor, toColor, ease, time: currentTime });
        currentTime += duration;
        currentScene.duration = Math.max(currentScene.duration || 0, currentTime / 1000);
        break;
      }

      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  }
}

function startScene(ctx, canvas) {
  animations = [];
  startTime = performance.now();
  lastNow = startTime;
  pauseOffset = 0;
  paused = false;
  requestAnimationFrame(now => loop(now, ctx, canvas));
}

function loop(now, ctx, canvas) {
  if (paused) return;

  const elapsed = now - startTime;
  const timeSec = elapsed / 1000;
  const dtSec = Math.min(0.05, (now - (lastNow || now)) / 1000); // cap dt
  lastNow = now;

  // Physics + frame stepping
  stepPhysics(dtSec, canvas);
  for (const id in SPRITES) stepSpriteAnimation(SPRITES[id], dtSec);

  // Process timeline events whose time has arrived
  while (timeline.length && elapsed >= timeline[0].time) {
    const item = timeline.shift();
    switch (item.type) {
      case "background":
        CURRENT_BG = item.color;
        break;
      case "draw":
        break;
      case "drawsprite":
        break;
      case "sound":
        playTone(item.freq, item.dur);
        break;
      case "play":
        playTone(noteMap[item.note], Math.max(0.1, (60 / tempoBPM) * 0.9));
        break;
      case "sequence":
        playSequence(item.notes);
        break;
      case "animate":
      case "animatesprite":
        animations.push({ ...item, start: now });
        break;
    }
  }

  // -------- Apply behaviors (NEW) before drawing --------
  const t = timeSec;
  function applyBehaviorTo(obj, dt){
    const b = obj.behavior; if(!b) return;
    // Only objects with x/y get behaviors (lines are skipped)
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

  // Clear and redraw the retained scene every frame
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // background (flat or animated noise)
  if (BG_NOISE) {
    BG_NOISE.phase += dtSec * BG_NOISE.speed;
    // simple 2-color warped gradient using phase
    const g = ctx.createLinearGradient(
      0, 0,
      w * (0.6 + 0.4*Math.sin(BG_NOISE.phase*0.7)),
      h * (0.6 + 0.4*Math.cos(BG_NOISE.phase*0.9))
    );
    g.addColorStop(0, BG_NOISE.colors[0]);
    g.addColorStop(1, BG_NOISE.colors[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // optional grain overlay
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
    ctx.fillStyle = CURRENT_BG;
    ctx.fillRect(0, 0, w, h);
  }

  // static/generative shapes (with optional wiggle)
  for (const obj of DRAWN_OBJECTS) {
    // If this object is mirrored as a live sprite (genshape), skip static draw to avoid double-render
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
      ctx.beginPath();
      ctx.arc(obj.x + ox, obj.y + oy, obj.r, 0, 2 * Math.PI);
      ctx.fillStyle = obj.color || "#FFF";
      ctx.fill();
    } else if (obj.type === "rect") {
      ctx.fillStyle = obj.color || "#FFF";
      ctx.fillRect(obj.x + ox, obj.y + oy, obj.w, obj.h);
    } else if (obj.type === "line") {
      ctx.beginPath();
      ctx.strokeStyle = obj.color || "#FFF";
      ctx.lineWidth = obj.width || 1;
      ctx.moveTo(obj.x1 + ox, obj.y1 + oy);
      ctx.lineTo(obj.x2 + ox, obj.y2 + oy);
      ctx.stroke();
    } else if (obj.type === "star") {
      drawStar(ctx, obj.x + ox, obj.y + oy, obj.rOuter, obj.rInner, obj.points, obj.color, obj.rot || 0);
    } else if (obj.type === "poly") {
      drawPoly(ctx, obj.x + ox, obj.y + oy, obj.radius, obj.sides, obj.color, obj.rot || 0);
    } else if (obj.type === "blob") {
      drawBlob(ctx, { ...obj, x: obj.x + ox, y: obj.y + oy }, timeSec);
    }
  }

  // live sprites (image/sheet/proc-turtle/genshape)
  for (const id in SPRITES) drawSprite(ctx, SPRITES[id]);

  // Active animations (shapes and sprites)
  animations = animations.filter(anim => {
    let t = Math.min((now - anim.start) / anim.duration, 1);
    t = applyEase(t, anim.ease);

    if (anim.type === "animate") {
      const color = anim.fromColor && anim.toColor
        ? interpolateColor(anim.fromColor, anim.toColor, t)
        : null;

      if (anim.shape === "circle") {
        const [x1, y1, r1] = anim.from;
        const [x2, y2, r2] = anim.to;
        const x = x1 + (x2 - x1) * t;
        const y = y1 + (y2 - y1) * t;
        const r = r1 + (r2 - r1) * t;
        const c = color || "#FF00FF";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = c;
        ctx.fill();
      } else if (anim.shape === "rect") {
        const [x1, y1, w1] = anim.from;
        const [x2, y2, w2] = anim.to;
        const x = x1 + (x2 - x1) * t;
        const y = y1 + (y2 - y1) * t;
        const w2h = w1 + (w2 - w1) * t;
        ctx.fillStyle = color || "#00FFFF";
        ctx.fillRect(x, y, w2h, w2h);
      }
    } else if (anim.type === "animatesprite") {
      const s = SPRITES[anim.id];
      if (!s) return false;
      const [x1, y1, sc1] = anim.from;
      const [x2, y2, sc2] = anim.to;
      s.x = x1 + (x2 - x1) * t;
      s.y = y1 + (y2 - y1) * t;
      s.scale = sc1 + (sc2 - sc1) * t;
    }
    return t < 1;
  });

  // Optional: compute current output levels for consumers
  if (MASTER.analyser) {
    // We just call it to keep state "hot"; consumers can call ShapeSound.hooks.getLevels() too.
    getLevels();
  }

  // timeline scrubber reflect progress
  const scrubber = document.getElementById("timeline-scrubber");
  if (scrubber && currentScene.duration) {
    scrubber.value = Math.min((elapsed / (currentScene.duration * 1000)) * 100, 100);
  }

  if (timeline.length > 0 || animations.length > 0 || Object.keys(SPRITES).length > 0) {
    requestAnimationFrame(n => loop(n, ctx, canvas));
  }
}

// ------------------------------
// Public API (global) + UI wiring
// ------------------------------
function runFromText(code) {
  const canvas = document.getElementById("canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  try {
    parseAndSchedule(code, ctx, canvas);
  } catch (err) {
    const box = document.getElementById("error-box");
    if (box) { box.style.display = 'block'; box.textContent = `Parse error: ${err.message}`; }
    throw err;
  }
  // Kick the scene
  const box = document.getElementById("error-box");
  if (box) { box.style.display = 'none'; box.textContent = ''; }
  startScene(ctx, canvas);
}

function renderInitial() {
  const canvas = document.getElementById("canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (BG_NOISE) {
    // draw once
    const w=canvas.width, h=canvas.height;
    const g = ctx.createLinearGradient(0,0,w,h);
    g.addColorStop(0, BG_NOISE.colors[0]);
    g.addColorStop(1, BG_NOISE.colors[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0,0,w,h);
  } else {
    ctx.fillStyle = CURRENT_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  for (const obj of DRAWN_OBJECTS) {
    if (obj.id && SPRITES[obj.id] && SPRITES[obj.id].type === 'genshape') continue;
    if (obj.type === "circle") {
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, obj.r, 0, 2 * Math.PI);
      ctx.fillStyle = obj.color || "#FFF";
      ctx.fill();
    } else if (obj.type === "rect") {
      ctx.fillStyle = obj.color || "#FFF";
      ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
    } else if (obj.type === "line") {
      ctx.beginPath();
      ctx.strokeStyle = obj.color || "#FFF";
      ctx.lineWidth = obj.width || 1;
      ctx.moveTo(obj.x1, obj.y1);
      ctx.lineTo(obj.x2, obj.y2);
      ctx.stroke();
    } else if (obj.type === "star") {
      drawStar(ctx, obj.x, obj.y, obj.rOuter, obj.rInner, obj.points, obj.color, obj.rot||0);
    } else if (obj.type === "poly") {
      drawPoly(ctx, obj.x, obj.y, obj.radius, obj.sides, obj.color, obj.rot||0);
    } else if (obj.type === "blob") {
      drawBlob(ctx, obj, 0);
    }
  }
}

// ---------- NL → DSL (CPU-light, rule-based but rich) ----------
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

  // defaults
  dsl.push(`canvas ${w} ${h}`);

  // seed
  const seedMatch = txt.match(/seed\s*(\d+)/);
  if (seedMatch) dsl.push(`seed ${parseInt(seedMatch[1],10)}`);

  // speed / tempo
  const slow = /\bslow(ly)?\b/.test(txt);
  const fast = /\bfast\b/.test(txt);
  const tempo = slow?60: fast?140: 100;
  dsl.push(`tempo ${tempo}`);

  // palette / background
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

  // counts & shapes
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

  // build scene objects
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

  // attach a smooth flow field + behaviors when wiggle/drift is requested
  if ((wiggle || drift) && !hasTurtle && count>0) {
    dsl.push(`field noise id=f1 scale ${slow?0.004:fast?0.008:0.006} speed ${slow?0.14:fast?0.3:0.22} strength ${slow?25:fast?45:35}`);
    const ids1 = dsl.filter(l=>/ id=/.test(l)).map(l=>l.match(/id=([a-z0-9]+)/i)[1]);
    ids1.forEach(id => dsl.push(`behavior ${id} use f1 mix 0.8`));
  }

  // drift across? (works now because shapes are mirrored as live genshape sprites with same ids)
  if ((leftToRight || rightToLeft || drift) && !hasTurtle && count>0) {
    const ids = dsl.filter(l=>/ id=/.test(l)).map(l=>l.match(/id=([a-z0-9]+)/i)[1]);
    const dur = slow?12:fast?6:9;
    const fromX = rightToLeft ? 780 : 20;
    const toX   = rightToLeft ? 20 : 780;
    ids.forEach((id,idx)=>{
      const y = 120 + (idx % 8)*50;
      dsl.push(`animate sprite ${id} ${fromX} ${y} 1 -> ${toX} ${y} 1 duration ${dur}s ease in-out`);
    });
  }

  // fallback: if no shapes recognized, make a neon blob trio
  if (!dsl.some(l=>/^(blob|star|poly|circle|rect|sprite)/.test(l))) {
    const pal = palette || pickPalette("neon");
    dsl.push(`backgroundnoise 1.2 ${slow?0.08:0.18} color ${pal[0]} ${pal[1]}`);
    const xs = [200,400,600], cs = [pal[2], pal[3], pal[4]];
    for(let i=0;i<3;i++){
      dsl.push(`blob ${xs[i]} 300 50 18 18 color ${cs[i]} id=b${i+1} speed ${slow?0.12:0.28}`);
      if (wiggle) dsl.push(`wiggle b${i+1} 6 6 0.3`);
    }
    // give them life anyway
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
  async loadFromText(code) { runFromText(code || ""); },
  // Aliases
  async parseAndRun(code) { runFromText(code || ""); },
  async run(code) { runFromText(code || ""); },

  // Playback controls
  play() {
    paused = false;
    // keep elapsed time when resuming
    startTime = performance.now() - (pauseOffset || 0);
    lastNow = startTime;
    const canvas = document.getElementById("canvas");
    const ctx = canvas?.getContext?.("2d");
    if (!ctx) return;
    requestAnimationFrame(now => { if (!paused) loop(now, ctx, canvas); });
  },
  pause() {
    if (!paused && startTime != null) {
      // capture elapsed so resume picks up from the same position
      pauseOffset = performance.now() - startTime;
    }
    paused = true;
  },
  resume() { this.play(); },
  seek(percent01) {
    if (!currentScene.duration) return;
    percent01 = clamp01(percent01||0);
    pauseOffset = currentScene.duration * 1000 * percent01;
    paused = true;
    const scrubber = document.getElementById("timeline-scrubber");
    if (scrubber) scrubber.value = percent01 * 100;
  },
  render: renderInitial,
  // expose internals (optional)
  _state: () => ({ tempoBPM, CURRENT_BG, BG_NOISE, DRAWN_OBJECTS, timeline, animations, SPRITES, SEED, FIELDS }),

  // ---- Hooks for TinyGPT or snippets ----
  hooks: {
    // audio
    getAC: () => getAC(),
    setMasterVolume: (v) => setMasterVolume(v),
    getLevels: () => getLevels(),
    initAudio: () => { try { unlockAudioOnce(); } catch(_) {} },

    // tempo/seed
    setTempo: (bpm) => { bpm = Number(bpm); if (isFinite(bpm) && bpm > 0) tempoBPM = bpm; },
    setSeed: (n) => setSeed(n),

    // physics helpers
    setPhysics: (on=true) => { PHYSICS.enabled = !!on; },
    setGravity: (x=0, y=0) => { PHYSICS.gravity.x = Number(x)||0; PHYSICS.gravity.y = Number(y)||0; },
    setDamping: (d=1) => { PHYSICS.damping = Number(d)||1; },
    setBounds: (mode='none') => { PHYSICS.bounds = (mode==='canvas')?'canvas':'none'; },

    // sprite nudges
    impulse: (id, ix=0, iy=0) => { const s = SPRITES[id]; if (s){ s.physics = true; s.vx = (s.vx||0)+Number(ix)||0; s.vy = (s.vy||0)+Number(iy)||0; } },
    setVel: (id, vx=0, vy=0) => { const s = SPRITES[id]; if (s){ s.physics = true; s.vx = Number(vx)||0; s.vy = Number(vy)||0; } },
  },

  // quick helper to init audio from UI (same as hooks.initAudio)
  initAudio() { try { unlockAudioOnce(); } catch(_) {} }
};

// ------------------------------
// DOM wiring for native buttons
// ------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("canvas");
  const ctx = canvas?.getContext?.("2d");
  const codeArea = document.getElementById("code");

  if (!ctx) return;

  // "Run" button uses the same public API
  document.getElementById("run")?.addEventListener("click", () => {
    unlockAudioOnce();
    window.ShapeSound.loadFromText(codeArea?.value || "");
  });

  // Timeline controls
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

  // --- Replace the basic converter with the richer NL parser ---
  document.getElementById("convert-prompt")?.addEventListener("click", () => {
    const input = document.getElementById("natural-prompt")?.value || "";
    const dsl = naturalToDSL(input);
    if (codeArea) codeArea.value = dsl;
  });

  // Example Picker (updated to show generative bits)
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
    if (codeArea) codeArea.value = examples[val] || "";
  });

  // Help Toggle
  document.getElementById("help-toggle")?.addEventListener("click", () => {
    const panel = document.getElementById("help-panel");
    if (!panel) return;
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });

  // Saved Scenes
  function updateSavedScenes() {
    const dropdown = document.getElementById("saved-scenes");
    if (!dropdown) return;
    dropdown.innerHTML = "<option value=''>Select Saved Scene</option>";
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith("ss-")) {
        const name = key.slice(3);
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        dropdown.appendChild(option);
      }
    });
  }
  document.getElementById("save-scene")?.addEventListener("click", () => {
    const name = prompt("Enter name for this scene:");
    if (name) {
      localStorage.setItem("ss-" + name, document.getElementById("code")?.value || "");
      updateSavedScenes();
    }
  });
  document.getElementById("delete-scene")?.addEventListener("click", () => {
    const dropdown = document.getElementById("saved-scenes");
    const name = dropdown?.value;
    if (name && confirm("Delete scene '" + name + "'?")) {
      localStorage.removeItem("ss-" + name);
      updateSavedScenes();
    }
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

  // Export PNG / Copy
  document.getElementById("export-png")?.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = "shapesound.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  });
  document.getElementById("copy-code")?.addEventListener("click", () => {
    const area = document.getElementById("code");
    navigator.clipboard.writeText(area?.value || "").then(() => {
      alert("Code copied to clipboard!");
    });
  });
});
