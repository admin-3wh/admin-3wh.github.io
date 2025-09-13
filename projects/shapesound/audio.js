<!-- projects/shapesound/audio.js -->
<script>
/*
  ShapeSoundAudio — tiny audio analyser helper.
  - attachTo(audioCtx): attaches an AnalyserNode to a provided AudioContext
  - enableMic(): prompts for microphone and analyses it
  - disable(): tears down mic input
  - getLevels(): {low, mid, high, peak} ∈ [0,1]
  - onState(cb): subscribe to analyser availability changes
*/
(function(){
  const S = {
    ctx: null,
    analyser: null,
    micStream: null,
    micNode: null,
    bins: null,
    subscribers: new Set(),
    lastLevels: { low:0, mid:0, high:0, peak:0 },
    usingMic: false,
  };

  function makeAnalyser(ctx){
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0.85;
    S.bins = new Uint8Array(an.frequencyBinCount);
    return an;
  }

  function notify(){
    for (const cb of S.subscribers) {
      try { cb({ attached: !!S.analyser, usingMic: S.usingMic }); } catch {}
    }
  }

  async function attachTo(ctx){
    if (!ctx) return;
    if (!S.ctx) S.ctx = ctx;
    if (!S.analyser) S.analyser = makeAnalyser(ctx);

    // If engine hasn’t connected us, we still can measure mic (when enabled).
    // To “hear” the engine master-bus, the engine can connect a tap node:
    //    someNode.connect(ShapeSoundAudio.getAnalyser())
    notify();
  }

  async function enableMic(){
    try {
      if (!S.ctx) S.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (S.ctx.state === 'suspended') await S.ctx.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      S.micStream = stream;
      if (!S.analyser) S.analyser = makeAnalyser(S.ctx);
      S.micNode = S.ctx.createMediaStreamSource(stream);
      S.micNode.connect(S.analyser);
      S.usingMic = true;
      notify();
    } catch (e) {
      console.warn('[ShapeSoundAudio] Mic enable failed:', e);
      S.usingMic = false;
      notify();
      throw e;
    }
  }

  function disable(){
    try {
      if (S.micNode) { try { S.micNode.disconnect(); } catch {} S.micNode = null; }
      if (S.micStream) {
        for (const t of S.micStream.getTracks()) t.stop();
        S.micStream = null;
      }
      S.usingMic = false;
      notify();
    } catch {}
  }

  function getAnalyser(){ return S.analyser || null; }

  function getLevels(){
    const an = S.analyser;
    if (!an) return S.lastLevels;

    an.getByteFrequencyData(S.bins);
    const N = S.bins.length;
    if (!N) return S.lastLevels;

    // 3 bands: 0-300Hz, 300-2kHz, 2k-nyquist (approx bin mapping)
    const nyquist = (S.ctx ? S.ctx.sampleRate / 2 : 22050);
    const hzPerBin = nyquist / N;
    let l=0, m=0, h=0, lc=0, mc=0, hc=0, peak=0;

    for (let i=0;i<N;i++){
      const v = S.bins[i] / 255;
      const f = i * hzPerBin;
      if (f < 300) { l += v; lc++; }
      else if (f < 2000) { m += v; mc++; }
      else { h += v; hc++; }
      if (v > peak) peak = v;
    }
    const levels = {
      low:  lc ? l/lc : 0,
      mid:  mc ? m/mc : 0,
      high: hc ? h/hc : 0,
      peak
    };
    // light smoothing
    const lerp = (a,b,t)=>a+(b-a)*t;
    const s = 0.35;
    S.lastLevels = {
      low:  lerp(S.lastLevels.low,  levels.low,  s),
      mid:  lerp(S.lastLevels.mid,  levels.mid,  s),
      high: lerp(S.lastLevels.high, levels.high, s),
      peak: lerp(S.lastLevels.peak, levels.peak, s),
    };
    return S.lastLevels;
  }

  function onState(cb){ if (typeof cb==='function') { S.subscribers.add(cb); cb({attached:!!S.analyser, usingMic:S.usingMic}); } return ()=>S.subscribers.delete(cb); }

  window.ShapeSoundAudio = { attachTo, enableMic, disable, getLevels, getAnalyser, onState };
})();
</script>
