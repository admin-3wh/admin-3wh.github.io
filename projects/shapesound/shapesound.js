// projects/shapesound/shapesound.js

const noteMap = {
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23,
  G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25,
  F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77
};

let animations = [];
let timeline = [];
let currentScene = { duration: 10 };
let paused = false;
let pauseOffset = 0;
let startTime = null;

// 🎵 tempo support (Phase 1)
let tempoBPM = 100;

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
  // derive beat length from tempo
  const beat = 60 / tempoBPM; // seconds per beat
  let time = 0;
  for (let note of notes) {
    if (noteMap[note]) {
      setTimeout(() => playTone(noteMap[note], Math.max(0.1, beat * 0.9)), time * 1000);
      time += beat;
    }
  }
}

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

/* -------------------------------------------------------
   🐢 Procedural Sprite: Turtle
   Drawn from primitives; 'scale' controls overall size.
------------------------------------------------------- */
function drawTurtle(ctx, x, y, scale = 1, colorVariant = null) {
  // choose a shell green variant if not provided (procedural variation hook)
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

  // belly pattern
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
  ctx.fillRect(x - 36 * s, y - 40 * s, 14 * s, 18 * s); // front-left
  ctx.fillRect(x + 20 * s, y - 40 * s, 14 * s, 18 * s); // front-right
  ctx.fillRect(x - 36 * s, y + 22 * s, 14 * s, 18 * s); // back-left
  ctx.fillRect(x + 20 * s, y + 22 * s, 14 * s, 18 * s); // back-right

  // tiny tail
  ctx.beginPath();
  ctx.moveTo(x - 42 * s, y + 6 * s);
  ctx.lineTo(x - 56 * s, y);
  ctx.lineTo(x - 42 * s, y - 6 * s);
  ctx.fill();
}

