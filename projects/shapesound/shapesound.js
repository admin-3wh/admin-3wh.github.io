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

      try {
        switch (command) {
          case "canvas":
            canvas.width = parseInt(parts[1]);
            canvas.height = parseInt(parts[2]);
            break;
          case "background":
            ctx.fillStyle = parts[1];
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            break;
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
          case "sound":
            playTone(parseFloat(parts[1]), parseFloat(parts[2]));
            break;
          case "play":
            if (noteMap[parts[1]]) playTone(noteMap[parts[1]], 1);
            break;
          case "animate": {
            const [shape, x1, y1, r1, , x2, y2, r2] = parts.slice(1, 9).map(p => isNaN(p) ? p : Number(p));
            const duration = parseFloat(parts[parts.indexOf("duration") + 1]) * 1000;
            animations.push({ shape, x1, y1, r1, x2, y2, r2, duration, startTime: null });
            break;
          }
          default:
            throw new Error(`Unknown command: ${command}`);
        }
      } catch (err) {
        showError(`Line error: "${line}"\n${err.message}`);
        return;
      }
    }

    showError(""); // clear error
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

  function showError(msg) {
    const box = document.getElementById("error-box");
    box.textContent = msg;
    box.style.display = msg ? "block" : "none";
  }

  document.getElementById("help-toggle").addEventListener("click", () => {
    const panel = document.getElementById("help-panel");
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });

  document.getElementById("example-picker").addEventListener("change", (e) => {
    const code = document.getElementById("code");
    const val = e.target.value;
    const examples = {
      example1: `canvas 800 600\nbackground #000\ncircle 200 300 60 color #FF0000\ncircle 400 300 60 color #00FF00\ncircle 600 300 60 color #0000FF`,
      example2: `canvas 800 600\nbackground #111\nline 100 100 700 100 width 5 color #FF00FF\nline 100 200 700 200 width 5 color #00FFFF\nline 100 300 700 300 width 5 color #FFFF00`,
      example3: `canvas 800 600\nbackground #000\ncircle 400 300 80 color #8888FF\nplay C4\nsequence {\n  C4 D4 E4 F4 G4\n}`
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

  // Prompt to code (rule-based)
  document.getElementById("convert-prompt").addEventListener("click", () => {
    const input = document.getElementById("natural-prompt").value.toLowerCase();
    const output = [];
    const colorMap = {
      red: "#FF0000", green: "#00FF00", blue: "#0000FF",
      yellow: "#FFFF00", purple: "#AA00FF", white: "#FFFFFF"
    };

    const match = input.match(/(\d+)\s+(red|green|blue|yellow|purple|white)\s+circle/);
    if (match) {
      const count = parseInt(match[1]);
      const color = colorMap[match[2]] || "#FFFFFF";
      const spacing = 800 / (count + 1);
      for (let i = 0; i < count; i++) {
        output.push(`circle ${spacing * (i + 1)} 300 50 color ${color}`);
      }
    } else {
      output.push("// Unsupported prompt");
    }

    document.getElementById("code").value = output.join("\n");
  });

  // Scene saving
  function updateSavedScenes() {
    const dropdown = document.getElementById("saved-scenes");
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

  document.getElementById("save-scene").addEventListener("click", () => {
    const name = prompt("Enter name for this scene:");
    if (name) {
      localStorage.setItem("ss-" + name, document.getElementById("code").value);
      updateSavedScenes();
    }
  });

  document.getElementById("delete-scene").addEventListener("click", () => {
    const dropdown = document.getElementById("saved-scenes");
    const name = dropdown.value;
    if (name && confirm("Delete scene '" + name + "'?")) {
      localStorage.removeItem("ss-" + name);
      updateSavedScenes();
    }
  });

  document.getElementById("saved-scenes").addEventListener("change", (e) => {
    const name = e.target.value;
    if (name) {
      document.getElementById("code").value = localStorage.getItem("ss-" + name);
    }
  });

  updateSavedScenes();
});
