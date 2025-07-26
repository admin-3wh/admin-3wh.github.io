// shapesound.js

document.addEventListener("DOMContentLoaded", () => {
  const runButton = document.getElementById("run");
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");

  runButton.addEventListener("click", () => {
    const script = document.getElementById("code").value;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const lines = script.split("\n");

    for (const line of lines) {
      const parts = line.trim().split(/\s+/); // split by any space
      if (parts[0] === "circle" && parts.length >= 6) {
        const x = parseFloat(parts[1]);
        const y = parseFloat(parts[2]);
        const r = parseFloat(parts[3]);
        const colorIndex = parts.indexOf("color");
        const color = colorIndex !== -1 ? parts[colorIndex + 1] : "#FFFFFF";

        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
      }

      if (parts[0] === "sound" && parts.length >= 3) {
        const freq = parseFloat(parts[1]);
        const duration = parseFloat(parts[2]);
        playTone(freq, duration);
      }
    }
  });

  function playTone(freq, duration) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = freq;

    oscillator.connect(gain);
    gain.connect(audioCtx.destination);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + duration);
  }
});
