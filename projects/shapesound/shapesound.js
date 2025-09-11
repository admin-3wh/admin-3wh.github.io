// projects/shapesound/shapesound.js
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
let CURRENT_BG = "#000000";        // can be string or {type:'noise',...}
let NOISE_BG = null;               // {scale, speed, c1, c2, t}
const DRAWN_OBJECTS = []; // array of {type, ...shapeProps}

// ------------------------------
// Lightweight generative helpers
// ------------------------------
// Seeded RNG (deterministic)
let RNG_SEED = 12345;
function srand(seed){ RNG_SEED = (seed|0) || 1; }
function rand(){ // xorshift32 -> 0..1
  let x = RNG_SEED |= 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  RNG_SEED = x;
  return ((x >>> 0) / 4294967295);
}
function randRange(a,b){ return a + (b-a) * rand(); }

// Tiny color helpers (global; different names than ones inside interpolateColor)
function gHexToRgb(hex){
  const n = parseInt(hex.slice(1),16);
  return [(n>>16)&255, (n>>8)&255, n&255];
}
function gRgbToHex([r,g,b]){
  return "#" + [r,g,b].map(v=>Math.max(0,Math.min(255,v|0)).toString(16).padStart(2,"0")).join("");
}
function mixRGB(a,b,t){ return [ a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t ]; }

// Super-light 2D value noise (hashed grid + bilinear)
function hash2(ix, iy){
  let x = (ix*374761393) ^ (iy*668265263);
  x = (x ^ (x>>>13)) * 1274126177;
  x = (x ^ (x>>>16)) >>> 0;
  return x / 4294967295; // 0..1
}
function valueNoise2(x, y){
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = x0 + 1,        y1 = y0 + 1;
  const fx = x - x0,        fy = y - y0;
  const v00 = hash2(x0,y0), v10 = hash2(x1,y0);
  const v01 = hash2(x0,y1), v11 = hash2(x1,y1);
  const i1 = v00 + (v10 - v00) * fx;
  const i2 = v01 + (v11 - v01) * fx;
  return i1 + (i2 - i1) * fy; // 0..1
}

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

function getAC() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === 'suspended') {
    AC.resume().catch(() => {});
  }
  return AC;
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
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
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

