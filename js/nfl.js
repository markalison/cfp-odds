// NFL pages: Standings (every team's odds), Bracket (the projected playoff field) and Scores (each week's
// games, refreshed from ESPN while games are on). Odds come from nfl-build.mjs.
(function () {
  'use strict';
  // R is the odds being shown: the build's for the chosen ratings model (BASE), or a fresh simulation with
  // the reader's picks.
  var data = window.NFL_DATA, D = data.D;
  var MODES = data.models.map(function (m) { return m.k; });
  var mode = (function () { try { var m = localStorage.getItem('nfl-mode'); return MODES.indexOf(m) >= 0 ? m : MODES[0]; } catch (e) { return MODES[0]; } })();
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
  function logo(t, px) { return '<img class="logo" alt="" width="' + px + '" height="' + px + '" src="' + esc(isDark() && t.logoDark ? t.logoDark : t.logo) + '" loading="lazy">'; }
  function etTime(iso) { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }); }
  function etDate(iso, opts) { return new Date(iso).toLocaleDateString('en-US', Object.assign({ timeZone: 'America/New_York' }, opts)); }
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  // Records from finished games, as of the last build.
  // Records count every final, including games that finished after the last build (live scores).
  var rec = [];
  function countRecords() {
    rec = D.teams.map(function () { return { w: 0, l: 0, t: 0 }; });
    D.games.forEach(function (g) {
      if (g.s !== 'post') return;
      var d = g.hs - g.as;
      if (d > 0) { rec[g.h].w++; rec[g.a].l++; } else if (d < 0) { rec[g.a].w++; rec[g.h].l++; } else { rec[g.h].t++; rec[g.a].t++; }
    });
  }
  countRecords();
  // A team's next game not yet final (a picked game still counts as its next game, so the pick box stays).
  function nextOpen(i) {
    var best = null;
    D.games.forEach(function (g) { if ((g.h === i || g.a === i) && g.s !== 'post' && (!best || g.d < best.d)) best = g; });
    return best ? best.id : null;
  }
  // Games that went final after the build, locked in as results for every simulation: { gameId: winner }.
  var auto = {};
  function recText(i) { var r = rec[i]; return r.w + '-' + r.l + (r.t ? '-' + r.t : ''); }
  var gameById = {};
  D.games.forEach(function (g) { gameById[g.id] = g; });

  // ---------- Standings ----------
  // Every view shows all 32 teams: one league list, or grouped by conference or by division.
  var VIEWS = [['all', 'NFL'], ['conf', 'Conference'], ['div', 'Division']];
  var st = { open: {}, view: 'all', week: null, picks: {}, bk: {}, bkSim: false, order: null, sort: null };
  var savedView = store.get('nfl-view');
  if (VIEWS.some(function (v) { return v[0] === savedView; })) st.view = savedView;
  $('nfl-view').innerHTML = VIEWS.map(function (v) { return '<option value="' + esc(v[0]) + '">' + esc(v[1]) + '</option>'; }).join('');
  $('nfl-view').previousElementSibling.textContent = 'View';
  $('nfl-view').value = st.view;

  // The Standings table uses the college Rankings table's layout and styles (styles.css section 7): RK and
  // Team pinned at the left, Rec, Index, the Next pick box, Playoffs shaded, and the other odds columns
  // (class sec) shown on wide screens or with Show all columns.
  function renderHead() {
    function th(key, label, cls, title) {
      var s = st.sort && st.sort.k === key ? (st.sort.dir > 0 ? 'ascending' : 'descending') : 'none';
      return '<th class="' + cls + '" aria-sort="' + s + '"' + (title ? ' title="' + esc(title) + '"' : '') + '><button type="button" data-nsort="' + key + '">' + label + '</button></th>';
    }
    $('nfl-head').innerHTML =
      '<th class="first c-rk" title="Place in this list">RK</th>' +
      th('team', 'Team', 'l c-team team-col') +
      th('dv', 'Div.', 'l c-cn') +
      th('rec', 'Rec', 'c-rec') +
      th('rating', '<abbr title="' + esc(modelLabel()) + ' rating: points better than an average team on a neutral field">Index</abbr>', 'c-idx tc') +
      '<th class="pick c-pick">Next</th>' +
      th('playoff', 'Playoffs', 'c-cfp', 'Chance to make the playoffs, and after a win or loss in the next game') +
      th('div', 'Win div', 'c-div sec') +
      th('bye', '1 seed', 'c-bye sec', 'Chance to be the top seed, with the only first-round bye') +
      th('conf', 'Win conf', 'c-conf sec', 'Chance to win the conference and reach the Super Bowl') +
      th('sb', 'Win SB', 'c-title sec');
  }
  function modelLabel() { var m = data.models.filter(function (x) { return x.k === mode; })[0]; return m ? m.label : ''; }
  // Sort values per column; text columns start A to Z, numbers start highest first.
  function sortValue(k, i) {
    var r = R.teams[i];
    if (k === 'team') return D.teams[i].name;
    if (k === 'rec') return winPct(i);
    if (k === 'dv') return D.teams[i].div;
    return r[k];
  }
  function shaded(v) { return '<td class="sec pct-cell" style="--p:' + (v || 0).toFixed(3) + '">' + pct(v) + '</td>'; }
  // Next: the W / L / blank box with the opponent under it, as in the college table.
  // Next shows only the coming week's game (the Scores page's week): a team on a bye that week gets a blank cell
  // rather than its game after the bye. A team whose game this week is already over shows next week's game.
  function nextCell(i) {
    var id = nextOpen(i);
    if (id == null) return '<td class="pick">—</td>';
    var cw = currentWeek();
    if (gameById[id].wk > cw && !D.games.some(function (g) { return g.wk === cw && (g.h === i || g.a === i); })) return '<td class="pick"></td>';
    var g = gameById[id], home = g.h === i, opp = D.teams[home ? g.a : g.h], vs = (home ? 'vs ' : '@') + opp.ab;
    var pk = st.picks[id], tie = pk === 'T', won = pk === i, lost = pk != null && !won && !tie;
    var label = won ? D.teams[i].short + ' ' + vs + ' picked to win. Press to pick a loss' : lost ? D.teams[i].short + ' ' + vs + ' picked to lose. Press to pick a tie' : tie ? D.teams[i].short + ' ' + vs + ' picked to tie. Press to clear the pick' : 'No pick for ' + D.teams[i].short + ' ' + vs + '. Press to pick a win';
    return '<td class="pick"><div class="nx-cell"><div class="mini"><button type="button" class="pick-box' + (won ? ' pick-w' : lost ? ' pick-l' : tie ? ' pick-t' : '') + '" data-pick="' + esc(id) + '" data-team="' + i + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + (won ? 'W' : lost ? 'L' : tie ? 'T' : '') + '</button></div>' +
      '<span class="nx-vs" aria-hidden="true">' + esc(vs) + '</span></div></td>';
  }
  // Row order: current standings (record, then playoff odds) in every view until a column is sorted. The order is set
  // when the view is chosen or picks are cleared, and held while picks change the odds, so rows don't jump.
  function winPct(i) { var r = rec[i], g = r.w + r.l + r.t; return g ? (r.w + r.t / 2) / g : 0; }
  function sortRows(v) {
    var sk = st.sort;
    var by = sk ? function (a, b) {
      var x = sortValue(sk.k, a), y = sortValue(sk.k, b);
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sk.dir || R.teams[b].playoff - R.teams[a].playoff;
    } : function (a, b) { return winPct(b) - winPct(a) || R.teams[b].div - R.teams[a].div || R.teams[b].playoff - R.teams[a].playoff; };
    var all = D.teams.map(function (t, i) { return i; });
    var key = v === 'conf' ? 'conf' : v === 'div' ? 'div' : null;
    var names = key ? all.map(function (i) { return D.teams[i][key]; }).filter(function (n, k, arr) { return arr.indexOf(n) === k; }).sort() : [null];
    return names.map(function (n) { return { name: n, rows: all.filter(function (i) { return !key || D.teams[i][key] === n; }).sort(by) }; });
  }
  // A label row must span exactly the columns showing, or the fixed table layout adds empty columns.
  var WIDE_Q = matchMedia('(min-width: 900px)'), TABLET_Q = matchMedia('(min-width: 600px)');
  function visibleCols() { var ex = document.querySelector('#nfl-tw table.expanded'); return WIDE_Q.matches || ex ? 11 : TABLET_Q.matches ? 7 : 6; }
  [WIDE_Q, TABLET_Q].forEach(function (q) { try { q.addEventListener('change', function () { renderRankings(); }); } catch (e) {} });
  // Conference and Division views: each group opens with its own copy of the column headings (sort buttons
  // included), with the group's name in the Team column. The table's own header row is hidden then, and each
  // group's headings stick to the top while its teams scroll by.
  function groupHead(name) {
    return '<tr class="nfl-group">' + [].map.call($('nfl-head').children, function (h) {
      return h.classList.contains('c-team') ? '<th scope="rowgroup" class="' + h.className + '"><span class="grp-name">' + esc(name) + '</span></th>' : h.outerHTML.replace('<th ', '<th scope="col" ');
    }).join('') + '</tr>';
  }
  function renderRankings() {
    if (!st.order || st.order.view !== st.view) st.order = { view: st.view, groups: sortRows(st.view) };
    renderHead();
    document.querySelector('#nfl-tw table').classList.toggle('grouped', st.view !== 'all');
    $('nfl-body').innerHTML = st.order.groups.map(function (grp) {
      return (grp.name ? groupHead(grp.name) : '') + grp.rows.map(row).join('');
    }).join('');
  }
  function row(i, k) {
    var t = D.teams[i], r = R.teams[i];
    return '<tr><td class="first c-rk">' + (k + 1) + '</td>' +
      '<td class="team-col"><div class="teamcell">' + logo(t, 30) + '<span><button class="tname" type="button" data-open="' + i + '" aria-expanded="' + !!st.open[i] + '" aria-label="' + esc(t.name) + '"><span class="tn-long">' + esc(t.name) + '</span><span class="tn-short" aria-hidden="true">' + esc(t.ab) + '</span></button></span></div></td>' +
      // Division, styled like the college table's Conf. column: "AFC East", or "AFC E" on phones.
      '<td class="l c-cn-cell"><span class="cn-long">' + esc(t.div) + '</span><span class="cn-short" aria-hidden="true">' + esc(t.div.replace(/ (\w)\w+$/, ' $1')) + '</span></td>' +
      '<td class="num rec">' + recText(i) + '</td>' +
      '<td class="num tc">' + (r.rating > 0 ? '+' : '') + r.rating.toFixed(1) + '</td>' +
      nextCell(i) +
      '<td class="odds-cell" style="--p:' + playoffShown(i).toFixed(3) + '"><div class="odds"><span class="v">' + pct(playoffShown(i)) + '</span></div></td>' +
      shaded(r.div) + shaded(r.bye) + shaded(r.conf) + shaded(r.sb) + '</tr>' + (st.open[i] ? detail(i) : '');
  }
  function playoffShown(i) {
    var g = gameById[nextOpen(i)];
    if (!g || g.s !== 'in') return R.teams[i].playoff;
    var ph = liveHomeWin(g);
    return playoffNow(g, i, g.h === i ? ph : 1 - ph);
  }
  // ---------- Team detail (click a team), laid out like the college table's ----------
  // One row of shaded tiles, as on the Scores cards. A missing number shows a dash.
  function oddsRow(label, now, win, loss) {
    var tile = function (v) { return v == null ? '<div class="lg-num">—</div>' : '<div class="lg-cfp" style="--p:' + v.toFixed(3) + '">' + pct(v) + '</div>'; };
    return '<div class="odds-row"><span class="h">' + label + '</span><span class="h">If win</span><span class="h">If loss</span>' + tile(now) + tile(win) + tile(loss) + '</div>';
  }
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
  // (each ranked among the 32 teams, by the selected ratings).
  function resumeTiles(i) {
    var n = D.teams.length, sd = Math.sqrt(MODEL.gameSD * MODEL.gameSD + 2 * MODEL.teamSD * MODEL.teamSD);
    var played = D.teams.map(function () { return []; }), leftOpp = D.teams.map(function () { return []; });
    D.games.forEach(function (g) {
      if (g.s === 'post') {
        var r = g.hs > g.as ? 1 : g.hs < g.as ? 0 : 0.5, site = g.neutral ? 0 : 1;
        played[g.h].push({ o: g.a, r: r, site: site }); played[g.a].push({ o: g.h, r: 1 - r, site: -site });
      } else { leftOpp[g.h].push(g.a); leftOpp[g.a].push(g.h); }
    });
    var rt = function (x) { return R.teams[x].rating; };
    // The level of the last playoff spot: the 14th-best rating.
    var bench = D.teams.map(function (_, x) { return rt(x); }).sort(function (a, b) { return b - a; })[13];
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
      return 1 + D.teams.filter(function (_, x) { var w = fn(x); return w != null && (better > 0 ? w > v + 1e-9 : w < v - 1e-9); }).length;
    };
    var sorRank = played[i].length ? rankOf(sor, -1) : null, sosRank = rankOf(sos, 1);
    var leftRank = leftOpp[i].length ? 1 + D.teams.filter(function (_, x) { var w = avg(leftOpp[x]); return w != null && w > avg(leftOpp[i]) + 1e-9; }).length : null;
    var dv = { w: 0, l: 0, t: 0 };
    played[i].forEach(function (e) { if (D.teams[e.o].div === D.teams[i].div) { if (e.r === 1) dv.w++; else if (e.r === 0) dv.l++; else dv.t++; } });
    var rc = rec[i], recTxt = rc.w + '-' + rc.l + (rc.t ? '-' + rc.t : '');
    var tile = function (label, title, value) { return '<div><dt><abbr title="' + esc(title) + '">' + label + '</abbr></dt><dd>' + value + '</dd></div>'; };
    return '<div class="resume"><dl class="rs-tiles nfl-tiles">' +
      tile('Record', 'Overall record', recTxt) +
      tile('Division', 'Record against ' + D.teams[i].div + ' teams', dv.w + '-' + dv.l + (dv.t ? '-' + dv.t : '')) +
      tile('SOR', 'Strength of record: how hard this record would be for a team at the level of the last playoff spot (the 14th-best rating) to match against this schedule, ranked among the 32 teams (1st = hardest)', sorRank ? ordinal(sorRank) : '—') +
      tile('SOS', 'Strength of schedule: average rating of opponents played, ranked among the 32 teams (1st = toughest)' + (leftRank ? '; schedule left ranks ' + ordinal(leftRank) : ''), sosRank ? ordinal(sosRank) : '—') +
    '</dl></div>';
  }
  // Team panel, laid out like the college one: playoff odds over time, the next games with pick boxes, then
  // Make playoffs (with any picks) over the seed distribution.
  function detail(i) {
    var t = D.teams[i], r = R.teams[i];
    var stat = function (label, v) { return '<div><dt>' + label + '</dt><dd>' + v + '</dd></div>'; };
    var stats = '<dl class="field-stats narrow-only">' + [['Playoffs', r.playoff], ['Win division', r.div], ['1 seed', r.bye], ['Win conf', r.conf], ['Win Super Bowl', r.sb]].map(function (x) { return stat(x[0], pct(x[1])); }).join('') +
      stat('Index', (r.rating > 0 ? '+' : '') + r.rating.toFixed(1)) + '</dl>';
    var left = D.games.filter(function (g) { return (g.h === i || g.a === i) && g.s !== 'post'; }).sort(function (a, b) { return a.d < b.d ? -1 : 1; });
    // The next four games; Win out and Clear still cover every game left.
    var lines = left.slice(0, 4).map(function (g) {
      var home = g.h === i, o = D.teams[home ? g.a : g.h], hw = R.homeWin[g.id], p = hw == null ? null : home ? hw : 1 - hw, pk = st.picks[g.id];
      var tie = pk === 'T', won = pk === i, lost = pk != null && !won && !tie, vs = (home ? 'vs ' : '@') + o.ab;
      var label = won ? t.short + ' ' + vs + ' picked to win. Press to pick a loss' : lost ? t.short + ' ' + vs + ' picked to lose. Press to pick a tie' : tie ? t.short + ' ' + vs + ' picked to tie. Press to clear the pick' : 'No pick for ' + t.short + ' ' + vs + '. Press to pick a win';
      var box = '<span class="mini"><button type="button" class="pick-box' + (won ? ' pick-w' : lost ? ' pick-l' : tie ? ' pick-t' : '') + '" data-pick="' + esc(g.id) + '" data-team="' + i + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + (won ? 'W' : lost ? 'L' : tie ? 'T' : '') + '</button></span>';
      var live = g.s === 'in' ? ' <b class="score-now">' + ((home ? g.hs - g.as : g.as - g.hs) > 0 ? 'Up ' : (home ? g.hs - g.as : g.as - g.hs) < 0 ? 'Down ' : 'Tied ') + (home ? g.hs + '-' + g.as : g.as + '-' + g.hs) + '</b>' : '';
      return '<span class="sched-g">' + box + '<span>' + etDate(g.d, { month: 'short', day: 'numeric' }) + ' · ' + (home ? 'vs ' : '@') + logo(o, 18) + esc(o.short) + live + '</span></span><span>' + (p == null ? '—' : Math.round(p * 100) + '%') + '</span>';
    }).join('') + (left.length > 4 ? '<span class="sched-more">and ' + (left.length - 4) + ' more</span><span></span>' : '');
    var seeds = (r.seeds || []).slice(0, 7), maxS = [0.05, 0.1, 0.2, 0.25, 0.4, 0.5, 0.6, 0.8, 1].find(function (x) { return x >= Math.max.apply(null, seeds.concat(0.0001)) - 1e-9; });
    var bars = seeds.map(function (v, k) { var lab = 'Seed ' + (k + 1) + ': ' + (v * 100).toFixed(1) + '% of simulations'; return '<div title="' + lab + '" aria-label="' + lab + '"><i style="height:' + (v / maxS * 100).toFixed(1) + '%"></i></div>'; }).join('');
    var xs = seeds.map(function (_, k) { return '<span>' + (k + 1) + '</span>'; }).join('');
    return '<tr class="detail"><td colspan="' + visibleCols() + '">' + stats + '<div class="detail-inner">' + resumeTiles(i) +
      oddsChartBlock(i, 'Make playoffs', 'All models average') +
      '<div><div class="sched-head"><h3 title="Chance to win each game">Regular season left</h3>' + winOutButton(i, left) + '</div><div class="sched">' + (lines || '<span>No games left</span><span></span>') + '</div></div>' +
      '<div><div class="scenario"><span>Make playoffs' + (Object.keys(st.picks).length ? ' with your picks' : '') + '</span><b>' + pct(r.playoff) + '</b></div>' +
        '<h3>Seed distribution, % of all simulations</h3>' + histY(maxS, '<div class="hist" role="img" aria-label="Chance of each seed for ' + esc(t.name) + '">' + bars + '</div><div class="hist-x">' + xs + '</div>') + '</div>' +
    '</div></td></tr>';
  }
  function renderPicksBar() {
    var n = Object.keys(st.picks).length;
    $('nfl-picks-bar').innerHTML = busy ? '<span><b>Simulating…</b> Updating every team’s odds for your picks.</span>' : n
      ? '<span><b>' + n + (n === 1 ? ' game' : ' games') + ' picked.</b> All odds assume ' + (n === 1 ? 'that result' : 'those results') + '.</span><button class="btn" id="nfl-clear" type="button">Clear picks</button>'
      : '<span>Press a team’s box to cycle its next game through <b>W</b>, <b>L</b>, <b>T</b> (tie) and blank. Its opponent gets the opposite result, and all odds update.</span>';
  }
  var played = D.games.filter(function (g) { return g.s === 'post'; }).length;
  $('nfl-note').textContent = D.season + ' season · ' + played + ' of ' + D.games.length + ' games played · updated ' +
    new Date(D.asOf).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';

  // ---------- Bracket: the likeliest field ----------
  // Division winners are each division's likeliest champion, seeded 1-4 by their average seed; the wild
  // cards are the three likeliest of the rest, seeded 5-7 the same way.
  function avgSeed(i, from, to) {
    var s = R.teams[i].seeds, w = 0, n = 0;
    for (var k = from; k <= to; k++) { w += (k + 1) * s[k]; n += s[k]; }
    return n ? w / n : 99;
  }
  function confTeams(conf) { return D.teams.map(function (t, i) { return i; }).filter(function (i) { return D.teams[i].conf === conf; }); }
  function projectedField(conf) {
    var idx = confTeams(conf), divs = [];
    idx.forEach(function (i) { if (divs.indexOf(D.teams[i].div) < 0) divs.push(D.teams[i].div); });
    var winners = divs.map(function (d) {
      return idx.filter(function (i) { return D.teams[i].div === d; }).sort(function (a, b) { return R.teams[b].div - R.teams[a].div; })[0];
    }).sort(function (a, b) { return avgSeed(a, 0, 3) - avgSeed(b, 0, 3); });
    var wild = idx.filter(function (i) { return winners.indexOf(i) < 0; })
      .sort(function (a, b) { return R.teams[b].playoff - R.teams[a].playoff; }).slice(0, 3)
      .sort(function (a, b) { return avgSeed(a, 4, 6) - avgSeed(b, 4, 6); });
    return winners.concat(wild);
  }
  // One game's win chance from the two ratings, as in the season simulation: home edge on non-neutral fields.
  var MODEL = R.model || { hfa: 1.5, gameSD: 13, teamSD: 1.5 };
  function phi(x) { var t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
  function winChance(h, a, neutral) {
    var sd = Math.sqrt(MODEL.gameSD * MODEL.gameSD + 2 * MODEL.teamSD * MODEL.teamSD);
    return phi((R.teams[h].rating - R.teams[a].rating + (neutral ? 0 : MODEL.hfa)) / sd);
  }
  function bkRow(key, i, opp, seed, p, won, pk) {
    if (i == null) return '<div class="bk-team tbd"></div>';
    var t = D.teams[i], mine = pk === i, theirs = pk === opp;
    if (opp == null) return '<div class="bk-team"><span class="bk-seed">' + seed + '</span>' + logo(t, 22) + '<span class="bk-name">' + esc(t.short) + ' <small class="lg-rec">(' + recText(i) + ')</small></span><span class="bk-p"></span></div>';
    var label = mine ? t.short + ' picked to win. Press to pick ' + D.teams[opp].short : theirs ? D.teams[opp].short + ' picked. Press to clear the pick' : 'Press to pick ' + t.short + ' to win';
    return '<button type="button" class="bk-team picks' + (won ? ' win' : won === false ? ' lose' : '') + '" data-bk="' + key + '" data-team="' + i + '" data-opp="' + opp + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
      '<span class="bk-seed">' + seed + '</span>' + logo(t, 22) +
      '<span class="bk-name">' + esc(t.short) + ' <small class="lg-rec">(' + recText(i) + ')</small></span>' +
      '<span class="bk-p">' + (p == null ? '' : pct(p)) + '</span>' +
      '<span class="mini"><span class="pick-box' + (mine ? ' pick-w' : theirs ? ' pick-l' : '') + '" aria-hidden="true">' + (mine ? 'W' : theirs ? 'L' : '') + '</span></span></button>';
  }
  // A game card: the higher seed (home team) on top. The bracket starts blank: a game is decided only by
  // the reader's pick, or by the favorite with Simulate games on. Win chances show once a game is picked or
  // simulated. A pick for a team no longer in this game is ignored; teams not yet known are empty rows.
  // Logos and the 2026 postseason schedule (NFL): Wild Card Jan 16-18, Divisional Jan 23-24, Conference
  // Championships Jan 31 (AFC on CBS, NFC on FOX), Super Bowl LXI Feb 14 at SoFi Stadium on ABC and ESPN.
  var BRAND = {
    AFC: 'https://upload.wikimedia.org/wikipedia/commons/7/7a/American_Football_Conference_logo.svg',
    NFC: 'https://upload.wikimedia.org/wikipedia/commons/6/6f/National_Football_Conference_logo.svg',
    SB: 'https://upload.wikimedia.org/wikipedia/en/e/ed/Super_Bowl_LXI_Logo.svg'
  };
  function brand(k, name) { return '<img class="bk-conf bk-big bk-' + k.toLowerCase() + '" src="' + BRAND[k] + '" alt="" loading="lazy"><span class="bk-title" title="' + esc(name) + '">' + esc(name) + '</span>'; }
  // The home team's city (the higher seed hosts), or the Super Bowl's site.
  function city(i) { var t = D.teams[i]; return t.name.slice(0, t.name.length - t.short.length).trim(); }
  // Wild Card and Divisional cards: the conference logo, then the seeds playing. The text always shows.
  function tag(c, text) { return '<img class="bk-conf bk-' + c.toLowerCase() + '" src="' + BRAND[c] + '" alt="' + c + '" title="' + c + '" loading="lazy"><span>' + esc(text) + '</span>'; }
  function air(when, nets) { return '<b>' + when + '</b>' + (nets.length ? '<span class="net-logos">' + tvBadges(nets) + '</span>' : ''); }
  function game(key, label, h, a, seedOf, neutral, airHtml, site) {
    var both = h != null && a != null;
    var p = both ? winChance(h, a, neutral) : null, pk = both && (st.bk[key] === h || st.bk[key] === a) ? st.bk[key] : null;
    var w = pk != null ? pk : both && st.bkSim ? (p >= 0.5 ? h : a) : null;
    var show = w != null ? p : null;
    var loc = site || (!neutral && h != null ? city(h) : '');
    return { winner: w, html: '<div class="bk-game"><div class="bk-where"><span class="bk-place">' + (label.charAt(0) === '<' ? label : '<span>' + label + '</span>') + (loc ? '<span class="bk-loc">' + esc(loc) + '</span>' : '') + '</span>' + (airHtml ? '<span class="bk-air">' + airHtml + '</span>' : '') + '</div>' +
      bkRow(key, h, a, h == null ? '' : seedOf(h), show, w == null ? null : w === h, pk) + bkRow(key, a, h, a == null ? '' : seedOf(a), show == null ? null : 1 - show, w == null ? null : w === a, pk) + '</div>' };
  }
  // Each conference's playoffs with the favorite advancing: 2v7, 3v6, 4v5; then the 1 seed hosts the
  // lowest seed left (the NFL reseeds), the other two meet, and the winners play for the conference.
  function confPath(c) {
    var f = projectedField(c), seedOf = function (i) { return f.indexOf(i) + 1; };
    var wc = [[1, 6], [2, 5], [3, 4]].map(function (m, k) { return game(c + '-wc' + k, tag(c, 'Wild Card'), f[m[0]], f[m[1]], seedOf, false, air('Jan 16–18', [])); });
    // The NFL reseeds, so the Divisional matchups are known only once all three Wild Card games are decided.
    var left = wc.map(function (g) { return g.winner; });
    var dv, feeds = null;
    if (left.every(function (x) { return x != null; })) {
      left.sort(function (x, y) { return seedOf(x) - seedOf(y); });
      feeds = wc.map(function (g) { return g.winner === left[2] ? 0 : 1; });
      dv = [game(c + '-dv0', tag(c, 'Divisional'), f[0], left[2], seedOf, false, air('Jan 23–24', [])), game(c + '-dv1', tag(c, 'Divisional'), left[0], left[1], seedOf, false, air('Jan 23–24', []))];
    } else dv = [game(c + '-dv0', tag(c, 'Divisional'), f[0], null, seedOf, false, air('Jan 23–24', [])), game(c + '-dv1', tag(c, 'Divisional'), null, null, seedOf, false, air('Jan 23–24', []))];
    var cw = dv.map(function (g) { return g.winner; }).filter(function (x) { return x != null; }).sort(function (x, y) { return seedOf(x) - seedOf(y); });
    var cc = game(c + '-cc', brand(c, c + ' Championship'), cw[0], cw[1], seedOf, false, air('Jan 31', [c === 'AFC' ? 'CBS' : 'FOX']));
    return { wc: wc, dv: dv, cc: cc, champ: cc.winner, seedOf: seedOf, feeds: feeds };
  }
  var NFL_ROUNDS = [['Wild Card', 'Jan 16–18 · higher seed hosts · 1 seeds rest'], ['Divisional', 'Jan 23–24 · 1 seed hosts the lowest seed left'], ['Conference', 'Jan 31 · AFC on CBS, NFC on FOX'], ['Super Bowl', 'Feb 14 · SoFi Stadium, Inglewood, Calif.']];
  var NFL_WHEN = ['Jan 16–18', 'Jan 23–24', 'Jan 31', 'Feb 14'];
  // Connector lines on wide screens, as on the college bracket. Before the Wild Card games are all picked,
  // each conference's three Wild Card games join one line that reaches both Divisional games (the NFL
  // reseeds, so either is possible); once they're picked, each winner's line goes to its own game.
  var feedsByConf = [null, null], NFL_WIDE = matchMedia('(min-width: 1000px)');
  // Shows each game site only if it fits in full on its card.
  // Logos change the room left once they load, so check again then.
  var fitTimer = null;
  document.addEventListener('load', function (e) {
    if (!e.target.closest || !e.target.closest('.bk-where')) return;
    clearTimeout(fitTimer);
    fitTimer = setTimeout(function () { var w = document.getElementById('nfl-rounds'); if (w) fitLocs(w); }, 50);
  }, true);
  function fitLocs(root) {
    [].forEach.call(root.querySelectorAll('.bk-loc'), function (l) { l.classList.remove('cut'); });
    [].forEach.call(root.querySelectorAll('.bk-loc'), function (l) { if (l.scrollWidth > l.clientWidth + 1) l.classList.add('cut'); });
  }
  function drawLines() {
    var wrap = $('nfl-rounds');
    if (!wrap) return;
    fitLocs(wrap);
    var old = wrap.querySelector('.bk-lines');
    if (old) old.remove();
    if (!NFL_WIDE.matches || !wrap.offsetWidth) return;
    var base = wrap.getBoundingClientRect();
    var cols = [].map.call(wrap.querySelectorAll('.bk-round'), function (r) { return [].slice.call(r.querySelectorAll('.bk-game')); });
    var links = [];
    [0, 1].forEach(function (c) {
      for (var k = 0; k < 3; k++) {
        var f = feedsByConf[c];
        if (f) links.push([0, c * 3 + k, 1, c * 2 + f[k]]);
        else { links.push([0, c * 3 + k, 1, c * 2]); links.push([0, c * 3 + k, 1, c * 2 + 1]); }
      }
      links.push([1, c * 2, 2, c], [1, c * 2 + 1, 2, c], [2, c, 3, 0]);
    });
    var d = links.map(function (l) {
      var a = cols[l[0]][l[1]].getBoundingClientRect(), b = cols[l[2]][l[3]].getBoundingClientRect();
      var x1 = a.right - base.left, y1 = a.top + a.height / 2 - base.top, x2 = b.left - base.left, y2 = b.top + b.height / 2 - base.top, mx = (x1 + x2) / 2;
      return 'M' + x1 + ' ' + y1 + 'H' + mx + 'V' + y2 + 'H' + x2;
    }).join('');
    wrap.insertAdjacentHTML('afterbegin', '<svg class="bk-lines" aria-hidden="true" width="' + base.width + '" height="' + base.height + '"><path d="' + d + '"></path></svg>');
  }
  try { new ResizeObserver(function () { drawLines(); }).observe($('nfl-bracket')); } catch (x) {}
  try { NFL_WIDE.addEventListener('change', drawLines); } catch (x) {}
  function renderBracket() {
    var A = confPath('AFC'), N = confPath('NFC');
    var sb = game('sb', brand('SB', 'Super Bowl LXI'), A.champ, N.champ, function (i) { return D.teams[i].conf; }, true, air('Feb 14', ['ABC', 'ESPN']), 'Inglewood, Calif.');
    $('nfl-bk-clear').hidden = !Object.keys(st.bk).length;
    $('nfl-bk-sim').setAttribute('aria-pressed', st.bkSim ? 'true' : 'false');
    $('nfl-bk-sim').textContent = st.bkSim ? 'Show seeds only' : 'Simulate games';
    // Each round holds the AFC half above the NFC half, so every game sits beside the games feeding it.
    var cols = [[A.wc, N.wc], [A.dv, N.dv], [[A.cc], [N.cc]], [[sb]]];
    var half = function (games) { return '<div class="nfl-half">' + games.map(function (g) { return g.html; }).join('') + '</div>'; };
    $('nfl-bracket').innerHTML = '<div class="bk-rounds nfl-rounds" id="nfl-rounds">' + cols.map(function (games, k) {
      return '<section class="bk-round" aria-label="' + NFL_ROUNDS[k][0] + ', ' + NFL_ROUNDS[k][1] + '">' + '<h3>' + NFL_ROUNDS[k][0] + '<small>' + NFL_WHEN[k] + '</small></h3>' +
        '<div class="bk-games">' + games.map(half).join('') + '</div></section>';
    }).join('') + '</div>';
    feedsByConf = [A.feeds, N.feeds];
    drawLines();
  }

  // ---------- Scores ----------
  var weeks = {};
  D.games.forEach(function (g) {
    var w = weeks[g.wk] || (weeks[g.wk] = { wk: g.wk, first: g.d, last: g.d });
    if (g.d < w.first) w.first = g.d;
    if (g.d > w.last) w.last = g.d;
  });
  var weekList = Object.keys(weeks).map(function (k) { return weeks[k]; }).sort(function (a, b) { return a.wk - b.wk; });
  // The current week is the latest one under way; it stays until next week's first kickoff.
  // The Scores page's week: the week under way, moving on to the next as soon as every game of it is over
  // (final, or kicked off over 5 hours ago), e.g. Tuesday after Monday night's game.
  function currentWeek() {
    var now = new Date().toISOString(), cur = weekList[0].wk, t = Date.now();
    weekList.forEach(function (w) { if (w.first <= now) cur = w.wk; });
    var over = D.games.filter(function (g) { return g.wk === cur; }).every(function (g) { return g.s === 'post' || Date.parse(g.d) < t - 5 * 3600000; });
    var k = weekList.map(function (w) { return w.wk; }).indexOf(cur);
    return over && weekList[k + 1] ? weekList[k + 1].wk : cur;
  }
  function weekLabel(w) {
    var a = etDate(w.first, { month: 'short', day: 'numeric' }), b = etDate(w.last, { month: 'short', day: 'numeric' });
    if (a === b) return 'Week ' + w.wk + ' · ' + a;
    if (a.split(' ')[0] === b.split(' ')[0]) b = b.split(' ')[1];
    return 'Week ' + w.wk + ' · ' + a + '–' + b;
  }
  var TV_LOGO = {
    Netflix: 'https://upload.wikimedia.org/wikipedia/commons/0/08/Netflix_2015_logo.svg',
    'NFL Net': 'https://upload.wikimedia.org/wikipedia/en/8/8f/NFL_Network_logo.svg',
    CBS: 'https://upload.wikimedia.org/wikipedia/commons/4/4e/CBS_logo.svg',
    FOX: 'https://upload.wikimedia.org/wikipedia/commons/c/c0/Fox_Broadcasting_Company_logo_%282019%29.svg',
    Fox: 'https://upload.wikimedia.org/wikipedia/commons/c/c0/Fox_Broadcasting_Company_logo_%282019%29.svg', // ESPN's NFL listings spell it Fox
    NBC: 'https://upload.wikimedia.org/wikipedia/commons/3/3f/NBC_logo.svg',
    ESPN: 'https://upload.wikimedia.org/wikipedia/commons/2/2f/ESPN_wordmark.svg',
    ABC: 'https://upload.wikimedia.org/wikipedia/commons/2/2f/ABC-2021-LOGO.svg',
    Peacock: 'https://upload.wikimedia.org/wikipedia/commons/f/fb/NBCUniversal_Peacock_Logo_%282020%E2%80%932026%29.svg',
    'Prime Video': 'https://upload.wikimedia.org/wikipedia/commons/9/90/Prime_Video_logo_%282024%29.svg'
  };
  function tvBadges(names) {
    return (names || []).map(function (n) {
      if (TV_LOGO[n]) return '<img class="net-' + n.toLowerCase().replace(/[^a-z0-9]/g, '') + '" src="' + TV_LOGO[n] + '" alt="' + esc(n) + '" title="' + esc(n) + '" loading="lazy">';
      return '<span class="tv-name">' + esc(n) + '</span>';
    }).join('');
  }
  function tile(v, cls) {
    cls = cls ? ' ' + cls : '';
    return v == null ? '<div class="lg-num' + cls + '">—</div>' : '<div class="lg-cfp' + cls + '" style="--p:' + v.toFixed(3) + '">' + pct(v) + '</div>';
  }
  // Live win chance: the pre-game rating edge shrinks with the time left, and the score margin is what's
  // already banked. The game's remaining randomness scales with the square root of the time left.
  function minutesLeft(g) {
    var txt = g.clock || '', m = /(\d+):(\d+)\s*-\s*(\d)(?:st|nd|rd|th)/i.exec(txt);
    if (m) return Math.max(0, (4 - +m[3]) * 15) + +m[1] + +m[2] / 60;
    if (/half/i.test(txt)) return 30;
    var e = /end of (\d)/i.exec(txt);
    if (e) return (4 - +e[1]) * 15;
    var ot = /(\d+):(\d+)\s*-\s*OT/i.exec(txt);
    if (ot) return +ot[1] + +ot[2] / 60;
    return 30; // unknown: call it halfway
  }
  function liveHomeWin(g) {
    var mu = R.teams[g.h].rating - R.teams[g.a].rating + (g.neutral ? 0 : MODEL.hfa);
    var sd = Math.sqrt(MODEL.gameSD * MODEL.gameSD + 2 * MODEL.teamSD * MODEL.teamSD);
    var f = Math.max(minutesLeft(g), 0) / 60, margin = g.hs - g.as;
    if (f <= 0.001) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
    return phi((margin + mu * f) / (sd * Math.sqrt(f)));
  }
  // Playoff odds that follow the game: during it, weighted by the live win chance; once it's final, the
  // odds for the actual result (when the odds were built before this game ended).
  function playoffNow(g, i, pw) {
    var r = R.teams[i];
    if (r.next !== g.id || r.ifWin == null) return r.playoff;
    if (g.s === 'post') return g.hs === g.as ? r.playoff : (g.h === i) === (g.hs > g.as) ? r.ifWin : r.ifLoss;
    if (g.s === 'in') return pw * r.ifWin + (1 - pw) * r.ifLoss;
    return r.playoff;
  }
  function cardRow(g, i, score, other) {
    var t = D.teams[i], r = R.teams[i];
    var name = '<div class="lg-team">' + logo(t, 22) + '<span>' + esc(t.ab) + ' <small class="lg-rec">(' + recText(i) + ')</small></span></div>';
    if (g.s === 'pre') {
      var hw = R.homeWin[g.id], win = hw == null ? '—' : Math.round((g.h === i ? hw : 1 - hw) * 100) + '%';
      var isNext = r.next === g.id;
      return name + '<div class="lg-num">' + win + '</div>' + tile(r.playoff) + tile(isNext ? r.ifWin : null, 'lg-if') + tile(isNext ? r.ifLoss : null, 'lg-if');
    }
    var lead = '<div class="lg-score' + (score >= other ? ' lead' : '') + '">' + score + '</div>';
    if (g.s === 'in') {
      var ph = liveHomeWin(g), pw = g.h === i ? ph : 1 - ph, nx = r.next === g.id;
      return name + lead + '<div class="lg-num">' + Math.round(pw * 100) + '%</div>' + tile(playoffNow(g, i, pw)) + tile(nx ? r.ifWin : null, 'lg-if') + tile(nx ? r.ifLoss : null, 'lg-if');
    }
    return name + lead + '<div class="lg-num"></div>' + tile(playoffNow(g, i));
  }
  function card(g) {
    var isLive = g.s === 'in', isPre = g.s === 'pre';
    var tv = g.s !== 'post' ? '<span class="tv-list net-logos">' + (g.tv && g.tv.length ? tvBadges(g.tv) : '<span class="tv-name tv-tba">TV TBA</span>') + '</span>' : '';
    var wd = etDate(g.d, { weekday: 'short', month: 'short', day: 'numeric' }); // every card names its day and date
    var top = isLive ? '<span class="lg-live"><b><span class="lg-clock">' + esc(g.clock || 'In progress') + '</span></b></span>' + tv :
      isPre ? '<b class="lg-kickoff">' + wd + ', ' + etTime(g.d) + ' ET</b>' + tv :
      '<span class="lg-live"><span class="final-pill">FINAL</span></span><span class="lg-when"><span>' + wd + '</span></span>';
    return '<article class="lg' + (isLive ? ' on' : '') + '"><div class="lg-top">' + top + '</div>' +
      (isPre ? '<div class="lg-rows pre"><span></span><span class="h">Win</span><span class="h">Playoffs</span><span class="h lg-if">If win</span><span class="h lg-if">If loss</span>' :
        isLive ? '<div class="lg-rows inplay"><span></span><span class="h">Score</span><span class="h">Win</span><span class="h">Playoffs</span><span class="h lg-if">If win</span><span class="h lg-if">If loss</span>' :
        '<div class="lg-rows"><span></span><span class="h">Score</span><span class="h"></span><span class="h">Playoffs</span>') +
      cardRow(g, g.a, g.as, g.hs) + cardRow(g, g.h, g.hs, g.as) + '</div></article>';
  }
  // Sort by Playoff impact (Start time is the default): picked games first, then the swing in playoff
  // odds between a win and a loss, added up for both teams when it's their next game. Other games (finals, or
  // later in a week) go by how much is at stake instead: p(1 - p) of each team's playoff odds.
  function impact(g) {
    if (st.picks[g.id] != null) return 10;
    var swing = 0, stake = 0;
    [g.h, g.a].forEach(function (i) {
      var r = R.teams[i];
      stake += r.playoff * (1 - r.playoff);
      if (r.next === g.id && r.ifWin != null && r.ifLoss != null) swing += Math.abs(r.ifWin - r.ifLoss);
    });
    return swing ? 1 + swing : stake; // a measured swing always ranks ahead of the stake estimate
  }
  var LIVE_RANK = { in: 0, pre: 1, post: 2 }; // score lists: live games first, finals last
  var impactFrozen = null;
  // Sorts by impact the first time, then keeps that order (games going live or final and new odds don't move it).
  function frozenImpact(games, key, byTime) {
    if (!impactFrozen || impactFrozen.key !== key) {
      impactFrozen = { key: key, pos: {} };
      games.slice().sort(function (a, b) { return impact(b) - impact(a) || byTime(a, b); }).forEach(function (g, n) { impactFrozen.pos[g.id] = n; });
    }
    var pos = impactFrozen.pos;
    return games.slice().sort(function (a, b) { return LIVE_RANK[a.s] - LIVE_RANK[b.s] || (pos[a.id] == null ? 1e4 : pos[a.id]) - (pos[b.id] == null ? 1e4 : pos[b.id]) || byTime(a, b); });
  } // the Playoff impact order, kept until the sort or week changes
  function renderScores() {
    var cur = currentWeek(), sel = st.week || cur;
    $('nfl-week').innerHTML = weekList.map(function (w) {
      return '<option value="' + w.wk + '"' + (w.wk === sel ? ' selected' : '') + '>' + esc(weekLabel(w)) + (w.wk === cur ? ' (current)' : '') + '</option>';
    }).join('');
    var games = D.games.filter(function (g) { return g.wk === sel; });
    var byTime = function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; };
    var order = st.sbSort !== 'impact' ? byTime : function (a, b) { return impact(b) - impact(a) || byTime(a, b); };
    var group = function (list, title) { return list.length ? '<div class="live-group">' + (title ? '<h4>' + title + '</h4>' : '') + '<div class="live-grid">' + list.sort(order).map(card).join('') + '</div></div>' : ''; };
    // Upcoming and final games under a heading per day (Eastern), in the chosen order within each day.
    var byDay = function (list, tag) {
      var keys = [], m = {};
      list.forEach(function (g) { var k = etDate(g.d, { year: 'numeric', month: '2-digit', day: '2-digit' }); if (!m[k]) { m[k] = []; keys.push(k); } m[k].push(g); });
      return keys.sort(function (a, b) { return m[a][0].d < m[b][0].d ? -1 : 1; }).map(function (k) {
        return group(m[k], etDate(m[k][0].d, { weekday: 'long', month: 'short', day: 'numeric' }) + (tag ? ' · ' + tag : ''));
      }).join('');
    };
    var live = games.filter(function (g) { return g.s === 'in'; });
    if (st.sbSort === 'impact') {
      $('nfl-scores').innerHTML = games.length ? '<div class="live-group"><div class="live-grid">' + frozenImpact(games, sel, byTime).map(card).join('') + '</div></div>' : '<p class="live-empty">No games this week.</p>';
      return;
    }
    var html = group(live, live.length ? 'In progress' : '') + byDay(games.filter(function (g) { return g.s === 'pre'; }), '') + byDay(games.filter(function (g) { return g.s === 'post'; }), 'Final');
    $('nfl-scores').innerHTML = html || '<p class="live-empty">No games this week.</p>';
  }
  // Live scores for the chosen week straight from ESPN; odds stay as of the last build.
  var liveTimer = null, page = 'rankings';
  function refreshScores() {
    var sel = st.week || currentWeek(), now = Date.now();
    clearTimeout(liveTimer);
    var due = D.games.some(function (g) { return g.wk === sel && g.s !== 'post' && Date.parse(g.d) <= now + 10 * 60000; });
    if (!due) return;
    fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=' + sel + '&dates=' + D.season)
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
          // Newly final (and not final in the build's season): lock the result in; a pick on it no longer applies.
          if (g.s === 'post' && was !== 'post' && simById()[g.id] && simById()[g.id].s !== 'post' && auto[g.id] == null) {
            auto[g.id] = g.hs > g.as ? g.h : g.hs < g.as ? g.a : 'T'; delete st.picks[g.id]; newFinal = true;
          }
        });
        $('nfl-live-note').hidden = true;
        countRecords();
        if (newFinal) resimulate(); else { renderScores(); renderRankings(); }
      })
      .catch(function () { $('nfl-live-note').hidden = false; $('nfl-live-note').innerHTML = '<b>Couldn’t reach ESPN.</b> Showing the saved scores.'; })
      .then(function () { liveTimer = setTimeout(refreshScores, 60000); });
  }

  // ---------- Views: Rankings, Bracket and Scores, chosen by the address's # ----------
  var PAGES = { rankings: 'NFL standings and playoff odds · CFP Odds Board', playoff: 'NFL playoff bracket · CFP Odds Board', scoreboard: 'NFL scores · CFP Odds Board' };
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
  // Ratings model menus (Standings and Bracket), open-source models first.
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
    try { localStorage.setItem('nfl-mode', mode); } catch (err) {}
    BASE = data.results[mode];
    renderModes();
    st.order = null;
    resimulate();
  });

  // ---------- Picks: re-simulate the season with the picked results locked in ----------
  var PICK_SIMS = 20000, ENGINE_URL = new URL(document.querySelector('script[src*="nfl-engine.js"]').getAttribute('src'), location.href).href;
  var SIM_D = JSON.parse(JSON.stringify(D)); // the season as of the build (live score updates don't change odds)
  SIM_D.games.forEach(function (g) { if (g.s === 'in') g.s = 'pre'; });
  var cache = {}, worker = null, busy = false, simIndex = null;
  function simById() { if (!simIndex) { simIndex = {}; SIM_D.games.forEach(function (g) { simIndex[g.id] = g; }); } return simIndex; }
  function allPicks() { return Object.assign({}, auto, st.picks); }
  function picksKey() { var all = allPicks(), p = Object.keys(all).sort().map(function (k) { return k + ':' + all[k]; }).join(','); return p ? mode + '|' + p : ''; }
  // A pick shows at once; odds follow in two passes from one worker that stays open: a quick 4,000-season
  // run (about half a second), then the full 20,000. Both use the same seed, so the second only sharpens the
  // first. Rapid presses wait 150 ms so only the final pick is simulated.
  var QUICK_SIMS = 4000, simTimer = null, jobN = 0;
  function startWorker() {
    try {
      worker = new Worker(URL.createObjectURL(new Blob(['importScripts(' + JSON.stringify(ENGINE_URL) + ');\nself.onmessage=function(e){var m=e.data;postMessage({job:m.job,sims:m.sims,res:NFLSIM.simulate(m.D,m.sims,m.seed,m.picks,m.rating)});};'], { type: 'text/javascript' })));
    } catch (err) { worker = null; }
    return worker;
  }
  function runSims(job, sims, picks, done) {
    var rating = data.ratings[mode];
    if (!worker && !startWorker()) { setTimeout(function () { done(NFLSIM.simulate(SIM_D, sims, 20261108, picks, rating)); }, 20); return; }
    worker.onmessage = function (e) { if (e.data.job === job) done(e.data.res); };
    worker.onerror = function () { worker = null; setTimeout(function () { done(NFLSIM.simulate(SIM_D, sims, 20261108, picks, rating)); }, 20); };
    worker.postMessage({ job: job, D: SIM_D, sims: sims, seed: 20261108, picks: picks, rating: rating });
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
    renderPicksBar(); renderRankings(); // the box changes straight away
    $('nfl-tw').classList.add('busy');
    simTimer = setTimeout(function () {
      // A worker still busy with an older pick is replaced rather than waited on.
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
    if (b.dataset.open != null) { st.open[b.dataset.open] = !st.open[b.dataset.open]; renderRankings(); return; }
    if (b.dataset.pick) {
      // Each press cycles this team through W, L, T (tie) and blank; its opponent gets the opposite result.
      var id = b.dataset.pick, me = +b.dataset.team, g = gameById[id], opp = g.h === me ? g.a : g.h;
      if (st.picks[id] == null) st.picks[id] = me; else if (st.picks[id] === me) st.picks[id] = opp; else if (st.picks[id] === opp) st.picks[id] = 'T'; else delete st.picks[id];
      resimulate();
    } else if (b.dataset.winout != null || b.dataset.clearteam != null) {
      // Win out picks every game left as a win for this team (or, when it's on, clears them); Clear drops them.
      var team = +(b.dataset.winout != null ? b.dataset.winout : b.dataset.clearteam), ids = b.dataset.games.split(',');
      var on = b.dataset.winout != null && ids.every(function (x) { return st.picks[x] === team; });
      ids.forEach(function (x) { if (b.dataset.winout != null && !on) st.picks[x] = team; else delete st.picks[x]; });
      resimulate();
    } else if (b.dataset.bk) {
      var k = b.dataset.bk, t = +b.dataset.team, o = +b.dataset.opp;
      if (st.bk[k] !== t && st.bk[k] !== o) st.bk[k] = t; else if (st.bk[k] === t) st.bk[k] = o; else delete st.bk[k];
      renderBracket();
    } else if (b.dataset.nsort) {
      var sk = b.dataset.nsort;
      st.sort = st.sort && st.sort.k === sk ? { k: sk, dir: -st.sort.dir } : { k: sk, dir: sk === 'team' || sk === 'dv' ? 1 : -1 };
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
  $('nfl-view').addEventListener('change', function (e) { st.view = e.target.value; st.sort = null; store.set('nfl-view', st.view); renderRankings(); });
  $('nfl-sb-sort').addEventListener('change', function (e) { st.sbSort = e.target.value; impactFrozen = null; renderScores(); });
  $('nfl-week').addEventListener('change', function (e) { st.week = +e.target.value === currentWeek() ? null : +e.target.value; renderScores(); refreshScores(); });
  window.addEventListener('hashchange', function () { showPage(); window.scrollTo(0, 0); });
  // Dark and light logos differ, so redraw when the theme changes.
  new MutationObserver(renderAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll); } catch (e) {}
  renderAll();
  showPage();
})();
