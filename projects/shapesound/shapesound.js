// projects/shapesound/shapesound.js

const noteMap = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23,
  G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25,
  F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77
};

let animations = [];

function playTone(freq, duration = 1) {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
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

document.addEventListener("DOMContentLoaded", () => {
  const runButton = document.getElementById("run");
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");

  runButton.addEventListener("click", () => {
    const script = document.getElementById("code").value;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    animations = [];

    const lines = script.split("\n");
    let inSequence = false;
    let sequenceNotes = [];

    for (let line of lines) {
      line = line.trim();
      if (line === "") continue;

      if (line.startsWith("sequence {")) {
        inSequence = true;
        sequenceNotes = [];
        continue;
      }
      if (line === "}" && inSequence) {
        playSequence(sequenceNotes);
        inSequence = false;
        continue;
      }
      if (inSequence) {
        sequenceNotes.push(...line.split(/\s+/));
        continue;
      }

      const parts = line.split(/\s+/);
      const command = parts[0];

      switch (command) {
        case "canvas": {
          const [w, h] = [parseInt(parts[1]), parseInt(parts[2])];
          canvas.width = w;
          canvas.height = h;
          break;
        }
        case "background": {
          ctx.fillStyle = parts[1];
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          break;
        }
        case "circle": {
          const [x, y, r] = parts.slice(1, 4).map(Number);
          const color = parts.includes("color") ? parts[parts.indexOf("color") + 1] : "#FFF";
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
          break;
        }
        case "rect": {
          const [x, y, w, h] = parts.slice(1, 5).map(Number);
          const color = parts.includes("color") ? parts[parts.indexOf("color") + 1] : "#FFF";
          ctx.fillStyle = color;
          ctx.fillRect(x, y, w, h);
          break;
        }
        case "line": {
          const [x1, y1, x2, y2] = parts.slice(1, 5).map(Number);
          const color = parts.includes("color") ? parts[parts.indexOf("color") + 1] : "#FFF";
          const width = parts.includes("width") ? parseFloat(parts[parts.indexOf("width") + 1]) : 1;
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          break;
        }
        case "sound": {
          const freq = parseFloat(parts[1]);
          const dur = parseFloat(parts[2]);
          playTone(freq, dur);
          break;
        }
        case "play": {
          const note = parts[1];
          if (noteMap[note]) playTone(noteMap[note], 1);
          break;
        }
        case "animate": {
          const [shape, x1, y1, r1, , x2, y2, r2] = parts.slice(1, 9).map(p => isNaN(p) ? p : Number(p));
          const duration = parseFloat(parts[parts.indexOf("duration") + 1]) * 1000;
          animations.push({ shape, x1, y1, r1, x2, y2, r2, duration, startTime: null });
          break;
        }
      }
    }

    requestAnimationFrame(step);
  });

  function step(timestamp) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let anim of animations) {
      if (!anim.startTime) anim.startTime = timestamp;
      const t = Math.min((timestamp - anim.startTime) / anim.duration, 1);
      const x = anim.x1 + (anim.x2 - anim.x1) * t;
      const y = anim.y1 + (anim.y2 - anim.y1) * t;
      const r = anim.r1 + (anim.r2 - anim.r1) * t;
      ctx.beginPath();
      if (anim.shape === "circle") {
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = "#FF00FF";
        ctx.fill();
      }
    }
    if (animations.some(a => (timestamp - a.startTime) < a.duration)) {
      requestAnimationFrame(step);
    }
  }

  // 📋 EXTRAS

  document.getElementById("help-toggle").addEventListener("click", () => {
    const panel = document.getElementById("help-panel");
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });

  document.getElementById("example-picker").addEventListener("change", (e) => {
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
background #000
circle 400 300 80 color #8888FF
play C4
sequence {
  C4 D4 E4 F4 G4
}`
    };
    code.value = examples[val] || "";
  });

  document.getElementById("export-png").addEventListener("click", () => {
    const canvas = document.getElementById("canvas");
    const link = document.createElement("a");
    link.download = "shapesound.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  });

  document.getElementById("copy-code").addEventListener("click", () => {
    const code = document.getElementById("code").value;
    navigator.clipboard.writeText(code).then(() => {
      alert("Code copied to clipboard!");
    });
  });
});
