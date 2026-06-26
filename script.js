/* 3wh.dev: site-wide behavior: theme, nav, header state, scroll reveals.
   Dark is the default. Light is opt-in and remembered. */
(function () {
  "use strict";

  /* ---- Theme ---- */
  var root = document.documentElement;
  var toggle = document.getElementById("theme-toggle");

  function isLight() { return root.classList.contains("light"); }

  function paintToggle() {
    if (!toggle) return;
    var label = toggle.querySelector(".theme-toggle-label");
    if (label) label.textContent = isLight() ? "Dark" : "Light";
    toggle.setAttribute("aria-label", isLight() ? "Switch to dark theme" : "Switch to light theme");
  }

  paintToggle();

  if (toggle) {
    toggle.addEventListener("click", function () {
      root.classList.toggle("light");
      try { localStorage.setItem("theme", isLight() ? "light" : "dark"); } catch (e) {}
      paintToggle();
    });
  }

  /* ---- Mobile nav ---- */
  var hamburger = document.getElementById("hamburger");
  var navLinks = document.querySelector(".nav-links");

  function closeNav() {
    if (!navLinks) return;
    navLinks.classList.remove("active");
    if (hamburger) {
      hamburger.classList.remove("active");
      hamburger.setAttribute("aria-expanded", "false");
      hamburger.setAttribute("aria-label", "Open menu");
    }
    document.body.style.removeProperty("overflow");
  }

  if (hamburger && navLinks) {
    hamburger.addEventListener("click", function () {
      var open = navLinks.classList.toggle("active");
      hamburger.classList.toggle("active", open);
      hamburger.setAttribute("aria-expanded", String(open));
      hamburger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      document.body.style.overflow = open ? "hidden" : "";
    });
    navLinks.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeNav);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNav();
    });
  }

  /* ---- Sticky header shadow on scroll ---- */
  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---- Pointer glow on cards ---- */
  document.querySelectorAll(".card").forEach(function (card) {
    card.addEventListener("pointermove", function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty("--mx", (e.clientX - r.left) + "px");
      card.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
  });

  /* ---- Scroll reveals (progressive enhancement) ---- */
  var revealEls = document.querySelectorAll(".reveal");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!revealEls.length) return;

  if (reduce || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("in"); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

  revealEls.forEach(function (el) { io.observe(el); });
})();

/* ============================================================
   Wayfinding: scroll progress, section node-nav + scrollspy,
   and the interactive architecture stack. All progressive
   enhancement; the page is complete without any of it.
   ============================================================ */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* scroll progress bar */
  var bar = document.createElement("div");
  bar.className = "scroll-progress";
  bar.setAttribute("aria-hidden", "true");
  document.body.appendChild(bar);
  var doc = document.documentElement;
  function progress() {
    var max = doc.scrollHeight - doc.clientHeight;
    bar.style.width = (max > 0 ? (doc.scrollTop / max) * 100 : 0) + "%";
  }
  progress();
  window.addEventListener("scroll", progress, { passive: true });
  window.addEventListener("resize", progress);

  /* section node-nav + scrollspy (pages opt in via data-nav) */
  var secs = Array.prototype.slice.call(document.querySelectorAll("[data-nav]"));
  if (secs.length >= 2 && "IntersectionObserver" in window) {
    var nav = document.createElement("nav");
    nav.className = "pagenav";
    nav.setAttribute("aria-label", "Page sections");
    var btns = secs.map(function (s, i) {
      if (!s.id) s.id = "sec-" + i;
      var b = document.createElement("button");
      b.type = "button";
      var label = s.getAttribute("data-nav");
      b.setAttribute("aria-label", label);
      b.innerHTML = '<span class="nd"></span><span class="nl"></span>';
      b.querySelector(".nl").textContent = label;
      b.addEventListener("click", function () {
        s.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      });
      nav.appendChild(b);
      return b;
    });
    document.body.appendChild(nav);
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var idx = secs.indexOf(e.target);
          btns.forEach(function (b, i) { b.classList.toggle("active", i === idx); });
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    secs.forEach(function (s) { spy.observe(s); });
  }

  /* interactive architecture stack */
  var stack = document.querySelector(".stack");
  var detail = document.querySelector(".stack-detail");
  if (stack && detail) {
    var layers = Array.prototype.slice.call(stack.querySelectorAll("[data-detail]"));
    var def = detail.innerHTML;
    var select = function (el) {
      layers.forEach(function (l) { l.classList.toggle("sel", l === el); });
      stack.classList.add("has-sel");
      detail.innerHTML = el.getAttribute("data-detail");
    };
    var clear = function () {
      layers.forEach(function (l) { l.classList.remove("sel"); });
      stack.classList.remove("has-sel");
      detail.innerHTML = def;
    };
    layers.forEach(function (l) {
      l.tabIndex = 0;
      l.addEventListener("mouseenter", function () { select(l); });
      l.addEventListener("focus", function () { select(l); });
      l.addEventListener("click", function () { select(l); });
    });
    stack.addEventListener("mouseleave", clear);
    stack.addEventListener("focusout", function (e) { if (!stack.contains(e.relatedTarget)) clear(); });
  }
})();
