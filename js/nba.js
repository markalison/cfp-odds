// NBA pages: Standings (every team's odds), Bracket (the projected play-in and playoffs) and Scores (each
// day's games, refreshed from ESPN while games are on). Odds come from nba-build.mjs. Built from js/nfl.js,
// and it reuses that page's element ids and styles.
(function () {
  'use strict';
  // R is the odds being shown: the build's for the chosen ratings model (BASE), or a fresh simulation with
  // the reader's picks.
  var data = window.NBA_DATA, D = data.D;
  // Each model's home win chances arrive as a list in schedule order; turn them into a lookup by game id.
  Object.keys(data.results).forEach(function (k) {
    var r = data.results[k], hw = {};
    (r.hw || []).forEach(function (v, i) { if (v != null) hw[D.games[i].id] = v; });
    r.homeWin = hw;
  });
  var MODES = data.models.map(function (m) { return m.k; });
  var mode = (function () { try { var m = localStorage.getItem('nba-mode'); return MODES.indexOf(m) >= 0 ? m : MODES[0]; } catch (e) { return MODES[0]; } })();
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
  // Every view shows all 30 teams: one league list, or grouped by conference or by division.
  var VIEWS = [['all', 'NBA'], ['conf', 'Conference'], ['div', 'Division']];
  var st = { open: {}, view: 'all', day: null, picks: {}, bk: {}, bkSim: false, order: null, sort: null };
  var savedView = store.get('nba-view');
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
      th('wins', '<abbr title="Projected final record: average wins over the simulated seasons">Proj.</abbr>', 'c-pw tc') +
      th('rating', '<abbr title="' + esc(modelLabel()) + ' rating: points better than an average team on a neutral field">Index</abbr>', 'c-idx tc') +
      '<th class="pick c-pick">Next</th>' +
      th('playoff', 'Playoffs', 'c-cfp', 'Chance to make the playoffs, straight in or through the play-in') +
      th('top6', 'Top 6', 'c-div sec', 'Chance to finish in the top 6 and skip the play-in') +
      th('playin', 'Play-in', 'c-bye sec', 'Chance to finish 7th to 10th and play in the play-in') +
      th('conf', 'Win conf', 'c-conf sec', 'Chance to win the conference and reach the NBA Finals') +
      th('title', 'Win title', 'c-title sec');
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
  var DIV_SHORT = { Atlantic: 'ATL', Central: 'CEN', Southeast: 'SE', Northwest: 'NW', Pacific: 'PAC', Southwest: 'SW' };
  // Projected final record over 82 games, from the average simulated wins.
  function projRec(r) { var w = Math.round(r.wins); return w + '-' + (82 - w); }
  function shaded(v) { return '<td class="sec pct-cell" style="--p:' + (v || 0).toFixed(3) + '">' + pct(v) + '</td>'; }
  // Next: the W / L / blank box with the opponent under it, as in the college table.
  function nextCell(i) {
    var id = nextOpen(i);
    if (id == null) return '<td class="pick">—</td>';
    var g = gameById[id], home = g.h === i, opp = D.teams[home ? g.a : g.h], vs = (home ? 'vs ' : '@') + opp.ab;
    var pk = st.picks[id], won = pk === i, lost = pk != null && !won;
    var label = won ? D.teams[i].short + ' ' + vs + ' picked to win. Press to pick a loss' : lost ? D.teams[i].short + ' ' + vs + ' picked to lose. Press to clear the pick' : 'No pick for ' + D.teams[i].short + ' ' + vs + '. Press to pick a win';
    return '<td class="pick"><div class="nx-cell"><div class="mini"><button type="button" class="pick-box' + (won ? ' pick-w' : lost ? ' pick-l' : '') + '" data-pick="' + esc(id) + '" data-team="' + i + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + (won ? 'W' : lost ? 'L' : '') + '</button></div>' +
      '<span class="nx-vs" aria-hidden="true">' + esc(vs) + '</span></div></td>';
  }
  // Row order: NBA and Conference by playoff odds, Division by record (then projected wins). The order is set
  // when the view is chosen or picks are cleared, and held while picks change the odds, so rows don't jump.
  function winPct(i) { var r = rec[i], g = r.w + r.l + r.t; return g ? (r.w + r.t / 2) / g : 0; }
  function sortRows(v) {
    var sk = st.sort;
    var by = sk ? function (a, b) {
      var x = sortValue(sk.k, a), y = sortValue(sk.k, b);
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sk.dir || R.teams[b].playoff - R.teams[a].playoff;
    } : v === 'div'
      ? function (a, b) { return winPct(b) - winPct(a) || R.teams[b].wins - R.teams[a].wins; }
      : function (a, b) { var x = R.teams[a], y = R.teams[b]; return y.playoff - x.playoff || y.wins - x.wins; };
    var all = D.teams.map(function (t, i) { return i; });
    var key = v === 'conf' ? 'conf' : v === 'div' ? 'div' : null;
    var names = key ? all.map(function (i) { return D.teams[i][key]; }).filter(function (n, k, arr) { return arr.indexOf(n) === k; }).sort() : [null];
    return names.map(function (n) { return { name: n, rows: all.filter(function (i) { return !key || D.teams[i][key] === n; }).sort(by) }; });
  }
  // A label row must span exactly the columns showing, or the fixed table layout adds empty columns.
  var WIDE_Q = matchMedia('(min-width: 900px)'), TABLET_Q = matchMedia('(min-width: 600px)');
  function visibleCols() { var ex = document.querySelector('#nfl-tw table.expanded'); return WIDE_Q.matches || ex ? 12 : TABLET_Q.matches ? 8 : 6; }
  [WIDE_Q, TABLET_Q].forEach(function (q) { try { q.addEventListener('change', function () { renderRankings(); }); } catch (e) {} });
  function renderRankings() {
    if (!st.order || st.order.view !== st.view) st.order = { view: st.view, groups: sortRows(st.view) };
    renderHead();
    $('nfl-body').innerHTML = st.order.groups.map(function (grp) {
      return (grp.name ? '<tr class="nfl-group"><th colspan="' + visibleCols() + '" scope="rowgroup">' + esc(grp.name) + '</th></tr>' : '') + grp.rows.map(row).join('');
    }).join('');
  }
  function row(i, k) {
    var t = D.teams[i], r = R.teams[i];
    return '<tr><td class="first c-rk">' + (k + 1) + '</td>' +
      '<td class="team-col"><div class="teamcell">' + logo(t, 30) + '<span><button class="tname" type="button" data-open="' + i + '" aria-expanded="' + !!st.open[i] + '" aria-label="' + esc(t.name) + '"><span class="tn-long">' + esc(t.name) + '</span><span class="tn-mid" aria-hidden="true">' + esc(t.short) + '</span><span class="tn-short" aria-hidden="true">' + esc(t.ab) + '</span></button></span></div></td>' +
      // Division, styled like the college table's Conf. column: "Atlantic", or "ATL" on phones.
      '<td class="l c-cn-cell"><span class="cn-long">' + esc(t.div) + '</span><span class="cn-short" aria-hidden="true">' + esc(DIV_SHORT[t.div] || t.div) + '</span></td>' +
      '<td class="num rec">' + recText(i) + '</td>' +
      '<td class="num tc pw">' + projRec(r) + '</td>' +
      '<td class="num tc">' + (r.rating > 0 ? '+' : '') + r.rating.toFixed(1) + '</td>' +
      nextCell(i) +
      '<td class="odds-cell" style="--p:' + playoffShown(i).toFixed(3) + '"><div class="odds"><span class="v">' + pct(playoffShown(i)) + '</span></div></td>' +
      shaded(r.top6) + shaded(r.playin) + shaded(r.conf) + shaded(r.title) + '</tr>' + (st.open[i] ? detail(i) : '');
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
  function detail(i) {
    var t = D.teams[i], r = R.teams[i];
    var stat = function (label, v) { return '<div><dt>' + label + '</dt><dd>' + v + '</dd></div>'; };
    var stats = '<dl class="field-stats narrow-only">' + [['Playoffs', r.playoff], ['Top 6', r.top6], ['Play-in', r.playin], ['Win conf', r.conf], ['Win title', r.title]].map(function (x) { return stat(x[0], pct(x[1])); }).join('') +
      stat('Index', (r.rating > 0 ? '+' : '') + r.rating.toFixed(1)) + '</dl>';
    var left = D.games.filter(function (g) { return (g.h === i || g.a === i) && g.s !== 'post'; }).sort(function (a, b) { return a.d < b.d ? -1 : 1; });
    var shown = left.slice(0, 12);
    var lines = shown.map(function (g) {
      var home = g.h === i, o = D.teams[home ? g.a : g.h], hw = R.homeWin[g.id], p = hw == null ? null : home ? hw : 1 - hw, pk = st.picks[g.id];
      var live = g.s === 'in' ? ' <b class="score-now">' + ((home ? g.hs - g.as : g.as - g.hs) > 0 ? 'Up ' : (home ? g.hs - g.as : g.as - g.hs) < 0 ? 'Down ' : 'Tied ') + (home ? g.hs + '-' + g.as : g.as + '-' + g.hs) + '</b>' : '';
      return '<span>' + etDate(g.d, { month: 'short', day: 'numeric' }) + ' · ' + (home ? 'vs ' : '@') + logo(o, 18) + esc(o.short) + live + '</span><span>' + (pk != null ? (pk === i ? 'Picked win' : 'Picked loss') : p == null ? '—' : Math.round(p * 100) + '%') + '</span>';
    }).join('') + (left.length > shown.length ? '<span class="sched-more">and ' + (left.length - shown.length) + ' more</span><span></span>' : '');
    var split = function (label, v) { return '<tr><th scope="row">' + label + '</th><td>' + pct(v) + '</td><td>' + pct(v == null ? null : 1 - v) + '</td></tr>'; };
    var seeds = (r.seeds || []).slice(0, 15), maxS = Math.max.apply(null, seeds.concat(0.0001));
    var bars = seeds.map(function (v, k) { var lab = 'Seed ' + (k + 1) + ': ' + (v * 100).toFixed(1) + '% of simulations'; return '<div title="' + lab + '" aria-label="' + lab + '"><i style="height:' + (v / maxS * 100).toFixed(1) + '%"></i></div>'; }).join('');
    var xs = seeds.map(function (_, k) { return '<span>' + (k + 1) + '</span>'; }).join('');
    return '<tr class="detail"><td colspan="' + visibleCols() + '">' + stats + '<div class="detail-inner">' +
      '<div><h3>Next games (chance to win)</h3><div class="sched">' + (lines || '<span>No games left</span><span></span>') + '</div></div>' +
      '<div><h3>What moves the odds</h3>' + '<dl class="kv"><dt>Make playoffs</dt><dd>' + pct(r.playoff) + '</dd><dt>If they win next game</dt><dd>' + pct(r.ifWin) + '</dd><dt>If they lose next game</dt><dd>' + pct(r.ifLoss) + '</dd><dt>Projected record</dt><dd>' + projRec(r) + '</dd></dl></div>' +
      '<div><h3>Seed, % of all simulations</h3><div class="hist" role="img" aria-label="Chance of each seed for ' + esc(t.name) + '">' + bars + '</div><div class="hist-x">' + xs + '</div></div>' +
    '</div></td></tr>';
  }
  function renderPicksBar() {
    var n = Object.keys(st.picks).length;
    $('nfl-picks-bar').innerHTML = busy ? '<span><b>Simulating…</b> Updating every team’s odds for your picks.</span>' : n
      ? '<span><b>' + n + (n === 1 ? ' game' : ' games') + ' picked.</b> All odds assume ' + (n === 1 ? 'that result' : 'those results') + '.</span><button class="btn" id="nfl-clear" type="button">Clear picks</button>'
      : '<span>Press a team’s box to cycle its next game through <b>W</b>, <b>L</b> and blank. Its opponent gets the opposite result, and all odds update.</span>';
  }
  var played = D.games.filter(function (g) { return g.s === 'post'; }).length;
  $('nfl-note').textContent = (D.season - 1) + '–' + String(D.season).slice(2) + ' season · ' + played + ' of ' + D.games.length + ' games played · updated ' +
    new Date(D.asOf).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';

  // ---------- Bracket: the likeliest field ----------
  // Each conference's ten likeliest teams by average seed: 1-6 straight in, 7-10 to the play-in.
  function avgSeed(i) { var s = R.teams[i].seeds, w = 0; for (var k = 0; k < s.length; k++) w += (k + 1) * s[k]; return w; }
  function confTeams(conf) { return D.teams.map(function (t, i) { return i; }).filter(function (i) { return D.teams[i].conf === conf; }); }
  function projectedField(conf) {
    return confTeams(conf).sort(function (a, b) { return (R.teams[b].playoff + R.teams[b].playin) - (R.teams[a].playoff + R.teams[a].playin); })
      .slice(0, 10).sort(function (a, b) { return avgSeed(a) - avgSeed(b); });
  }
  // One game's win chance from the two ratings, as in the season simulation; a series is best of 7 with the
  // better seed home in games 1, 2, 5 and 7.
  var MODEL = R.model || { hfa: 2.2, gameSD: 12, teamSD: 2.6 };
  function phi(x) { var t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
  function gameSd() { return Math.sqrt(MODEL.gameSD * MODEL.gameSD + 2 * MODEL.teamSD * MODEL.teamSD); }
  function winChance(h, a, neutral) { return phi((R.teams[h].rating - R.teams[a].rating + (neutral ? 0 : MODEL.hfa)) / gameSd()); }
  function seriesChance(hi, lo) {
    var gap = R.teams[hi].rating - R.teams[lo].rating, pH = phi((gap + MODEL.hfa) / gameSd()), pA = phi((gap - MODEL.hfa) / gameSd()), HOME = [1, 1, 0, 0, 1, 0, 1], win = 0;
    (function go(a, b, k, p) { if (a === 4) { win += p; return; } if (b === 4) return; var q = HOME[k] ? pH : pA; go(a + 1, b, k + 1, p * q); go(a, b + 1, k + 1, p * (1 - q)); })(0, 0, 0, 1);
    return win;
  }
  function bkRow(key, i, opp, seed, p, won, pk, ph) {
    if (i == null) return '<div class="bk-team tbd">' + (ph ? '<span class="bk-name"><small>' + esc(ph) + '</small></span>' : '') + '</div>';
    var t = D.teams[i], mine = pk === i, theirs = pk === opp;
    if (opp == null) return '<div class="bk-team"><span class="bk-seed">' + seed + '</span>' + logo(t, 22) + '<span class="bk-name"><span class="bk-nm">' + esc(t.short) + '</span><span class="bk-ab">' + esc(t.ab) + '</span> <small class="lg-rec">(' + recText(i) + ')</small></span><span class="bk-p"></span></div>';
    var label = mine ? t.short + ' picked to win. Press to pick ' + D.teams[opp].short : theirs ? D.teams[opp].short + ' picked. Press to clear the pick' : 'Press to pick ' + t.short + ' to win';
    return '<button type="button" class="bk-team picks' + (won ? ' win' : won === false ? ' lose' : '') + '" data-bk="' + key + '" data-team="' + i + '" data-opp="' + opp + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
      '<span class="bk-seed">' + seed + '</span>' + logo(t, 22) +
      '<span class="bk-name"><span class="bk-nm">' + esc(t.short) + '</span><span class="bk-ab">' + esc(t.ab) + '</span> <small class="lg-rec">(' + recText(i) + ')</small></span>' +
      '<span class="bk-p">' + (p == null ? '' : pct(p)) + '</span>' +
      '<span class="mini"><span class="pick-box' + (mine ? ' pick-w' : theirs ? ' pick-l' : '') + '" aria-hidden="true">' + (mine ? 'W' : theirs ? 'L' : '') + '</span></span></button>';
  }
  // 2026-27 postseason (NBA): play-in April 13-16, 2027; playoffs from April 17; NBA Finals in June.
  var NBA_LOGO = 'https://upload.wikimedia.org/wikipedia/en/0/03/National_Basketball_Association_logo.svg';
  var FINALS_LOGO = 'https://upload.wikimedia.org/wikipedia/commons/0/09/The_NBA_Finals_logo.svg';
  function label(c, text) { return '<span class="bk-title">' + esc(c + ' · ' + text) + '</span>'; }
  function air(when) { return '<b>' + when + '</b>'; }
  // A game or series card: the better seed on top. The bracket starts blank: a slot is decided only by the
  // reader's pick, or by the favorite with Simulate games on. Chances show once it's picked or simulated.
  function game(key, lab, h, a, seedOf, isSeries, when, neutral, ph) {
    ph = ph || [];
    var both = h != null && a != null;
    var p = both ? (isSeries ? seriesChance(h, a) : winChance(h, a, neutral)) : null, pk = both && (st.bk[key] === h || st.bk[key] === a) ? st.bk[key] : null;
    var w = pk != null ? pk : both && st.bkSim ? (p >= 0.5 ? h : a) : null;
    var show = w != null ? p : null;
    return { winner: w, loser: w == null ? null : w === h ? a : h, html: '<div class="bk-game"><div class="bk-where"><span class="bk-place">' + lab + '</span>' + (when ? '<span class="bk-air">' + air(when) + '</span>' : '') + '</div>' +
      bkRow(key, h, a, h == null ? '' : seedOf(h), show, w == null ? null : w === h, pk, ph[0]) + bkRow(key, a, h, a == null ? '' : seedOf(a), show == null ? null : 1 - show, w == null ? null : w === a, pk, ph[1]) + '</div>' };
  }
  // Play-in: 7 hosts 8 (winner is the 7 seed); 9 hosts 10; the 7/8 loser hosts the 9/10 winner for the 8
  // seed. Then 1v8, 4v5, 3v6, 2v7, with the better seed holding home court every round.
  function confPath(c) {
    var f = projectedField(c), seedOf = function (i) { return f.indexOf(i) + 1; };
    var hiLo = function (x, y) { return x == null || y == null ? [x, y] : seedOf(x) < seedOf(y) ? [x, y] : [y, x]; };
    var p910 = game(c + '-p910', label(c, 'Play-In'), f[8], f[9], seedOf, false, 'Apr 13–16');
    var p78 = game(c + '-p78', label(c, 'Play-In'), f[6], f[7], seedOf, false, 'Apr 13–16');
    var p8 = game(c + '-p8', label(c, 'Play-In'), p78.loser, p910.winner, seedOf, false, 'Apr 13–16', false, ['Loser of 7 vs 8', 'Winner of 9 vs 10']);
    var s7 = p78.winner, s8 = p8.winner;
    var r1 = [[f[0], s8], [f[3], f[4]], [f[2], f[5]], [f[1], s7]].map(function (m, k) { return game(c + '-r1' + k, label(c, 'First Round'), m[0], m[1], seedOf, true, 'From Apr 17'); });
    var sfPair = function (k, x, y) { var o = hiLo(x, y); return game(c + '-sf' + k, label(c, 'Semifinals'), o[0], o[1], seedOf, true, 'Late Apr–May'); };
    var sf = [sfPair(0, r1[0].winner, r1[1].winner), sfPair(1, r1[2].winner, r1[3].winner)];
    var o = hiLo(sf[0].winner, sf[1].winner);
    var cf = game(c + '-cf', label(c, 'Finals'), o[0], o[1], seedOf, true, 'May');
    return { pin: [p910, p8, p78], r1: r1, sf: sf, cf: cf, champ: cf.winner };
  }
  var NBA_ROUNDS = ['Play-In', 'First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'];
  var NBA_WIDE = matchMedia('(min-width: 1000px)');
  // Connector lines on wide screens, as on the other brackets: the play-in's 8-seed game feeds 1v8 and its
  // 7/8 game feeds 2v7; each pair of series feeds the next round.
  function drawLines() {
    var wrap = $('nfl-rounds');
    if (!wrap) return;
    var old = wrap.querySelector('.bk-lines');
    if (old) old.remove();
    if (!NBA_WIDE.matches || !wrap.offsetWidth) return;
    var base = wrap.getBoundingClientRect();
    var cols = [].map.call(wrap.querySelectorAll('.bk-round'), function (r) { return [].slice.call(r.querySelectorAll('.bk-game')); });
    var links = [];
    [0, 1].forEach(function (c) {
      links.push([0, c * 3 + 1, 1, c * 4], [0, c * 3 + 2, 1, c * 4 + 3]);
      links.push([1, c * 4, 2, c * 2], [1, c * 4 + 1, 2, c * 2], [1, c * 4 + 2, 2, c * 2 + 1], [1, c * 4 + 3, 2, c * 2 + 1]);
      links.push([2, c * 2, 3, c], [2, c * 2 + 1, 3, c], [3, c, 4, 0]);
    });
    var d = links.map(function (l) {
      var a = cols[l[0]][l[1]].getBoundingClientRect(), b = cols[l[2]][l[3]].getBoundingClientRect();
      var x1 = a.right - base.left, y1 = a.top + a.height / 2 - base.top, x2 = b.left - base.left, y2 = b.top + b.height / 2 - base.top, mx = (x1 + x2) / 2;
      return 'M' + x1 + ' ' + y1 + 'H' + mx + 'V' + y2 + 'H' + x2;
    }).join('');
    wrap.insertAdjacentHTML('afterbegin', '<svg class="bk-lines" aria-hidden="true" width="' + base.width + '" height="' + base.height + '"><path d="' + d + '"></path></svg>');
  }
  try { new ResizeObserver(function () { drawLines(); }).observe($('nfl-bracket')); } catch (x) {}
  try { NBA_WIDE.addEventListener('change', drawLines); } catch (x) {}
  function renderBracket() {
    var E = confPath('East'), W = confPath('West');
    // The NBA Finals: the better projected record has home court.
    var fx = E.champ, fy = W.champ, top = fx != null && fy != null && R.teams[fy].wins > R.teams[fx].wins ? [fy, fx] : [fx, fy];
    var fin = game('fin', '<img class="bk-conf bk-big bk-nbaf" src="' + FINALS_LOGO + '" alt="" loading="lazy"><span class="bk-title">NBA Finals</span>', top[0], top[1], function (i) { return D.teams[i].conf.charAt(0); }, true, 'June');
    $('nfl-bk-clear').hidden = !Object.keys(st.bk).length;
    $('nfl-bk-sim').setAttribute('aria-pressed', st.bkSim ? 'true' : 'false');
    $('nfl-bk-sim').textContent = st.bkSim ? 'Show seeds only' : 'Simulate games';
    var cols = [[E.pin, W.pin], [E.r1, W.r1], [E.sf, W.sf], [[E.cf], [W.cf]], [[fin]]];
    var half = function (games) { return '<div class="nfl-half">' + games.map(function (g) { return g.html; }).join('') + '</div>'; };
    $('nfl-bracket').innerHTML = '<div class="bk-rounds nfl-rounds nba-rounds" id="nfl-rounds">' + cols.map(function (games, k) {
      return '<section class="bk-round" aria-label="' + NBA_ROUNDS[k] + '"><div class="bk-games">' + games.map(half).join('') + '</div></section>';
    }).join('') + '</div>';
    drawLines();
  }

  // ---------- Scores ----------
  // Days with games (Eastern time). The current day is the latest one under way; it stays until the next
  // day's first tipoff.
  function etDay(iso) { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); }
  var days = {};
  D.games.forEach(function (g) { var k = etDay(g.d); var x = days[k] || (days[k] = { day: k, first: g.d }); if (g.d < x.first) x.first = g.d; g.day = k; });
  var dayList = Object.keys(days).sort().map(function (k) { return days[k]; });
  function currentDay() {
    var now = new Date().toISOString(), cur = dayList[0].day;
    dayList.forEach(function (x) { if (x.first <= now) cur = x.day; });
    return cur;
  }
  function dayLabel(x) { return new Date(x.day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); }
  var TV_LOGO = {
    CBS: 'https://upload.wikimedia.org/wikipedia/commons/4/4e/CBS_logo.svg',
    FOX: 'https://upload.wikimedia.org/wikipedia/commons/c/c0/Fox_Broadcasting_Company_logo_%282019%29.svg',
    NBC: 'https://upload.wikimedia.org/wikipedia/commons/3/3f/NBC_logo.svg',
    ESPN: 'https://upload.wikimedia.org/wikipedia/commons/2/2f/ESPN_wordmark.svg',
    ABC: 'https://upload.wikimedia.org/wikipedia/commons/2/2f/ABC-2021-LOGO.svg',
    Peacock: 'https://upload.wikimedia.org/wikipedia/commons/f/fb/NBCUniversal_Peacock_Logo_%282020%E2%80%932026%29.svg'
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
    if (m) return Math.max(0, (4 - +m[3]) * 12) + +m[1] + +m[2] / 60;
    if (/half/i.test(txt)) return 24;
    var e = /end of (\d)/i.exec(txt);
    if (e) return Math.max(0, (4 - +e[1]) * 12);
    var ot = /(\d+):(\d+)\s*-\s*\d*OT/i.exec(txt);
    if (ot) return +ot[1] + +ot[2] / 60;
    return 24; // unknown: call it halfway
  }
  function liveHomeWin(g) {
    var mu = R.teams[g.h].rating - R.teams[g.a].rating + (g.neutral ? 0 : MODEL.hfa);
    var sd = Math.sqrt(MODEL.gameSD * MODEL.gameSD + 2 * MODEL.teamSD * MODEL.teamSD);
    var f = Math.max(minutesLeft(g), 0) / 48, margin = g.hs - g.as;
    if (f <= 0.001) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
    return phi((margin + mu * f) / (sd * Math.sqrt(f)));
  }
  // Playoff odds that follow the game: during it, weighted by the live win chance; once it's final, the
  // odds for the actual result (when the odds were built before this game ended).
  function playoffNow(g, i, pw) {
    var r = R.teams[i];
    if (r.next !== g.id || r.ifWin == null) return r.playoff;
    if (g.s === 'post') return (g.h === i) === (g.hs > g.as) ? r.ifWin : r.ifLoss;
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
    var tv = g.tv && g.tv.length && g.s !== 'post' ? '<span class="tv-list net-logos">' + tvBadges(g.tv) + '</span>' : '';
    var top = isLive ? '<span class="lg-live"><b>' + esc(g.clock || 'In progress') + '</b></span>' + tv :
      isPre ? '<b class="lg-kickoff">' + etTime(g.d) + ' ET</b>' + tv :
      '<span class="lg-live"><span class="final-pill">FINAL</span></span><span class="lg-when"><span>' + etDate(g.d, { weekday: 'short' }) + '</span></span>';
    return '<article class="lg' + (isLive ? ' on' : '') + '"><div class="lg-top">' + top + '</div>' +
      (isPre ? '<div class="lg-rows pre"><span></span><span class="h">Win</span><span class="h">Playoffs</span><span class="h lg-if">If win</span><span class="h lg-if">If loss</span>' :
        isLive ? '<div class="lg-rows inplay"><span></span><span class="h">Score</span><span class="h">Win</span><span class="h">Playoffs</span><span class="h lg-if">If win</span><span class="h lg-if">If loss</span>' :
        '<div class="lg-rows"><span></span><span class="h">Score</span><span class="h"></span><span class="h">Playoffs</span>') +
      cardRow(g, g.a, g.as, g.hs) + cardRow(g, g.h, g.hs, g.as) + '</div></article>';
  }
  function renderScores() {
    var cur = currentDay(), sel = st.day || cur;
    $('nfl-week').innerHTML = dayList.map(function (x) {
      return '<option value="' + x.day + '"' + (x.day === sel ? ' selected' : '') + '>' + esc(dayLabel(x)) + (x.day === cur ? ' (today)' : '') + '</option>';
    }).join('');
    var games = D.games.filter(function (g) { return g.day === sel; });
    var byTime = function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; };
    var group = function (list) { return list.length ? '<div class="live-group"><div class="live-grid">' + list.sort(byTime).map(card).join('') + '</div></div>' : ''; };
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
    fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=' + sel.replace(/-/g, ''))
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

  // ---------- Views: Rankings, Bracket and Scores, chosen by the address's # ----------
  var PAGES = { rankings: 'NBA standings and playoff odds · CFP Odds Board', playoff: 'NBA playoff bracket · CFP Odds Board', scoreboard: 'NBA scores · CFP Odds Board' };
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
    try { localStorage.setItem('nba-mode', mode); } catch (err) {}
    BASE = data.results[mode];
    renderModes();
    st.order = null;
    resimulate();
  });

  // ---------- Picks: re-simulate the season with the picked results locked in ----------
  var PICK_SIMS = 20000, ENGINE_URL = new URL(document.querySelector('script[src*="nba-engine.js"]').getAttribute('src'), location.href).href;
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
      worker = new Worker(URL.createObjectURL(new Blob(['importScripts(' + JSON.stringify(ENGINE_URL) + ');\nself.onmessage=function(e){var m=e.data;postMessage({job:m.job,sims:m.sims,res:NBASIM.simulate(m.D,m.sims,m.seed,m.picks,m.rating)});};'], { type: 'text/javascript' })));
    } catch (err) { worker = null; }
    return worker;
  }
  function runSims(job, sims, picks, done) {
    var rating = data.ratings[mode];
    if (!worker && !startWorker()) { setTimeout(function () { done(NBASIM.simulate(SIM_D, sims, 20270411, picks, rating)); }, 20); return; }
    worker.onmessage = function (e) { if (e.data.job === job) done(e.data.res); };
    worker.onerror = function () { worker = null; setTimeout(function () { done(NBASIM.simulate(SIM_D, sims, 20270411, picks, rating)); }, 20); };
    worker.postMessage({ job: job, D: SIM_D, sims: sims, seed: 20270411, picks: picks, rating: rating });
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
      // Each press cycles this team through W, L and blank; its opponent gets the opposite result.
      var id = b.dataset.pick, me = +b.dataset.team, g = gameById[id], opp = g.h === me ? g.a : g.h;
      if (st.picks[id] == null) st.picks[id] = me; else if (st.picks[id] === me) st.picks[id] = opp; else delete st.picks[id];
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
  $('nfl-view').addEventListener('change', function (e) { st.view = e.target.value; st.sort = null; store.set('nba-view', st.view); renderRankings(); });
  $('nfl-week').addEventListener('change', function (e) { st.day = e.target.value === currentDay() ? null : e.target.value; renderScores(); refreshScores(); });
  window.addEventListener('hashchange', function () { showPage(); window.scrollTo(0, 0); });
  // Dark and light logos differ, so redraw when the theme changes.
  new MutationObserver(renderAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll); } catch (e) {}
  renderAll();
  showPage();
})();