// ------------------------------
// Procedural Turtle
// ------------------------------
function drawTurtle(ctx, x, y, scale = 1, colorVariant = null) {
  const greens = ["#228B22", "#2E8B57", "#006400"];
  const shellColor = colorVariant || greens[Math.floor(Math.random() * greens.length)];
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
  // wiggle offsets
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

  // Procedural turtle live sprite
  if (s.type === 'proc-turtle') {
    const sc = s.scale || 1;
    const col = s.color || null;
    drawTurtle(ctx, tx, ty, sc, col);
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
  NOISE_BG = null;
  tempoBPM = 100;
  for (const k in SPRITES) delete SPRITES[k];

  PHYSICS.enabled = false;
  PHYSICS.gravity = { x: 0, y: 0 };
  PHYSICS.damping = 1.0;
  PHYSICS.bounds = 'none';

  // sequence parsing
  let currentTime = 0;
  let inSequence = false;
  let sequenceNotes = [];

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let line of lines) {
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

    switch (cmd) {
      case "seed": {
        const s = parseInt(parts[1]);
        if (!Number.isFinite(s)) throw new Error("seed expects an integer");
        srand(s);
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
        // backgroundnoise <scale> <speed> color <c1> <c2>
        const scale = parseFloat(parts[1]) || 80;
        const speed = parseFloat(parts[2]) || 0.03;
        const ci = parts.indexOf("color");
        if (ci === -1) throw new Error("backgroundnoise needs: backgroundnoise scale speed color #c1 #c2");
        const c1 = parts[ci+1] || "#000000";
        const c2 = parts[ci+2] || "#222244";
        CURRENT_BG = { type:"noise", scale, speed, c1, c2 };
        NOISE_BG = { scale, speed, c1, c2, t: 0 };
        timeline.push({ type:"background", time: currentTime });
        break;
      }

      case "tempo": {
        const bpm = parseInt(parts[1]);
        if (!Number.isFinite(bpm) || bpm <= 0) throw new Error("tempo must be a positive number");
        tempoBPM = bpm;
        break;
      }

      // Basic shapes (retained)
      case "circle": {
        const [x, y, r] = parts.slice(1, 4).map(Number);
        const color = parts.includes("color") ? parts[parts.indexOf("color") + 1] : "#FFF";
        const shape = { type: "circle", x, y, r, color };
        DRAWN_OBJECTS.push(shape);
        timeline.push({ type: "draw", shape: "circle", ...shape, time: currentTime });
        break;
      }
      case "rect": {
        const [x, y, w, h] = parts.slice(1, 5).map(Number);
        const color = parts.includes("color") ? parts[parts.indexOf("color") + 1] : "#FFF";
        const shape = { type: "rect", x, y, w, h, color };
        DRAWN_OBJECTS.push(shape);
        timeline.push({ type: "draw", shape: "rect", ...shape, time: currentTime });
        break;
      }
      case "line": {
        const [x1, y1, x2, y2] = parts.slice(1, 5).map(Number);
        const color = parts.includes("color") ? parts[parts.indexOf("color") + 1] : "#FFF";
        const width = parts.includes("width") ? parseFloat(parts[parts.indexOf("width") + 1]) : 1;
        const shape = { type: "line", x1, y1, x2, y2, width, color };
        DRAWN_OBJECTS.push(shape);
        timeline.push({ type: "draw", shape: "line", ...shape, time: currentTime });
        break;
      }

      // Generative retained shapes
      case "blob": {
        // blob x y r points jitter color #RRGGBB
        const x = parseFloat(parts[1]);
        const y = parseFloat(parts[2]);
        const r = parseFloat(parts[3]);
        const points = parseInt(parts[4]) || 16;
        const jitter = parseFloat(parts[5]) || 0.25;
        const color = parts.includes("color") ? parts[parts.indexOf("color")+1] : "#ffffff";
        if (!Number.isFinite(x+y+r) || points < 3) throw new Error("blob expects: blob x y r points jitter color #hex");
        DRAWN_OBJECTS.push({ type:"blob", x, y, r, points, jitter, color });
        timeline.push({ type:"draw", shape:"blob", time: currentTime });
        break;
      }
      case "star": {
        // star x y rOuter rInner points color #hex [rot deg]
        const x = parseFloat(parts[1]), y = parseFloat(parts[2]);
        const R = parseFloat(parts[3]), r = parseFloat(parts[4]);
        const points = parseInt(parts[5]) || 5;
        const color = parts.includes("color") ? parts[parts.indexOf("color")+1] : "#ffffff";
        const rotIdx = parts.indexOf("rot");
        const rot = rotIdx !== -1 ? parseFloat(parts[rotIdx+1]) : 0;
        DRAWN_OBJECTS.push({ type:"star", x, y, R, r, points, color, rot });
        timeline.push({ type:"draw", shape:"star", time: currentTime });
        break;
      }
      case "poly": {
        // poly x y radius sides color #hex [rot deg]
        const x = parseFloat(parts[1]), y = parseFloat(parts[2]);
        const radius = parseFloat(parts[3]);
        const sides = parseInt(parts[4]) || 6;
        const color = parts.includes("color") ? parts[parts.indexOf("color")+1] : "#ffffff";
        const rotIdx = parts.indexOf("rot");
        const rot = rotIdx !== -1 ? parseFloat(parts[rotIdx+1]) : 0;
        DRAWN_OBJECTS.push({ type:"poly", x, y, radius, sides, color, rot });
        timeline.push({ type:"draw", shape:"poly", time: currentTime });
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

      // Procedural sprite turtle  (live sprite with optional id)
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

      // Wiggle
      case "wiggle": {
        // wiggle <id> ampX ampY freq  OR  wiggle <id> amp freq
        const id = parts[1];
        const a2 = parseFloat(parts[2]);
        const a3 = parseFloat(parts[3]);
        const a4 = parseFloat(parts[4]);
        if (!SPRITES[id]) break;
        if (Number.isFinite(a2) && Number.isFinite(a3) && Number.isFinite(a4)) {
          SPRITES[id].wiggle = { ampX: a2, ampY: a3, freq: a4 };
        } else if (Number.isFinite(a2) && Number.isFinite(a3)) {
          SPRITES[id].wiggle = { amp: a2, freq: a3 };
        } else {
          throw new Error("wiggle expects: wiggle <id> ampX ampY freq  OR  wiggle <id> amp freq");
        }
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

        // circle/rect linears with optional colors
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
        // keep CURRENT_BG as set by parser (string or noise object)
        break;

      case "draw":
        // retained in DRAWN_OBJECTS already
        break;

      case "drawsprite":
        // sprite already in SPRITES; nothing else to do
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
        animations.push({ ...item, start: now });
        break;

      case "animatesprite":
        animations.push({ ...item, start: now });
        break;
    }
  }

  // Clear and redraw the retained scene every frame
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // background (solid or animated noise)
  if (typeof CURRENT_BG === "string") {
    ctx.fillStyle = CURRENT_BG;
    ctx.fillRect(0, 0, w, h);
  } else if (CURRENT_BG && CURRENT_BG.type === "noise" && NOISE_BG) {
    NOISE_BG.t += NOISE_BG.speed;
    const cell = Math.max(2, Math.floor(NOISE_BG.scale * 0.25)); // pixel block for speed
    const c1 = gHexToRgb(NOISE_BG.c1), c2 = gHexToRgb(NOISE_BG.c2);
    for (let py=0; py<h; py+=cell){
      for (let px=0; px<w; px+=cell){
        const nx = (px / NOISE_BG.scale);
        const ny = (py / NOISE_BG.scale);
        const n = valueNoise2(nx + NOISE_BG.t, ny - NOISE_BG.t); // 0..1
        const rgb = mixRGB(c1,c2,n);
        ctx.fillStyle = gRgbToHex(rgb);
        ctx.fillRect(px, py, cell, cell);
      }
    }
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
  }

  // static shapes (retained)
  for (const obj of DRAWN_OBJECTS) {
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
    } else if (obj.type === "blob") {
      const { x, y, r, points, jitter, color } = obj;
      const saved = RNG_SEED;
      srand((Math.abs((x|0)*73856093 ^ (y|0)*19349663) | 0) || 1);
      const step = (Math.PI*2) / points;
      const verts = [];
      for (let i=0; i<points; i++){
        const a = step*i;
        const jr = 1 + randRange(-jitter, jitter);
        const rr = Math.max(4, r * jr);
        verts.push([ x + Math.cos(a)*rr, y + Math.sin(a)*rr ]);
      }
      ctx.beginPath();
      ctx.moveTo(verts[0][0], verts[0][1]);
      for (let i=1;i<verts.length;i++) ctx.lineTo(verts[i][0], verts[i][1]);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      RNG_SEED = saved;
    } else if (obj.type === "star") {
      const { x, y, R, r, points, color, rot=0 } = obj;
      const step = Math.PI / points;
      ctx.beginPath();
      for (let i=0; i<points*2; i++){
        const a = rot*Math.PI/180 + i*step;
        const rad = (i%2===0) ? R : r;
        const px = x + Math.cos(a)*rad;
        const py = y + Math.sin(a)*rad;
        if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    } else if (obj.type === "poly") {
      const { x, y, radius, sides, color, rot=0 } = obj;
      const step = (Math.PI*2) / sides;
      ctx.beginPath();
      for (let i=0; i<sides; i++){
        const a = rot*Math.PI/180 + i*step;
        const px = x + Math.cos(a)*radius;
        const py = y + Math.sin(a)*radius;
        if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  // live sprites (image/sheet/proc-turtle) drawn every frame
  for (const id in SPRITES) {
    drawSprite(ctx, SPRITES[id]);
  }

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
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = color || "#FF00FF";
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
  const ctx = canvas.getContext("2d");
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
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;

  // background (single frame)
  if (typeof CURRENT_BG === "string") {
    ctx.fillStyle = CURRENT_BG;
    ctx.fillRect(0, 0, w, h);
  } else if (CURRENT_BG && CURRENT_BG.type === "noise" && NOISE_BG) {
    const cell = Math.max(2, Math.floor(NOISE_BG.scale * 0.25));
    const c1 = gHexToRgb(NOISE_BG.c1), c2 = gHexToRgb(NOISE_BG.c2);
    for (let py=0; py<h; py+=cell){
      for (let px=0; px<w; px+=cell){
        const nx = (px / NOISE_BG.scale);
        const ny = (py / NOISE_BG.scale);
        const n = valueNoise2(nx, ny);
        const rgb = mixRGB(c1,c2,n);
        ctx.fillStyle = gRgbToHex(rgb);
        ctx.fillRect(px, py, cell, cell);
      }
    }
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
  }

  // retained shapes
  for (const obj of DRAWN_OBJECTS) {
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
    } else if (obj.type === "blob" || obj.type === "star" || obj.type === "poly") {
      // Use the same drawing as in loop for consistency
      // quick path: call loop’s retained drawing by simulating once
      // To keep code simple, duplicate drawing:
      if (obj.type === "blob") {
        const { x, y, r, points, jitter, color } = obj;
        const saved = RNG_SEED;
        srand((Math.abs((x|0)*73856093 ^ (y|0)*19349663) | 0) || 1);
        const step = (Math.PI*2) / points;
        const verts = [];
        for (let i=0; i<points; i++){
          const a = step*i;
          const jr = 1 + randRange(-jitter, jitter);
          const rr = Math.max(4, r * jr);
          verts.push([ x + Math.cos(a)*rr, y + Math.sin(a)*rr ]);
        }
        ctx.beginPath();
        ctx.moveTo(verts[0][0], verts[0][1]);
        for (let i=1;i<verts.length;i++) ctx.lineTo(verts[i][0], verts[i][1]);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        RNG_SEED = saved;
      } else if (obj.type === "star") {
        const { x, y, R, r, points, color, rot=0 } = obj;
        const step = Math.PI / points;
        ctx.beginPath();
        for (let i=0; i<points*2; i++){
          const a = rot*Math.PI/180 + i*step;
          const rad = (i%2===0) ? R : r;
          const px = x + Math.cos(a)*rad;
          const py = y + Math.sin(a)*rad;
          if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
        }
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      } else if (obj.type === "poly") {
        const { x, y, radius, sides, color, rot=0 } = obj;
        const step = (Math.PI*2) / sides;
        ctx.beginPath();
        for (let i=0; i<sides; i++){
          const a = rot*Math.PI/180 + i*step;
          const px = x + Math.cos(a)*radius;
          const py = y + Math.sin(a)*radius;
          if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
        }
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      }
    }
  }
}

window.ShapeSound = {
  // Primary entry point used by index.html
  async loadFromText(code) { runFromText(code || ""); },
  // Alias(es) for flexibility
  async parseAndRun(code) { runFromText(code || ""); },
  async run(code) { runFromText(code || ""); },

  // Playback controls
  play() {
    // Make Play act as "start or resume"
    paused = false;
    startTime = performance.now() - (pauseOffset || 0);
    lastNow = startTime;
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");
    requestAnimationFrame(now => {
      if (!paused) loop(now, ctx, canvas);
    });
  },
  pause() { paused = true; },
  resume() { this.play(); },
  seek(percent01) {
    if (!currentScene.duration) return;
    percent01 = Math.min(Math.max(percent01, 0), 1);
    pauseOffset = currentScene.duration * 1000 * percent01;
    paused = true;
    const scrubber = document.getElementById("timeline-scrubber");
    if (scrubber) scrubber.value = percent01 * 100;
  },
  render: renderInitial,
  // expose internals (optional)
  _state: () => ({ tempoBPM, CURRENT_BG, NOISE_BG, DRAWN_OBJECTS, timeline, animations, SPRITES })
};

// ------------------------------
// DOM wiring for native buttons
// ------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const codeArea = document.getElementById("code");

  // "Run" button uses the same public API
  document.getElementById("run")?.addEventListener("click", () => {
    unlockAudioOnce();
    window.ShapeSound.loadFromText(codeArea.value || "");
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

  // Natural Prompt → Script (rule-based quick gen; TinyGPT handled in tinygpt.js via Generate button)
  document.getElementById("convert-prompt")?.addEventListener("click", () => {
    const input = document.getElementById("natural-prompt").value.toLowerCase().trim();
    const output = [];
    const colors = {
      red: "#FF0000", green: "#00FF00", blue: "#0000FF",
      yellow: "#FFFF00", purple: "#AA00FF", white: "#FFFFFF", black: "#000000"
    };

    const simpleMatch = input.match(/(\d+)\s+(red|green|blue|yellow|purple|white|black)\s+(circle|square|rect|rectangle)/);
    const turtleMatch = /turtle.*crawling/.test(input);
    const slowMatch = /slow (note|notes|music|tempo)/.test(input);
    const fastMatch = /fast (note|notes|music|tempo)/.test(input);

    if (turtleMatch) {
      output.push("canvas 800 600");
      output.push("backgroundnoise 80 0.02 color #001122 #123456");
      output.push("tempo " + (slowMatch ? 50 : fastMatch ? 140 : 100));
      output.push("sprite turtle crawling x=80 y=520 scale=1");
      output.push("animate sprite turtle 80 520 1 -> 720 520 1 duration 8s ease in-out");
      if (slowMatch) {
        output.push("sequence { C3 E3 G3 }");
      } else if (fastMatch) {
        output.push("sequence { C4 E4 G4 C5 }");
      } else {
        output.push("sequence { C4 D4 E4 }");
      }
      output.push("seed 7");
      output.push("blob 300 200 60 20 0.25 color #f3c4fb");
      output.push("star 540 180 55 25 8 color #ffd166 rot 12");
    } else if (simpleMatch) {
      const count = parseInt(simpleMatch[1]);
      const color = colors[simpleMatch[2]];
      const shape = simpleMatch[3];
      const spacing = 800 / (count + 1);

      output.push("canvas 800 600");
      output.push("backgroundnoise 70 0.02 color #000000 #20203a");
      for (let i = 0; i < count; i++) {
        if (shape.startsWith("circle")) {
          output.push(`circle ${Math.round(spacing * (i + 1))} 300 40 color ${color}`);
        } else {
          output.push(`rect ${Math.round(spacing * (i + 1) - 20)} 280 40 40 color ${color}`);
        }
      }
      output.push("seed 42");
      output.push("blob 400 140 50 18 0.3 color #88ffcc");
    } else {
      output.push("// Unsupported prompt. Try 'turtle crawling with slow notes' or '4 white squares'.");
    }

    document.getElementById("code").value = output.join("\n");
  });

  // Example Picker
  document.getElementById("example-picker")?.addEventListener("change", (e) => {
    const val = e.target.value;
    const examples = {
      example1: `canvas 800 600
backgroundnoise 80 0.02 color #0b0f1a #1b2238
seed 42
blob 220 310 90 22 0.35 color #8ef1ff
blob 420 320 70 18 0.28 color #ffd08e
blob 600 280 60 16 0.30 color #c6ff8e
animate circle 200 200 10 -> 600 200 80 duration 6s fromColor #ff0088 toColor #88ffcc ease in-out`,
      example2: `canvas 800 600
backgroundnoise 80 0.02 color #1b2238 #3c486b
seed 7
star 200 300 80 35 10 color #ffd166 rot 12
poly 600 300 70 7 color #06d6a0 rot 0
animate rect 100 450 40 -> 700 450 140 duration 5s fromColor #ff006e toColor #8338ec ease in-out`,
      example3: `canvas 800 600
backgroundnoise 70 0.03 color #001022 #002a44
tempo 60
sprite turtle crawling x=100 y=520 scale=1
animate sprite turtle 100 520 1 -> 700 520 1 duration 8s ease in-out
seed 9
blob 300 160 60 20 0.25 color #f3c4fb
star 520 150 55 25 8 color #ffd166
sequence { C3 E3 G3 }`
    };
    document.getElementById("code").value = examples[val] || "";
  });

  // Help Toggle
  document.getElementById("help-toggle")?.addEventListener("click", () => {
    const panel = document.getElementById("help-panel");
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
      localStorage.setItem("ss-" + name, document.getElementById("code").value);
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
      document.getElementById("code").value = localStorage.getItem("ss-" + name);
    }
  });
  updateSavedScenes();

  // Export PNG
  document.getElementById("export-png")?.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = "shapesound.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  });

  // Copy Code
  document.getElementById("copy-code")?.addEventListener("click", () => {
    navigator.clipboard.writeText(document.getElementById("code").value).then(() => {
      alert("Code copied to clipboard!");
    });
  });
});
