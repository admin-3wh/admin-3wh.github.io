<!-- projects/shapesound/inspector.js -->
<script>
/*
  ShapeSound Inspector — lightweight overlay for live stats + knobs.
  - Shows FPS, counts, audio levels
  - Lets you tweak physics (gravity/damping/bounds) at runtime
*/
(function(){
  const css = `
  .ss-inspector {
    position: fixed; right: 14px; bottom: 14px; width: 260px;
    background: rgba(20,20,20,.92); color: #eee; font: 12px/1.4 monospace;
    border: 1px solid #333; border-radius: 8px; padding: 10px; z-index: 9999;
    backdrop-filter: blur(3px);
  }
  body.light .ss-inspector { background: rgba(255,255,255,.9); color: #111; border-color: #ccc; }
  .ss-inspector h4 { margin: 0 0 6px 0; font-size: 12px; display:flex; justify-content:space-between; align-items:center;}
  .ss-inspector .rows { display:grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; align-items:center; }
  .ss-inspector .bar { height: 6px; background:#222; border-radius:3px; overflow:hidden; }
  body.light .ss-inspector .bar { background:#ddd; }
  .ss-inspector .bar > i { display:block; height:100%; background:#00ffaa; width:0%; }
  .ss-inspector .knob { display:flex; gap:6px; align-items:center; }
  .ss-inspector input[type="range"] { width: 100%; accent-color:#00ffaa; }
  .ss-inspector .rowfull { grid-column: 1 / span 2; }
  .ss-inspector .mini { opacity:.8; }
  .ss-inspector .select { width: 100%; }
  .ss-inspector .close { cursor:pointer; opacity:.7; }
  .ss-inspector .close:hover { opacity:1; }
  `;

  function ensureStyles(){
    if (document.getElementById('ss-inspector-style')) return;
    const s = document.createElement('style');
    s.id = 'ss-inspector-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function el(tag, attrs={}, children=[]){
    const n = document.createElement(tag);
    for (const k in attrs) {
      if (k==='class') n.className = attrs[k];
      else if (k==='html') n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (children||[]).forEach(c=>n.appendChild(c));
    return n;
  }

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

  function init(){
    ensureStyles();
    const root = el('div', { class:'ss-inspector', id:'ss-inspector' }, [
      el('h4', { html:'<span>Inspector</span><span class="close">✕</span>' }),
      el('div', { class:'rows mini' }, [
        el('div', { html:'FPS' }), el('div', { id:'ss-fps', html:'—' }),
        el('div', { html:'Sprites' }), el('div', { id:'ss-sprites', html:'—' }),
        el('div', { html:'Shapes' }), el('div', { id:'ss-shapes', html:'—' }),
      ]),
      el('div', { class:'rows rowfull', style:'margin-top:6px;' }, [
        el('div', { class:'rowfull', html:'Audio Levels' }),
        el('div', { class:'rowfull bar' }, [ el('i', { id:'ss-bar-low' }) ]),
        el('div', { class:'rowfull bar' }, [ el('i', { id:'ss-bar-mid' }) ]),
        el('div', { class:'rowfull bar' }, [ el('i', { id:'ss-bar-high' }) ]),
      ]),
      el('div', { class:'rows rowfull', style:'margin-top:8px;' }, [
        el('div', { html:'Bounds' }),
        (function(){
          const sel = el('select', { id:'ss-bounds', class:'select' });
          ['none','canvas'].forEach(v=>{
            const o = el('option'); o.value=v; o.textContent=v; sel.appendChild(o);
          });
          return sel;
        })(),
        el('div', { html:'Gravity X' }),
        el('div', { class:'knob' }, [
          el('input', { id:'ss-gx', type:'range', min:'-1500', max:'1500', step:'10', value:'0' })
        ]),
        el('div', { html:'Gravity Y' }),
        el('div', { class:'knob' }, [
          el('input', { id:'ss-gy', type:'range', min:'-1500', max:'1500', step:'10', value:'0' })
        ]),
        el('div', { html:'Damping' }),
        el('div', { class:'knob' }, [
          el('input', { id:'ss-damp', type:'range', min:'0.80', max:'1.00', step:'0.005', value:'1.00' })
        ]),
      ])
    ]);
    document.body.appendChild(root);

    root.querySelector('.close').addEventListener('click', ()=> root.remove());

    // Control bindings
    const boundsSel = root.querySelector('#ss-bounds');
    const gx = root.querySelector('#ss-gx');
    const gy = root.querySelector('#ss-gy');
    const damp = root.querySelector('#ss-damp');

    function api(){ return window.ShapeSound? (window.ShapeSound._raw || window.ShapeSound) : null; }

    boundsSel.addEventListener('change', ()=> {
      api()?._setPhysics?.({ bounds: boundsSel.value });
    });
    gx.addEventListener('input', ()=> { api()?._setGravity?.(parseFloat(gx.value), parseFloat(gy.value)); });
    gy.addEventListener('input', ()=> { api()?._setGravity?.(parseFloat(gx.value), parseFloat(gy.value)); });
    damp.addEventListener('input', ()=> { api()?._setPhysics?.({ damping: parseFloat(damp.value) }); });

    // Live loop
    let last = performance.now(), frames = 0, fps = 0;
    const barL = root.querySelector('#ss-bar-low');
    const barM = root.querySelector('#ss-bar-mid');
    const barH = root.querySelector('#ss-bar-high');
    const fpsEl = root.querySelector('#ss-fps');
    const spEl = root.querySelector('#ss-sprites');
    const shEl = root.querySelector('#ss-shapes');
    const perfWarn = document.getElementById('perf-warning');

    function tick(){
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        fps = Math.round(frames * 1000 / (now - last));
        frames = 0; last = now;
        fpsEl.textContent = String(fps);
        if (perfWarn) perfWarn.style.display = fps < 30 ? 'block' : 'none';
      }

      // counters
      try {
        const st = window.ShapeSound?._state?.();
        spEl.textContent = st ? Object.keys(st.SPRITES || {}).length : '—';
        shEl.textContent = st ? (st.DRAWN_OBJECTS || []).length : '—';
      } catch { spEl.textContent = shEl.textContent = '—'; }

      // audio bars
      const levels = window.ShapeSoundAudio?.getLevels?.() || {low:0,mid:0,high:0};
      barL.style.width = Math.round(clamp(levels.low, 0, 1) * 100) + '%';
      barM.style.width = Math.round(clamp(levels.mid, 0, 1) * 100) + '%';
      barH.style.width = Math.round(clamp(levels.high, 0, 1) * 100) + '%';

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
</script>
