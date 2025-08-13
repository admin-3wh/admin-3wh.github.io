// projects/shapesound/shapesound.js

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
let animations = [];        // active animation tweens (circles/rects & sprites)
let timeline = [];          // scheduled events (sorted by time asc)
let currentScene = { duration: 10 };

let paused = false;
let pauseOffset = 0;
let startTime = null;
let lastNow = null;

// Retained drawing state so shapes persist across frames
let CURRENT_BG = "#000000";
const DRAWN_OBJECTS = []; // array of {type, ...shapeProps}

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

function drawSprite(ctx, s) {
  if (s.type === 'image') {
    const img = ASSETS.images[s.key];
    if (!img) return;
    const w = img.width * (s.scale || 1);
    const h = img.height * (s.scale || 1);
    ctx.save();
    ctx.translate(s.x, s.y);
    if (s.rot) ctx.rotate((s.rot * Math.PI) / 180);
    ctx.scale(s.flipX ? -1 : 1, s.flipY ? -1 : 1);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  } else if (s.type === 'sheet') {
    const sheet = ASSETS.sheets[s.key];
    if (!sheet) return;
    const { img, frameW, frameH, frames } = sheet;
    const frame = Math.floor(s.frame || 0) % frames;

    // frame index -> src rect (assuming row-major strip)
    const perRow = Math.max(1, Math.floor(img.width / frameW));
    const sx = (frame % perRow) * frameW;
    const sy = Math.floor(frame / perRow) * frameH;

    const w = frameW * (s.scale || 1);
    const h = frameH * (s.scale || 1);
    ctx.save();
    ctx.translate(s.x, s.y);
    if (s.rot) ctx.rotate((s.rot * Math.PI) / 180);
    ctx.scale(s.flipX ? -1 : 1, s.flipY ? -1 : 1);
    ctx.drawImage(img, sx, sy, frameW, frameH, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

// ------------------------------
// Audio
// ------------------------------
function playTone(freq, duration = 1) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
// Procedural Turtle (Phase 1)
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
// Boot
// ------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const codeArea = document.getElementById("code");

  // ------------------
  // Run ShapeSound Script (Parser)
  // ------------------
  document.getElementById("run").addEventListener("click", () => {
    const script = codeArea.value;
    const rawLines = script.split("\n");
    const lines = rawLines.map(l => l.trim()).filter(l => l !== "" && !l.startsWith("//"));

    // reset state
    animations = [];
    timeline = [];
    DRAWN_OBJECTS.length = 0;
    CURRENT_BG = "#000000";
    tempoBPM = 100;
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

      try {
        switch (cmd) {
          case "canvas":
            canvas.width = parseInt(parts[1]);
            canvas.height = parseInt(parts[2]);
            break;

          case "background":
            CURRENT_BG = parts[1];
            timeline.push({ type: "background", color: parts[1], time: currentTime });
            break;

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

          // Procedural sprite turtle (Phase 1)
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

            if (name !== "turtle") throw new Error(`unknown sprite: ${name}`);
            // we record a draw event; actual drawing is in render
            timeline.push({ type: "draw", shape: "sprite-turtle", x, y, scale, color, action, time: currentTime });
            // and store a retained representation as a pseudo-sprite
            DRAWN_OBJECTS.push({ type: "sprite-turtle", x, y, scale, color, action });
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
              // key made from 2nd+3rd tokens (e.g., turtle walk -> turtle_walk)
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
            // spriteimg turtle1 from spritesheet turtle_walk at 120 500 scale 1.2
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
              SPRITES[id] = { type: 'image', key, x, y, scale, physics: false };
            } else if (kind === "spritesheet") {
              if (!ASSETS.sheets[key]) console.warn(`spritesheet asset '${key}' not loaded yet`);
              SPRITES[id] = { type: 'sheet', key, x, y, scale, frame: 0, playing: false, physics: false };
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

          // Path shorthand (linear) -> animatesprite
          case "path": {
            // path <id> (x1,y1) -> (x2,y2) duration 5s
            const id = parts[1];
            const arrow = parts.indexOf("->");
            if (arrow === -1) throw new Error("path missing '->'");
            const p1 = parts[2].replace(/[()]/g, "").split(",");
            const p2 = parts[arrow + 1].replace(/[()]/g, "").split(",");
            const durKey = parts.indexOf("duration");
            if (durKey === -1) throw new Error("path missing duration");
            const duration = parseFloat(parts[durKey + 1].replace("s", "")) * 1000;
            const s = SPRITES[id];
            const scale = s?.scale ?? 1;
            const from = [parseFloat(p1[0]), parseFloat(p1[1]), scale];
            const to   = [parseFloat(p2[0]), parseFloat(p2[1]), scale];
            timeline.push({ type: "animatesprite", id, from, to, duration, time: currentTime });
            currentTime += duration;
            currentScene.duration = Math.max(currentScene.duration || 0, currentTime / 1000);
            break;
          }

          // Animate (shapes or sprites)
          case "animate": {
            const shape = parts[1];

            // sprite id triple: x y scale
            if (shape === "sprite") {
              const id = parts[2];
              const arrowIndex = parts.indexOf("->");
              if (arrowIndex === -1) throw new Error("animate sprite missing '->'");
              const from = parts.slice(3, arrowIndex).map(Number);
              const to = parts.slice(arrowIndex + 1, arrowIndex + 4).map(Number);
              const durKey = parts.indexOf("duration");
              if (durKey === -1) throw new Error("animate missing duration");
              const duration = parseFloat(parts[durKey + 1].replace("s", "")) * 1000;
              timeline.push({ type: "animatesprite", id, from, to, duration, time: currentTime });
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

            timeline.push({ type: "animate", shape, from, to, duration, fromColor, toColor, time: currentTime });
            currentTime += duration;
            currentScene.duration = Math.max(currentScene.duration || 0, currentTime / 1000);
            break;
          }

          default:
            throw new Error(`Unknown command: ${cmd}`);
        }
      } catch (err) {
        return showError(`Error on line: "${line}"\n${err.message}`);
      }
    }

    showError("");
    startScene(ctx);
  });

  // ------------------
  // Render Loop
  // ------------------
  function startScene(ctx) {
    animations = [];
    startTime = performance.now();
    lastNow = startTime;
    pauseOffset = 0;
    paused = false;
    requestAnimationFrame(loop);
  }

  function loop(now) {
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
          CURRENT_BG = item.color;
          break;

        case "draw": {
          // already retained in DRAWN_OBJECTS; nothing else to do
          break;
        }

        case "drawsprite":
          // sprite instance already exists in SPRITES; nothing else to do
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // background
    ctx.fillStyle = CURRENT_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // static shapes
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
      } else if (obj.type === "sprite-turtle") {
        drawTurtle(ctx, obj.x, obj.y, obj.scale || 1, obj.color || null);
      }
    }
    // sprites (image/spritesheet) drawn every frame
    for (const id in SPRITES) {
      drawSprite(ctx, SPRITES[id]);
    }

    // Active animations (shapes and sprites)
    animations = animations.filter(anim => {
      const t = Math.min((now - anim.start) / anim.duration, 1);

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
          const w = w1 + (w2 - w1) * t;
          ctx.fillStyle = color || "#00FFFF";
          ctx.fillRect(x, y, w, w);
        }
      } else if (anim.type === "animatesprite") {
        const s = SPRITES[anim.id];
        if (!s) return false;
        const [x1, y1, sc1] = anim.from;
        const [x2, y2, sc2] = anim.to;
        s.x = x1 + (x2 - x1) * t;
        s.y = y1 + (y2 - y1) * t;
        s.scale = sc1 + (sc2 - sc1) * t;
        // sprite is drawn in the sprites pass above
      }

      return t < 1;
    });

    // timeline scrubber reflect progress
    const scrubber = document.getElementById("timeline-scrubber");
    if (scrubber && currentScene.duration) {
      scrubber.value = Math.min((elapsed / (currentScene.duration * 1000)) * 100, 100);
    }

    if (timeline.length > 0 || animations.length > 0 || Object.keys(SPRITES).length > 0) {
      requestAnimationFrame(loop);
    }
  }

  function showError(msg) {
    const box = document.getElementById("error-box");
    if (box) {
      box.textContent = msg;
      box.style.display = msg ? "block" : "none";
    }
  }

  // ------------------
  // UI Extras
  // ------------------

  // Timeline controls
  document.getElementById("play-scene")?.addEventListener("click", () => {
    paused = false;
    startTime = performance.now() - pauseOffset;
    lastNow = startTime;
    requestAnimationFrame(loop);
  });
  document.getElementById("pause-scene")?.addEventListener("click", () => {
    paused = true;
  });
  document.getElementById("resume-scene")?.addEventListener("click", () => {
    paused = false;
    startTime = performance.now() - pauseOffset;
    lastNow = startTime;
    requestAnimationFrame(loop);
  });
  document.getElementById("timeline-scrubber")?.addEventListener("input", (e) => {
    if (!currentScene.duration) return;
    const percent = parseFloat(e.target.value) / 100;
    pauseOffset = currentScene.duration * 1000 * percent;
    paused = true;
  });

  // Natural Prompt → Script (rules incl. turtle)
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
      output.push("background #001122");
      output.push("tempo " + (slowMatch ? 50 : fastMatch ? 140 : 100));
      output.push("sprite turtle crawling x=80 y=520 scale=1");
      output.push("animate sprite turtle 80 520 1 -> 720 520 1 duration 8s");
      if (slowMatch) {
        output.push("sequence { C3 E3 G3 }");
      } else if (fastMatch) {
        output.push("sequence { C4 E4 G4 C5 }");
      } else {
        output.push("sequence { C4 D4 E4 }");
      }
    } else if (simpleMatch) {
      const count = parseInt(simpleMatch[1]);
      const color = colors[simpleMatch[2]];
      const shape = simpleMatch[3];
      const spacing = 800 / (count + 1);

      output.push("canvas 800 600");
      output.push("background #000000");
      for (let i = 0; i < count; i++) {
        if (shape.startsWith("circle")) {
          output.push(`circle ${Math.round(spacing * (i + 1))} 300 40 color ${color}`);
        } else {
          output.push(`rect ${Math.round(spacing * (i + 1) - 20)} 280 40 40 color ${color}`);
        }
      }
    } else {
      output.push("// Unsupported prompt. Try:");
      output.push("//  - 'turtle crawling with slow notes'");
      output.push("//  - '4 white squares'");
    }

    codeArea.value = output.join("\n");
  });

  // Example Picker
  document.getElementById("example-picker")?.addEventListener("change", (e) => {
    const code = document.getElementById("code");
    const val = e.target.value;
    const examples = {
      example1: `canvas 800 600
background #000
circle 200 300 60 color #FF0000
circle 400 300 60 color #00FF00
circle 600 300 60 color #0000FF`,
      example2: `canvas 800 600
background #111
line 100 100 700 100 width 5 color #FF00FF
line 100 200 700 200 width 5 color #00FFFF
line 100 300 700 300 width 5 color #FFFF00`,
      example3: `canvas 800 600
background #001122
tempo 60
sprite turtle crawling x=100 y=520 scale=1
animate sprite turtle 100 520 1 -> 700 520 1 duration 8s
sequence { C3 E3 G3 }`
    };
    code.value = examples[val] || "";
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
      localStorage.setItem("ss-" + name, codeArea.value);
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
      codeArea.value = localStorage.getItem("ss-" + name);
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
    navigator.clipboard.writeText(codeArea.value).then(() => {
      alert("Code copied to clipboard!");
    });
  });

  // Export JSON (simple: wrap script text)
  document.getElementById("save-json")?.addEventListener("click", () => {
    const data = { sceneScript: codeArea.value, savedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "scene.json";
    link.click();
  });

  // Import JSON (expects { sceneScript: "..." } )
  document.getElementById("load-json")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result);
        if (json.sceneScript) codeArea.value = json.sceneScript;
        else alert("JSON missing 'sceneScript' field.");
      } catch (err) {
        alert("Invalid JSON file.");
      }
    };
    reader.readAsText(file);
    // reset input so same file can be loaded again
    e.target.value = "";
  });
});
