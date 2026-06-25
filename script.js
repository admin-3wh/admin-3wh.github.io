/* 3wh.dev — site-wide behavior: theme, nav, header state, scroll reveals.
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
