// Shared by every page. Loaded in <head> so a saved theme applies before the page paints.
(function () {
  'use strict';
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem('cfp-theme');
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  } catch (e) {}

  var SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>';
  var MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>';

  function isDark() { return /dark/.test(getComputedStyle(root).colorScheme); }

  // The button shows the theme it switches to.
  function drawButton() {
    var b = document.getElementById('theme');
    if (!b) return;
    var dark = isDark(), label = dark ? 'Switch to light theme' : 'Switch to dark theme';
    b.innerHTML = dark ? SUN : MOON;
    b.setAttribute('aria-label', label);
    b.title = label;
  }

  document.addEventListener('DOMContentLoaded', function () {
    drawButton();
    var b = document.getElementById('theme');
    if (b) b.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('cfp-theme', next); } catch (e) {}
      drawButton();
    });
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawButton); } catch (e) {}
  });
})();
