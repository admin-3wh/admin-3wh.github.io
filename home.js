/* 3wh.dev homepage — the living knowledge graph.
   Fragmented points drift in and resolve into a connected, structured core.
   Decorative only; the page is fully usable without it. */
(function () {
  "use strict";

  /* ---------- Pipeline pulse: ingest -> embed -> search -> cite ---------- */
  var steps = Array.prototype.slice.call(document.querySelectorAll(".pipeline span"));
  if (steps.length) {
    var i = 0;
    var tick = function () {
      steps.forEach(function (s, n) { s.classList.toggle("active", n === i); });
      i = (i + 1) % steps.length;
    };
    tick();
    setInterval(tick, 1400);
  }

  /* ---------- Knowledge graph canvas ---------- */
  var canvas = document.getElementById("graph");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var W = 0, H = 0, DPR = 1, cx = 0, cy = 0;
  var nodes = [];
  var pointer = { x: -9999, y: -9999, active: false };
  var LINK = 150;          // connection radius
  var raf = null;

  function themeColors() {
    var light = document.documentElement.classList.contains("light");
    return light
      ? { a: [10, 154, 160], b: [107, 89, 214], line: 0.5, node: 0.85 }
      : { a: [53, 224, 224], b: [155, 140, 255], line: 0.85, node: 1 };
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
      nodes.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.6 + 1,
        t: Math.random()            // color mix cyan<->violet
      });
    }
  }

  function mix(c, t) {
    return Math.round(COL.a[c] + (COL.b[c] - COL.a[c]) * t);
  }

  function step() {
    ctx.clearRect(0, 0, W, H);

    for (var n = 0; n < nodes.length; n++) {
      var p = nodes[n];
      // gentle drift + weak pull toward center => "coalescing into structure"
      p.vx += (cx - p.x) * 0.0000075;
      p.vy += (cy - p.y) * 0.0000075;

      // pointer attraction: the cursor gathers nearby fragments
      if (pointer.active) {
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
      var glow = 0.55 + near * 0.45;
      ctx.fillStyle = "rgba(" + mix(0, q.t) + "," + mix(1, q.t) + "," + mix(2, q.t) + "," + (glow * COL.node) + ")";
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.r + near * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    raf = requestAnimationFrame(step);
  }

  function renderStatic() {
    // one tasteful frame for reduced-motion users
    build();
    for (var s = 0; s < 3; s++) { // settle a little toward center
      for (var n = 0; n < nodes.length; n++) {
        var p = nodes[n];
        p.x += (cx - p.x) * 0.03;
        p.y += (cy - p.y) * 0.03;
      }
    }
    ctx.clearRect(0, 0, W, H);
    var saved = pointer.active; pointer.active = false;
    // draw a single frame using step()'s draw logic by temporarily stopping motion
    drawFrameOnly();
    pointer.active = saved;
  }

  function drawFrameOnly() {
    for (var a = 0; a < nodes.length; a++) {
      var pa = nodes[a];
      for (var b = a + 1; b < nodes.length; b++) {
        var pb = nodes[b];
        var dx = pa.x - pb.x, dy = pa.y - pb.y, d2 = dx * dx + dy * dy;
        if (d2 < LINK * LINK) {
          var d = Math.sqrt(d2), alpha = (1 - d / LINK) * 0.5 * COL.line, t = (pa.t + pb.t) * 0.5;
          ctx.strokeStyle = "rgba(" + mix(0, t) + "," + mix(1, t) + "," + mix(2, t) + "," + alpha + ")";
          ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
        }
      }
    }
    for (var k = 0; k < nodes.length; k++) {
      var q = nodes[k];
      ctx.fillStyle = "rgba(" + mix(0, q.t) + "," + mix(1, q.t) + "," + mix(2, q.t) + ",0.7)";
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  function start() {
    if (raf == null && !reduce) raf = requestAnimationFrame(step);
  }
  function stop() {
    if (raf != null) { cancelAnimationFrame(raf); raf = null; }
  }

  // pointer
  window.addEventListener("pointermove", function (e) {
    var r = canvas.getBoundingClientRect();
    if (e.clientY <= r.bottom) {
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.active = true;
    } else {
      pointer.active = false;
    }
  }, { passive: true });
  window.addEventListener("pointerleave", function () { pointer.active = false; });

  window.addEventListener("resize", function () {
    resize();
    if (reduce) renderStatic();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();
  });

  // re-tint when theme changes
  var toggleBtn = document.getElementById("theme-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", function () {
      setTimeout(function () { COL = themeColors(); if (reduce) renderStatic(); }, 0);
    });
  }

  resize();
  if (reduce) renderStatic(); else start();
})();
