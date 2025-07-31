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

function playSequence(notes, delay = 0.6) {
  let time = 0;
  for (let note of notes) {
    if (noteMap[note]) {
      setTimeout(() => playTone(noteMap[note], delay * 0.9), time * 1000);
      time += delay;
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

document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const codeArea = document.getElementById("code");

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
        currentTime += sequenceNotes.length * 600;
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

          case "sound": {
            const freq = parseFloat(parts[1]);
            const dur = parseFloat(parts[2]);
            timeline.push({ type: "sound", freq, dur, time: currentTime });
            currentTime += dur * 1000;
            break;
          }

          case "play": {
            const note = parts[1];
            if (noteMap[note]) {
              timeline.push({ type: "play", note, time: currentTime });
              currentTime += 1000;
            }
            break;
          }

          case "delay": {
            const ms = parseInt(parts[1]);
            currentTime += ms;
            break;
          }

          case "animate": {
            const shape = parts[1];
            const from = parts.slice(2, 5).map(Number);
            const to = parts.slice(6, 9).map(Number);
            const duration = parseFloat(parts[parts.indexOf("duration") + 1]) * 1000;
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
          ctx.beginPath();
          ctx.fillStyle = item.color || "#FFF";
          if (item.shape === "circle") {
            ctx.arc(item.x, item.y, item.r, 0, 2 * Math.PI);
            ctx.fill();
          } else if (item.shape === "rect") {
            ctx.fillRect(item.x, item.y, item.w, item.h);
          } else if (item.shape === "line") {
            ctx.strokeStyle = item.color;
            ctx.lineWidth = item.width;
            ctx.moveTo(item.x1, item.y1);
            ctx.lineTo(item.x2, item.y2);
            ctx.stroke();
          }
          break;
        case "sound":
          playTone(item.freq, item.dur);
          break;
        case "play":
          playTone(noteMap[item.note], 1);
          break;
        case "sequence":
          playSequence(item.notes);
          break;
        case "animate":
          animations.push({ ...item, start: now });
          break;
      }
    }

    animations = animations.filter(anim => {
      const t = Math.min((now - anim.start) / anim.duration, 1);
      const [x1, y1, r1] = anim.from;
      const [x2, y2, r2] = anim.to;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      const r = r1 + (r2 - r1) * t;
      const color = anim.fromColor && anim.toColor
        ? interpolateColor(anim.fromColor, anim.toColor, t)
        : "#FF00FF";

      ctx.beginPath();
      if (anim.shape === "circle") {
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
      } else if (anim.shape === "rect") {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, r, r);
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
});
