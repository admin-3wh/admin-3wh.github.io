/* 3wh.dev homepage: the living knowledge graph.
   Fragmented points drift in and resolve into a connected, structured core.

   Quietly interactive (no hint in the UI, by design):
     - press-and-hold an empty patch of the graph to grow a new cluster from that point
     - grab a node and throw it; it keeps the momentum and settles back in
   On touch, a light tap seeds a few nodes. Decorative throughout: the page is
   fully usable, and fully readable, without any of it. */
(function () {
  "use strict";

  /* ---------- Pipeline pulse: ingest -> embed -> search -> cite ---------- */
  var steps = Array.prototype.slice.call(document.querySelectorAll(".pipeline span"));
  if (steps.length) {
    var pi = 0;
    var ptick = function () {
      steps.forEach(function (s, n) { s.classList.toggle("active", n === pi); });
      pi = (pi + 1) % steps.length;
    };
    ptick();
    setInterval(ptick, 1400);
  }

  /* ---------- Knowledge graph canvas ---------- */
  var canvas = document.getElementById("graph");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(pointer: fine)").matches;

  var W = 0, H = 0, DPR = 1, cx = 0, cy = 0;
  var nodes = [];
  var pointer = { x: -9999, y: -9999, active: false };
  var LINK = 150;          // connection radius
  var MAX_NODES = 160;     // hard cap, including grown nodes
  var raf = null;
  var seq = 0;             // monotonic id, used to recycle the oldest grown node

  // interaction state
  var drag = null;         // { node, ox, oy }
  var grow = null;         // { x, y, last }
  var vel = { x: 0, y: 0 };
  var prev = { x: 0, y: 0 };
  var activeId = null;     // pointerId currently being tracked
  var tap = null;          // touch tap candidate

  function themeColors() {
    var light = document.documentElement.classList.contains("light");
    return light
      ? { a: [214, 40, 57], b: [224, 97, 47], line: 0.5, node: 0.85 }
      : { a: [255, 90, 95], b: [255, 138, 92], line: 0.85, node: 1 };
  }
  var COL = themeColors();

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    cx = W * 0.5;
    cy = H * 0.46;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    build();
  }

  function makeNode(x, y, vx, vy, grown) {
    return {
      x: x, y: y, vx: vx, vy: vy,
      r: Math.random() * 1.6 + 1,
      t: Math.random(),       // color mix: accent <-> accent-2
      fixed: false,
      grown: !!grown,
      id: seq++
    };
  }

  function build() {
    // Node count scales with area, capped for performance.
    var target = Math.round(Math.min(92, Math.max(34, (W * H) / 16000)));
    nodes = [];
    for (var n = 0; n < target; n++) {
      // Bias spawn toward the center so the structure feels denser at the core.
      var ang = Math.random() * Math.PI * 2;
      var rad = Math.pow(Math.random(), 0.72) * Math.max(W, H) * 0.55;
      var x = cx + Math.cos(ang) * rad + (Math.random() - 0.5) * 80;
      var y = cy + Math.sin(ang) * rad + (Math.random() - 0.5) * 80;
      nodes.push(makeNode(x, y, (Math.random() - 0.5) * 0.22, (Math.random() - 0.5) * 0.22, false));
    }
  }

  function mix(c, t) {
    return Math.round(COL.a[c] + (COL.b[c] - COL.a[c]) * t);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // grow a node near (x, y); recycle the oldest grown node once we are capped
  function growAt(x, y) {
    var ang = Math.random() * Math.PI * 2;
    var sp = 0.6 + Math.random() * 1.1;
    var nx = x + (Math.random() - 0.5) * 10;
    var ny = y + (Math.random() - 0.5) * 10;
    var vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
    if (nodes.length < MAX_NODES) {
      nodes.push(makeNode(nx, ny, vx, vy, true));
      return;
    }
    var oldest = -1, best = Infinity;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].grown && nodes[i].id < best) { best = nodes[i].id; oldest = i; }
    }
    if (oldest === -1) return;
    var p = nodes[oldest];
    p.x = nx; p.y = ny; p.vx = vx; p.vy = vy; p.fixed = false; p.id = seq++;
  }

  function drawScene() {
    ctx.clearRect(0, 0, W, H);

    // edges
    for (var a = 0; a < nodes.length; a++) {
      var pa = nodes[a];
      for (var b = a + 1; b < nodes.length; b++) {
        var pb = nodes[b];
        var dx = pa.x - pb.x, dy = pa.y - pb.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < LINK * LINK) {
          var d = Math.sqrt(d2);
          var alpha = (1 - d / LINK) * 0.5 * COL.line;
          var t = (pa.t + pb.t) * 0.5;
          ctx.strokeStyle = "rgba(" + mix(0, t) + "," + mix(1, t) + "," + mix(2, t) + "," + alpha + ")";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }
      }
    }

    // nodes
    for (var k = 0; k < nodes.length; k++) {
      var q = nodes[k];
      var near = pointer.active
        ? Math.max(0, 1 - (Math.hypot(pointer.x - q.x, pointer.y - q.y) / 240))
        : 0;
      var held = drag && drag.node === q;
      var glow = 0.55 + near * 0.45;
      ctx.fillStyle = "rgba(" + mix(0, q.t) + "," + mix(1, q.t) + "," + mix(2, q.t) + "," + (glow * COL.node) + ")";
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.r + near * 1.6 + (held ? 2 : 0), 0, Math.PI * 2);
      ctx.fill();
      if (held) {
        ctx.strokeStyle = "rgba(" + mix(0, q.t) + "," + mix(1, q.t) + "," + mix(2, q.t) + ",0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.r + 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function step() {
    // grow while a press is held
    if (grow) {
      var now = performance.now();
      if (now - grow.last > 70) { growAt(grow.x, grow.y); grow.last = now; }
    }

    for (var n = 0; n < nodes.length; n++) {
      var p = nodes[n];
      if (p.fixed) continue;                 // a grabbed node is pinned to the pointer
      // gentle drift + weak pull toward center => "coalescing into structure"
      p.vx += (cx - p.x) * 0.0000075;
      p.vy += (cy - p.y) * 0.0000075;

      // pointer attraction: the cursor gathers nearby fragments (not while dragging)
      if (pointer.active && !drag) {
        var dxp = pointer.x - p.x, dyp = pointer.y - p.y;
        var dp = dxp * dxp + dyp * dyp;
        if (dp < 240 * 240) {
          var f = (1 - dp / (240 * 240)) * 0.04;
          p.vx += dxp * f * 0.02;
          p.vy += dyp * f * 0.02;
        }
      }

      p.vx *= 0.985; p.vy *= 0.985;
      p.x += p.vx; p.y += p.vy;

      // soft wrap with margin
      var m = 60;
      if (p.x < -m) p.x = W + m; else if (p.x > W + m) p.x = -m;
      if (p.y < -m) p.y = H + m; else if (p.y > H + m) p.y = -m;
    }

    drawScene();
    raf = requestAnimationFrame(step);
  }

  function renderStatic() {
    // one tasteful frame for reduced-motion users
    build();
    for (var s = 0; s < 3; s++) {
      for (var n = 0; n < nodes.length; n++) {
        var p = nodes[n];
        p.x += (cx - p.x) * 0.03;
        p.y += (cy - p.y) * 0.03;
      }
    }
    var saved = pointer.active; pointer.active = false;
    drawScene();
    pointer.active = saved;
  }

  function start() { if (raf == null && !reduce) raf = requestAnimationFrame(step); }
  function stop() { if (raf != null) { cancelAnimationFrame(raf); raf = null; } }

  /* ---------- Interaction ---------- */
  function localCoords(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, h: r.height };
  }

  function isInteractive(t) {
    return !!(t && t.closest && t.closest("a, button, input, textarea, select, label, .theme-toggle, .hamburger"));
  }

  function nearestNode(x, y, maxD) {
    var best = null, bd = maxD * maxD;
    for (var i = 0; i < nodes.length; i++) {
      var dx = nodes[i].x - x, dy = nodes[i].y - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = nodes[i]; }
    }
    return best;
  }

  function onDown(e) {
    if (reduce) return;
    if (e.button != null && e.button !== 0) return;
    if (isInteractive(e.target)) return;
    var c = localCoords(e);
    if (c.x < 0 || c.y < 0 || c.x > W || c.y > H) return;   // only over the hero

    if (e.pointerType === "touch") {                         // touch: tap-to-seed only
      tap = { x: c.x, y: c.y, t: performance.now() };
      return;
    }
    if (!finePointer) return;

    activeId = e.pointerId;
    prev.x = c.x; prev.y = c.y; vel.x = 0; vel.y = 0;
    pointer.x = c.x; pointer.y = c.y; pointer.active = true;

    var hit = nearestNode(c.x, c.y, 24);
    if (hit) {
      drag = { node: hit, ox: hit.x - c.x, oy: hit.y - c.y };
      hit.fixed = true;
      document.body.classList.add("grabbing");
      e.preventDefault();                                    // smooth drag, no text selection
    } else {
      grow = { x: c.x, y: c.y, last: 0 };
      growAt(c.x, c.y);                                      // immediate seed on press
      e.preventDefault();                                    // let a hold "draw" without selecting text
    }
    start();
  }

  function onMove(e) {
    var c = localCoords(e);
    if (c.y >= -40 && c.y <= c.h) { pointer.x = c.x; pointer.y = c.y; pointer.active = true; }
    else pointer.active = false;

    if (activeId !== null && e.pointerId === activeId) {
      var dx = c.x - prev.x, dy = c.y - prev.y;
      vel.x = vel.x * 0.55 + dx * 0.45;
      vel.y = vel.y * 0.55 + dy * 0.45;
      if (drag) { drag.node.x = c.x + drag.ox; drag.node.y = c.y + drag.oy; drag.node.vx = 0; drag.node.vy = 0; }
      if (grow) { grow.x = c.x; grow.y = c.y; }
    }
    prev.x = c.x; prev.y = c.y;
  }

  function onUp(e) {
    // touch tap: small, brief, stationary press seeds a tiny cluster
    if (tap && e.pointerType === "touch") {
      var c = localCoords(e);
      if (Math.hypot(c.x - tap.x, c.y - tap.y) < 12 && performance.now() - tap.t < 350) {
        for (var k = 0; k < 5; k++) growAt(tap.x + (Math.random() - 0.5) * 8, tap.y + (Math.random() - 0.5) * 8);
        start();
      }
      tap = null;
    }
    if (activeId !== null && e.pointerId === activeId) {
      if (drag) {
        drag.node.fixed = false;
        drag.node.vx = clamp(vel.x, -24, 24);
        drag.node.vy = clamp(vel.y, -24, 24);
        drag = null;
        document.body.classList.remove("grabbing");
      }
      grow = null;
      activeId = null;
    }
  }

  // Listen on the document so presses land even though the canvas sits behind
  // the hero content; coordinate + target checks keep us scoped to the graph.
  document.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  window.addEventListener("pointerleave", function () { pointer.active = false; });

  window.addEventListener("resize", function () {
    resize();
    if (reduce) renderStatic();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();
  });

  // re-tint when the theme changes
  var toggleBtn = document.getElementById("theme-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", function () {
      setTimeout(function () { COL = themeColors(); if (reduce) renderStatic(); }, 0);
    });
  }

  resize();
  if (reduce) renderStatic(); else start();
})();
