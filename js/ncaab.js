// Men's college basketball pages: Standings (every D-I team's NCAA tournament odds), Bracket (the projected
// 68-team field) and Scores (each day's games, refreshed from ESPN while games are on). Odds come from
// ncaab-build.mjs. Built from js/nba.js; it reuses the NFL/NBA pages' element ids and styles.
(function () {
  'use strict';
  var data = window.NCAAB_DATA, D = data.D, N1 = D.nD1;
  // Each model's home win chances arrive as a list in schedule order; turn them into a lookup by game id.
  Object.keys(data.results).forEach(function (k) {
    var r = data.results[k], hw = {};
    (r.hw || []).forEach(function (v, i) { if (v != null) hw[D.games[i].id] = v; });
    r.homeWin = hw;
  });
  var MODES = data.models.map(function (m) { return m.k; });
  var mode = (function () { try { var m = localStorage.getItem('ncaab-mode'); return MODES.indexOf(m) >= 0 ? m : MODES[0]; } catch (e) { return MODES[0]; } })();
  var BASE = data.results[mode], R = BASE;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function isDark() { return /dark/.test(getComputedStyle(document.documentElement).colorScheme); }
  function pct(v) {
    if (v == null) return '—';
    if (v <= 0.0005) return '<0.1%';
    if (v >= 0.9995) return '>99.9%';
    return (v * 100).toFixed(v >= 0.1 && v < 0.9 ? 0 : 1) + '%';
  }
  function logo(t, px) {
    var src = isDark() && t.logoDark ? t.logoDark : t.logo;
    return src ? '<img class="logo" alt="" width="' + px + '" height="' + px + '" src="' + esc(src) + '" loading="lazy">' : '<span class="logo" style="display:inline-block;width:' + px + 'px;height:' + px + 'px"></span>';
  }
  function etTime(iso) { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }); }
  function etDate(iso, opts) { return new Date(iso).toLocaleDateString('en-US', Object.assign({ timeZone: 'America/New_York' }, opts)); }
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  var CONF = {};
  D.confs.forEach(function (c) { CONF[c.k] = c; });
  function confShort(k) { return (CONF[k] && CONF[k].short) || k; }
  // Short conference codes for phones.
  var CONF_ABBR = { aeast: 'AE', american: 'AAC', atl10: 'A-10', acc: 'ACC', asun: 'ASUN', big12: 'B12', bige: 'BE', bsky: 'BSKY', bsou: 'BSO', big10: 'B1G', bigw: 'BW',
    col: 'CAA', usa: 'CUSA', hor: 'HL', ivy: 'IVY', metro: 'MAAC', midam: 'MAC', meac: 'MEAC', mvc: 'MVC', mwest: 'MW', neast: 'NEC', ovc: 'OVC', pac12: 'P12',
    pat: 'PAT', sec: 'SEC', south: 'SOCON', land: 'SLND', swac: 'SWAC', summ: 'SUMM', belt: 'SBC', uac: 'UAC', wcc: 'WCC' };

  // Records count every final, including games that finished after the last build (live scores).
  var rec = [];
  function countRecords() {
    rec = D.teams.map(function () { return { w: 0, l: 0 }; });
    D.games.forEach(function (g) {
      if (g.s !== 'post') return;
      if (g.hs > g.as) { rec[g.h].w++; rec[g.a].l++; } else { rec[g.a].w++; rec[g.h].l++; }
    });
  }
  countRecords();
  function recText(i) { var r = rec[i]; return r.w + '-' + r.l; }
  var gameById = {}, byTeam = D.teams.map(function () { return []; });
  D.games.forEach(function (g) { gameById[g.id] = g; byTeam[g.h].push(g); byTeam[g.a].push(g); });
  // A team's next game not yet final (a picked game still counts as its next game, so the pick box stays).
  function nextOpen(i) {
    var best = null;
    byTeam[i].forEach(function (g) { if (g.s !== 'post' && (!best || g.d < best.d)) best = g; });
    return best ? best.id : null;
  }
  // Games that went final after the build, locked in as results for every simulation: { gameId: winner }.
  var auto = {};
  function rankTag(t) { return t.rank ? '<small class="lg-rank">' + t.rank + '</small>' : ''; }

  // ---------- Standings ----------
  // All D-I by tournament odds, grouped by conference, or one conference.
  var st = { open: {}, view: 'all', day: null, picks: {}, bk: {}, bkSim: false, order: null, sort: null };
  var VIEWS = [['all', 'All Division I'], ['top', 'Top 100 by odds'], ['conf', 'By conference']].concat(D.confs.slice().sort(function (a, b) { return a.short.localeCompare(b.short); }).map(function (c) { return ['c:' + c.k, c.short]; }));
  var savedView = store.get('ncaab-view');
  if (VIEWS.some(function (v) { return v[0] === savedView; })) st.view = savedView;
  $('nfl-view').innerHTML = VIEWS.map(function (v, k) { return (k === 3 ? '<optgroup label="Conference">' : '') + '<option value="' + esc(v[0]) + '">' + esc(v[1]) + '</option>' + (k === VIEWS.length - 1 ? '</optgroup>' : ''); }).join('');
  $('nfl-view').previousElementSibling.textContent = 'View';
  $('nfl-view').value = st.view;

  function renderHead() {
    function th(key, label, cls, title) {
      var s = st.sort && st.sort.k === key ? (st.sort.dir > 0 ? 'ascending' : 'descending') : 'none';
      return '<th class="' + cls + '" aria-sort="' + s + '"' + (title ? ' title="' + esc(title) + '"' : '') + '><button type="button" data-nsort="' + key + '">' + label + '</button></th>';
    }
    $('nfl-head').innerHTML =
      '<th class="first c-rk" title="Place in this list">RK</th>' +
      th('team', 'Team', 'l c-team team-col') +
      th('cf', 'Conf.', 'l c-cn') +
      th('rec', 'Rec', 'c-rec') +
      th('w', '<abbr title="Projected regular-season record: average wins and losses over the simulated seasons">Proj.</abbr>', 'c-pw tc') +
      th('rating', '<abbr title="' + esc(modelLabel()) + ' rating: points better than an average D-I team on a neutral court">Index</abbr>', 'c-idx tc') +
      '<th class="pick c-pick">Next</th>' +
      th('make', 'Make NCAA', 'c-cfp', 'Chance to make the 68-team NCAA tournament, by automatic bid or at-large') +
      th('seed', '<abbr title="Average seed in the simulations where they make the tournament">Seed</abbr>', 'c-div sec') +
      th('auto', 'Auto bid', 'c-bye sec', 'Chance to win the conference tournament and its automatic bid') +
      th('f4', 'Final Four', 'c-conf sec', 'Chance to reach the Final Four') +
      th('title', 'Win title', 'c-title sec');
  }
  function modelLabel() { var m = data.models.filter(function (x) { return x.k === mode; })[0]; return m ? m.label : ''; }
  // Sort values per column; text columns start A to Z, numbers start highest first (Seed lowest first).
  function sortValue(k, i) {
    var r = R.teams[i];
    if (k === 'team') return D.teams[i].name;
    if (k === 'rec') return winPct(i);
    if (k === 'cf') return confShort(D.teams[i].conf);
    if (k === 'seed') return r.seed == null ? 99 : r.seed;
    return r[k];
  }
  function projRec(r) { var w = Math.round(r.w); return w + '-' + Math.round(r.w + r.l - w); }
  function shaded(v) { return '<td class="sec pct-cell" style="--p:' + (v || 0).toFixed(3) + '">' + pct(v) + '</td>'; }
  function nextCell(i) {
    var id = nextOpen(i);
    if (id == null) return '<td class="pick">—</td>';
    var g = gameById[id], home = g.h === i, opp = D.teams[home ? g.a : g.h], vs = (g.n ? 'vs ' : home ? 'vs ' : '@') + opp.ab;
    var pk = st.picks[id], won = pk === i, lost = pk != null && !won, me = D.teams[i].name;
    var label = won ? me + ' ' + vs + ' picked to win. Press to pick a loss' : lost ? me + ' ' + vs + ' picked to lose. Press to clear the pick' : 'No pick for ' + me + ' ' + vs + '. Press to pick a win';
    return '<td class="pick"><div class="nx-cell"><div class="mini"><button type="button" class="pick-box' + (won ? ' pick-w' : lost ? ' pick-l' : '') + '" data-pick="' + esc(id) + '" data-team="' + i + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + (won ? 'W' : lost ? 'L' : '') + '</button></div>' +
      '<span class="nx-vs" aria-hidden="true">' + esc(vs) + '</span></div></td>';
  }
  function winPct(i) { var r = rec[i], g = r.w + r.l; return g ? r.w / g : 0; }
  // Row order: by tournament odds (then projected wins), or by the column chosen. Set when the view is chosen
  // or picks are cleared, and held while picks change the odds, so rows don't jump.
  function sortRows(v) {
    var sk = st.sort;
    var by = sk ? function (a, b) {
      var x = sortValue(sk.k, a), y = sortValue(sk.k, b);
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sk.dir || R.teams[b].make - R.teams[a].make;
    } : function (a, b) { var x = R.teams[a], y = R.teams[b]; return y.make - x.make || y.title - x.title || y.w - x.w || y.rating - x.rating; };
    var all = []; for (var i = 0; i < N1; i++) all.push(i);
    if (v.indexOf('c:') === 0) { var ck = v.slice(2); return [{ name: null, rows: all.filter(function (i) { return D.teams[i].conf === ck; }).sort(by) }]; }
    if (v === 'top') return [{ name: null, rows: all.slice().sort(function (a, b) { return R.teams[b].make - R.teams[a].make || R.teams[b].rating - R.teams[a].rating; }).slice(0, 100).sort(by) }];
    if (v !== 'conf') return [{ name: null, rows: all.sort(by) }];
    return D.confs.slice().sort(function (a, b) { return a.short.localeCompare(b.short); }).map(function (c) {
      return { name: c.short, rows: all.filter(function (i) { return D.teams[i].conf === c.k; }).sort(by) };
    });
  }
  var WIDE_Q = matchMedia('(min-width: 900px)'), TABLET_Q = matchMedia('(min-width: 600px)');
  function visibleCols() { var ex = document.querySelector('#nfl-tw table.expanded'); return WIDE_Q.matches || ex ? 12 : TABLET_Q.matches ? 8 : 6; }
  [WIDE_Q, TABLET_Q].forEach(function (q) { try { q.addEventListener('change', function () { renderRankings(); }); } catch (e) {} });
  function groupHead(name) {
    return '<tr class="nfl-group">' + [].map.call($('nfl-head').children, function (h) {
      return h.classList.contains('c-team') ? '<th scope="rowgroup" class="' + h.className + '"><span class="grp-name">' + esc(name) + '</span></th>' : h.outerHTML.replace('<th ', '<th scope="col" ');
    }).join('') + '</tr>';
  }
  function renderRankings() {
    if (!st.order || st.order.view !== st.view) st.order = { view: st.view, groups: sortRows(st.view) };
    renderHead();
    document.querySelector('#nfl-tw table').classList.toggle('grouped', st.view === 'conf');
    $('nfl-body').innerHTML = st.order.groups.map(function (grp) {
      return (grp.name ? groupHead(grp.name) : '') + grp.rows.map(row).join('');
    }).join('');
  }
  function row(i, k) {
    var t = D.teams[i], r = R.teams[i];
    return '<tr><td class="first c-rk">' + (k + 1) + '</td>' +
      '<td class="team-col"><div class="teamcell">' + logo(t, 30) + '<span><button class="tname" type="button" data-open="' + i + '" aria-expanded="' + !!st.open[i] + '" aria-label="' + esc(t.name) + '">' + rankTag(t) + '<span class="tn-long">' + esc(t.name) + '</span><span class="tn-mid" aria-hidden="true">' + esc(t.short || t.name) + '</span><span class="tn-short" aria-hidden="true">' + esc(t.ab) + '</span></button></span></div></td>' +
      '<td class="l c-cn-cell"><span class="cn-long">' + esc(confShort(t.conf)) + '</span><span class="cn-short" aria-hidden="true">' + esc(CONF_ABBR[t.conf] || confShort(t.conf)) + '</span></td>' +
      '<td class="num rec">' + recText(i) + '</td>' +
      '<td class="num tc pw">' + projRec(r) + '</td>' +
      '<td class="num tc">' + (r.rating > 0 ? '+' : '') + r.rating.toFixed(1) + '</td>' +
      nextCell(i) +
      '<td class="odds-cell" style="--p:' + makeShown(i).toFixed(3) + '"><div class="odds"><span class="v">' + pct(makeShown(i)) + '</span></div></td>' +
      '<td class="sec num">' + (r.seed == null ? '—' : r.seed.toFixed(1)) + '</td>' +
      shaded(r.auto) + shaded(r.f4) + shaded(r.title) + '</tr>' + (st.open[i] ? detail(i) : '');
  }
  function makeShown(i) {
    var g = gameById[nextOpen(i)];
    if (!g || g.s !== 'in') return R.teams[i].make;
    var ph = liveHomeWin(g);
    return makeNow(g, i, g.h === i ? ph : 1 - ph);
  }
  // ---------- Team detail ----------
  // Playoff odds over time (D.hist from the build): each point re-runs the season as it stood then, with the
  // default ratings; the last point is now.
  function histLabel(l) { return l === 'Pre' ? 'Preseason' : l === 'Now' ? 'Now' : /^\d+$/.test(l) ? 'After week ' + l : 'Through ' + l; }
  function oddsChart(i, what) {
    var H = D.hist, v = H && H.v[i];
    if (!v || !v.length) return '<p class="ap-none">No history yet.</p>';
    var n = v.length, W = 260, Hh = 110, L = 30, Rp = 8, T = 8, B = 18, dates = H.labels.some(function (l) { return /[a-z]/.test(l) && l !== 'Pre' && l !== 'Now'; });
    var px = function (k) { return L + (n === 1 ? (W - L - Rp) / 2 : k * (W - L - Rp) / (n - 1)); };
    var py = function (x) { return T + (1000 - x) * (Hh - T - B) / 1000; };
    var grid = [1000, 500, 0].map(function (y) {
      return '<line x1="' + L + '" x2="' + (W - Rp) + '" y1="' + py(y) + '" y2="' + py(y) + '" class="ap-grid"/><text x="' + (L - 5) + '" y="' + (py(y) + 3) + '" class="ap-y">' + y / 10 + '%</text>';
    }).join('');
    var pts = [];
    v.forEach(function (x, k) { if (x != null) pts.push(px(k).toFixed(1) + ',' + py(x).toFixed(1)); });
    var line = pts.length > 1 ? '<polyline points="' + pts.join(' ') + '" class="ap-line"/>' : '';
    var dots = v.map(function (x, k) {
      return x == null ? '' : '<circle cx="' + px(k).toFixed(1) + '" cy="' + py(x).toFixed(1) + '" r="3" class="ap-dot"><title>' + histLabel(H.labels[k]) + ': ' + pct(x / 1000) + (H.src && H.src[k] === 'saved' ? ' (as the site had it then)' : H.src && (H.src[k] === 'rebuilt' || H.src[k] === 'pre') ? ' (rebuilt)' : '') + '</title></circle>';
    }).join('');
    var step = Math.max(1, Math.ceil(n / (dates ? 4 : 9)));
    var xs = H.labels.map(function (l, k) {
      if (k % step && k !== n - 1) return '';
      return '<text x="' + px(k).toFixed(1) + '" y="' + (Hh - 4) + '" class="ap-x"' + (k === n - 1 && n > 1 ? ' text-anchor="end"' : k === 0 ? ' text-anchor="start"' : '') + '>' + (l === 'Pre' ? 'P' : l) + '</text>';
    }).join('');
    var label = D.teams[i].name + ', ' + what + ' over time: ' + v.map(function (x, k) { return histLabel(H.labels[k]) + ' ' + (x == null ? 'none' : pct(x / 1000)); }).join(', ');
    return '<svg viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="' + esc(label) + '">' + grid + line + dots + xs + '</svg>';
  }
  function oddsChartBlock(i, what, model) {
    var H = D.hist, v = H && H.v[i], now = v && v.length ? v[v.length - 1] : null;
    var how = what + ' after each ' + (H && H.labels.some(function (l) { return /^\d+$/.test(l); }) ? 'week' : 'week (Sunday night)') +
      '. Points marked "as the site had it" are the odds saved at the time; the others are rebuilt by re-running the season as it stood then, with ' +
      (H && H.past ? H.past : 'the ratings of that time') + '. The preseason point uses ' + (H && H.pre ? H.pre : 'preseason ratings') +
      '. The last point is now, with today\'s ' + model + ' ratings.';
    return '<div class="ap-chart"><h3 title="' + esc(how) + '">' + esc(what) + ' over time' + (now != null ? ', now ' + pct(now / 1000) : '') + '</h3>' + oddsChart(i, what) + '</div>';
  }
  // A y axis for the seed chart: the top of the scale, half of it and zero, with light lines across.
  function histY(top, plot) {
    var f = function (x) { return Math.round(x * 100) + '%'; };
    return '<div class="hist-y"><div class="hist-ax" aria-hidden="true"><span style="top:0">' + f(top) + '</span><span style="top:50%">' + f(top / 2) + '</span><span style="top:100%">0</span></div><div class="hist-plot">' + plot + '</div></div>';
  }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  // Clear / Win out for a team's games left, as on the college panel.
  function winOutButton(i, left) {
    if (!left.length) return '';
    var on = left.every(function (g) { return st.picks[g.id] === i; }), any = left.some(function (g) { return st.picks[g.id] != null; });
    var ids = esc(left.map(function (g) { return g.id; }).join(','));
    return '<span class="sched-btns"><button type="button" class="winout-btn" data-clearteam="' + i + '" data-games="' + ids + '"' + (any ? '' : ' disabled') + '>Clear</button>' +
      '<button type="button" class="winout-btn" data-winout="' + i + '" data-games="' + ids + '" aria-pressed="' + on + '">Win out</button></span>';
  }
  // The tile row, as on the college panel: record, division record, strength of record and of schedule
  // (each ranked among all Division I teams, by the selected ratings).
  function resumeTiles(i) {
    var n = D.teams.length, sd = Math.sqrt(MODEL.gameSD * MODEL.gameSD + 2 * MODEL.teamSD * MODEL.teamSD);
    var played = D.teams.map(function () { return []; }), leftOpp = D.teams.map(function () { return []; });
    D.games.forEach(function (g) {
      if (g.s === 'post') {
        var r = g.hs > g.as ? 1 : g.hs < g.as ? 0 : 0.5, site = g.neutral || g.n ? 0 : 1;
        played[g.h].push({ o: g.a, r: r, site: site }); played[g.a].push({ o: g.h, r: 1 - r, site: -site });
      } else { leftOpp[g.h].push(g.a); leftOpp[g.a].push(g.h); }
    });
    var rt = function (x) { return R.teams[x] ? R.teams[x].rating : MODEL.nonD1 != null ? MODEL.nonD1 : 0; };
    // The level of the last spot in the field: about the 45th-best rating.
    var bench = R.teams.map(function (_, x) { return rt(x); }).sort(function (a, b) { return b - a; })[44];
    // Strength of record: the chance that a team at that level does at least as well against this schedule
    // (a tie counts half). Smaller is harder, so it ranks higher.
    function sor(x) {
      var dist = [1];
      played[x].forEach(function (e) {
        var p = phi((bench - rt(e.o) + e.site * MODEL.hfa) / sd), nd = new Array(dist.length + 1).fill(0);
        dist.forEach(function (q, k) { nd[k] += q * (1 - p); nd[k + 1] += q * p; });
        dist = nd;
      });
      var score = played[x].reduce(function (a, e) { return a + e.r; }, 0), above = 0;
      dist.forEach(function (q, k) { if (k > score + 1e-9) above += q; else if (Math.abs(k - score) < 1e-9) above += q / 2; });
      return above;
    }
    var avg = function (list) { return list.length ? list.reduce(function (a, x) { return a + rt(x); }, 0) / list.length : null; };
    var sos = function (x) { return avg(played[x].map(function (e) { return e.o; })); };
    var rankOf = function (fn, better) {
      var v = fn(i); if (v == null) return null;
      return 1 + R.teams.filter(function (_, x) { var w = fn(x); return w != null && (better > 0 ? w > v + 1e-9 : w < v - 1e-9); }).length;
    };
    var sorRank = played[i].length ? rankOf(sor, -1) : null, sosRank = rankOf(sos, 1);
    var leftRank = leftOpp[i].length ? 1 + R.teams.filter(function (_, x) { var w = avg(leftOpp[x]); return w != null && w > avg(leftOpp[i]) + 1e-9; }).length : null;
    var dv = { w: 0, l: 0, t: 0 };
    played[i].forEach(function (e) { if (D.teams[e.o].conf === D.teams[i].conf) { if (e.r === 1) dv.w++; else if (e.r === 0) dv.l++; else dv.t++; } });
    var rc = rec[i], recTxt = rc.w + '-' + rc.l + (rc.t ? '-' + rc.t : '');
    var tile = function (label, title, value) { return '<div><dt><abbr title="' + esc(title) + '">' + label + '</abbr></dt><dd>' + value + '</dd></div>'; };
    return '<div class="resume"><dl class="rs-tiles nfl-tiles">' +
      tile('Record', 'Overall record', recTxt) +
      tile('Conference', 'Record in conference games', dv.w + '-' + dv.l + (dv.t ? '-' + dv.t : '')) +
      tile('SOR', 'Strength of record: how hard this record would be for a team at the level of the last spot in the field (about the 45th-best rating) to match against this schedule, ranked among all Division I teams (1st = hardest)', sorRank ? ordinal(sorRank) : '—') +
      tile('SOS', 'Strength of schedule: average rating of opponents played, ranked among all Division I teams (1st = toughest)' + (leftRank ? '; schedule left ranks ' + ordinal(leftRank) : ''), sosRank ? ordinal(sosRank) : '—') +
    '</dl></div>';
  }
  function detail(i) {
    var t = D.teams[i], r = R.teams[i];
    var stat = function (label, v) { return '<div><dt>' + label + '</dt><dd>' + v + '</dd></div>'; };
    var stats = '<dl class="field-stats narrow-only">' + [['Make NCAA', r.make], ['Auto bid', r.auto], ['Final Four', r.f4], ['Win title', r.title]].map(function (x) { return stat(x[0], pct(x[1])); }).join('') +
      stat('Seed', r.seed == null ? '—' : r.seed.toFixed(1)) + stat('Index', (r.rating > 0 ? '+' : '') + r.rating.toFixed(1)) + '</dl>';
    var left = byTeam[i].filter(function (g) { return g.s !== 'post'; }).sort(function (a, b) { return a.d < b.d ? -1 : 1; });
    var shown = left.slice(0, 4);
    var lines = shown.map(function (g) {
      var home = g.h === i, o = D.teams[home ? g.a : g.h], hw = R.homeWin[g.id], p = hw == null ? null : home ? hw : 1 - hw, pk = st.picks[g.id];
      var live = g.s === 'in' ? ' <b class="score-now">' + ((home ? g.hs - g.as : g.as - g.hs) > 0 ? 'Up ' : (home ? g.hs - g.as : g.as - g.hs) < 0 ? 'Down ' : 'Tied ') + (home ? g.hs + '-' + g.as : g.as + '-' + g.hs) + '</b>' : '';
      var won = pk === i, lost = pk != null && !won, vs = (home ? 'vs ' : '@') + o.ab;
      var plabel = won ? t.short + ' ' + vs + ' picked to win. Press to pick a loss' : lost ? t.short + ' ' + vs + ' picked to lose. Press to clear the pick' : 'No pick for ' + t.short + ' ' + vs + '. Press to pick a win';
      var box = '<span class="mini"><button type="button" class="pick-box' + (won ? ' pick-w' : lost ? ' pick-l' : '') + '" data-pick="' + esc(g.id) + '" data-team="' + i + '" aria-label="' + esc(plabel) + '" title="' + esc(plabel) + '">' + (won ? 'W' : lost ? 'L' : '') + '</button></span>';
      return '<span class="sched-g">' + box + '<span>' + etDate(g.d, { month: 'short', day: 'numeric' }) + ' · ' + (g.n ? 'vs ' : home ? 'vs ' : '@') + logo(o, 18) + esc(o.name) + live + '</span></span><span>' + (p == null ? '—' : Math.round(p * 100) + '%') + '</span>';
    }).join('') + (left.length > shown.length ? '<span class="sched-more">and ' + (left.length - shown.length) + ' more</span><span></span>' : '');
    var seeds = r.seeds || [], maxS = [0.05, 0.1, 0.2, 0.25, 0.4, 0.5, 0.6, 0.8, 1].find(function (x) { return x >= Math.max.apply(null, seeds.concat(0.0001)) - 1e-9; });
    var bars = seeds.map(function (v, k) { var lab = 'Seed ' + (k + 1) + ': ' + (v * 100).toFixed(1) + '% of simulations'; return '<div title="' + lab + '" aria-label="' + lab + '"><i style="height:' + (v / maxS * 100).toFixed(1) + '%"></i></div>'; }).join('');
    var xs = seeds.map(function (_, k) { return '<span>' + (k + 1) + '</span>'; }).join('');
    return '<tr class="detail"><td colspan="' + visibleCols() + '">' + stats + '<div class="detail-inner">' + resumeTiles(i) +
      oddsChartBlock(i, 'Make NCAA', 'All models average') +
      '<div><div class="sched-head"><h3 title="Chance to win each game">Next games</h3>' + winOutButton(i, left) + '</div><div class="sched">' + (lines || '<span>No games left</span><span></span>') + '</div></div>' +
      '<div><div class="scenario"><span>Make NCAA' + (Object.keys(st.picks).length ? ' with your picks' : '') + '</span><b>' + pct(r.make) + '</b></div>' +
        '<h3>Seed distribution, % of all simulations</h3>' + histY(maxS, '<div class="hist" role="img" aria-label="Chance of each seed for ' + esc(t.name) + '">' + bars + '</div><div class="hist-x">' + xs + '</div>') + '</div>' +
    '</div></td></tr>';
  }
  function renderPicksBar() {
    var n = Object.keys(st.picks).length;
    $('nfl-picks-bar').innerHTML = busy ? '<span><b>Simulating…</b> Updating every team’s odds for your picks.</span>' : n
      ? '<span><b>' + n + (n === 1 ? ' game' : ' games') + ' picked.</b> All odds assume ' + (n === 1 ? 'that result' : 'those results') + '.</span><button class="btn" id="nfl-clear" type="button">Clear picks</button>'
      : '<span>Press a team’s box to cycle its next game through <b>W</b>, <b>L</b> and blank. Its opponent gets the opposite result, and all odds update.</span>';
  }
  var played = D.games.filter(function (g) { return g.s === 'post'; }).length;
  $('nfl-note').textContent = (D.season - 1) + '–' + String(D.season).slice(2) + ' season · ' + played.toLocaleString('en-US') + ' of ' + D.games.length.toLocaleString('en-US') + ' games played · updated ' +
    new Date(D.asOf).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';

  // ---------- Bracket: the likeliest field of 68 ----------
  // Each conference's likeliest champion takes its automatic bid; the best remaining tournament odds take the
  // at-large bids. The field is seeded by average seed on an S-curve, with the First Four as in the simulation:
  // the four lowest at-large teams and the four lowest automatic qualifiers.
  var REGIONS = ['East', 'West', 'South', 'Midwest'];
  var ORDER = NCAABSIM.REGION_ORDER;
  function projectedField() {
    var autos = [], taken = {};
    D.confs.forEach(function (c) {
      var best = null;
      for (var i = 0; i < N1; i++) if (D.teams[i].conf === c.k && (best == null || R.teams[i].auto > R.teams[best].auto)) best = i;
      if (best != null && R.teams[best].auto > 0) { autos.push(best); taken[best] = 1; }
    });
    var rest = []; for (var i = 0; i < N1; i++) if (!taken[i]) rest.push(i);
    var seedKey = function (x) { return R.teams[x].seed == null ? 99 : R.teams[x].seed; };
    var bids = rest.sort(function (a, b) { return R.teams[b].make - R.teams[a].make; }).slice(0, 68 - autos.length).sort(function (a, b) { return seedKey(a) - seedKey(b); });
    autos.sort(function (a, b) { return seedKey(a) - seedKey(b); });
    var ffL = bids.slice(-4), ffA = autos.slice(-4);
    var slots = bids.slice(0, -4).concat(autos.slice(0, -4)).map(function (t) { return { v: seedKey(t), teams: [t] }; });
    [[ffL[0], ffL[3]], [ffL[1], ffL[2]], [ffA[0], ffA[3]], [ffA[1], ffA[2]]].forEach(function (pr, k) { slots.push({ v: (seedKey(pr[0]) + seedKey(pr[1])) / 2, teams: pr, ff: k }); });
    slots.sort(function (a, b) { return a.v - b.v; });
    var regions = [{}, {}, {}, {}], ff = [];
    slots.forEach(function (sl, k) {
      var line = (k >> 2) + 1, pos = k & 3, reg = line % 2 ? pos : 3 - pos;
      sl.line = line; sl.reg = reg;
      regions[reg][line] = sl;
      if (sl.teams.length === 2) ff.push(sl);
    });
    return { regions: regions, ff: ff };
  }
  var MODEL = R.model || { gameSD: 11, teamSD: 3, hfa: 3.2 };
  function phi(x) { var t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
  function gameSd() { return Math.sqrt(MODEL.gameSD * MODEL.gameSD + 2 * MODEL.teamSD * MODEL.teamSD); }
  function rtg(i) { return i < N1 ? R.teams[i].rating : -22; }
  function winChance(h, a, neutral) { return phi((rtg(h) - rtg(a) + (neutral ? 0 : MODEL.hfa)) / gameSd()); }
  function bkRow(key, i, opp, seed, p, won, pk, ph) {
    if (i == null) return '<div class="bk-team tbd">' + (ph ? '<span class="bk-name"><small>' + esc(ph) + '</small></span>' : '') + '</div>';
    var t = D.teams[i], mine = pk === i, theirs = pk === opp;
    var nm = '<span class="bk-name"><span class="bk-nm">' + esc(t.name) + '</span><span class="bk-ab">' + esc(t.ab) + '</span> <small class="lg-rec">(' + recText(i) + ')</small></span>';
    if (opp == null) return '<div class="bk-team"><span class="bk-seed">' + seed + '</span>' + logo(t, 22) + nm + '<span class="bk-p"></span></div>';
    var label = mine ? t.name + ' picked to win. Press to pick ' + D.teams[opp].name : theirs ? D.teams[opp].name + ' picked. Press to clear the pick' : 'Press to pick ' + t.name + ' to win';
    return '<button type="button" class="bk-team picks' + (won ? ' win' : won === false ? ' lose' : '') + '" data-bk="' + key + '" data-team="' + i + '" data-opp="' + opp + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
      '<span class="bk-seed">' + seed + '</span>' + logo(t, 22) + nm +
      '<span class="bk-p">' + (p == null ? '' : pct(p)) + '</span>' +
      '<span class="mini"><span class="pick-box' + (mine ? ' pick-w' : theirs ? ' pick-l' : '') + '" aria-hidden="true">' + (mine ? 'W' : theirs ? 'L' : '') + '</span></span></button>';
  }
  // A game card: the better seed on top. A slot is decided only by the reader's pick, or by the favorite with
  // Simulate games on. Every tournament game is on a neutral court.
  // 2027 Final Four (Detroit) logo; CBS has the Final Four and the title game in 2027.
  var FF_LOGO = 'https://upload.wikimedia.org/wikipedia/en/0/0c/2027_NCAA_Men%27s_Final_Four_Logo.svg';
  function game(key, lab, h, a, seedOf, when, ph) {
    ph = ph || [];
    var both = h != null && a != null;
    var p = both ? winChance(h, a, true) : null, pk = both && (st.bk[key] === h || st.bk[key] === a) ? st.bk[key] : null;
    var w = pk != null ? pk : both && st.bkSim ? (p >= 0.5 ? h : a) : null;
    if (w != null) pathP[w] = (pathP[w] == null ? 1 : pathP[w]) * (w === h ? p : 1 - p); // chance of winning every game on its path
    var show = w != null ? p : null;
    // Region games carry no header of their own (the round's heading above the column says it); a null label.
    // when is a date, or [date, networks] when the broadcaster is known; a Final Four game carries its logo.
    var nets = [];
    if (Array.isArray(when)) { nets = when[1]; when = when[0]; }
    var mark = /^(Final Four|National Championship)/.test(lab || '') ? '<img class="bk-conf bk-ff" src="' + FF_LOGO + '" alt="" loading="lazy">' : '';
    var head = lab == null ? '' : '<div class="bk-where"><span class="bk-place">' + mark + '<span class="bk-title">' + esc(lab) + '</span></span>' + (when ? '<span class="bk-air"><b>' + when + '</b>' + (nets.length ? '<span class="net-logos">' + tvBadges(nets) + '</span>' : '') + '</span>' : '') + '</div>';
    return { winner: w, html: '<div class="bk-game' + (lab == null ? ' bk-bare' : '') + '">' + head +
      bkRow(key, h, a, h == null ? '' : seedOf(h), show, w == null ? null : w === h, pk, ph[0]) + bkRow(key, a, h, a == null ? '' : seedOf(a), show == null ? null : 1 - show, w == null ? null : w === a, pk, ph[1]) + '</div>' };
  }
  var pathP = {};
  var ROUND_NAMES = ['First Round', 'Second Round', 'Sweet 16', 'Elite Eight'];
  var ROUND_WHEN = ['Mar 18–19', 'Mar 20–21', 'Mar 25–26', 'Mar 27–28'];
  function renderBracket() {
    pathP = {};
    var F = projectedField(), seedOf = {};
    F.regions.forEach(function (R4) { Object.keys(R4).forEach(function (ln) { R4[ln].teams.forEach(function (t) { seedOf[t] = +ln; }); }); });
    var sOf = function (i) { return seedOf[i] || ''; };
    var ffGames = F.ff.map(function (sl) {
      return game('ff' + sl.reg + '-' + sl.line, REGIONS[sl.reg] + ' · First Four · ' + sl.line + ' seed', sl.teams[0], sl.teams[1], sOf, 'Mar 16–17');
    });
    var ffWin = {};
    F.ff.forEach(function (sl, k) { ffWin[sl.reg + '-' + sl.line] = ffGames[k].winner; });
    // Every region is played out (the Final Four needs its champions), but only the chosen one is shown.
    var regionHtml = [], champs = [];
    F.regions.forEach(function (R4, reg) {
      var slot = function (ln) { var sl = R4[ln]; return sl.teams.length === 2 ? ffWin[reg + '-' + ln] : sl.teams[0]; };
      var ph = function (ln) { var sl = R4[ln]; return sl.teams.length === 2 ? 'First Four winner' : ''; };
      var round = ORDER.map(function (ln) { return { t: slot(ln), ph: ph(ln) }; }), cols = [], k = 0;
      while (round.length > 1) {
        var games = [], next = [];
        for (var j = 0; j < round.length; j += 2) {
          var x = round[j], y = round[j + 1];
          var hi = x.t != null && y.t != null && sOf(y.t) < sOf(x.t) ? [y, x] : [x, y];
          var g = game('r' + reg + '-' + k + '-' + j, null, hi[0].t, hi[1].t, sOf, null, [hi[0].ph, hi[1].ph]);
          games.push(g); next.push({ t: g.winner, ph: '' });
        }
        cols.push(games); round = next; k++;
      }
      champs.push(round[0].t);
      regionHtml.push('<div class="bk-rounds ncaab-rounds">' + cols.map(function (gs, c) {
        return '<section class="bk-round" aria-label="' + REGIONS[reg] + ' ' + ROUND_NAMES[c] + '"><h3>' + ROUND_NAMES[c] + '<small>' + ROUND_WHEN[c] + '</small></h3><div class="bk-games">' + gs.map(function (g) { return g.html; }).join('') + '</div></section>';
      }).join('') + '</div>');
    });
    // Final Four: East v West, South v Midwest.
    var regSeed = function (i) { return sOf(i); };
    var s1 = game('f4-0', 'Final Four · East v West', champs[0], champs[1], regSeed, ['Apr 3', ['CBS']]), s2 = game('f4-1', 'Final Four · South v Midwest', champs[2], champs[3], regSeed, ['Apr 3', ['CBS']]);
    var fin = game('final', 'National Championship', s1.winner, s2.winner, regSeed, ['Apr 5', ['CBS']]);
    $('nfl-bk-clear').hidden = !Object.keys(st.bk).length;
    $('nfl-bk-sim').setAttribute('aria-pressed', st.bkSim ? 'true' : 'false');
    $('nfl-bk-sim').textContent = st.bkSim ? 'Show seeds only' : 'Simulate games';
    // One view at a time, picked from a row of buttons: a region (its four rounds side by side on wide screens)
    // or the Final Four. The First Four sits at the bottom whatever's chosen.
    var tabs = REGIONS.concat('Final Four'), cur = st.bkReg || 0;
    var champLine = cur < 4 ? '' : '<p class="ncaab-champs">Region champions: ' + champs.map(function (c, r) { return REGIONS[r] + ' ' + (c == null ? '—' : esc(D.teams[c].name)); }).join(' · ') + '</p>';
    // As on the college football bracket: the champion's card above once the title game is decided, and the
    // title odds from the full simulation below the bracket while Simulate games is on.
    var champ = fin.winner, champCard = '';
    if (champ != null) {
      var ct = D.teams[champ];
      champCard = '<div class="bk-champ"><div class="bk-champ-team">' + logo(ct, 40) + '<div><p class="bk-label">' + (st.bk.final === champ ? 'Your champion' : 'Projected champion') + '</p><p class="bk-champ-name">' + esc(ct.name) + '</p></div></div>' +
        '<p><b>' + esc(ct.name) + '</b> wins every game on this path ' + pct(pathP[champ]) + ' of the time, using each game’s win chance. Across all simulations it wins the title ' + pct(R.teams[champ].title) + ' of the time.</p></div>';
    }
    var top = []; for (var i = 0; i < N1; i++) top.push(i);
    top = top.sort(function (a, b) { return R.teams[b].title - R.teams[a].title; }).slice(0, 8);
    var titles = st.bkSim ? '<div class="bk-titles"><h3>Title odds</h3><ol>' + top.map(function (x) { return '<li>' + logo(D.teams[x], 20) + '<span>' + esc(D.teams[x].name) + '</span><b>' + pct(R.teams[x].title) + '</b></li>'; }).join('') + '</ol></div>' : '';
    // A map of the whole bracket beside the buttons: East and West on the left half (their winners meet in one
    // semifinal), South and Midwest on the right, the Final Four between. The part shown is highlighted.
    var cell = function (k, cls) { return '<button type="button" class="nm-' + cls + '" data-bkreg="' + k + '" aria-pressed="' + (k === cur) + '" title="' + tabs[k] + '">' + (k === 4 ? 'F4' : tabs[k].charAt(0)) + '</button>'; };
    var map = '<div class="ncaab-map" role="group" aria-label="Where this is in the bracket: ' + tabs[cur] + '">' + cell(0, 'e') + cell(4, 'f') + cell(2, 's') + cell(1, 'w') + cell(3, 'm') + '</div>';
    $('nfl-bracket').innerHTML = champCard +
      '<div class="ncaab-nav">' + map + '<div class="ncaab-tabs" role="group" aria-label="Bracket section">' + tabs.map(function (n, k) { return '<button type="button" class="btn bk-toggle" data-bkreg="' + k + '" aria-pressed="' + (k === cur) + '">' + n + '</button>'; }).join('') + '</div>' +
      '<p class="ncaab-where">' + (cur < 4 ? REGIONS[cur] + ' region · ' + ['top left', 'bottom left', 'top right', 'bottom right'][cur] + ' of the bracket · its winner plays the ' + REGIONS[[1, 0, 3, 2][cur]] + ' winner in the Final Four' : 'Final Four · East v West and South v Midwest, then the title game') + '</p></div>' +
      (cur < 4 ? '<section class="ncaab-region" aria-label="' + REGIONS[cur] + ' region">' + regionHtml[cur] + '</section>'
        : '<section class="ncaab-region" aria-label="Final Four">' + champLine + '<div class="bk-rounds ncaab-rounds ncaab-f4rounds">' +
          '<section class="bk-round" aria-label="Final Four, Apr 3"><h3>Final Four<small>Apr 3</small></h3><div class="bk-games">' + s1.html + s2.html + '</div></section>' +
          '<section class="bk-round" aria-label="National Championship, Apr 5"><h3>National Championship<small>Apr 5</small></h3><div class="bk-games">' + fin.html + '</div></section></div></section>') +
      titles +
      '<section class="ncaab-region ncaab-first4" aria-label="First Four"><h3 class="ncaab-reg-title">First Four · Mar 16–17</h3><div class="ncaab-ff">' + ffGames.map(function (g) { return g.html; }).join('') + '</div></section>';
  }

  // ---------- Scores ----------
  function etDay(iso) { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); }
  var days = {};
  D.games.forEach(function (g) { var k = etDay(g.d); var x = days[k] || (days[k] = { day: k, first: g.d }); if (g.d < x.first) x.first = g.d; g.day = k; });
  var dayList = Object.keys(days).sort().map(function (k) { return days[k]; });
  function currentDay() {
    var today = etDay(new Date().toISOString()), cur = dayList[0].day;
    dayList.forEach(function (x) { if (x.day <= today) cur = x.day; });
    return cur;
  }
  function dayLabel(x) { return new Date(x.day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); }
  // Major networks only, as logos (the college football page's set).
  var TV_LOGO = {
    TBS: 'https://upload.wikimedia.org/wikipedia/commons/2/2c/TBS_2020.svg',
    ESPN: 'https://upload.wikimedia.org/wikipedia/commons/2/2f/ESPN_wordmark.svg', ESPN2: 'https://upload.wikimedia.org/wikipedia/commons/b/bf/ESPN2_logo.svg', ESPNU: 'https://upload.wikimedia.org/wikipedia/commons/c/ca/ESPN_U_logo.svg',
    ABC: 'https://upload.wikimedia.org/wikipedia/commons/2/2f/ABC-2021-LOGO.svg', CBS: 'https://upload.wikimedia.org/wikipedia/commons/4/4e/CBS_logo.svg', CBSSN: 'https://upload.wikimedia.org/wikipedia/commons/0/04/CBS_Sports_Network_2021.svg',
    FOX: 'https://upload.wikimedia.org/wikipedia/commons/c/c0/Fox_Broadcasting_Company_logo_%282019%29.svg', Fox: 'https://upload.wikimedia.org/wikipedia/commons/c/c0/Fox_Broadcasting_Company_logo_%282019%29.svg', FS1: 'https://upload.wikimedia.org/wikipedia/commons/3/37/2015_Fox_Sports_1_logo.svg',
    NBC: 'https://upload.wikimedia.org/wikipedia/commons/3/3f/NBC_logo.svg', Peacock: 'https://upload.wikimedia.org/wikipedia/commons/f/fb/NBCUniversal_Peacock_Logo_%282020%E2%80%932026%29.svg',
    'SEC Network': 'https://upload.wikimedia.org/wikipedia/commons/b/b9/SEC_Network_logo.svg', SECN: 'https://upload.wikimedia.org/wikipedia/commons/b/b9/SEC_Network_logo.svg', 'ACC Network': 'https://upload.wikimedia.org/wikipedia/commons/0/00/ACC_Network_logo_fc_db.svg', ACCN: 'https://upload.wikimedia.org/wikipedia/commons/0/00/ACC_Network_logo_fc_db.svg',
    TNT: 'https://upload.wikimedia.org/wikipedia/commons/2/24/TNT_Logo_2016.svg', truTV: 'https://upload.wikimedia.org/wikipedia/commons/3/36/TruTV_logo.svg', 'Prime Video': 'https://upload.wikimedia.org/wikipedia/commons/9/90/Prime_Video_logo_%282024%29.svg', BTN: 'https://upload.wikimedia.org/wikipedia/en/3/39/Big_Ten_Network_Logo.svg',
    CW: 'https://upload.wikimedia.org/wikipedia/commons/b/b1/The_CW_2024.svg', 'The CW': 'https://upload.wikimedia.org/wikipedia/commons/b/b1/The_CW_2024.svg', 'USA Net': 'https://upload.wikimedia.org/wikipedia/commons/d/d7/USA_Network_logo_%282016%29.svg'
  };
  function tvBadges(names) {
    return (names || []).filter(function (n) { return TV_LOGO[n]; }).map(function (n) {
      return '<img class="net-' + n.toLowerCase().replace(/[^a-z0-9]/g, '') + '" src="' + TV_LOGO[n] + '" alt="' + esc(n) + '" title="' + esc(n) + '" loading="lazy">';
    }).join('');
  }
  function tile(v, cls) {
    cls = cls ? ' ' + cls : '';
    return v == null ? '<div class="lg-num' + cls + '">—</div>' : '<div class="lg-cfp' + cls + '" style="--p:' + v.toFixed(3) + '">' + pct(v) + '</div>';
  }
  // Live win chance: the rating edge shrinks with the time left; the margin is banked. Two 20-minute halves.
  function minutesLeft(g) {
    var txt = g.clock || '', m = /(\d+):(\d+)\s*-\s*(1st|2nd)/i.exec(txt);
    if (m) return (/1st/i.test(m[3]) ? 20 : 0) + +m[1] + +m[2] / 60;
    if (/half/i.test(txt) && !/end of 2nd/i.test(txt)) return 20;
    var ot = /(\d+):(\d+)\s*-\s*\d*OT/i.exec(txt);
    if (ot) return +ot[1] + +ot[2] / 60;
    return 20;
  }
  function liveHomeWin(g) {
    var mu = rtg(g.h) - rtg(g.a) + (g.n ? 0 : MODEL.hfa);
    var f = Math.max(minutesLeft(g), 0) / 40, margin = g.hs - g.as;
    if (f <= 0.001) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
    return phi((margin + mu * f) / (gameSd() * Math.sqrt(f)));
  }
  function makeNow(g, i, pw) {
    var r = R.teams[i];
    if (!r || r.next !== g.id || r.ifWin == null) return r ? r.make : null;
    if (g.s === 'post') return (g.h === i) === (g.hs > g.as) ? r.ifWin : r.ifLoss;
    if (g.s === 'in') return pw * r.ifWin + (1 - pw) * r.ifLoss;
    return r.make;
  }
  function cardRow(g, i, score, other) {
    var t = D.teams[i], r = i < N1 ? R.teams[i] : null;
    var name = '<div class="lg-team">' + logo(t, 22) + '<span>' + rankTag(t) + esc(t.ab || t.name) + (r ? ' <small class="lg-rec">(' + recText(i) + ')</small>' : '') + '</span></div>';
    if (g.s === 'pre') {
      var hw = R.homeWin[g.id], win = hw == null ? '—' : Math.round((g.h === i ? hw : 1 - hw) * 100) + '%';
      var isNext = r && r.next === g.id;
      return name + '<div class="lg-num">' + win + '</div>' + tile(r ? r.make : null) + tile(isNext ? r.ifWin : null, 'lg-if') + tile(isNext ? r.ifLoss : null, 'lg-if');
    }
    var lead = '<div class="lg-score' + (score >= other ? ' lead' : '') + '">' + score + '</div>';
    if (g.s === 'in') {
      var ph = liveHomeWin(g), pw = g.h === i ? ph : 1 - ph, nx = r && r.next === g.id;
      return name + lead + '<div class="lg-num">' + Math.round(pw * 100) + '%</div>' + tile(r ? makeNow(g, i, pw) : null) + tile(nx ? r.ifWin : null, 'lg-if') + tile(nx ? r.ifLoss : null, 'lg-if');
    }
    return name + lead + '<div class="lg-num"></div>' + tile(r ? makeNow(g, i) : null);
  }
  function card(g) {
    var isLive = g.s === 'in', isPre = g.s === 'pre';
    var tv = g.tv && g.tv.length && g.s !== 'post' ? '<span class="tv-list net-logos">' + tvBadges(g.tv) + '</span>' : '';
    var wd = etDate(g.d, { weekday: 'short', month: 'short', day: 'numeric' }); // every card names its day and date
    var top = isLive ? '<span class="lg-live"><b><span class="lg-clock">' + esc(g.clock || 'In progress') + '</span></b></span>' + tv :
      isPre ? '<b class="lg-kickoff">' + wd + ', ' + etTime(g.d) + ' ET</b>' + tv :
      '<span class="lg-live"><span class="final-pill">FINAL</span></span><span class="lg-when"><span>' + wd + '</span></span>';
    return '<article class="lg' + (isLive ? ' on' : '') + '"><div class="lg-top">' + top + '</div>' +
      (isPre ? '<div class="lg-rows pre"><span></span><span class="h">Win</span><span class="h">Make NCAA</span><span class="h lg-if">If win</span><span class="h lg-if">If loss</span>' :
        isLive ? '<div class="lg-rows inplay"><span></span><span class="h">Score</span><span class="h">Win</span><span class="h">Make NCAA</span><span class="h lg-if">If win</span><span class="h lg-if">If loss</span>' :
        '<div class="lg-rows"><span></span><span class="h">Score</span><span class="h"></span><span class="h">Make NCAA</span>') +
      cardRow(g, g.a, g.as, g.hs) + cardRow(g, g.h, g.hs, g.as) + '</div></article>';
  }
  // Playoff impact: picked games first, then both teams' swing in tournament odds between a win and a loss
  // (when it's their next game), otherwise how much is at stake: p(1 - p) of each team's odds.
  function impact(g) {
    if (st.picks[g.id] != null) return 10;
    var swing = 0, stake = 0;
    [g.h, g.a].forEach(function (i) {
      if (i >= N1) return;
      var r = BASE.teams[i]; // the build's odds, so a game that finished since keeps its pre-game swing
      stake += r.make * (1 - r.make);
      if (r.next === g.id && r.ifWin != null && r.ifLoss != null) swing += Math.abs(r.ifWin - r.ifLoss);
    });
    return swing ? 1 + swing : stake; // a measured swing always ranks ahead of the stake estimate
  }
  var LIVE_RANK = { in: 0, pre: 1, post: 2 }; // score lists: live games first, finals last
  var impactFrozen = null; // the Playoff impact order, kept until the sort or day changes
  function frozenImpact(games, key, byTime) {
    if (!impactFrozen || impactFrozen.key !== key) {
      impactFrozen = { key: key, pos: {} };
      games.slice().sort(function (a, b) { return impact(b) - impact(a) || byTime(a, b); }).forEach(function (g, n) { impactFrozen.pos[g.id] = n; });
    }
    var pos = impactFrozen.pos;
    return games.slice().sort(function (a, b) { return LIVE_RANK[a.s] - LIVE_RANK[b.s] || (pos[a.id] == null ? 1e4 : pos[a.id]) - (pos[b.id] == null ? 1e4 : pos[b.id]) || byTime(a, b); });
  }
  // The day picker: a strip of seven calendar days around the chosen one, arrows to step a day, and a
  // calendar for longer jumps. It stands in for the Day dropdown, which stays in the page but hidden.
  // The month calendar behind the calendar button. st.cal is the month showing ('YYYY-MM'), or null when closed.
  function addMonth(ym, n) { var t = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1, 12)); return t.toISOString().slice(0, 7); }
  function calendarHtml(sel, first, last, today) {
    var ym = st.cal, y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var start = new Date(Date.UTC(y, m - 1, 1, 12)), lead = start.getUTCDay(), dim = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
    var prev = addMonth(ym, -1), next = addMonth(ym, 1), cells = '';
    for (var b = 0; b < lead; b++) cells += '<span></span>';
    for (var d = 1; d <= dim; d++) {
      var day = ym + '-' + (d < 10 ? '0' : '') + d, off = day < first || day > last;
      var label = new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) + (days[day] ? '' : ', no games');
      cells += '<button type="button" class="cal-day' + (day === sel ? ' on' : '') + (day === today ? ' today' : '') + (days[day] ? '' : ' empty') + '" data-day="' + day + '"' + (off ? ' disabled' : '') + ' aria-label="' + esc(label) + '">' + d + '</button>';
    }
    return '<div class="day-pop" id="day-pop" role="dialog" aria-label="Pick a date">' +
      '<div class="cal-head"><button type="button" class="cal-nav" data-calmonth="' + prev + '"' + (prev < first.slice(0, 7) ? ' disabled' : '') + ' aria-label="Previous month">\u2039</button>' +
      '<b>' + esc(start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })) + '</b>' +
      '<button type="button" class="cal-nav" data-calmonth="' + next + '"' + (next > last.slice(0, 7) ? ' disabled' : '') + ' aria-label="Next month">\u203a</button></div>' +
      '<div class="cal-grid">' + ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (x) { return '<span class="cal-dow" aria-hidden="true">' + x + '</span>'; }).join('') + cells + '</div></div>';
  }
  function redrawDayStrip() { renderDayStrip(st.day || currentDay(), currentDay()); }
  function addDays(day, n) { var t = new Date(day + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  function renderDayStrip(sel, cur) {
    var el = $('day-strip');
    if (!el) {
      var ctl = $('nfl-week').closest('.ctl');
      el = document.createElement('div'); el.id = 'day-strip'; el.className = 'day-strip'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Day');
      ctl.hidden = true; ctl.parentNode.insertBefore(el, ctl);
    }
    var first = dayList[0].day, last = dayList[dayList.length - 1].day, today = etDay(new Date().toISOString());
    var fmt = function (day, o) { return new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC' }, o)); };
    var arrow = function (dir, to) {
      var off = to < first || to > last;
      return '<button type="button" class="day-arrow" data-day="' + to + '"' + (off ? ' disabled' : '') + ' aria-label="' + (dir < 0 ? 'Previous day' : 'Next day') + '">' + (dir < 0 ? '\u2039' : '\u203a') + '</button>';
    };
    var cells = '', count = {};
    D.games.forEach(function (g) { count[g.day] = (count[g.day] || 0) + 1; });
    for (var k = -3; k <= 3; k++) {
      var day = addDays(sel, k), off = day < first || day > last, on = k === 0, n = count[day] || 0;
      cells += '<button type="button" class="day-btn' + (day === today ? ' today' : '') + (Math.abs(k) === 3 ? ' far' : Math.abs(k) === 2 ? ' mid' : '') + (days[day] ? '' : ' empty') + '" data-day="' + day + '"' + (off ? ' disabled' : '') +
        ' aria-pressed="' + on + '" aria-label="' + esc(fmt(day, { weekday: 'long', month: 'long', day: 'numeric' }) + (day === today ? ' (today)' : '') + (days[day] ? '' : ', no games')) + '">' +
        '<span class="dw">' + fmt(day, { weekday: 'short' }) + '</span><span class="dd">' + fmt(day, { month: 'short', day: 'numeric' }) + '</span><span class="dc">' + (off ? '' : n ? n + (n === 1 ? ' game' : ' games') : 'No games') + '</span></button>';
    }
    el.innerHTML = arrow(-1, addDays(sel, -1)) + '<div class="day-cells">' + cells + '</div>' + arrow(1, addDays(sel, 1)) +
      '<span class="day-jump"><button type="button" class="day-cal" data-cal="1" aria-expanded="' + !!st.cal + '" aria-label="Pick a date" title="Pick a date"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12.5" rx="2"/><path d="M3 8.5h14M7 2.5v4M13 2.5v4"/></svg></button>' + (st.cal ? calendarHtml(sel, first, last, today) : '') + '</span>';
  }
  function pickDay(day) { st.cal = null; st.day = day === currentDay() ? null : day; impactFrozen = null; renderScores(); refreshScores(); }
  function renderScores() {
    var cur = currentDay(), sel = st.day || cur;
    renderDayStrip(sel, cur);
    $('nfl-week').innerHTML = dayList.map(function (x) {
      return '<option value="' + x.day + '"' + (x.day === sel ? ' selected' : '') + '>' + esc(dayLabel(x)) + (x.day === cur ? ' (today)' : '') + '</option>';
    }).join('');
    var games = D.games.filter(function (g) { return g.day === sel; });
    var byTime = function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; };
    var group = function (list) { return list.length ? '<div class="live-group"><div class="live-grid">' + list.sort(byTime).map(card).join('') + '</div></div>' : ''; };
    if (st.sbSort === 'impact') {
      $('nfl-scores').innerHTML = games.length ? '<div class="live-group"><div class="live-grid">' + frozenImpact(games, sel + '|' + mode, byTime).map(card).join('') + '</div></div>' : '<p class="live-empty">No games this day.</p>';
      return;
    }
    var html = group(games.filter(function (g) { return g.s === 'in'; })) + group(games.filter(function (g) { return g.s === 'pre'; })) + group(games.filter(function (g) { return g.s === 'post'; }));
    $('nfl-scores').innerHTML = html || '<p class="live-empty">No games this day.</p>';
  }
  // Live scores for the chosen day straight from ESPN; odds stay as of the last build.
  var liveTimer = null, page = 'rankings';
  function refreshScores() {
    var sel = st.day || currentDay(), now = Date.now();
    clearTimeout(liveTimer);
    var due = D.games.some(function (g) { return g.day === sel && g.s !== 'post' && Date.parse(g.d) <= now + 10 * 60000; });
    if (!due) return;
    fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=50&limit=500&dates=' + sel.replace(/-/g, ''))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        var newFinal = false;
        (j.events || []).forEach(function (e) {
          var g = gameById[e.id];
          if (!g) return;
          var c = e.competitions[0], s = c.status || e.status, was = g.s;
          g.s = s.type.completed ? 'post' : s.type.state === 'in' ? 'in' : 'pre';
          g.clock = s.type.shortDetail;
          c.competitors.forEach(function (x) { if (x.homeAway === 'home') g.hs = +x.score || 0; else g.as = +x.score || 0; });
          if (g.s === 'post' && was !== 'post' && simById()[g.id] && simById()[g.id].s !== 'post' && auto[g.id] == null && g.hs !== g.as) {
            auto[g.id] = g.hs > g.as ? g.h : g.a; delete st.picks[g.id]; newFinal = true;
          }
        });
        $('nfl-live-note').hidden = true;
        countRecords();
        if (newFinal) resimulate(); else { renderScores(); renderRankings(); }
      })
      .catch(function () { $('nfl-live-note').hidden = false; $('nfl-live-note').innerHTML = '<b>Couldn’t reach ESPN.</b> Showing the saved scores.'; })
      .then(function () { liveTimer = setTimeout(refreshScores, 60000); });
  }

  // ---------- Views ----------
  var PAGES = { rankings: 'College basketball NCAA tournament odds · CFP Odds Board', playoff: 'Projected NCAA tournament bracket · CFP Odds Board', scoreboard: 'College basketball scores · CFP Odds Board' };
  function showPage() {
    var h = location.hash.replace('#', '');
    page = h === 'scores' || h === 'scoreboard' ? 'scoreboard' : PAGES[h] ? h : 'rankings';
    Object.keys(PAGES).forEach(function (k) { $('page-' + k).hidden = k !== page; });
    [].forEach.call(document.querySelectorAll('.tabs a'), function (a) {
      if (a.dataset.page === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = PAGES[page];
    refreshScores();
  }
  function renderAll() { renderPicksBar(); renderRankings(); renderBracket(); renderScores(); }
  function renderModes() {
    var groups = [];
    data.models.forEach(function (m) { if (groups.indexOf(m.group) < 0) groups.push(m.group); });
    var html = groups.map(function (g) {
      return '<optgroup label="' + esc(g) + '">' + data.models.filter(function (m) { return m.group === g; }).map(function (m) {
        return '<option value="' + m.k + '"' + (m.k === mode ? ' selected' : '') + '>' + esc(m.label) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    [].forEach.call(document.querySelectorAll('.nfl-mode'), function (s) { s.innerHTML = html; });
  }
  renderModes();
  document.addEventListener('change', function (e) {
    if (!e.target.classList.contains('nfl-mode')) return;
    mode = e.target.value;
    store.set('ncaab-mode', mode);
    BASE = data.results[mode];
    renderModes();
    st.order = null; impactFrozen = null;
    resimulate();
  });

  // ---------- Picks: re-simulate with the picked results locked in ----------
  var PICK_SIMS = 10000, QUICK_SIMS = 2000, SEED = 20270405;
  var ENGINE_URL = new URL(document.querySelector('script[src*="ncaab-engine.js"]').getAttribute('src'), location.href).href;
  var SIM_D = JSON.parse(JSON.stringify(D)); // the season as of the build (live score updates don't change odds)
  SIM_D.games.forEach(function (g) { if (g.s === 'in') g.s = 'pre'; });
  var cache = {}, worker = null, busy = false, simIndex = null, simTimer = null, jobN = 0;
  function simById() { if (!simIndex) { simIndex = {}; SIM_D.games.forEach(function (g) { simIndex[g.id] = g; }); } return simIndex; }
  function allPicks() { return Object.assign({}, auto, st.picks); }
  function picksKey() { var all = allPicks(), p = Object.keys(all).sort().map(function (k) { return k + ':' + all[k]; }).join(','); return p ? mode + '|' + p : ''; }
  function startWorker() {
    try {
      worker = new Worker(URL.createObjectURL(new Blob(['importScripts(' + JSON.stringify(ENGINE_URL) + ');\nself.onmessage=function(e){var m=e.data;postMessage({job:m.job,sims:m.sims,res:NCAABSIM.simulate(m.D,m.sims,m.seed,m.picks,m.rating)});};'], { type: 'text/javascript' })));
    } catch (err) { worker = null; }
    return worker;
  }
  function runSims(job, sims, picks, done) {
    var rating = data.ratings[mode];
    if (!worker && !startWorker()) { setTimeout(function () { done(NCAABSIM.simulate(SIM_D, sims, SEED, picks, rating)); }, 20); return; }
    worker.onmessage = function (e) { if (e.data.job === job) done(e.data.res); };
    worker.onerror = function () { worker = null; setTimeout(function () { done(NCAABSIM.simulate(SIM_D, sims, SEED, picks, rating)); }, 20); };
    worker.postMessage({ job: job, D: SIM_D, sims: sims, seed: SEED, picks: picks, rating: rating });
  }
  function resimulate() {
    var key = picksKey();
    clearTimeout(simTimer);
    var job = ++jobN;
    if (!key || cache[key]) {
      R = key ? cache[key] : BASE; busy = false;
      $('nfl-tw').classList.remove('busy');
      renderAll();
      return;
    }
    busy = true;
    renderPicksBar(); renderRankings();
    $('nfl-tw').classList.add('busy');
    simTimer = setTimeout(function () {
      if (worker && worker.job) { worker.terminate(); worker = null; }
      var picks = allPicks();
      var show = function (res) { res.model = BASE.model; if (job !== jobN) return; R = res; renderAll(); };
      if (worker) worker.job = job; else if (startWorker()) worker.job = job;
      runSims(job, QUICK_SIMS, picks, function (quick) {
        busy = false; $('nfl-tw').classList.remove('busy');
        show(quick);
        if (job !== jobN) return;
        runSims(job, PICK_SIMS, picks, function (full) { if (worker) worker.job = 0; full.model = BASE.model; cache[key] = full; show(full); });
      });
    }, 150);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cal) { st.cal = st.cal ? null : (st.day || currentDay()).slice(0, 7); redrawDayStrip(); return; }
    if (b.dataset.calmonth) { st.cal = b.dataset.calmonth; redrawDayStrip(); return; }
    if (b.dataset.day) { pickDay(b.dataset.day); return; }
    if (b.dataset.open != null) { st.open[b.dataset.open] = !st.open[b.dataset.open]; renderRankings(); return; }
    if (b.dataset.pick) {
      var id = b.dataset.pick, me = +b.dataset.team, g = gameById[id], opp = g.h === me ? g.a : g.h;
      if (st.picks[id] == null) st.picks[id] = me; else if (st.picks[id] === me) st.picks[id] = opp; else delete st.picks[id];
      resimulate();
    } else if (b.dataset.winout != null || b.dataset.clearteam != null) {
      // Win out picks every game left as a win for this team (or, when it's on, clears them); Clear drops them.
      var team = +(b.dataset.winout != null ? b.dataset.winout : b.dataset.clearteam), ids = b.dataset.games.split(',');
      var on = b.dataset.winout != null && ids.every(function (x) { return st.picks[x] === team; });
      ids.forEach(function (x) { if (b.dataset.winout != null && !on) st.picks[x] = team; else delete st.picks[x]; });
      resimulate();
    } else if (b.dataset.bkreg != null) {
      st.bkReg = +b.dataset.bkreg; renderBracket();
    } else if (b.dataset.bk) {
      var k = b.dataset.bk, t = +b.dataset.team, o = +b.dataset.opp;
      if (st.bk[k] !== t && st.bk[k] !== o) st.bk[k] = t; else if (st.bk[k] === t) st.bk[k] = o; else delete st.bk[k];
      renderBracket();
    } else if (b.dataset.nsort) {
      var sk = b.dataset.nsort;
      st.sort = st.sort && st.sort.k === sk ? { k: sk, dir: -st.sort.dir } : { k: sk, dir: sk === 'team' || sk === 'cf' || sk === 'seed' ? 1 : -1 };
      st.order = null; renderRankings();
    } else if (b.id === 'nfl-clear') { st.picks = {}; st.order = null; resimulate(); }
    else if (b.id === 'nfl-bk-clear') { st.bk = {}; renderBracket(); }
    else if (b.id === 'nfl-bk-sim') { st.bkSim = !st.bkSim; renderBracket(); }
  });
  $('nfl-expand').addEventListener('click', function (e) {
    var on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', on);
    e.currentTarget.textContent = on ? 'Show fewer columns' : 'Show all columns';
    document.querySelector('#nfl-tw table').classList.toggle('expanded', on);
    renderRankings();
  });
  $('nfl-view').addEventListener('change', function (e) { st.view = e.target.value; st.sort = null; st.order = null; store.set('ncaab-view', st.view); renderRankings(); });
  $('nfl-sb-sort').addEventListener('change', function (e) { st.sbSort = e.target.value; impactFrozen = null; renderScores(); });
  document.addEventListener('click', function (e) { if (st.cal && !e.target.closest('.day-jump')) { st.cal = null; redrawDayStrip(); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st.cal) { st.cal = null; redrawDayStrip(); var c = document.querySelector('.day-cal'); if (c) c.focus(); } });
  $('nfl-week').addEventListener('change', function (e) { st.day = e.target.value === currentDay() ? null : e.target.value; renderScores(); refreshScores(); });
  window.addEventListener('hashchange', function () { showPage(); window.scrollTo(0, 0); });
  new MutationObserver(renderAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll); } catch (e) {}
  renderAll();
  showPage();
})();
