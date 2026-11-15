// The History tab: every team's Elo rating after each game, drawn as one line per team with the chosen team
// (and an optional second one) in colour. Data loads the first time the tab opens.
// Usage: EloHistory.show({ root, file, detail, noun }) where file is the packed ratings and detail the folder of
// per-team game files.
window.EloHistory = (function () {
  'use strict';
  var cfg = null, H = null, st = { a: null, b: null, range: 'all', hover: null, hoverK: null, cf: 'all', coach: -1, zoom: null, hoverEra: null }, details = {}, staff = {}, crowns = {}, els = {}, G = {}, raf = 0;
  var DAY = 86400000;
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function dateOf(d) { return new Date(H.t0 + d * DAY); }
  function fmtDate(d, o) { return dateOf(d).toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }, o)); }
  function dayOfYear(y) { return Math.round((Date.UTC(y, 0, 1) - H.t0) / DAY); }

  // ---------- data ----------
  function prepare(raw) {
    H = raw; H.t0 = Date.parse(raw.day0 + 'T00:00:00Z');
    H.teams.forEach(function (t, i) {
      var acc = 0; t.i = i; t.x = t.d.map(function (step) { acc += step; return acc; });
      // u: where each point sits on the chart, in seasons. A season fills one unit: its starting rating at the
      // left edge, then its games from late August to late January spread across it. The offseason takes no room,
      // so the move back toward average shows as a step between seasons.
      t.u = new Array(t.x.length);
      t.s.forEach(function (from, n) {
        var y = t.y[n], to = n + 1 < t.s.length ? t.s[n + 1] : t.x.length, d0 = dayOfYear(y) + 232, len = 158;
        t.u[from] = y;
        for (var k = from + 1; k < to; k++) t.u[k] = y + 0.04 + 0.96 * Math.max(0, Math.min(1, (t.x[k] - d0) / len));
      });
      t.last = t.e[t.e.length - 1]; t.peak = 0; t.low = 1e9;
      t.e.forEach(function (e, k) { if (e > t.peak) { t.peak = e; t.peakK = k; } if (e < t.low) { t.low = e; t.lowK = k; } });
      t.titles = t.w || [];
      // The last point of each season, for the zoomed-out view.
      t.ends = t.s.map(function (from, n) { return (n + 1 < t.s.length ? t.s[n + 1] : t.e.length) - 1; });
      // Dashed bridges over the years the team was in a lower division: each runs from its last top-level
      // point, through the carried rating of each missing year, to the point where it returned.
      if (t.br && t.br.length) {
        var eBy = {}; t.br.forEach(function (p) { eBy[p[0]] = p[1]; });
        t.bridges = [];
        for (var g = 1; g < t.y.length; g++) {
          if (t.y[g] - t.y[g - 1] <= 1) continue;
          var a0 = t.s[g] - 1, a1 = t.s[g], poly = [{ u: t.u[a0], e: t.e[a0] }];
          for (var yy = t.y[g - 1] + 1; yy < t.y[g]; yy++) if (eBy[yy] != null) poly.push({ u: yy + 0.5, e: eBy[yy] });
          poly.push({ u: t.u[a1], e: t.e[a1] });
          if (poly.length > 2) { t.bridges.push(poly); (t.breakAt || (t.breakAt = {}))[a1] = 1; }
        }
        if (!t.bridges.length) t.bridges = null;
        if (t.breakAt) { var set = t.breakAt; t.breakAt = { has: function (k) { return !!set[k]; } }; }
      }
    });
    H.uMin = H.first; H.uMax = H.last + 1;
    // Every team-season: its year, best and final rating.
    H.seasons = [];
    H.teams.forEach(function (t) {
      t.s.forEach(function (from, n) {
        var to = n + 1 < t.s.length ? t.s[n + 1] : t.e.length, best = 0, bestK = from;
        for (var k = from; k < to; k++) if (t.e[k] > best) { best = t.e[k]; bestK = k; }
        if (to - from > 1) H.seasons.push({ t: t.i, y: t.y[n], best: best, bestK: bestK, end: t.e[to - 1], endK: to - 1 });
      });
    });
    // For the shaded band: each season, the ratings that the middle 80% of teams finished between.
    var byYear = {};
    H.seasons.forEach(function (x) { (byYear[x.y] = byYear[x.y] || []).push(x.end); });
    H.band = Object.keys(byYear).map(Number).sort(function (p, q) { return p - q; }).filter(function (y) { return byYear[y].length >= 8; }).map(function (y) {
      var v = byYear[y].sort(function (p, q) { return p - q; }), at = function (f) { return v[Math.round(f * (v.length - 1))]; };
      return { y: y, lo: at(0.1), hi: at(0.9) };
    });
    var cur = H.teams.filter(function (t) { return t.now; }).sort(function (p, q) { return q.last - p.last; });
    cur.forEach(function (t, n) { t.rank = n + 1; });
    H.current = cur;
    st.a = cur.length ? cur[0].i : 0;
  }
  // The rating a team held on a day: its latest point on or before it (null outside its playing years).
  function indexAt(t, d) {
    var lo = 0, hi = t.x.length - 1;
    if (d < t.u[0] || d > t.u[hi] + 0.9) return -1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (t.u[mid] <= d) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function loadDetail(i) {
    if (details[i]) return;
    details[i] = 'loading';
    fetch(cfg.detail + H.teams[i].id + '.json' + (cfg.ver ? '?v=' + encodeURIComponent(cfg.ver) : '')).then(function (r) { return r.json(); }).then(function (j) { details[i] = j.g || j; staff[i] = j.c || []; crowns[i] = (j.t || []).map(function (x) { return [x[0], x[1].filter(isVoter)]; }).filter(function (x) { return x[1].length; }); renderSide(); renderLog(); renderCoach(); drawAll(); }).catch(function () { details[i] = null; });
  }

  // ---------- layout ----------
  function build(root) {
    root.innerHTML =
      '<div class="eh-controls">' +
        '<div class="ctl"><label for="eh-team">Team</label><select id="eh-team"></select></div>' +
        '<div class="ctl" id="eh-coach-ctl" hidden><label for="eh-coach">Coach</label><select id="eh-coach"></select></div>' +
      '</div>' +
      '<div class="eh-plot" id="eh-plot"><canvas id="eh-base"></canvas><canvas id="eh-top" role="img" tabindex="0"></canvas><div class="eh-tip" id="eh-tip" hidden></div></div>' +
      '<p class="eh-hint">Each coach’s era is shaded along the top — click one (or use the Coach menu) to zoom to those years. Hover the line for each game; a star marks a national championship season.</p>' +
      '<div class="eh-cl-wrap" id="eh-cl" hidden></div>' +
      '<section class="eh-facts" id="eh-story" aria-live="polite"></section>' +
      '<div id="eh-log"></div>' +
      '<p class="eh-method" id="eh-method"></p>';
    ['team', 'coach', 'plot', 'base', 'top', 'tip', 'story', 'method', 'cl', 'log'].forEach(function (k) { els[k] = document.getElementById('eh-' + k); });
    els.coachWrap = document.getElementById('eh-coach-ctl');
    var opts = function (list) { return list.map(function (t) { return '<option value="' + t.i + '">' + esc(t.n) + '</option>'; }).join(''); };
    var cur = H.teams.filter(function (t) { return t.now; }), old = H.teams.filter(function (t) { return !t.now; });
    var groups = '<optgroup label="Current ' + esc(cfg.noun) + ' teams">' + opts(cur) + '</optgroup><optgroup label="Former major teams">' + opts(old) + '</optgroup>';
    els.team.innerHTML = groups;
    els.team.addEventListener('change', function () { select(+els.team.value); });
    root.addEventListener('change', function (e) {
      if (e.target.id === 'eh-org') { st.cf = e.target.value; renderSide(); drawTop(); var o = document.getElementById('eh-org'); if (o) o.focus(); }
      if (e.target.id === 'eh-coach') pickCoach(+e.target.value);
    });
    root.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.ehteam) { select(+b.dataset.ehteam); els.plot.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    });
    els.top.addEventListener('pointermove', onMove);
    els.top.addEventListener('pointerleave', function () { st.hover = null; st.hoverK = null; st.hoverEra = null; els.top.style.cursor = ''; els.tip.hidden = true; drawTop(); });
    els.top.addEventListener('click', onClick);
    els.top.addEventListener('keydown', onKey);
    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { drawAll(); renderCoach(); }, 100); });
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawAll); } catch (e) {}
    new MutationObserver(drawAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    els.method.innerHTML = 'Elo is a running rating: an average major-college team is 1500, the winner of each game takes points from the loser, and bigger or more surprising wins move more. Home teams get ' + H.p.hfa +
      ' points, and each rating moves a quarter of the way back to average between seasons. Results from <a href="https://collegefootballdata.com" target="_blank" rel="noopener">CollegeFootballData.com</a> (' + H.first + ' on) and ESPN (this season). ' +
      'National championships are those named by the NCAA records book\u2019s major selectors, as listed on <a href="https://en.wikipedia.org/wiki/College_football_national_championships_in_NCAA_Division_I_FBS" target="_blank" rel="noopener">Wikipedia</a>; the chart marks the ones from the AP, the coaches\u2019 poll, the FWAA, the NFF, the BCS and the CFP.';
  }
  function select(i) { st.a = i; if (st.b === i) st.b = null; st.cf = 'all'; st.coach = -1; st.zoom = null; sync(); }
  function sync() {
    els.team.value = st.a;
    loadDetail(st.a);
    drawAll(); renderSide(); renderChartLegend(); renderLog(); renderCoach();
  }
  function renderChartLegend() {
    if (!els.cl) return;
    var t = H.teams[st.a], has = !!(t.bridges && t.bridges.length);
    els.cl.innerHTML = has ? '<span class="eh-cl"><i class="eh-cl-dash" style="--c:' + colorOf(st.a) + '"></i>Dashed: seasons away from the top division (FCS, or no team), rating carried across</span>' : '';
    els.cl.hidden = !has;
  }

  // ---------- drawing ----------
  function lum(hex) { var n = parseInt(hex, 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255; return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
  function toRGB(hex) { var n = parseInt(hex, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function lumRGB(c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
  function hx(x) { var h = Math.round(Math.max(0, Math.min(255, x))).toString(16); return h.length < 2 ? '0' + h : h; }
  // Keep a colour's hue but mix it toward white or black until its brightness lands in [lo, hi], so a team's
  // own colour stays legible against the page instead of being thrown away.
  function fit(hex, lo, hi) {
    var rgb = toRGB(hex), L = lumRGB(rgb);
    if (L >= lo && L <= hi) return '#' + hex;
    var toward = L < lo ? 255 : 0, target = L < lo ? lo : hi, a = 0, b = 1, f = 0;
    for (var k = 0; k < 9; k++) { f = (a + b) / 2; var m = rgb.map(function (c) { return c + (toward - c) * f; }); if ((lumRGB(m) < target) === (toward === 255)) a = f; else b = f; }
    f = (a + b) / 2;
    return '#' + rgb.map(function (c) { return hx(c + (toward - c) * f); }).join('');
  }
  // The team's primary colour, lightened for the dark page or darkened for the light one so it reads clearly.
  function colorOf(i) {
    var t = H.teams[i], dark = lum(css('--bg').replace('#', '')) < 0.4, c = t.c && /^[0-9a-f]{6}$/i.test(t.c) ? t.c : null;
    if (!c) return css('--accent');
    return dark ? fit(c, 0.42, 1) : fit(c, 0, 0.5);
  }
  function span() {
    // Zoomed to a coach's tenure: just that window, with a little breathing room.
    if (st.zoom) { var za = st.zoom[0], zb = st.zoom[1], pad = Math.max(0.22, (zb - za) * 0.03); return [za - pad, zb + pad]; }
    // All time starts at the chosen team's first season (the earlier of the two when comparing).
    var first = Math.min.apply(null, [st.a, st.b].filter(function (i) { return i != null; }).map(function (i) { return H.teams[i].u[0]; }));
    var from = st.range === 'all' ? first : st.range === '10' ? H.last - 9 : Math.max(+st.range, first);
    var to = H.uMax + 0.1;
    return [Math.min(from, to - 3) - (to - from) * 0.012, to];
  }
  function size(canvas, w, h) { var r = window.devicePixelRatio || 1; canvas.width = Math.round(w * r); canvas.height = Math.round(h * r); canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; var c = canvas.getContext('2d'); c.setTransform(r, 0, 0, r, 0, 0); return c; }
  function drawAll() {
    if (!H || !els.plot || !els.plot.clientWidth) return;
    // Coach eras for the chosen team (only when the detail has loaded); the chart reserves a label lane for them.
    var eras = (st.b == null && details[st.a] && details[st.a] !== 'loading') ? coachStats(st.a) : [];
    var ta = H.teams[st.a], a0 = ta.y[0], z0 = ta.y[ta.y.length - 1] + 1;
    var W = els.plot.clientWidth, Hh = W < 560 ? 340 : Math.max(420, Math.min(600, Math.round(W * 0.52))), m = { l: 44, r: 14, t: eras.length >= 2 ? 48 : 30, b: 26 };
    var s = span(), lo = 1e9, hi = 0;
    // The scale fits what is drawn, so the line uses the height it has (and always includes the average).
    [st.a, st.b].forEach(function (i) { if (i == null) return; var t = H.teams[i]; for (var k = 0; k < t.u.length; k++) if (t.u[k] >= s[0] && t.u[k] <= s[1]) { if (t.e[k] < lo) lo = t.e[k]; if (t.e[k] > hi) hi = t.e[k]; } });
    if (lo > hi) { lo = 1300; hi = 1700; }
    lo = Math.min(lo, 1480); hi = Math.max(hi, 1520);
    lo = Math.floor((lo - 20) / 100) * 100; hi = Math.ceil((hi + 20) / 100) * 100;
    G = { W: W, H: Hh, m: m, s: s, lo: lo, hi: hi, iw: W - m.l - m.r, ih: Hh - m.t - m.b };
    G.eras = eras.length >= 2 ? eras.map(function (r) { return { idx: r.idx, name: r.name, y0: Math.max(r.first, a0), y1: Math.min(r.last + 1, z0) }; }) : [];
    G.px = function (d) { return m.l + (d - s[0]) / (s[1] - s[0]) * G.iw; };
    G.py = function (e) { return m.t + (hi - e) / (hi - lo) * G.ih; };
    var c = size(els.base, W, Hh), muted = css('--muted'), line = css('--line');
    c.clearRect(0, 0, W, Hh);
    c.font = '600 11px ' + (css('--display') || 'sans-serif'); c.textBaseline = 'middle';
    var stepY = hi - lo > 900 ? 200 : 100;
    for (var e = lo; e <= hi; e += stepY) {
      c.strokeStyle = line; c.lineWidth = e === 1500 ? 1.5 : 1; c.beginPath(); c.moveTo(m.l, G.py(e) + 0.5); c.lineTo(W - m.r, G.py(e) + 0.5); c.stroke();
      c.fillStyle = e === 1500 ? css('--ink') : muted; c.textAlign = 'right'; c.fillText(e === 1500 ? 'Avg.' : String(e), m.l - 8, G.py(e));
    }
    if (lo < 1500 && hi > 1500 && stepY === 200 && (1500 - lo) % 200) { c.strokeStyle = line; c.lineWidth = 1.5; c.beginPath(); c.moveTo(m.l, G.py(1500) + 0.5); c.lineTo(W - m.r, G.py(1500) + 0.5); c.stroke(); c.fillStyle = css('--ink'); c.textAlign = 'right'; c.fillText('Avg.', m.l - 8, G.py(1500)); }
    var y0 = Math.ceil(s[0]), y1 = Math.floor(s[1]), perYear = G.iw / (s[1] - s[0]);
    // Year labels at least 46px apart.
    var stepX = [1, 2, 5, 10, 20, 25, 50].filter(function (n) { return n * perYear >= 46; })[0] || 50;
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    for (var y = Math.ceil(y0 / stepX) * stepX; y <= y1; y += stepX) {
      var x = G.px(y); if (x < m.l - 1 || x > W - m.r - 8) continue;
      c.strokeStyle = line; c.lineWidth = 1; c.beginPath(); c.moveTo(x + 0.5, m.t + G.ih); c.lineTo(x + 0.5, m.t + G.ih + 4); c.stroke();
      c.fillStyle = muted; c.fillText(String(y), x, Hh - 6);
    }
    drawTop();
  }
  // One team's line across the span; a gap of more than two years (a team that stopped and came back) lifts the pen.
  function trace(c, t, coarse) {
    var s = G.s, on = false, idx = coarse ? t.ends : null, n = idx ? idx.length : t.u.length, prev = 0, lift = coarse ? 1.5 : 2; c.beginPath();
    for (var q = 0; q < n; q++) {
      var k = idx ? idx[q] : q, d = t.u[k]; if (d < s[0] - 1.1) { prev = d; continue; } if (d > s[1] + 1.1) break;
      if (on && (d - prev > lift || (!idx && t.breakAt && t.breakAt.has(k)))) on = false;
      prev = d;
      if (on) c.lineTo(G.px(d), G.py(t.e[k])); else { c.moveTo(G.px(d), G.py(t.e[k])); on = true; }
    }
    c.stroke();
  }
  function drawTop() {
    if (!G.W) return;
    var c = size(els.top, G.W, G.H), m = G.m, bg = css('--bg');
    c.clearRect(0, 0, G.W, G.H);
    c.save(); c.beginPath(); c.rect(m.l - 6, 0, G.iw + 12, m.t + G.ih); c.clip();
    drawEras(c);
    var paint = function (i, color, w) {
      var t = H.teams[i];
      c.lineJoin = 'round'; c.strokeStyle = bg; c.lineWidth = w + 1.5; trace(c, t);
      c.strokeStyle = color; c.lineWidth = w; trace(c, t);
      // Championship seasons, starred at the season's last game. They follow the organization chosen in the panel
      // below: a filled star for a season it covers (for "all", a filled star for a major title and a small
      // hollow one where only other selectors named the team).
      var endOf = function (y) { var n = t.y.indexOf(y); return n < 0 ? -1 : (n + 1 < t.s.length ? t.s[n + 1] : t.e.length) - 1; };
      var star = function (px, py, r, filled) {
        c.beginPath();
        for (var q = 0; q < 10; q++) { var ang = -Math.PI / 2 + q * Math.PI / 5, rad = q % 2 ? r * 0.45 : r; if (q) c.lineTo(px + rad * Math.cos(ang), py + rad * Math.sin(ang)); else c.moveTo(px + rad * Math.cos(ang), py + rad * Math.sin(ang)); }
        c.closePath(); c.lineJoin = 'round';
        if (filled) { c.lineWidth = 3; c.strokeStyle = bg; c.stroke(); c.fillStyle = color; c.fill(); }
        else { c.fillStyle = bg; c.fill(); c.lineWidth = 1.2; c.strokeStyle = color; c.stroke(); }
      };
      var seasons = crowns[i] ? crowns[i].filter(function (x) { return orgMatch(x, st.cf); }) : t.titles.map(function (y) { return [y, ['AP']]; });
      // hollow ones first, so a filled star is never hidden under one
      seasons.slice().sort(function (p, q) { return (t.titles.indexOf(p[0]) >= 0) - (t.titles.indexOf(q[0]) >= 0); }).forEach(function (x) {
        var k = endOf(x[0]); if (k < 0) return;
        var px = G.px(t.u[k]), py = G.py(t.e[k]); if (px < m.l - 2 || px > G.W - m.r + 2) return;
        var big = st.cf !== 'all' || t.titles.indexOf(x[0]) >= 0;
        star(px, py - (big ? 11 : 9), big ? 6.5 : 4.5, big);
      });
      if (t.bridges) {
        c.save(); c.setLineDash([5, 4]); c.lineWidth = w; c.strokeStyle = color; c.globalAlpha = 0.65; c.lineJoin = 'round';
        t.bridges.forEach(function (poly) { c.beginPath(); poly.forEach(function (pt, q) { var bx = G.px(pt.u), by = G.py(pt.e); if (q) c.lineTo(bx, by); else c.moveTo(bx, by); }); c.stroke(); });
        c.restore();
      }
    };
    // A finer line when many seasons share the width.
    var dense = G.iw / (G.s[1] - G.s[0]) < 20, lw = dense ? 1 : 1.5;
    if (st.b != null) paint(st.b, colorOf(st.b, true), lw);
    if (st.a != null) paint(st.a, colorOf(st.a), lw);
    if (st.hover != null && st.hoverK != null) {
      var t = H.teams[st.hover], x = G.px(t.u[st.hoverK]), y = G.py(t.e[st.hoverK]);
      c.strokeStyle = css('--muted'); c.globalAlpha = 0.5; c.lineWidth = 1; c.beginPath(); c.moveTo(x + 0.5, m.t); c.lineTo(x + 0.5, m.t + G.ih); c.stroke(); c.globalAlpha = 1;
      c.beginPath(); c.arc(x, y, 4, 0, 6.3); c.fillStyle = st.hover === st.a ? colorOf(st.a) : st.hover === st.b ? colorOf(st.b, true) : css('--ink'); c.fill(); c.lineWidth = 2; c.strokeStyle = bg; c.stroke();
    }
    c.restore();
    drawEraLabels(c);
    els.top.setAttribute('aria-label', 'Elo ratings of every team, ' + Math.ceil(G.s[0]) + ' to ' + Math.min(H.last, Math.floor(G.s[1])) + ', with ' + H.teams[st.a].n + ' highlighted');
  }
  // The coach whose era covers a point on the x-axis (in season units).
  function eraAt(d) { var e = G.eras || []; for (var i = 0; i < e.length; i++) if (d >= e[i].y0 && d < e[i].y1) return e[i]; return null; }
  // Faint vertical bands, one per coach, behind the line: the chosen coach in the team colour, the one under the
  // cursor a touch darker, and the rest in a quiet alternating wash so the eras read without clutter.
  function drawEras(c) {
    var e = G.eras || []; if (!e.length) return;
    var m = G.m, top = m.t, h = G.ih, ink = css('--ink'), col = colorOf(st.a), line = css('--line');
    e.forEach(function (er, n) {
      var x0 = Math.max(m.l, G.px(er.y0)), x1 = Math.min(G.W - m.r, G.px(er.y1)); if (x1 - x0 < 0.5) return;
      var sel = er.idx === st.coach, hov = er.idx === st.hoverEra;
      var fill = sel ? col : ink, alpha = sel ? 0.13 : hov ? 0.08 : (n % 2 ? 0.04 : 0);
      if (alpha) { c.fillStyle = fill; c.globalAlpha = alpha; c.fillRect(x0, top, x1 - x0, h); c.globalAlpha = 1; }
    });
    c.strokeStyle = line; c.lineWidth = 1; c.globalAlpha = 0.9;
    e.forEach(function (er) { var x = G.px(er.y0); if (x > m.l + 1 && x < G.W - m.r - 1) { c.beginPath(); c.moveTo(x + 0.5, top); c.lineTo(x + 0.5, top + h); c.stroke(); } });
    c.globalAlpha = 1;
  }
  // Coach names in the lane above the plot, each centred over its era and shortened to what fits.
  function drawEraLabels(c) {
    var e = G.eras || []; if (!e.length) return;
    var m = G.m, col = colorOf(st.a), muted = css('--muted'), ink = css('--ink');
    c.font = '600 11px ' + (css('--display') || 'sans-serif'); c.textBaseline = 'alphabetic'; c.textAlign = 'center';
    var ly = m.t - 8;
    e.forEach(function (er) {
      var x0 = Math.max(m.l, G.px(er.y0)), x1 = Math.min(G.W - m.r, G.px(er.y1)); if (x1 - x0 < 30) return;
      var txt = fitText(c, er.name, x1 - x0 - 8); if (!txt) return;
      var sel = er.idx === st.coach, hov = er.idx === st.hoverEra;
      c.fillStyle = sel ? col : hov ? ink : muted;
      c.fillText(txt, (x0 + x1) / 2, ly);
    });
  }
  // Full name if it fits, else the last name, else a truncated last name, else nothing.
  function fitText(c, s, maxw) {
    if (maxw < 8) return '';
    if (c.measureText(s).width <= maxw) return s;
    var last = s.split(' ').pop();
    if (c.measureText(last).width <= maxw) return last;
    var t = last; while (t.length > 1 && c.measureText(t + '…').width > maxw) t = t.slice(0, -1);
    return t.length > 1 ? t + '…' : '';
  }

  // ---------- hover ----------
  function onMove(ev) {
    var r = els.top.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    if (x < G.m.l || x > G.W - G.m.r) { st.hover = null; st.hoverEra = null; els.tip.hidden = true; els.top.style.cursor = ''; schedule(); return; }
    var d = G.s[0] + (x - G.m.l) / G.iw * (G.s[1] - G.s[0]), best = null, bd = 1e9, bk = null;
    var he = eraAt(d); st.hoverEra = he ? he.idx : null; els.top.style.cursor = he ? 'pointer' : '';
    [st.a, st.b].forEach(function (i) {
      if (i == null) return;
      var t = H.teams[i], k = indexAt(t, d); if (k < 0) return;
      var dist = Math.abs(G.py(t.e[k]) - y);
      if (dist < bd) { bd = dist; best = i; bk = k; }
    });
    st.hover = best; st.hoverK = bk;
    if (best == null) { els.tip.hidden = true; schedule(); return; }
    showTip(best, bk, G.px(H.teams[best].u[bk]), G.py(H.teams[best].e[bk])); schedule();
  }
  // Click a coach's era to zoom to it; click the one already shown to go back to the full history.
  function onClick(ev) {
    if (!G.eras || !G.eras.length) return;
    var r = els.top.getBoundingClientRect(), x = ev.clientX - r.left;
    if (x < G.m.l || x > G.W - G.m.r) return;
    var e = eraAt(G.s[0] + (x - G.m.l) / G.iw * (G.s[1] - G.s[0])); if (!e) return;
    pickCoach(st.coach === e.idx ? -1 : e.idx);
  }
  function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawTop); }
  function gameText(i, k) {
    var t = H.teams[i], dt = details[i];
    if (t.s.indexOf(k) >= 0) return 'Start of the ' + t.y[t.s.indexOf(k)] + ' season';
    if (!dt || dt === 'loading' || !dt[k]) return '';
    var g = dt[k], res = g[1] > g[2] ? 'Beat' : g[1] < g[2] ? 'Lost to' : 'Tied';
    return res + ' ' + esc(g[0]) + ' ' + g[1] + '–' + g[2] + (g[3] === 1 ? ' (away)' : g[3] === 2 ? ' (neutral)' : '') + (g[4] ? '<br><span>' + esc(String(g[4])) + '</span>' : '');
  }
  function showTip(i, k, x, y) {
    var t = H.teams[i], prev = k > 0 ? t.e[k - 1] : null, ch = prev == null || t.s.indexOf(k) >= 0 ? '' : ' <span>(' + (t.e[k] >= prev ? '+' : '−') + Math.abs(t.e[k] - prev) + ')</span>';
    var game = i === st.a || i === st.b ? gameText(i, k) : '';
    els.tip.innerHTML = '<b>' + esc(t.n) + '</b><div>' + fmtDate(t.x[k]) + '</div><div class="eh-tip-e">' + t.e[k] + ch + '</div>' + (game ? '<div class="eh-tip-g">' + game + '</div>' : '');
    els.tip.hidden = false;
    var tw = els.tip.offsetWidth, th = els.tip.offsetHeight, left = x + 14 + tw > G.W ? x - 14 - tw : x + 14;
    els.tip.style.left = Math.max(0, left) + 'px'; els.tip.style.top = Math.max(0, Math.min(y - th / 2, G.H - th)) + 'px';
  }
  // Keyboard: arrows walk the chosen team's games.
  function onKey(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    var t = H.teams[st.a], k = st.hover === st.a && st.hoverK != null ? st.hoverK : t.e.length - 1;
    k = Math.max(0, Math.min(t.e.length - 1, k + (e.key === 'ArrowRight' ? 1 : -1)));
    st.hover = st.a; st.hoverK = k;
    if (t.u[k] < G.s[0] || t.u[k] > G.s[1]) { st.range = 'all'; st.zoom = null; st.coach = -1; sync(); }
    showTip(st.a, k, G.px(t.u[k]), G.py(t.e[k])); drawTop();
  }

  // ---------- text ----------
  // Who names champions. The well-known ones are spelled out; the rest (mostly ratings systems and historians
  // naming champions after the fact) are counted, with their names in the hover text.
  var KEY = [['CFP', /^CFP$/, 'College Football Playoff'], ['BCS', /^BCS$/, 'Bowl Championship Series'], ['AP', /^AP$/, 'Associated Press poll'],
    ['Coaches', /^(UP|UPI|USAT)(\/|$)/, 'Coaches\u2019 poll (UPI, USA Today)'], ['FWAA', /^FWAA$/, 'Football Writers Association of America'], ['NFF', /^NFF$/, 'National Football Foundation']];
  // The other selectors kept: polls and research bodies. Computer models and ratings formulas (Sagarin,
  // Billingsley, Colley, Dunkel and the like) are left out, so a season only a formula picked is not listed.
  var OTHER = { FN: 'Football News', INS: 'International News Service', SN: 'Sporting News', HAF: 'Helms Athletic Foundation', NCF: 'National Championship Foundation',
    CFRA: 'College Football Researchers Association', PD: 'Parke Davis', CW: 'Caspar Whitney' };
  function isVoter(c) { return !!OTHER[c] || KEY.some(function (k) { return k[1].test(c); }); }
  function titleRow(x) {
    var codes = x[1], key = [], rest = [];
    KEY.forEach(function (k) { if (codes.some(function (c) { return k[1].test(c); })) key.push('<abbr title="' + esc(k[2]) + '">' + k[0] + '</abbr>'); });
    codes.forEach(function (c) { if (!KEY.some(function (k) { return k[1].test(c); })) rest.push(OTHER[c] || c); });
    var others = !rest.length ? '' : key.length || rest.length > 3
      ? '<span class="eh-more" title="' + esc(rest.join(', ')) + '">' + (key.length ? '+ ' : '') + rest.length + ' other' + (rest.length === 1 ? '' : 's') + '</span>'
      : '<span class="eh-more">' + esc(rest.join(', ')) + '</span>';
    return '<li' + (key.length ? ' class="eh-major"' : '') + '><b>' + x[0] + '</b><span>' + key.join(', ') + (key.length && others ? ' ' : '') + others + '</span></li>';
  }
  function fact(label, value, i, k) {
    var t = H.teams[i], n = t.s.indexOf(k), dt = details[i], ready = dt && dt !== 'loading';
    var what = n >= 0 ? 'Start of the ' + t.y[n] + ' season' : ready && dt[k] ? (dt[k][1] > dt[k][2] ? 'Beat ' : dt[k][1] < dt[k][2] ? 'Lost to ' : 'Tied ') + esc(dt[k][0]) + ' ' + Math.max(dt[k][1], dt[k][2]) + '\u2013' + Math.min(dt[k][1], dt[k][2]) : '';
    return '<div class="eh-tile"><dt>' + label + '</dt><dd>' + value + '</dd><p>' + (what ? what + '<br>' : '') + fmtDate(t.x[k]) + '</p></div>';
  }
  // Does this championship season count for the chosen organization? 'all', 'major' (any of the six well-known
  // ones), one of those six by name, or any other selector by its code.
  function orgMatch(x, org) {
    if (org === 'all') return true;
    var isKey = function (c, k) { return k[1].test(c); };
    if (org === 'major') return x[1].some(function (c) { return KEY.some(function (k) { return isKey(c, k); }); });
    var key = KEY.filter(function (k) { return k[0] === org; })[0];
    return key ? x[1].some(function (c) { return isKey(c, key); }) : x[1].indexOf(org) >= 0;
  }
  function championPanel(list) {
    // The organizations that ever named this team: the six well-known ones first, then the rest by name.
    var has = function (org) { return list.some(function (x) { return orgMatch(x, org); }); }, count = function (org) { return list.filter(function (x) { return orgMatch(x, org); }).length; };
    var others = {};
    list.forEach(function (x) { x[1].forEach(function (c) { if (!KEY.some(function (k) { return k[1].test(c); })) others[c] = OTHER[c] || c; }); });
    var opt = function (v, label) { return '<option value="' + esc(v) + '"' + (v === st.cf ? ' selected' : '') + '>' + esc(label) + ' (' + count(v) + ')</option>'; };
    if (st.cf !== 'all' && st.cf !== 'major' && !has(st.cf)) st.cf = 'all';
    var select = '<div class="ctl"><label for="eh-org">Named by</label><select id="eh-org">' + opt('all', 'Any selector') + (has('major') ? opt('major', 'Major polls and title games') : '') +
      '<optgroup label="Polls and title games">' + KEY.filter(function (k) { return has(k[0]); }).map(function (k) { return opt(k[0], k[2]); }).join('') + '</optgroup>' +
      (Object.keys(others).length ? '<optgroup label="Other polls and historians">' + Object.keys(others).sort(function (p, q) { return others[p].localeCompare(others[q]); }).map(function (c) { return opt(c, others[c]); }).join('') + '</optgroup>' : '') + '</select></div>';
    var shown = list.filter(function (x) { return orgMatch(x, st.cf); });
    shown.sort(function (p, q) { return p[0] - q[0]; }); // oldest first
    return '<div class="eh-crowns"><div class="eh-crowns-head"><h3>Championship seasons</h3><div class="eh-crowns-ctl">' + select + '</div></div>' +
      '<ol class="eh-titles">' + shown.map(titleRow).join('') + '</ol></div>';
  }
  function story(i) {
    var t = H.teams[i], list = crowns[i] || [], major = list.filter(function (x) { return x[1].some(function (c) { return KEY.some(function (k) { return k[1].test(c); }); }); }).length;
    var note = !list.length ? 'None named by a poll or title game' : major ? 'From the major polls and title games' + (list.length > major ? '<br>' + (list.length - major) + ' more from other polls and historians' : '') : 'None from the major polls or title games<br>' + list.length + ' from other polls and historians';
    return '<dl class="eh-tiles3">' + fact('Highest rating', t.peak, i, t.peakK) + fact('Lowest rating', t.low, i, t.lowK) +
      '<div class="eh-tile"><dt>National titles</dt><dd>' + major + '</dd><p>' + note + '</p></div></dl>' +
      (list.length ? championPanel(list) : '');
  }
  function renderSide() {
    if (!els.story) return;
    els.story.innerHTML = story(st.a);
  }

  // ---------- year-by-year results (the record-book log) ----------
  function shortDate(dayVal) { return dateOf(dayVal).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }); }
  // The coach whose tenure covers a season, or null when the records don't name one.
  function coachAt(i, y) { var s = staff[i] || []; for (var j = 0; j < s.length; j++) if (y >= s[j][1] && y <= s[j][2]) return s[j]; return null; }
  // Each season at the top level, with its games pulled from the detail rows that sit between season markers.
  function seasonsOf(i) {
    var t = H.teams[i], dt = details[i], out = [];
    if (!dt || dt === 'loading') return out;
    t.s.forEach(function (from, n) {
      var to = n + 1 < t.s.length ? t.s[n + 1] : t.e.length, games = [];
      for (var k = from + 1; k < to; k++) { var g = dt[k]; if (g) games.push({ d: t.x[k], opp: g[0], pf: g[1], pa: g[2], site: g[3], post: g[4] }); }
      out.push({ y: t.y[n], games: games });
    });
    return out;
  }
  function rec(w, l, ti) { return w + '–' + l + (ti ? '–' + ti : ''); }
  // The records' postseason note is messy (sponsor names, all-caps, a few are just locations). Tidy it to a
  // readable bowl/championship label, or a plain "Postseason" when there is nothing usable.
  function titleCase(s) { return s.toLowerCase().replace(/\b([a-z])/g, function (m, c) { return c.toUpperCase(); }).replace(/\bbcs\b/i, 'BCS').replace(/\bcfp\b/i, 'CFP').replace(/\bLsu\b/, 'LSU').replace(/\bTcu\b/, 'TCU').replace(/\bUconn\b/, 'UConn').replace(/\bat&t\b/i, 'AT&T').replace(/\.com\b/i, '.com'); }
  function bowlName(note) {
    var s = String(note == null ? '' : note).replace(/\s+/g, ' ').trim();
    if (!s || /^postseason$/i.test(s)) return 'Postseason';
    if (/national championship|BCS national/i.test(s)) return 'National Championship';
    if (/\b(bowl|classic|playoff|championship)\b/i.test(s)) return titleCase(s);
    return 'Postseason'; // e.g. a stray "AT TEMPE AZ" with no bowl in it
  }
  function seasonBlock(s) {
    var w = 0, l = 0, ti = 0;
    var rows = s.games.map(function (g) {
      var res = g.pf > g.pa ? 'w' : g.pf < g.pa ? 'l' : 't';
      if (res === 'w') w++; else if (res === 'l') l++; else ti++;
      var opp = (g.site === 1 ? '<i>at</i> ' : g.site === 2 ? '<i>vs</i> ' : '') + esc(g.opp);
      var post = g.post ? '<em class="eh-bowl">' + esc(bowlName(g.post)) + '</em>' : '';
      return '<li class="eh-g-' + res + '"><span class="eh-g-d">' + shortDate(g.d) + '</span><span class="eh-g-o">' + opp + post + '</span><span class="eh-g-s">' + g.pf + '–' + g.pa + '</span></li>';
    }).join('');
    return '<div class="eh-yr"><div class="eh-yr-h"><b>' + s.y + '</b><span>' + rec(w, l, ti) + '</span></div><ul class="eh-g">' + rows + '</ul></div>';
  }
  function logPanel(i) {
    var dt = details[i];
    if (dt === 'loading') return '<div class="eh-log-load">Loading games…</div>';
    if (!dt) return '';
    var t = H.teams[i], seasons = seasonsOf(i);
    if (!seasons.length) return '';
    // When a coach is chosen on the chart, the log narrows to just their seasons (and opens so it is in view);
    // otherwise it is the full history, grouped under each coach, collapsed.
    var sel = st.coach >= 0 ? coachStats(i).filter(function (r) { return r.idx === st.coach; })[0] : null;
    var shown = sel ? seasons.filter(function (s) { return s.y >= sel.first && s.y <= sel.last; }) : seasons;
    var total = 0, cr = {};
    shown.forEach(function (s) { total += s.games.length; });
    if (!sel) seasons.forEach(function (s) {
      var c = coachAt(i, s.y); if (!c) return;
      var key = c[1] + ':' + c[0], r = cr[key] || (cr[key] = { w: 0, l: 0, t: 0 });
      s.games.forEach(function (g) { if (g.pf > g.pa) r.w++; else if (g.pf < g.pa) r.l++; else r.t++; });
    });
    var html = '', lastKey = null;
    shown.forEach(function (s) {
      if (!sel) {
        var c = coachAt(i, s.y), key = c ? c[1] + ':' + c[0] : null;
        if (key !== lastKey) {
          lastKey = key;
          if (c) { var r = cr[key]; html += '<div class="eh-era"><b>' + esc(c[0]) + '</b><span>' + c[1] + '–' + c[2] + ' · ' + rec(r.w, r.l, r.t) + '</span></div>'; }
        }
      }
      html += seasonBlock(s);
    });
    var summary = sel
      ? '<span class="eh-log-t">' + esc(sel.name) + '</span><span class="eh-log-n">' + sel.first + '–' + sel.last + ' · ' + rec(sel.w, sel.l, sel.t) + ' · ' + total.toLocaleString() + ' games</span>'
      : '<span class="eh-log-t">Year-by-year results</span><span class="eh-log-n">' + t.y[0] + '–' + t.y[t.y.length - 1] + ' · ' + total.toLocaleString() + ' games</span>';
    return '<details class="eh-log"' + (sel ? ' open' : '') + '><summary>' + summary + '</summary>' +
      '<div class="eh-log-body">' + html + '</div></details>';
  }
  function renderLog() { if (els.log) els.log.innerHTML = logPanel(st.a); }

  // ---------- coach tenure: the dropdown (the eras themselves are drawn on the chart) ----------
  // Each coach who has at least one charted season, in order, with their record. Needs the detail (for games)
  // and staff (for tenures) to have loaded; returns empty until then.
  function coachStats(i) {
    var s = staff[i] || [], seasons = seasonsOf(i);
    if (!s.length || !seasons.length) return [];
    var rows = s.map(function (c, idx) { return { idx: idx, name: c[0], first: c[1], last: c[2], w: 0, l: 0, t: 0, n: 0 }; });
    seasons.forEach(function (se) {
      var c = rows.filter(function (r) { return se.y >= r.first && se.y <= r.last; })[0];
      if (!c) return; c.n++;
      se.games.forEach(function (g) { if (g.pf > g.pa) c.w++; else if (g.pf < g.pa) c.l++; else c.t++; });
    });
    return rows.filter(function (r) { return r.n > 0; }).sort(function (p, q) { return p.first - q.first; });
  }
  function pickCoach(ci) {
    var rows = coachStats(st.a), r = ci < 0 ? null : rows.filter(function (x) { return x.idx === ci; })[0];
    if (!r) { st.coach = -1; st.zoom = null; }
    else { var t = H.teams[st.a], a = t.y[0], z = t.y[t.y.length - 1] + 1; st.coach = ci; st.zoom = [Math.max(r.first, a), Math.min(r.last + 1, z)]; }
    drawAll(); renderCoach(); renderLog();
  }
  function renderCoach() {
    if (!els.coachWrap || !els.coach) return;
    var rows = coachStats(st.a);
    if (rows.length < 2) { els.coachWrap.hidden = true; return; }
    els.coachWrap.hidden = false;
    els.coach.innerHTML = '<option value="-1">Full history</option>' +
      rows.map(function (r) { return '<option value="' + r.idx + '"' + (r.idx === st.coach ? ' selected' : '') + '>' + esc(r.name) + ' (' + r.first + '–' + r.last + ', ' + rec(r.w, r.l, r.t) + ')</option>'; }).join('');
    els.coach.value = String(st.coach);
  }

  // ---------- entry ----------
  function show(c) {
    cfg = c;
    var root = document.getElementById(c.root);
    if (H) { drawAll(); return; }
    if (root.dataset.loading) return;
    root.dataset.loading = '1';
    root.innerHTML = '<p class="eh-hint">Loading ' + esc(c.noun) + ' history…</p>';
    fetch(c.file).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (raw) {
      prepare(raw); build(root); sync();
    }).catch(function () { delete root.dataset.loading; root.innerHTML = '<p class="eh-hint">Couldn’t load the history. Reload the page to try again.</p>'; });
  }
  return { show: show };
})();