document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const codeArea = document.getElementById("code");

  // ------------------
  // Run ShapeSound Script
  // ------------------
  document.getElementById("run").addEventListener("click", () => {
    const script = codeArea.value;
    const lines = script.split("\n").map(l => l.trim()).filter(l => l !== "");

    animations = [];
    timeline = [];
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
        // duration of sequence depends on tempo (length = notes * beat)
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
            timeline.push({ type: "background", color: parts[1], time: currentTime });
            break;

          case "tempo": {
            // tempo 60
            const bpm = parseInt(parts[1]);
            if (!Number.isFinite(bpm) || bpm <= 0) throw new Error("tempo must be a positive number");
            tempoBPM = bpm;
            break;
          }

          case "circle": {
            const [x, y, r] = parts.slice(1, 4).map(Number);
            const color = parts.includes("color") ? parts[parts.indexOf("color") + 1] : "#FFF";
            timeline.push({ type: "draw", shape: "circle", x, y, r, color, time: currentTime });
            break;
          }

          case "rect": {
            const [x, y, w, h] = parts.slice(1, 5).map(Number);
            const color = parts.includes("color") ? parts[parts.indexOf("color") + 1] : "#FFF";
            timeline.push({ type: "draw", shape: "rect", x, y, w, h, color, time: currentTime });
            break;
          }

          case "line": {
            const [x1, y1, x2, y2] = parts.slice(1, 5).map(Number);
            const color = parts.includes("color") ? parts[parts.indexOf("color") + 1] : "#FFF";
            const width = parts.includes("width") ? parseFloat(parts[parts.indexOf("width") + 1]) : 1;
            timeline.push({ type: "draw", shape: "line", x1, y1, x2, y2, width, color, time: currentTime });
            break;
          }

          // 🐢 NEW: sprite turtle crawling (x=..., y=..., scale=..., color=#hex [optional])
          case "sprite": {
            const name = parts[1];           // turtle
            const action = parts[2] || "";   // crawling (optional)
            const kv = Object.fromEntries(
              parts.slice(3).map(tok => tok.split("=")).filter(a => a.length === 2)
            );
            const x = Number(kv.x ?? 100);
            const y = Number(kv.y ?? 500);
            const scale = Number(kv.scale ?? 1);
            const color = kv.color || null;

            if (name !== "turtle") throw new Error(`unknown sprite: ${name}`);

            timeline.push({
              type: "draw",
              shape: "sprite",
              name, action, x, y, scale, color,
              time: currentTime
            });
            break;
          }

          case "sound": {
            const freq = parseFloat(parts[1]);
            const durSecs = parseFloat(parts[2]);
            if (!Number.isFinite(freq) || !Number.isFinite(durSecs)) {
              throw new Error("sound expects: sound FREQ SECONDS");
            }
            timeline.push({ type: "sound", freq, dur: durSecs, time: currentTime });
            currentTime += durSecs * 1000;
            break;
          }

          case "play": {
            const note = parts[1];
            if (noteMap[note]) {
              // one beat long
              timeline.push({ type: "play", note, time: currentTime });
              currentTime += (60 / tempoBPM) * 1000;
            } else {
              throw new Error(`unknown note: ${note}`);
            }
            break;
          }

          case "delay": {
            const ms = parseInt(parts[1]);
            if (!Number.isFinite(ms) || ms < 0) throw new Error("delay expects milliseconds");
            currentTime += ms;
            break;
          }

          case "animate": {
            // animate <circle|rect|line|sprite> [maybe name] <from triple> -> <to triple> duration Ns [fromColor #.. toColor #..]
            // For sprite: "animate sprite turtle x y scale -> x y scale duration 8s"
            const shape = parts[1];

            let name = null;
            let cursor = 2;

            if (shape === "sprite") {
              name = parts[2];
              cursor = 3;
            }

            const arrowIndex = parts.indexOf("->");
            if (arrowIndex === -1) throw new Error("animate missing '->'");

            const fromArr = parts.slice(cursor, arrowIndex).map(Number);
            const toArr = parts.slice(arrowIndex + 1, arrowIndex + 4).map(Number);

            const durKey = parts.indexOf("duration");
            if (durKey === -1) throw new Error("animate missing duration");

            const durStr = parts[durKey + 1];
            const duration = parseFloat(durStr.replace("s", "")) * 1000;

            const fromColor = parts.includes("fromColor") ? parts[parts.indexOf("fromColor") + 1] : null;
            const toColor = parts.includes("toColor") ? parts[parts.indexOf("toColor") + 1] : null;

            const anim = { type: "animate", shape, name, from: fromArr, to: toArr, duration, fromColor, toColor, time: currentTime };
            timeline.push(anim);
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
  // Scene Loop
  // ------------------
  function startScene(ctx) {
    animations = [];
    startTime = performance.now();
    pauseOffset = 0;
    paused = false;
    requestAnimationFrame(loop);
  }

  function loop(now) {
    if (paused) return;
    const elapsed = now - startTime;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    while (timeline.length && elapsed >= timeline[0].time) {
      const item = timeline.shift();
      switch (item.type) {
        case "background":
          ctx.fillStyle = item.color;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          break;
        case "draw":
          if (item.shape === "circle") {
            ctx.beginPath();
            ctx.fillStyle = item.color || "#FFF";
            ctx.arc(item.x, item.y, item.r, 0, 2 * Math.PI);
            ctx.fill();
          } else if (item.shape === "rect") {
            ctx.fillStyle = item.color || "#FFF";
            ctx.fillRect(item.x, item.y, item.w, item.h);
          } else if (item.shape === "line") {
            ctx.beginPath();
            ctx.strokeStyle = item.color || "#FFF";
            ctx.lineWidth = item.width || 1;
            ctx.moveTo(item.x1, item.y1);
            ctx.lineTo(item.x2, item.y2);
            ctx.stroke();
          } else if (item.shape === "sprite" && item.name === "turtle") {
            drawTurtle(ctx, item.x, item.y, item.scale || 1, item.color || null);
          }
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
      }
    }

    // Draw active animations
    animations = animations.filter(anim => {
      const t = Math.min((now - anim.start) / anim.duration, 1);

      // Circle/Rect/Line: we already handle circle/rect below; (line morphing can be added Phase 2+)
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
      } else if (anim.shape === "sprite" && anim.name === "turtle") {
        // for sprite animate we treat triple as [x, y, scale]
        const [x1, y1, s1] = anim.from;
        const [x2, y2, s2] = anim.to;
        const x = x1 + (x2 - x1) * t;
        const y = y1 + (y2 - y1) * t;
        const s = s1 + (s2 - s1) * t;
        drawTurtle(ctx, x, y, s, anim.fromColor || null); // color variance optional
      }

      return t < 1;
    });

    const scrubber = document.getElementById("timeline-scrubber");
    if (scrubber && currentScene.duration) {
      scrubber.value = Math.min((elapsed / (currentScene.duration * 1000)) * 100, 100);
    }

    if (timeline.length > 0 || animations.length > 0) {
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
  // Extra Controls
  // ------------------

  // Timeline controls
  document.getElementById("play-scene")?.addEventListener("click", () => {
    paused = false;
    startTime = performance.now() - pauseOffset;
    requestAnimationFrame(loop);
  });

  document.getElementById("pause-scene")?.addEventListener("click", () => {
    paused = true;
  });

  document.getElementById("resume-scene")?.addEventListener("click", () => {
    paused = false;
    startTime = performance.now() - pauseOffset;
    requestAnimationFrame(loop);
  });

  document.getElementById("timeline-scrubber")?.addEventListener("input", (e) => {
    if (!currentScene.duration) return;
    const percent = parseFloat(e.target.value) / 100;
    pauseOffset = currentScene.duration * 1000 * percent;
    paused = true;
  });

  // Natural Prompt → Script (Phase 1 rules)
  document.getElementById("convert-prompt")?.addEventListener("click", () => {
    const input = document.getElementById("natural-prompt").value.toLowerCase().trim();
    const output = [];
    const colors = {
      red: "#FF0000", green: "#00FF00", blue: "#0000FF",
      yellow: "#FFFF00", purple: "#AA00FF", white: "#FFFFFF", black: "#000000"
    };

    // Pattern: "<n> <color> <circle|square|rect|rectangle>"
    const simpleMatch = input.match(/(\d+)\s+(red|green|blue|yellow|purple|white|black)\s+(circle|square|rect|rectangle)/);
    // Pattern: "turtle crawling" (optional with slow/fast notes)
    const turtleMatch = input.match(/turtle.*crawling/);
    const slowMatch = input.match(/slow (note|notes|music|tempo)/);
    const fastMatch = input.match(/fast (note|notes|music|tempo)/);

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
});
