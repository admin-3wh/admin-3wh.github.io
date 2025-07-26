// projects/shapesound/shapesound.js

document.getElementById("run").addEventListener("click", () => {
  const script = document.getElementById("code").value;
  const ctx = document.getElementById("canvas").getContext("2d");

  // Clear canvas
  ctx.clearRect(0, 0, 800, 600);

  // Very basic demo: look for `circle x y r color #hex`
  const lines = script.split("\n");
  for (let line of lines) {
    const parts = line.trim().split(" ");
    if (parts[0] === "circle") {
      const [_, x, y, r, , color] = parts;
      ctx.beginPath();
      ctx.arc(Number(x), Number(y), Number(r), 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    }
    if (parts[0] === "sound") {
      const [, freq, duration] = parts;
      playTone(Number(freq), Number(duration));
    }
  }
});

// Play tone using Web Audio API
function playTone(freq = 440, duration = 1) {
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
