// Odds and Scoreboard views: simulation runs, live ESPN updates and rendering.
(function () {
  'use strict';
  // data.js sets CFP_DATA: teams, games, ratings and the default simulation.
  var embedded = window.CFP_DATA;
  // 40,000 seasons gives about +/-0.5 points at 50% odds in roughly a second. More adds wait for little precision.
  var SIMS = 40000;
  var D = embedded.D, results = embedded.results, simsNote = {};
  var st = { mode: 'blend', picks: {}, bkPicks: {}, sort: 'team', dir: 1, open: {}, conf: '', view: 'all', q: '', live: 'pending', running: false };
  var schedCache = {}, worker = null;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  function isDark() { return /dark/.test(getComputedStyle(document.documentElement).colorScheme); }
  // ESPN's logo CDN. If an image fails, the error listener below swaps in a team-color dot.
  function logo(t, px) {
    var color = t.color ? '#' + t.color : 'var(--muted)', size = px * 3;
    return '<img class="logo" alt="" width="' + px + '" height="' + px + '" data-color="' + esc(color) + '" src="https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/' + (isDark() ? '500-dark' : '500') + '/' + encodeURIComponent(t.id) + '.png&amp;h=' + size + '&amp;w=' + size + '">';
  }
  document.addEventListener('error', function (e) {
    var el = e.target;
    if (!el || el.tagName !== 'IMG' || !el.classList.contains('logo')) return;
    var dot = document.createElement('span');
    dot.className = 'chip logo';
    dot.style.background = el.dataset.color;
    el.replaceWith(dot);
  }, true);

  function pct(v, sims) {
    if (v == null) return '—';
    if (v <= 0.0005) return '<0.1%';
    if (v >= 0.9995) return '>99.9%';
    return (v * 100).toFixed(v >= 0.1 && v < 0.9 ? 0 : 1) + '%';
    void sims;
  }
  var pickResults = {}, lastRes = results[st.mode], jobId = 0, pickTimer = null;
  function hasPicks() { return Object.keys(st.picks).length > 0; }
  function picksKey() {
    return st.mode + JSON.stringify(Object.keys(st.picks).sort().map(function (k) { return [k, st.picks[k]]; }));
  }
  // While a new run is in progress, the last finished results stay on screen.
  function res() {
    var r = hasPicks() ? pickResults[picksKey()] : results[st.mode];
    if (r) lastRes = r;
    return lastRes;
  }
  function schedule() {
    if (!schedCache[st.mode]) schedCache[st.mode] = CFP.nextGames(CFP.prep(D, st.mode));
    return schedCache[st.mode];
  }
  function record(i) {
    var w = 0, l = 0, cw = 0, cl = 0;
    D.games.forEach(function (g) {
      if (g.s !== 'post' || (g.h !== i && g.a !== i)) return;
      var won = g.w === i;
      if (won) w++; else l++;
      if (g.c) { if (won) cw++; else cl++; }
    });
    return { w: w, l: l, cw: cw, cl: cl, text: w + '-' + l };
  }
  function buildRows() {
    var R = res(), sc = schedule(), rows = [];
    // Each team's place among all FBS teams in the selected model's ratings, 1 = highest.
    var order = R.rating.map(function (v, i) { return i; }).sort(function (a, b) { return R.rating[b] - R.rating[a]; });
    var modelRank = []; order.forEach(function (i, n) { modelRank[i] = n + 1; });
    for (var i = 0; i < D.fbs; i++) {
      var t = D.teams[i], r = R.teams[i], next = sc[i][0] || null;
      rows.push({ i: i, t: t, r: r, rec: record(i), index: CFP.ratingFor(t, st.mode, D.sources), next: next, rating: R.rating[i], modelRank: modelRank[i], base: results[st.mode] && results[st.mode].teams[i] });
    }
    return rows;
  }
  var COLS = {
    team: function (x) { return x.t.rank || 200 - x.r.cfp; }, rating: function (x) { return x.modelRank; }, next: function (x) { return x.r.pNext == null ? -1 : x.r.pNext; },
    cfp: function (x) { return x.r.cfp; }, bye: function (x) { return x.r.bye; }, champ: function (x) { return x.r.champ; },
    seed: function (x) { return x.r.seed == null ? 99 : x.r.seed; }, title: function (x) { return x.r.title; },
    rec: function (x) { var n = x.rec.w + x.rec.l; return (n ? x.rec.w / n : 0) + x.rec.w / 1000; }, index: function (x) { return x.index; }
  };
  // Notre Dame sits with the power conferences and UConn with the Group of 6.
  // Power 4 includes Notre Dame; Group of 6 is everyone else, UConn included.
  function inGroup(t, group) {
    if (!group || group === 'all') return true;
    var power = CFP.P4.indexOf(t.conf) >= 0 || t.ab === 'ND';
    return group === 'p4' ? power : !power;
  }
  function inView(t) { return inGroup(t, st.view); }
  var GROUP_NAME = { p4: 'Power 4', g5: 'Group of 6' };
  // The Conference dropdowns: team groups first, then each conference. Groups are stored as "group:p4".
  function confOptions(selected) {
    var confs = {};
    for (var i = 0; i < D.fbs; i++) confs[D.teams[i].conf] = 1;
    function option(v, label) { return '<option value="' + v + '"' + (selected === v ? ' selected' : '') + '>' + esc(label) + '</option>'; }
    return '<optgroup label="Teams">' + option('', 'FBS') + option('group:p4', 'Power 4') + option('group:g5', 'Group of 6') + '</optgroup>' +
      '<optgroup label="Conferences">' + Object.keys(confs).sort(function (a, b) { return (CFP.CONF_NAME[a] || a) < (CFP.CONF_NAME[b] || b) ? -1 : 1; }).map(function (c) { return option(c, CFP.CONF_NAME[c] || c); }).join('') + '</optgroup>';
  }
  function renderScoreboardControls() { $('sb-conf').innerHTML = confOptions(st.sbConf || ''); }
  function renderViewControls() { $('conf').innerHTML = confOptions(st.view !== 'all' ? 'group:' + st.view : st.conf); }
  function visible(rows) {
    var q = st.q.trim().toLowerCase();
    var out = rows.filter(function (x) {
      if (!inView(x.t)) return false;
      if (st.conf && x.t.conf !== st.conf) return false;
      return !q || (x.t.full + ' ' + x.t.ab).toLowerCase().indexOf(q) >= 0;
    });
    // After a W/L pick the rows keep the order they had, so the team just picked doesn't jump away.
    if (st.lockOrder) {
      var pos = st.lockOrder;
      out.sort(function (a, b) { return (pos[a.t.id] == null ? 1e4 : pos[a.t.id]) - (pos[b.t.id] == null ? 1e4 : pos[b.t.id]); });
      return out;
    }
    return sortRows(out);
  }
  function sortRows(rows) {
    if (st.sort === 'conf') {
      var name = function (x) { return CFP.CONF_NAME[x.t.conf] || x.t.conf; };
      return rows.sort(function (a, b) { return st.dir * name(a).localeCompare(name(b)) || b.r.cfp - a.r.cfp; });
    }
    var f = COLS[st.sort], d = st.dir;
    return rows.sort(function (a, b) { return d * (f(a) - f(b)) || b.r.cfp - a.r.cfp; });
  }
  // Remembers the current order of every team. Cleared by sorting, changing ratings or clearing picks.
  function lockOrder() {
    if (st.lockOrder) return;
    st.lockOrder = {};
    sortRows(buildRows()).forEach(function (x, i) { st.lockOrder[x.t.id] = i; });
  }
  function head() {
    function th(key, label, cls) {
      var s = st.sort === key ? (st.dir < 0 ? 'descending' : 'ascending') : 'none';
      return '<th class="' + (cls || '') + '" aria-sort="' + s + '"><button type="button" data-sort="' + key + '">' + label + '</button>';
    }
    // Fixed column widths live on these header classes. Columns marked sec are hidden on phones.
    $('head').innerHTML =
      th('team', '<abbr title="College Football Playoff committee ranking">RK</abbr>', 'first c-rk') + '</th>' +
      '<th class="l c-team team-col">Team</th>' +
      th('conf', 'Conf.', 'l c-cn') + '</th>' +
      th('rec', 'Rec', 'c-rec') + '</th>' +
      th('index', '<abbr title="' + esc(modeName()) + ' rating as last published">Index</abbr>', 'c-idx tc') + '</th>' +
      '<th class="pick c-pick">Next</th>' +
      th('cfp', 'Make CFP', 'c-cfp') + '</th>' +
      th('bye', '1st rd bye', 'c-bye sec') + '</th>' +
      th('champ', 'Win conf.', 'c-conf sec') + '</th>' +
      th('title', 'Win title', 'c-title sec') + '</th>';
  }
  function nextChance(g, t) {
    var pk = st.picks[g.id];
    if (!pk) return Math.round(g.p * 100) + '% to win';
    return '<b>' + (pk === t.id ? 'picked to win' : 'picked to lose') + '</b>';
  }
  // A live game as a small scoreboard: away team and score on the left, home score and team on the right.
  // The row's own team is bold, and so is the leading score.
  var gameIndex = { D: null, byId: {} };
  function gameById(id) {
    if (gameIndex.D !== D) { gameIndex = { D: D, byId: {} }; D.games.forEach(function (g) { gameIndex.byId[g.id] = g; }); }
    return gameIndex.byId[id];
  }
  // The current week: the ESPN week of the most recent kickoff, so today's finals still count as this week.
  var weekIndex = { D: null, at: 0, wk: null, byTeam: {} };
  function weekGames() {
    var now = Date.now();
    if (weekIndex.D !== D || now - weekIndex.at > 60000) {
      var started = D.games.filter(function (g) { return g.wk != null && Date.parse(g.d) <= now; });
      var wk = started.length ? Math.max.apply(null, started.map(function (g) { return g.wk; })) : Math.min.apply(null, D.games.map(function (g) { return g.wk || 99; }));
      // Each team's games by week, and the week of its next game that hasn't kicked off.
      var byWeek = {}, nextPre = {};
      D.games.forEach(function (g) {
        if (g.wk == null) return;
        [g.h, g.a].forEach(function (i) {
          (byWeek[i] = byWeek[i] || {})[g.wk] = g;
          if (g.s === 'pre' && (nextPre[i] == null || g.wk < nextPre[i])) nextPre[i] = g.wk;
        });
      });
      weekIndex = { D: D, at: now, wk: wk, byWeek: byWeek, nextPre: nextPre };
    }
    return weekIndex;
  }
  // Each team moves on to a new week when its own game that week kicks off, so a Tuesday MAC game doesn't
  // move everyone else. Until then its week is the one before its next game (no later than the current week).
  function teamWeek(x) {
    var W = weekGames(), n = W.nextPre[x.i];
    return n == null ? W.wk : Math.min(W.wk, n - 1);
  }
  function weekGame(x, wk) { var m = weekGames().byWeek[x.i]; return (m && m[wk]) || null; }
  function thisWeek(x) { return weekGame(x, teamWeek(x)); }
  // ESPN writes the clock as '12:00 - 2nd'; show it without the hyphen, '12:00 2nd'. Halftime and the like pass through.
  function clock(g) { var m = /^\s*(\d+:\d+)\s*-\s*(.+)$/.exec(g.st || ''); return m ? m[1] + ' ' + m[2] : g.st || ''; }
  function shortDay(d) { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }); }
  // "at ND" or "vs ND" for team i's side of a game.
  function matchup(g, i) { var opp = D.teams[g.h === i ? g.a : g.h]; return (g.n || g.h === i ? 'vs ' : 'at ') + esc(opp.ab || opp.name); }
  // A stacked scoreboard: away team over home team. The team ahead (or the winner) is bold.
  function stackRows(g) {
    var played = g.s !== 'pre';
    function line(t, n, other) {
      return '<span class="ss-r' + (played && n > other ? ' lead' : '') + '"><span class="ss-t">' + esc(t.ab || t.name) + '</span><span class="ss-s">' + (played ? n : '') + '</span></span>';
    }
    return line(D.teams[g.a], g.as, g.hs) + line(D.teams[g.h], g.hs, g.as);
  }
  function scoreLabel(g) {
    var away = D.teams[g.a], home = D.teams[g.h];
    return g.s === 'pre' ? away.name + ' at ' + home.name : away.name + ' ' + g.as + ', ' + home.name + ' ' + g.hs;
  }
  // This week's game: the final score, the live score with the clock, or the matchup to come with its date.
  function nextCell(x) {
    var g = thisWeek(x);
    if (!g) return '<span class="next">Bye week</span>';
    var isNext = x.next && x.next.id === g.id;
    var info = g.s === 'post' ? '' : (g.s === 'in' ? esc(clock(g)) : shortDay(g.d)) + (isNext ? ' · ' + nextChance(x.next, x.t) : '');
    return '<span class="next"><span class="ss" role="img" aria-label="' + esc(scoreLabel(g)) + '">' + stackRows(g) + '</span>' + (info ? '<small>' + info + '</small>' : '') + '</span>';
  }

  // The headline numbers for one team. The field panel always shows them; table details show them on phones.
  function statsList(x, cls) {
    var R = x.r;
    function stat(label, value) { return '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>'; }
    return '<dl class="field-stats' + (cls ? ' ' + cls : '') + '">' +
      stat('Make CFP', pct(R.cfp)) +
      stat('First-round bye', pct(R.bye)) +
      stat('Avg seed', R.seed ? R.seed.toFixed(1) : '—') +
      stat('Win conf.', x.t.conf === 'ind' ? '—' : pct(R.champ)) +
      stat('Win title', pct(R.title)) +
      stat('Rating', x.rating.toFixed(1)) +
    '</dl>';
  }
  // The Next column: the week after This week. It names the opponent and has a W/L box for that game.
  // A team with no game that week shows "Bye" with nothing to press. After the regular season's last
  // week it falls back to the team's next scheduled game (a title game), or a dash.
  function nextWeekGame(x) {
    var wk = teamWeek(x) + 1;
    if (!D.games.some(function (g) { return g.wk === wk; })) {
      var tw = thisWeek(x), g = x.next ? gameById(x.next.id) : null;
      return g && (!tw || tw.id !== g.id) ? g : null;
    }
    return weekGame(x, wk) || 'bye';
  }
  function pickCell(x) {
    var g = nextWeekGame(x);
    if (g === 'bye') return '<div class="nx-cell"><span class="pick-bye">Bye</span></div>';
    if (!g || g.s === 'post') return '\u2014';
    var opp = D.teams[g.h === x.i ? g.a : g.h], vs = matchup(g, x.i);
    var pk = st.picks[g.id], won = pk === x.t.id, lost = !!pk && !won;
    var label = won ? x.t.name + ' ' + vs + ' picked to win. Press to pick a loss' : lost ? x.t.name + ' ' + vs + ' picked to lose. Press to clear the pick' : 'No pick for ' + x.t.name + ' ' + vs + '. Press to pick a win';
    return '<div class="nx-cell"><div class="mini"><button type="button" class="pick-box' + (won ? ' pick-w' : lost ? ' pick-l' : '') + '" data-pick="' + esc(g.id) + '" data-team="' + x.t.id + '" data-opp="' + esc(opp.id) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + (won ? 'W' : lost ? 'L' : '') + '</button></div>' +
      '<span class="nx-vs" aria-hidden="true"><span class="nx-long">' + vs + '</span><span class="nx-short">' + (g.h === x.i || g.n ? '' : '@') + esc(opp.ab || opp.name) + '</span></span></div>';
  }
  // Phones show four columns: CFP, team, pick and Make CFP (styles.css hides the rest below 900px). A full-width row must span
  // exactly the visible columns, or the fixed table layout adds empty columns and squeezes the team name.
  var WIDE = matchMedia('(min-width: 900px)');
  var TABLET = matchMedia('(min-width: 600px)');
  function visibleColumns() { return WIDE.matches || st.expanded ? 10 : TABLET.matches ? 7 : 6; }
  // The selected ratings' name, as the Ratings menu shows it.
  function modeName() { var o = $('mode') && $('mode').selectedOptions[0]; return o ? o.textContent : st.mode; }
  function detail(x) {
    return '<tr class="detail"><td colspan="' + visibleColumns() + '">' + statsList(x, 'narrow-only') + detailBody(x) + '</td></tr>';
  }
  function splitRow(label, make) {
    return '<tr><th scope="row">' + label + '</th><td>' + pct(make) + '</td><td>' + pct(make == null ? null : 1 - make) + '</td></tr>';
  }
  function detailBody(x) {
    var sc = schedule()[x.i], R = x.r, hist = R.hist, maxH = Math.max.apply(null, hist.concat(1)), N = res().sims;
    var lines = sc.map(function (g) {
      var o = D.teams[g.o];
      return '<span>' + (g.home === 1 ? 'vs ' : g.home === -1 ? 'at ' : 'vs ') + logo(o, 18) + esc(o.name) + (g.s === 'in' ? ' <b class="score-now">' + (g.us > g.them ? 'Up ' : g.us < g.them ? 'Down ' : 'Tied ') + g.us + '-' + g.them + '</b>' : '') + '</span><span>' + (st.picks[g.id] ? (st.picks[g.id] === x.t.id ? 'Picked win' : 'Picked loss') : Math.round(g.p * 100) + '%') + '</span>';
    }).join('');
    var bars = hist.map(function (h, i) {
      var label = 'Seed ' + (i + 1) + ': ' + (h / N * 100).toFixed(1) + '% of simulations';
      return '<div title="' + label + '" aria-label="' + label + '"><i style="height:' + (h / maxH * 100).toFixed(1) + '%"></i></div>';
    }).join('');
    var xs = hist.map(function (_, i) { return '<span>' + (i + 1) + '</span>'; }).join('');
    return '<div class="detail-inner">' +
      '<div><h3>Regular season left (chance to win)</h3><div class="sched">' + (lines || '<span>No games left</span><span></span>') + '</div></div>' +
      '<div><h3>What moves the odds</h3><table class="split"><thead><tr><td></td><th scope="col">Make CFP</th><th scope="col">Miss CFP</th></tr></thead><tbody>' +
        splitRow(hasPicks() ? 'With your picks' : 'Today', R.cfp) +
        splitRow('If they win next game', R.ifNext) +
        splitRow('If they lose next game', R.ifLose) +
      '</tbody></table><dl class="kv">' +
        (x.t.conf === 'ind' ? '' : '<dt>Reach conference title game</dt><dd>' + pct(R.ccg) + '</dd>') +
        '<dt>Earn an automatic bid</dt><dd>' + pct(R.aq) + '</dd>' +
        '<dt>Host a first-round game</dt><dd>' + pct(R.host) + '</dd>' +
      '</dl></div>' +
      '<div><h3>Seed distribution, % of all simulations</h3><div class="hist" role="img" aria-label="Chance of each playoff seed for ' + esc(x.t.name) + '">' + bars + '</div><div class="hist-x">' + xs + '</div></div>' +
    '</div>';
  }
  // The table heading names what's shown: a conference if one is chosen, otherwise the team group.
  var VIEW_NAME = { all: 'FBS', p4: 'Power 4', g5: 'Group of 6' };
  // What RK is, and which week's ranking it is. Shown with the table instructions.
  function rkNote() {
    var week = D.rankLabel ? D.rankLabel.replace(/^.*- /, '').replace(/^CFP Rankings /i, '') : '';
    return ' <b>RK</b> is the College Football Playoff committee ranking' + (week ? ' (' + esc(week) + ')' : '') + '.';
  }
  function renderBoardTitle(count) {
    $('board-title').textContent = st.conf ? (CFP.CONF_NAME[st.conf] || st.conf) : VIEW_NAME[st.view];
    $('board-count').textContent = count + (count === 1 ? ' team' : ' teams') + (st.q.trim() ? ' matching “' + st.q.trim() + '”' : '');
  }
  // A percentage column cell, shaded by its value like Make CFP.
  function shaded(v) { return '<td class="sec pct-cell" style="--p:' + v.toFixed(3) + '">' + pct(v) + '</td>'; }
  function renderTable() {
    head();
    var rows = visible(buildRows());
    renderBoardTitle(rows.length);
    if (!rows.length) { $('body').innerHTML = '<tr><td class="empty" colspan="' + visibleColumns() + '">No teams match. Clear the search or pick another conference.</td></tr>'; return; }
    $('body').innerHTML = rows.map(function (x) {
      var r = '<tr' + (x.next && x.next.s === 'in' ? ' class="live-row"' : '') + '><td class="first c-rk">' + (x.t.rank || '') + '</td>' +
        '<td class="team-col"><div class="teamcell">' + logo(x.t, 30) +
        '<span><button class="tname" type="button" data-open="' + x.t.id + '" aria-expanded="' + !!st.open[x.t.id] + '" aria-label="' + esc(x.t.name) + '"><span class="tn-long">' + esc(x.t.name) + '</span><span class="tn-short" aria-hidden="true">' + esc(x.t.ab || x.t.name) + '</span></button></span></div></td>' +
        '<td class="l c-cn-cell"><span class="cn-long">' + esc(CFP.CONF_NAME[x.t.conf] || x.t.conf) + '</span><span class="cn-short" aria-hidden="true">' + esc(CFP.CONF_ABBR[x.t.conf] || CFP.CONF_NAME[x.t.conf] || x.t.conf) + '</span></td>' +
        '<td class="num rec">' + x.rec.text + '</td>' +
        '<td class="num tc">' + x.index.toFixed(1) + '</td>' +
        '<td class="pick">' + pickCell(x) + '</td>' +
        '<td class="odds-cell" style="--p:' + x.r.cfp.toFixed(3) + '"><div class="odds"><span class="v">' + pct(x.r.cfp) + '</span></div></td>' +
        shaded(x.r.bye) +
        (x.t.conf === 'ind' ? '<td class="sec">—</td>' : shaded(x.r.champ)) + shaded(x.r.title) + '</tr>';
      return r + (st.open[x.t.id] ? detail(x) : '');
    }).join('');
  }
  function fieldPanel(x) {
    var conf = CFP.CONF_NAME[x.t.conf] || x.t.conf;
    return '<div class="fd-head">' +
        '<div class="field-team">' + logo(x.t, 30) + '<span><b>' + esc(x.t.name) + '</b><span class="tmeta">' + x.rec.text + ' · ' + esc(conf) + (x.t.rank ? ' · CFP No. ' + x.t.rank : '') + '</span></span></div>' +
        '<div class="field-pick">' + nextCell(x) + pickCell(x) + '</div>' +
        '<button class="btn" type="button" id="field-close">Close</button>' +
      '</div>' +
      statsList(x) + detailBody(x);
  }
  // The 12 teams most likely to make it, in order of average seed. Shared by the field and the bracket.
  // Built the way the bids work: the most likely champion of each power conference and the Group of 6 team
  // most likely to earn its automatic bid, then the best remaining odds. Taking the 12 highest odds alone can
  // leave out the Group of 6 bid when it's split among several teams, say after the favorite loses.
  function projectedField() {
    var all = buildRows().sort(function (a, b) { return b.r.cfp - a.r.cfp; });
    var field = [], used = {};
    function add(x) { if (x && !used[x.t.id] && field.length < 12) { used[x.t.id] = 1; field.push(x); } }
    function likeliestBid(teams) { return teams.sort(function (a, b) { return b.r.aq - a.r.aq || b.r.cfp - a.r.cfp; })[0]; }
    CFP.P4.forEach(function (c) { add(likeliestBid(all.filter(function (x) { return x.t.conf === c; }))); });
    add(likeliestBid(all.filter(function (x) { return CFP.G6.indexOf(x.t.conf) >= 0; })));
    all.forEach(add);
    var seedOf = function (x) { return x.r.seed == null ? 99 : x.r.seed; };
    field.sort(function (a, b) { return seedOf(a) - seedOf(b); });
    return { all: all, field: field, rest: all.filter(function (x) { return !used[x.t.id]; }) };
  }
  // The Projected field section was removed from the page; the bracket still uses projectedField().
  function renderField() {
    if (!$('seeds')) return;
    var pf = projectedField(), all = pf.all, field = pf.field;
    $('seeds').innerHTML = field.map(function (x, i) {
      var isOpen = st.fieldOpen === x.t.id;
      return '<button type="button" class="seed" data-field="' + x.t.id + '" aria-expanded="' + isOpen + '" aria-controls="field-detail" aria-label="Seed ' + (i + 1) + ', ' + esc(x.t.name) + ', ' + pct(x.r.cfp) + ' to make the playoff. ' + (isOpen ? 'Hide' : 'Show') + ' details"><span class="n">' + (i + 1) + '</span><span class="ab">' + logo(x.t, 22) + esc(x.t.ab) + '</span><span class="pc">' + pct(x.r.cfp) + '</span></button>';
    }).join('');
    // A pick can drop the open team out of the 12, so it is looked up in all teams.
    var opened = all.filter(function (x) { return x.t.id === st.fieldOpen; })[0];
    $('field-detail').hidden = !opened;
    $('field-detail').innerHTML = opened ? fieldPanel(opened) : '';
    $('out').innerHTML = '<b>Next in line:</b> ' + pf.rest.slice(0, 4).map(function (x) { return esc(x.t.name) + ' ' + pct(x.r.cfp); }).join(', ');
    $('field-note').textContent = 'The likeliest champion of each power conference and the likeliest Group of 6 bid, plus the seven best remaining odds, ordered by average seed. Select a team for details.';
  }

  // ---------- Playoff bracket ----------
  // One game's win chance from the two ratings, as the simulator plays it. Only first-round games have home field.
  function winChance(a, b, home) {
    var M = CFP.M, total = Math.sqrt(M.gameSD * M.gameSD + 2 * M.teamSD * M.teamSD);
    var hfa = home ? (D.sources.hfa[st.mode] || 2.5) : 0;
    return CFP.phi((a.rating - b.rating + hfa) / total);
  }
  // A team or a not-yet-known slot. Seeds only: later rounds show which game feeds them.
  function tbd(label) { return { tbd: label }; }
  // st.bkPicks maps a game key (r1-0 ... f) to the seed the viewer picked to win it.
  function bracketRow(key, slot, opp, cls, chance, host) {
    if (slot.tbd) {
      return '<div class="bk-team tbd" aria-label="To be decided: ' + esc(slot.tbd) + '"></div>';
    }
    var inner = '<span class="bk-seed">' + slot.seed + '</span>' + logo(slot.x.t, 22) +
      '<span class="bk-name">' + esc(slot.x.t.name) + '</span><span class="bk-p">' + (chance == null ? '' : Math.round(chance * 100) + '%') + '</span>';
    if (opp.tbd) return '<div class="bk-team' + (cls ? ' ' + cls : '') + '">' + inner + '</div>';
    var picked = st.bkPicks[key] === slot.seed, lost = st.bkPicks[key] === opp.seed;
    var label = picked ? slot.x.t.name + ' picked to win. Press to pick a loss' : lost ? slot.x.t.name + ' picked to lose. Press to clear the pick' : 'No pick for ' + slot.x.t.name + ' vs ' + opp.x.t.name + '. Press to pick a win';
    // The same box as the Rankings table: W for the team you picked, L for its opponent, empty otherwise.
    var box = '<span class="mini"><span class="pick-box' + (picked ? ' pick-w' : lost ? ' pick-l' : '') + '" aria-hidden="true">' + (picked ? 'W' : lost ? 'L' : '') + '</span></span>';
    return '<button type="button" class="bk-team picks' + (cls ? ' ' + cls : '') + '" data-bk="' + key + '" data-seed="' + slot.seed + '" data-opp="' + opp.seed + '" aria-pressed="' + picked + '" aria-label="' + esc(label) + '">' + inner + box + '</button>';
  }
  // A game is decided by the viewer's pick, or by the favorite when Simulate games is on.
  // Win chances show for every decided game. A winner carries its chance of getting this far.
  function bracketGame(key, hi, lo, home, feeds, where) {
    var known = !hi.tbd && !lo.tbd;
    var pickSeed = st.bkPicks[key], picked = known ? (pickSeed === hi.seed ? hi : pickSeed === lo.seed ? lo : null) : null;
    // A pick whose team is no longer in this game (an earlier pick changed) is dropped, so it can't return unseen.
    if (pickSeed != null && !picked) delete st.bkPicks[key];
    var p = known && (st.bkSim || picked) ? winChance(hi.x, lo.x, home) : null;
    var win = picked || (p != null ? (p >= 0.5 ? hi : lo) : null);
    var html = '<article class="bk-game">' + (where ? '<p class="bk-where">' + where + '</p>' : '') + '<div class="bk-box">' +
      bracketRow(key, hi, lo, win ? (win === hi ? 'win' : 'lose') : '', p, home) +
      bracketRow(key, lo, hi, win ? (win === lo ? 'win' : 'lose') : '', p == null ? null : 1 - p, false) +
      '</div></article>';
    if (!win) return { winner: tbd(feeds), html: html };
    var chance = win === hi ? p : 1 - p;
    return { winner: { seed: win.seed, x: win.x, path: (win.path || 1) * chance }, html: html };
  }
  // 2026-27 playoff schedule, from the CFP's broadcast schedule (times Eastern).
  // Fixed: the Fiesta Bowl quarterfinal (Dec 30), the Orange and Sugar semifinals and the title game.
  // Set on Selection Day (Dec 6): which seeds go to which quarterfinal bowl, the Jan 1 windows for the Peach,
  // Cotton and Rose bowls, and the first-round slots. Until then those are projected (see projectBowls).
  var NET = {
    ESPN: { name: 'ESPN', logo: 'https://upload.wikimedia.org/wikipedia/commons/2/2f/ESPN_wordmark.svg' },
    ABC: { name: 'ABC', logo: 'https://upload.wikimedia.org/wikipedia/commons/2/2f/ABC-2021-LOGO.svg' },
    TNT: { name: 'TNT', logo: 'https://upload.wikimedia.org/wikipedia/commons/2/24/TNT_Logo_2016.svg' },
    truTV: { name: 'truTV', logo: 'https://upload.wikimedia.org/wikipedia/commons/3/36/TruTV_logo.svg' },
    HBOMax: { name: 'HBO Max', logo: 'https://upload.wikimedia.org/wikipedia/commons/b/b3/HBO_Max_%282025%29.svg' }
  };
  var TNT_GROUP = ['TNT', 'truTV', 'HBOMax'], ABC_ESPN = ['ABC', 'ESPN'];
  var BOWLS = {
    fiesta: { short: 'Fiesta Bowl', name: 'Vrbo Fiesta Bowl', color: '#7a2a8e', site: 'Glendale, Ariz.', logo: 'https://upload.wikimedia.org/wikipedia/en/9/9d/Fiesta_Bowl_Logo.svg' },
    peach: { short: 'Peach Bowl', name: 'Chick-fil-A Peach Bowl', color: '#e35205', site: 'Atlanta', logo: 'https://upload.wikimedia.org/wikipedia/en/3/39/Peach_Bowl_logo.svg' },
    rose: { short: 'Rose Bowl', name: 'Rose Bowl Game', color: '#c8102e', site: 'Pasadena, Calif.', logo: 'https://upload.wikimedia.org/wikipedia/en/a/a3/Rose_Bowl_Game_logo.svg' },
    cotton: { short: 'Cotton Bowl', name: 'Goodyear Cotton Bowl Classic', color: '#1f3c88', site: 'Arlington, Texas', logo: 'https://upload.wikimedia.org/wikipedia/en/3/3b/Cotton_Bowl_logo.svg' },
    orange: { short: 'Orange Bowl', name: 'Capital One Orange Bowl', color: '#f47321', site: 'Miami Gardens, Fla.', logo: 'https://upload.wikimedia.org/wikipedia/en/5/51/Orange_Bowl_logo.svg', when: 'Thu, Jan 14 · 7:30 PM', tv: TNT_GROUP },
    sugar: { short: 'Sugar Bowl', name: 'Allstate Sugar Bowl', color: '#0b3d91', site: 'New Orleans', logo: 'https://upload.wikimedia.org/wikipedia/en/9/98/Sugar_Bowl_Logo.svg', when: 'Fri, Jan 15 · 7:30 PM', tv: ABC_ESPN },
    title: { short: 'Las Vegas', name: 'CFP National Championship', color: 'var(--accent)', site: 'Allegiant Stadium, Las Vegas', when: 'Mon, Jan 25 · 7:30 PM', tv: ABC_ESPN,
      logo: 'https://upload.wikimedia.org/wikipedia/commons/4/4d/College_Football_National_Championship_logo.svg' }
  };
  // Quarterfinal slots: the Fiesta's is fixed; the Jan 1 windows are projected the way they usually go
  // (the Rose Bowl in its traditional afternoon slot).
  var QF_SLOT = {
    fiesta: { when: 'Wed, Dec 30 · 7:30 PM', tv: TNT_GROUP },
    peach: { when: 'Fri, Jan 1 · 12:00 PM', tv: TNT_GROUP },
    rose: { when: 'Fri, Jan 1 · 4:00 PM', tv: ABC_ESPN },
    cotton: { when: 'Fri, Jan 1 · 8:00 PM', tv: ['ESPN'] }
  };
  // First-round slots, projected by seed: 8 vs 9 Friday night, the rest Saturday.
  var R1_SLOT = {
    '8-9': { when: 'Fri, Dec 18 · 8:00 PM', tv: ['ESPN'] },
    '5-12': { when: 'Sat, Dec 19 · 12:00 PM', tv: ABC_ESPN },
    '6-11': { when: 'Sat, Dec 19 · 3:30 PM', tv: TNT_GROUP },
    '7-10': { when: 'Sat, Dec 19 · 7:30 PM', tv: TNT_GROUP }
  };
  // The committee places the top four seeds into quarterfinal bowls, in seed order, with an eye to geography
  // and tradition. This projection does the same: each seed takes the first open bowl on its conference's list.
  var BOWL_PREF = {
    big10: ['rose', 'fiesta', 'cotton', 'peach'], pac12: ['rose', 'fiesta', 'cotton', 'peach'],
    sec: ['peach', 'cotton', 'fiesta', 'rose'], acc: ['peach', 'cotton', 'fiesta', 'rose'],
    big12: ['cotton', 'fiesta', 'peach', 'rose'], ind: ['fiesta', 'cotton', 'peach', 'rose']
  };
  function projectBowls(top4) {
    var open = ['rose', 'peach', 'cotton', 'fiesta'], out = [];
    top4.forEach(function (x) {
      var pref = BOWL_PREF[x.x.t.conf] || ['fiesta', 'cotton', 'peach', 'rose'];
      var k = pref.filter(function (p) { return open.indexOf(p) >= 0; })[0];
      open.splice(open.indexOf(k), 1);
      out.push(k);
    });
    return out;
  }
  function netLogos(keys) {
    return '<span class="net-logos">' + keys.map(function (k) { return '<img class="net-' + k.toLowerCase() + '" src="' + NET[k].logo + '" alt="' + esc(NET[k].name) + '" title="' + esc(NET[k].name) + '" loading="lazy">'; }).join('') + '</span>';
  }
  // The line above a bracket game: TV logos and time, then the bowl or site. "proj." marks a projected slot.
  function gameLine(tv, when, place) {
    // "Fri, Jan 1 · 12:00 PM" -> "Jan 1 · 12 PM ET"
    var short = when.replace(/^\w+, /, '').replace(':00 ', ' ');
    return '<span class="bk-place">' + place + '</span><span class="bk-air"><b>' + esc(short) + '<span class="bk-et"> ET</span></b>' + netLogos(tv) + '</span>';
  }
  var ROUND_INFO = {
    'First round': 'Dec 18–19 · higher seed hosts',
    Quarterfinals: 'Dec 30 – Jan 1 · Fiesta, Peach, Rose, Cotton',
    Semifinals: 'Jan 14–15 · Orange, Sugar',
    Championship: 'Jan 25 · Las Vegas'
  };
  // A bowl's logo, named in its tooltip and for screen readers.
  // Bowl logo, name and site; the site shows only where the card has room (styles.css).
  function bowlChip(k) {
    var b = BOWLS[k], loc = k === 'title' ? 'Allegiant Stadium' : b.site;
    return '<img class="bk-bowl bk-bowl-' + k + '" src="' + b.logo + '" alt="" loading="lazy"><span title="' + esc(b.name + ' · ' + b.site) + '">' + esc(b.short) + '</span><span class="bk-loc">' + esc(loc) + '</span>';
  }
  // Fixed bracket, no reseeding: 1 plays the 8/9 winner, 4 plays 5/12, 2 plays 7/10, 3 plays 6/11.
  function renderBracket() {
    var field = projectedField().field, sim = !!st.bkSim;
    $('bk-sim').setAttribute('aria-pressed', sim);
    $('bk-sim').textContent = sim ? 'Show seeds only' : 'Simulate games';
    $('bracket-note').textContent = sim
      ? 'The favorite in each game advances unless you pick a team. Win chances come from the two ratings, with home field for the higher seed in the first round.'
      : 'Select a team to advance it. Each game you decide shows both teams’ chance to win, from their ratings.';
    if (field.length < 12) { $('bracket').innerHTML = ''; return; }
    var s = field.map(function (x, i) { return { seed: i + 1, x: x }; });
    // First round at the higher seed's stadium; quarterfinal bowls projected for seeds 1-4 in seed order;
    // the semifinal with the No. 1 seed's side projected to the Orange Bowl.
    var r1Line = function (key, x) { var sl = R1_SLOT[key]; return gameLine(sl.tv, sl.when, '<span>At ' + esc(x.x.t.name) + '</span>'); };
    var bySeed = projectBowls([s[0], s[1], s[2], s[3]]), bowl = [bySeed[0], bySeed[3], bySeed[1], bySeed[2]]; // seeds pick in order 1-4; the bracket lists 1, 4, 2, 3
    var qfLine = function (k) { var sl = QF_SLOT[k]; return gameLine(sl.tv, sl.when, bowlChip(k)); };
    var sfLine = function (k) { var b = BOWLS[k]; return gameLine(b.tv, b.when, bowlChip(k)); };
    var r1 = [bracketGame('r1-0', s[7], s[8], true, 'Winner of 8 vs 9', r1Line('8-9', s[7])), bracketGame('r1-1', s[4], s[11], true, 'Winner of 5 vs 12', r1Line('5-12', s[4])),
      bracketGame('r1-2', s[6], s[9], true, 'Winner of 7 vs 10', r1Line('7-10', s[6])), bracketGame('r1-3', s[5], s[10], true, 'Winner of 6 vs 11', r1Line('6-11', s[5]))];
    var qf = [bracketGame('qf-0', s[0], r1[0].winner, false, 'Winner of quarterfinal 1', qfLine(bowl[0])), bracketGame('qf-1', s[3], r1[1].winner, false, 'Winner of quarterfinal 2', qfLine(bowl[1])),
      bracketGame('qf-2', s[1], r1[2].winner, false, 'Winner of quarterfinal 3', qfLine(bowl[2])), bracketGame('qf-3', s[2], r1[3].winner, false, 'Winner of quarterfinal 4', qfLine(bowl[3]))];
    var sf = [bracketGame('sf-0', qf[0].winner, qf[1].winner, false, 'Winner of semifinal 1', sfLine('orange')), bracketGame('sf-1', qf[2].winner, qf[3].winner, false, 'Winner of semifinal 2', sfLine('sugar'))];
    var fin = bracketGame('f', sf[0].winner, sf[1].winner, false, 'Champion', gameLine(BOWLS.title.tv, BOWLS.title.when, bowlChip('title')));
    $('bk-clear').hidden = !Object.keys(st.bkPicks).length; // after the games drop stale picks
    function round(title, games) { return '<section class="bk-round" aria-label="' + esc(title + ', ' + (ROUND_INFO[title] || '')) + '"><div class="bk-games">' + games.map(function (g) { return g.html; }).join('') + '</div></section>'; }
    var champ = fin.winner.tbd ? null : fin.winner;
    var titles = s.slice().sort(function (a, b) { return b.x.r.title - a.x.r.title; }).slice(0, 6);
    var champCard = '';
    if (champ) {
      var t = champ.x.t;
      champCard = '<div class="bk-champ"><div class="bk-champ-team">' + logo(t, 40) + '<div><p class="bk-label">' + (st.bkPicks.f === champ.seed ? 'Your champion' : 'Projected champion') + '</p><p class="bk-champ-name">' + esc(t.name) + '</p></div></div>' +
        '<p><b>' + esc(t.name) + '</b> wins every game on this path ' + pct(champ.path) + ' of the time, using each game’s win chance. Across all simulations it wins the title ' + pct(champ.x.r.title) + ' of the time.</p></div>';
    }
    $('bracket').innerHTML = champCard +
      '<div class="bk-rounds" id="bk-rounds">' + round('First round', r1) + round('Quarterfinals', qf) + round('Semifinals', sf) + round('Championship', [fin]) + '</div>' +
      (sim ? '<div class="bk-titles"><h3>Title odds</h3><ol>' + titles.map(function (x) { return '<li>' + logo(x.x.t, 20) + '<span>' + esc(x.x.t.name) + '</span><b>' + pct(x.x.r.title) + '</b></li>'; }).join('') + '</ol></div>' : '');
    drawConnectors();
  }
  // Lines from each game to the one its winner plays next. Only drawn when the rounds sit side by side.
  var BK_WIDE = matchMedia('(min-width: 1000px)');
  // Shows each game site only if it fits in full on its card.
  // Logos change the room left once they load, so check again then.
  var fitTimer = null;
  document.addEventListener('load', function (e) {
    if (!e.target.closest || !e.target.closest('.bk-where')) return;
    clearTimeout(fitTimer);
    fitTimer = setTimeout(function () { var w = document.getElementById('bk-rounds'); if (w) fitLocs(w); }, 50);
  }, true);
  function fitLocs(root) {
    [].forEach.call(root.querySelectorAll('.bk-loc'), function (l) { l.classList.remove('cut'); });
    [].forEach.call(root.querySelectorAll('.bk-loc'), function (l) { if (l.scrollWidth > l.clientWidth + 1) l.classList.add('cut'); });
  }
  function drawConnectors() {
    var wrap = document.getElementById('bk-rounds');
    if (!wrap) return;
    fitLocs(wrap);
    var old = wrap.querySelector('.bk-lines');
    if (old) old.remove();
    if (!BK_WIDE.matches || !wrap.offsetWidth) return;
    var base = wrap.getBoundingClientRect();
    var rounds = [].map.call(wrap.querySelectorAll('.bk-round'), function (r) { return [].slice.call(r.querySelectorAll('.bk-game')); });
    var links = [[0, 0, 1, 0], [0, 1, 1, 1], [0, 2, 1, 2], [0, 3, 1, 3], [1, 0, 2, 0], [1, 1, 2, 0], [1, 2, 2, 1], [1, 3, 2, 1], [2, 0, 3, 0], [2, 1, 3, 0]];
    var d = links.map(function (l) {
      var a = rounds[l[0]][l[1]].getBoundingClientRect(), b = rounds[l[2]][l[3]].getBoundingClientRect();
      var x1 = a.right - base.left, y1 = a.top + a.height / 2 - base.top, x2 = b.left - base.left, y2 = b.top + b.height / 2 - base.top, mx = (x1 + x2) / 2;
      return 'M' + x1 + ' ' + y1 + 'H' + mx + 'V' + y2 + 'H' + x2;
    }).join('');
    wrap.insertAdjacentHTML('afterbegin', '<svg class="bk-lines" aria-hidden="true" width="' + base.width + '" height="' + base.height + '"><path d="' + d + '"></path></svg>');
  }
  try { new ResizeObserver(function () { drawConnectors(); }).observe($('bracket')); } catch (x) {}
  try { BK_WIDE.addEventListener('change', drawConnectors); } catch (x) {}
  function etTime(iso) { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }); }
  function etDay(when) { return new Date(when).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); }
  // How far one game could move playoff odds: the team with the biggest gap between winning and losing.
  function gameStakes(g) {
    var R = res(), best = null;
    if (g.s === 'post' || st.picks[g.id]) return best;
    [g.h, g.a].forEach(function (i) {
      if (i >= D.fbs) return;
      var r = R.teams[i], nx = schedule()[i][0];
      if (!nx || nx.id !== g.id || r.ifNext == null || r.ifLose == null || nx.p > 0.97 || nx.p < 0.03) return;
      var swing = r.ifNext - r.ifLose;
      if (!best || swing > best.swing) best = { i: i, swing: swing, win: r.ifNext, lose: r.ifLose };
    });
    return best;
  }
  function liveRow(g, i, score, other) {
    var t = D.teams[i], isFbs = i < D.fbs, r = isFbs ? res().teams[i] : null, nx = isFbs ? schedule()[i][0] : null;
    var done = g.s === 'post', win = '';
    // A shaded odds tile, or a dash when there's no number.
    function tile(v, cls) { cls = cls ? ' ' + cls : ''; return v == null ? '<div class="lg-num' + cls + '">—</div>' : '<div class="lg-cfp' + cls + '" style="--p:' + v.toFixed(3) + '">' + pct(v) + '</div>'; }
    if (!done) {
      if (st.picks[g.id]) win = st.picks[g.id] === t.id ? 'Pick' : '';
      else if (nx && nx.id === g.id) win = Math.round(nx.p * 100) + '%';
      else win = '—';
    }
    var name = '<div class="lg-team">' + logo(t, 22) + '<span>' + (t.rank ? '<small class="lg-rank">' + t.rank + '</small>' : '') + esc(t.ab || t.name) + (isFbs ? ' <small class="lg-rec">(' + record(i).text + ')</small>' : '') + '</span></div>';
    // Upcoming games: no score; Make CFP odds if this team wins or loses it. A picked game has one outcome left.
    if (g.s === 'pre') {
      var ifW = null, ifL = null;
      if (r && st.picks[g.id]) { if (st.picks[g.id] === t.id) ifW = r.cfp; else ifL = r.cfp; }
      else if (r && nx && nx.id === g.id) { ifW = r.ifNext; ifL = r.ifLose; }
      return name + '<div class="lg-num">' + win + '</div>' + tile(r ? r.cfp : null) + tile(ifW, 'lg-if') + tile(ifL, 'lg-if');
    }
    return name +
      '<div class="lg-score' + (score >= other ? ' lead' : '') + '">' + score + '</div>' +
      '<div class="lg-num">' + win + '</div>' +
      tile(r ? r.cfp : null);
  }
  // Pre-game win chance for the home team, from the selected ratings. FCS teams use their Massey rating.
  function pregameHome(g) {
    var R = res(), M = CFP.M, total = Math.sqrt(M.gameSD * M.gameSD + 2 * M.teamSD * M.teamSD);
    function rating(i) { return i < D.fbs ? R.rating[i] : (D.teams[i].r && D.teams[i].r.massey) || 0; }
    return CFP.phi((rating(g.h) - rating(g.a) + (g.n ? 0 : (D.sources.hfa[st.mode] || 2.5))) / total);
  }
  // The home team's chance right now, using the current score and clock.
  function liveHome(g) {
    var sc = schedule(), nx;
    if (g.h < D.fbs && (nx = sc[g.h][0]) && nx.id === g.id) return nx.p;
    if (g.a < D.fbs && (nx = sc[g.a][0]) && nx.id === g.id) return 1 - nx.p;
    return null;
  }
  // An upset: a team under 35% before kickoff that is now favored, or that won. Picked games aren't flagged.
  var UPSET_LINE = 0.35;
  function upset(g) {
    if (st.picks[g.id] || g.s === 'pre') return null;
    var pre = pregameHome(g), dog = pre < UPSET_LINE ? g.h : pre > 1 - UPSET_LINE ? g.a : -1;
    if (dog < 0) return null;
    var dogPre = dog === g.h ? pre : 1 - pre;
    if (g.s === 'post') return g.w === dog ? { dog: dog, pre: dogPre } : null;
    var lh = liveHome(g);
    if (lh == null) return null;
    var now = dog === g.h ? lh : 1 - lh;
    return now >= 0.5 ? { dog: dog, pre: dogPre, now: now } : null;
  }
  // A network name as a small badge in its brand color. Names come from ESPN; unknown ones get a neutral badge.
  var TV_COLORS = {
    ESPN: '#cc0000', ESPN2: '#cc0000', ESPNU: '#cc0000', ESPNEWS: '#cc0000', 'ESPN+': '#cc0000', SECN: '#003a70', 'SECN+': '#003a70', ACCN: '#013ca6', 'ACCNX': '#013ca6',
    'ESPN Unlmtd': '#cc0000', 'SEC Network': '#003a70', 'ACC Network': '#013ca6', Fox: '#0b2240', 'Disney+': '#0b3d91', 'USA Net': '#1d3f8f', 'MW+': '#3d4f6b', 'UConn+': '#0e1a3d',
    ABC: '#111111', CBS: '#0b3d91', CBSSN: '#0b3d91', FOX: '#0b2240', FS1: '#2d2d2d', FS2: '#2d2d2d', BTN: '#0088ce', NBC: '#5c2d91', Peacock: '#111111',
    TNT: '#c8102e', truTV: '#e2231a', 'HBO Max': '#5822b4', CW: '#00843d', 'The CW': '#00843d', 'Big 12 Now': '#c8102e', 'Pac-12 Network': '#004b87'
  };
  // Network logos by ESPN's network name. Networks without a freely licensed logo keep a colored name badge.
  var TV_LOGO = {
    ESPN: 'https://upload.wikimedia.org/wikipedia/commons/2/2f/ESPN_wordmark.svg', ESPN2: 'https://upload.wikimedia.org/wikipedia/commons/b/bf/ESPN2_logo.svg', ESPNU: 'https://upload.wikimedia.org/wikipedia/commons/c/ca/ESPN_U_logo.svg', ESPNEWS: 'https://upload.wikimedia.org/wikipedia/commons/1/1b/ESPNews.svg',
    ABC: 'https://upload.wikimedia.org/wikipedia/commons/2/2f/ABC-2021-LOGO.svg', CBS: 'https://upload.wikimedia.org/wikipedia/commons/4/4e/CBS_logo.svg', CBSSN: 'https://upload.wikimedia.org/wikipedia/commons/0/04/CBS_Sports_Network_2021.svg',
    FOX: 'https://upload.wikimedia.org/wikipedia/commons/c/c0/Fox_Broadcasting_Company_logo_%282019%29.svg', Fox: 'https://upload.wikimedia.org/wikipedia/commons/c/c0/Fox_Broadcasting_Company_logo_%282019%29.svg', FS1: 'https://upload.wikimedia.org/wikipedia/commons/3/37/2015_Fox_Sports_1_logo.svg',
    NBC: 'https://upload.wikimedia.org/wikipedia/commons/3/3f/NBC_logo.svg', Peacock: 'https://upload.wikimedia.org/wikipedia/commons/f/fb/NBCUniversal_Peacock_Logo_%282020%E2%80%932026%29.svg',
    'SEC Network': 'https://upload.wikimedia.org/wikipedia/commons/b/b9/SEC_Network_logo.svg', SECN: 'https://upload.wikimedia.org/wikipedia/commons/b/b9/SEC_Network_logo.svg', 'ACC Network': 'https://upload.wikimedia.org/wikipedia/commons/0/00/ACC_Network_logo_fc_db.svg', ACCN: 'https://upload.wikimedia.org/wikipedia/commons/0/00/ACC_Network_logo_fc_db.svg',
    TNT: 'https://upload.wikimedia.org/wikipedia/commons/2/24/TNT_Logo_2016.svg', truTV: 'https://upload.wikimedia.org/wikipedia/commons/3/36/TruTV_logo.svg', 'HBO Max': 'https://upload.wikimedia.org/wikipedia/commons/b/b3/HBO_Max_%282025%29.svg',
    CW: 'https://upload.wikimedia.org/wikipedia/commons/b/b1/The_CW_2024.svg', 'The CW': 'https://upload.wikimedia.org/wikipedia/commons/b/b1/The_CW_2024.svg', 'USA Net': 'https://upload.wikimedia.org/wikipedia/commons/d/d7/USA_Network_logo_%282016%29.svg', 'Disney+': 'https://upload.wikimedia.org/wikipedia/commons/3/3e/Disney%2B_logo.svg'
  };
  function tvBadges(names) {
    return (names || []).map(function (n) {
      if (TV_LOGO[n]) return '<img class="net-' + n.toLowerCase().replace(/[^a-z0-9]/g, '') + '" src="' + TV_LOGO[n] + '" alt="' + esc(n) + '" title="' + esc(n) + '" loading="lazy">';
      return '<span class="tv" style="--tv:' + (TV_COLORS[n] || 'var(--muted)') + '">' + esc(n) + '</span>';
    }).join('');
  }
  function liveCard(g) {
    var isLive = g.s === 'in', isPre = g.s === 'pre';
    var u = upset(g);
    // The network matters for games still to come or under way, not for finals.
    var tv = g.tv && g.s !== 'post' ? '<span class="tv-list net-logos">' + tvBadges(g.tv) + '</span>' : '';
    var top = isLive ? '<span class="lg-live"><b>' + esc(clock(g)) + '</b>' + (u ? '<span class="upset-pill">UPSET ALERT</span>' : '') + '</span>' + tv :
      // Upcoming: the kickoff on the left, where "Kickoff" used to be; the network stays top right.
      isPre ? '<b class="lg-kickoff">' + (etDay(g.d) === etDay(Date.now()) ? '' : new Date(g.d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }) + ', ') +
        // ESPN marks a kickoff time that hasn't been set as midnight Eastern.
        (etTime(g.d) === '12:00 AM' ? 'time TBA' : etTime(g.d) + ' ET') + '</b>' + tv : '<span class="lg-live"><span class="final-pill">FINAL</span>' + (u ? '<span class="upset-pill">UPSET</span>' : '') + '</span><span class="lg-when">' + tv + '<span>' + (etDay(g.d) === etDay(Date.now()) ? 'Today' : new Date(g.d).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' })) + '</span></span>';
    return '<article class="lg' + (isLive ? ' on' : '') + '">' +
      '<div class="lg-top">' + top + '</div>' +
      (isPre ? '<div class="lg-rows pre"><span></span><span class="h">Win</span><span class="h">Make CFP</span><span class="h lg-if">If win</span><span class="h lg-if">If loss</span>' :
        '<div class="lg-rows"><span></span><span class="h">Score</span><span class="h">' + (isLive ? 'Win' : '') + '</span><span class="h">Make CFP</span>') +
        liveRow(g, g.a, isPre ? '' : g.as, isPre ? '' : g.hs) + liveRow(g, g.h, isPre ? '' : g.hs, isPre ? '' : g.as) +
      '</div>' +
    '</article>';
  }
  // Playoff impact on the Scores page, measured as total swing in Make CFP odds across every team.
  // Every game of today goes back to unplayed, so live scores don't count (a pre-game view):
  //  - a final: its real result against the game left open,
  //  - a live or later game: the home team winning against the away team winning.
  // All runs share one seed and the same game list (finals become locked games), so each difference comes
  // from that one game (common random numbers). Runs in its own worker after the main odds are ready.
  var SWING_SIMS = 5000;
  var SWING_TAIL = 'self.onmessage=function(e){var m=e.data;postMessage(CFP.measureSwings(m.D,m.mode,m.seed,m.sims,m.ids));};';
  // Results are remembered per ratings model and game list, so a week that's been measured never reshuffles.
  // The build measures the default ratings' current and next week ahead of time (g.sw), so those show their
  // final order straight away.
  var swings = { key: null, worker: null }, swingCache = {};
  function gameSwings(games) {
    if (!games.length) return null;
    var key = st.mode + '|' + games.map(function (g) { return g.id + g.s.charAt(0); }).sort().join(',');
    if (swingCache[key]) return swingCache[key];
    if (st.mode === D.swMode && games.every(function (g) { return g.sw != null && g.swS === g.s; })) {
      var pre = {};
      games.forEach(function (g) { pre[g.id] = g.sw; });
      return (swingCache[key] = pre);
    }
    if (swings.key === key) return null; // being measured
    if (swings.worker) swings.worker.terminate();
    swings = { key: key, worker: null };
    var data = D, ids = games.map(function (g) { return g.id; });
    try {
      var w = new Worker(URL.createObjectURL(new Blob(['importScripts(' + JSON.stringify(ENGINE_URL) + ');\n' + SWING_TAIL], { type: 'text/javascript' })));
      w.onmessage = function (e) {
        swingCache[key] = e.data;
        if (swings.key !== key) return;
        swings.worker = null; w.terminate();
        if (st.sbSort !== 'time') renderLive();
      };
      w.onerror = function () { if (swings.worker === w) swings.worker = null; };
      swings.worker = w;
      w.postMessage({ D: data, mode: st.mode, seed: CFP.seedFor(st.mode), sims: SWING_SIMS, ids: ids });
    } catch (err) {}
    return null;
  }
  // The weeks on the Scores page, with their date range, e.g. "Week 10 · Nov 3–7".
  function scoreWeeks() {
    var m = {};
    D.games.forEach(function (g) {
      if (g.wk == null || (g.h >= D.fbs && g.a >= D.fbs)) return;
      var w = m[g.wk] = m[g.wk] || { wk: g.wk, first: g.d, last: g.d };
      if (g.d < w.first) w.first = g.d;
      if (g.d > w.last) w.last = g.d;
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (x, y) { return x.wk - y.wk; });
  }
  function weekLabel(w) {
    function md(d) { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }); }
    var a = md(w.first), b = md(w.last);
    if (a === b) return 'Week ' + w.wk + ' · ' + a;
    if (a.split(' ')[0] === b.split(' ')[0]) b = b.split(' ')[1];
    return 'Week ' + w.wk + ' · ' + a + '–' + b;
  }
  // Live games with the most playoff impact come first, then games still to come, then finals, for the chosen week.
  // With no week chosen it follows the current week, which moves on when next week's first game kicks off.
  function renderLive() {
    var weeks = scoreWeeks(), current = weekGames().wk;
    var sel = st.sbWeek != null && weeks.some(function (w) { return w.wk === st.sbWeek; }) ? st.sbWeek : current;
    $('sb-week').innerHTML = weeks.map(function (w) {
      return '<option value="' + w.wk + '"' + (w.wk === sel ? ' selected' : '') + '>' + esc(weekLabel(w)) + (w.wk === current ? ' (current)' : '') + '</option>';
    }).join('');
    var sbConf = st.sbConf || '';
    var sbGroup = sbConf.indexOf('group:') === 0 ? sbConf.slice(6) : '';
    var inConf = function (g) {
      if (!sbConf) return true;
      var h = D.teams[g.h], a = D.teams[g.a];
      return sbGroup ? (g.h < D.fbs && inGroup(h, sbGroup)) || (g.a < D.fbs && inGroup(a, sbGroup)) : h.conf === sbConf || a.conf === sbConf;
    };
    var inWeek = function (g) { return g.wk === sel && (g.h < D.fbs || g.a < D.fbs); };
    var counts = function (g) { return inWeek(g) && inConf(g); };
    var R = res();
    var best = function (g) { return Math.max(g.h < D.fbs ? R.teams[g.h].cfp : 0, g.a < D.fbs ? R.teams[g.a].cfp : 0); };
    var stake = function (g) { var s = gameStakes(g); return s ? s.swing : 0; };
    var byTime = st.sbSort === 'time';
    var kickoff = function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; };
    // Pre-game swing for every game that week, once measured; until then the live stakes stand in.
    var sw = byTime ? null : gameSwings(D.games.filter(inWeek));
    var swing = function (g) { return sw ? sw[g.id] || 0 : g.s === 'post' ? best(g) : stake(g); };
    var impact = function (a, b) { return (st.picks[b.id] ? 1 : 0) - (st.picks[a.id] ? 1 : 0) || swing(b) - swing(a) || best(b) - best(a); };
    var order = byTime ? function (a, b) { return kickoff(a, b) || best(b) - best(a); } : function (a, b) { return impact(a, b) || kickoff(a, b); };
    var live = D.games.filter(function (g) { return g.s === 'in' && counts(g); }).sort(order);
    var later = D.games.filter(function (g) { return g.s === 'pre' && counts(g); }).sort(byTime ? order : function (a, b) { return impact(a, b) || kickoff(a, b); });
    var done = D.games.filter(function (g) { return g.s === 'post' && counts(g); }).sort(byTime ? order : function (a, b) { return swing(b) - swing(a) || kickoff(a, b); });
    function group(title, games, note) {
      return games.length ? '<div class="live-group">' + (title ? '<h4>' + title + '</h4>' : '') + (note ? '<p class="live-note">' + note + '</p>' : '') + '<div class="live-grid">' + games.map(liveCard).join('') + '</div></div>' : '';
    }
    var next = D.games.filter(function (g) { return g.s === 'pre' && (g.h < D.fbs || g.a < D.fbs) && inConf(g); }).sort(kickoff)[0];
    var nextText = next ? 'Next kickoff: ' + new Date(next.d).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET.' : '';
    var impactNote = byTime ? 'Earliest kickoff first.' : 'Your picks first, then the biggest possible swing in playoff odds, judged before kickoff.';
    var who = sbConf ? esc(sbGroup ? GROUP_NAME[sbGroup] : CFP.CONF_NAME[sbConf] || sbConf) + ' ' : '';
    // Only a failed ESPN check is worth a line here.
    $('live-head').innerHTML = st.live === 'blocked' ? '<p class="live-note"><b>Couldn’t reach ESPN.</b> Showing the saved scores.</p>' : '';
    $('live-board').innerHTML =
      (live.length || later.length || done.length ?
        group(live.length && (later.length || done.length) ? 'In progress' : '', live, impactNote) + group(later.length && (live.length || done.length) ? 'Upcoming' : '', later, impactNote) + group('', done) :
        '<p class="live-empty">No ' + who + 'games in week ' + sel + '.' + (nextText ? ' ' + nextText : '') + '</p>');
  }
  // Views: Rankings (default), Playoff and Scoreboard, chosen by the address's #. About is its own page.
  var PAGES = { rankings: 'CFP Odds Board', playoff: 'Playoff bracket · CFP Odds Board', scoreboard: 'Scores · CFP Odds Board' };
  var INTRO = {
    rankings: ['College Football Playoff odds', 'Each team’s chance of making the 12-team playoff, from simulating every remaining game, conference title game and committee ranking.'],
    playoff: ['Projected playoff', 'The most likely 12-team field in its bracket. Simulate the games to see who’s favored in each round.'],
    scoreboard: ['Scores', 'Today\u2019s games, with each team\u2019s win chance and what the result means for its playoff odds.']
  };
  var OLD_HASH = { odds: 'rankings', live: 'scoreboard', scores: 'scoreboard' }; // names used by earlier versions of the site
  function showPage() {
    var hash = location.hash.replace('#', ''), p = OLD_HASH[hash] || hash;
    if (hash === 'about') { location.replace('about.html'); return hash; } // older links
    if (!PAGES[p]) p = 'rankings';
    Object.keys(PAGES).forEach(function (k) { $('page-' + k).hidden = k !== p; });
    [].forEach.call(document.querySelectorAll('.tabs a'), function (a) {
      if (a.dataset.page === p) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = PAGES[p];
    // Each view gets its own title and intro.
    $('page-title').textContent = INTRO[p][0];
    return hash;
  }
  window.addEventListener('hashchange', function () {
    showPage();
    window.scrollTo(0, 0);
  });
  function renderStatus() {
    var as = new Date(D.asOf).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
    var left = D.games.filter(function (g) { return g.s !== 'post'; }).length, inp = D.games.filter(function (g) { return g.s === 'in'; }).length;
    var liveMsg = st.live === 'on' ? '<b>Live ESPN data</b> loaded ' + as + ' ET' :
      st.live === 'blocked' ? '<b>Couldn’t reach ESPN.</b> Showing the saved data from ' + as + ' ET' :
      st.live === 'pending' ? '<b>Checking ESPN…</b> Showing the saved data from ' + as + ' ET' :
      st.live === 'same' ? '<b>ESPN checked</b>, no new results since ' + as + ' ET' : '<b>ESPN snapshot</b> from ' + as + ' ET';
    $('status').innerHTML = '<span>' + liveMsg + '</span><span>' + left + ' games left' + (inp ? ', ' + inp + ' in progress' : '') + '</span>' +
      '<span>' + esc(D.rankLabel ? D.rankLabel.replace(/^.*- /, '') : 'CFP rankings') + '</span><span><b>' + res().sims.toLocaleString() + '</b> simulated seasons</span>';
  }
  function renderPicksBar() {
    var n = Object.keys(st.picks).length;
    $('picks-bar').innerHTML = n
      ? '<span><b>' + n + (n === 1 ? ' game' : ' games') + ' picked.</b> All odds assume ' + (n === 1 ? 'that result' : 'those results') + '.' + rkNote() + '</span><button class="btn" id="clear-picks" type="button">Clear picks</button>'
      : '<span>Press a team\u2019s box to cycle its next game through <b>W</b>, <b>L</b> and blank. Its opponent gets the opposite result, and all odds update.' + rkNote() + '</span>';
  }
  function renderAll() { renderPicksBar(); renderStatus(); renderLive(); renderField(); renderBracket(); renderTable(); }

  function renderModes() {
    function option(k, label) { return '<option value="' + k + '"' + (st.mode === k ? ' selected' : '') + '>' + esc(label) + '</option>'; }
    var groups = '<optgroup label="Averages">' + option('blend', 'Massey + Sagarin') + option('all', 'All models average') + '</optgroup>';
    ['Point-based', 'Recent form', 'Results only'].forEach(function (g) {
      groups += '<optgroup label="' + g + '">' + D.sources.models.filter(function (m) { return m.group === g; }).map(function (m) { return option(m.k, m.label); }).join('') + '</optgroup>';
    });
    [].forEach.call(document.querySelectorAll('.mode-select'), function (s) { s.innerHTML = groups; });
  }
  function setProgress(p, text) {
    // Minute-by-minute score checks update quietly, without dimming the table.
    if (p == null) st.quiet = false;
    else if (st.quiet) return;
    $('progress').hidden = p == null;
    $('top-controls').hidden = p == null;
    if (p != null) { $('fill').style.width = (p * 100).toFixed(0) + '%'; $('progress-text').textContent = text; }
    $('tw').classList.toggle('busy', p != null);
  }
  // The worker loads the same engine file this page uses.
  var ENGINE_URL = new URL(document.querySelector('script[src*="engine.js"]').getAttribute('src'), location.href).href;
  var WORKER_TAIL = 'self.onmessage=function(e){var m=e.data,P=CFP.prep(m.D,m.mode,m.picks),sim=new CFP.Sim(P,m.seed),t=CFP.emptyTally(P.n),min=800,done=0;' +
    'while(done<m.sims){var c=Math.min(1000,m.sims-done);CFP.baseBatch(sim,t,c);done+=c;if(done%4000===0)postMessage({p:done/m.sims*.8});}' +
    'var jobs=CFP.forcedJobs(P,t,min),forced={};jobs.forEach(function(j,i){forced[j.t]=CFP.forcedRun(sim,j,1000);if(i%5===0)postMessage({p:.8+.2*i/jobs.length});});' +
    'postMessage({result:{sims:m.sims,mode:m.mode,teams:CFP.summarize(P,t,forced,min),rating:Array.prototype.slice.call(P.R.subarray(0,P.fbs))}});};';
  function runJob(mode, picks, done) {
    // The same seed for every run of this model, so picks and live updates only move what they affect.
    var sims = SIMS, seed = CFP.seedFor(mode), id = ++jobId;
    if (worker) worker.terminate();
    worker = null;
    setProgress(0, 'Simulating ' + sims.toLocaleString() + ' seasons\u2026');
    var data = st.pendingD || D;
    function finish(result) {
      if (id !== jobId) return;
      // New ESPN data can reorder teams, so it replaces the old data only once its results exist.
      if (data !== D) {
        D = data; st.pendingD = null; schedCache = {}; results = {}; pickResults = {}; st.live = 'on';
        var open = {};
        D.games.forEach(function (g) { if (g.s !== 'post') open[g.id] = 1; });
        Object.keys(st.picks).forEach(function (k) { if (!open[k]) delete st.picks[k]; }); // that game has finished
      }
      lastRes = result;
      worker = null;
      done(result);
    }
    try {
      worker = new Worker(URL.createObjectURL(new Blob(['importScripts(' + JSON.stringify(ENGINE_URL) + ');\n' + WORKER_TAIL], { type: 'text/javascript' })));
      worker.onmessage = function (e) {
        if (e.data.result) finish(e.data.result);
        else setProgress(e.data.p, 'Simulating ' + sims.toLocaleString() + ' seasons\u2026');
      };
      worker.onerror = function () { worker = null; setTimeout(function () { finish(CFP.runAll(data, mode, sims, seed, 1000, picks)); }, 30); };
      worker.postMessage({ D: data, mode: mode, sims: sims, seed: seed, picks: picks });
    } catch (err) {
      setTimeout(function () { finish(CFP.runAll(data, mode, sims, seed, 1000, picks)); }, 30);
    }
  }
  // Makes sure the baseline and any picked scenario exist for the current ratings, then draws.
  function refresh() {
    var m = st.mode;
    if (st.pendingD || !results[m]) return runJob(m, null, function (r) { results[m] = r; refresh(); });
    if (hasPicks()) {
      var key = picksKey();
      if (!pickResults[key]) return runJob(m, JSON.parse(JSON.stringify(st.picks)), function (r) { pickResults[key] = r; refresh(); });
    }
    jobId++;
    if (worker) { worker.terminate(); worker = null; }
    setProgress(null);
    renderAll();
  }

  // Try ESPN directly. This works from a local copy of the file; the published viewer refuses it.
  var liveRaw = { weeks: {}, rankings: null, standings: null }, liveBusy = false;
  // auto: a minute-by-minute check. It reuses finished weeks and standings, so only active weeks are fetched.
  function tryLive(auto) {
    if (liveBusy) return;
    liveBusy = true;
    if (auto) st.quiet = true;
    var API = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
    var get = function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); };
    var kept = function (val, u) { return val ? Promise.resolve(val) : get(u); };
    kept(auto && liveRaw.rankings, API + '/rankings').then(function (r) { return CFP.withCfp(r, D.season, get); }).then(function (rankings) {
      liveRaw.rankings = rankings;
      var wk = [];
      for (var w = 1; w <= 15; w++) (function (week) {
        wk.push(kept(liveRaw.weeks[week], API + '/scoreboard?groups=80&limit=400&week=' + week + '&seasontype=2&dates=' + D.season).then(function (data) {
          var ev = data.events || [];
          if (ev.length && ev.every(function (e) { return e.status && e.status.type && e.status.type.completed; })) liveRaw.weeks[week] = data;
          return data;
        }));
      })(w);
      var fpi = auto ? null : get('https://site.web.api.espn.com/apis/fitt/v3/sports/football/college-football/powerindex?season=' + D.season + '&limit=200&region=us&lang=en').catch(function () { return null; });
      return Promise.all([Promise.all(wk), kept(liveRaw.standings, 'https://site.web.api.espn.com/apis/v2/sports/football/college-football/standings?group=80&season=' + D.season + '&level=3'), fpi]).then(function (x) {
        liveRaw.standings = x[1];
        var fresh = CFP.parseEspn({ weeks: x[0], rankings: rankings, standings: x[1] });
        var byId = {}; D.teams.forEach(function (t) { byId[t.id] = t; });
        fresh.teams.forEach(function (t) {
          var old = byId[t.id];
          t.r = old ? old.r : { massey: 28, sagarin: 45, predictor: 45 };
        });
        fresh.sources = D.sources;
        fresh.swMode = D.swMode;
        var oldGame = {}; D.games.forEach(function (g) { oldGame[g.id] = g; });
        fresh.games.forEach(function (g) { var o = oldGame[g.id]; if (o && o.sw != null) { g.sw = o.sw; g.swS = o.swS; } });
        // Teams share their rating objects with D, so new FPI values reach both copies.
        var fpiFresh = x[2] && CFP.applyFpi(fresh, x[2]);
        if (fpiFresh) { delete results.fpi; delete results.all; pickResults = {}; }
        var count = function (d, s) { return d.games.filter(function (g) { return g.s === s; }).length; };
        var changed = count(fresh, 'post') !== count(D, 'post') || count(fresh, 'in') > 0 || count(D, 'in') > 0 || fresh.rankDate !== D.rankDate;
        if (!changed) {
          st.live = 'same';
          st.quiet = false;
          renderStatus();
          renderLive();
          if (fpiFresh && (st.mode === 'fpi' || st.mode === 'all' || hasPicks())) refresh();
          return;
        }
        fresh.season = D.season; fresh.asOf = new Date().toISOString();
        st.pendingD = fresh;
        refresh();
      });
    }).catch(function () { st.live = 'blocked'; st.quiet = false; renderStatus(); renderLive(); }).then(function () { liveBusy = false; });
  }
  // Check again only when a game is on, or should have kicked off by now.
  function gamesActive() {
    var now = Date.now();
    return D.games.some(function (g) { return g.s === 'in' || (g.s === 'pre' && Date.parse(g.d) <= now); });
  }
  setInterval(function () {
    if (!document.hidden && !st.pendingD && gamesActive()) tryLive(true);
  }, 60000);
  // Coming back to the tab catches up right away instead of waiting for the next minute.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !st.pendingD && gamesActive()) tryLive(true);
  });

  // Controls
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sort) {
      var k = b.dataset.sort;
      if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = k === 'seed' || k === 'team' || k === 'rating' || k === 'conf' ? 1 : -1; }
      st.lockOrder = null;
      renderTable();
    } else if (b.dataset.view) {
      st.view = b.dataset.view;
      renderViewControls();
      renderTable();
    } else if (b.dataset.pick) {
      lockOrder();
      // Each press moves this team through blank, win, loss and back to blank.
      var current = st.picks[b.dataset.pick];
      if (!current) st.picks[b.dataset.pick] = b.dataset.team;
      else if (current === b.dataset.team) st.picks[b.dataset.pick] = b.dataset.opp;
      else delete st.picks[b.dataset.pick];
      st.quiet = false;
      renderPicksBar();
      renderLive();
      renderField();
      renderTable();
      // A short pause lets several picks in a row share one simulation.
      setProgress(0, 'Simulating\u2026');
      clearTimeout(pickTimer);
      pickTimer = setTimeout(refresh, 250);
    } else if (b.id === 'clear-picks') {
      st.picks = {};
      st.lockOrder = null;
      clearTimeout(pickTimer);
      refresh();
    } else if (b.dataset.bk) {
      // Like the Rankings table, each press cycles this team through W, L and blank (its opponent gets the opposite).
      var seed = +b.dataset.seed, opp = +b.dataset.opp, cur = st.bkPicks[b.dataset.bk];
      if (cur == null) st.bkPicks[b.dataset.bk] = seed; else if (cur === seed) st.bkPicks[b.dataset.bk] = opp; else delete st.bkPicks[b.dataset.bk];
      renderBracket();
    } else if (b.id === 'expand-table') {
      // Phones: switch between the compact table and every column.
      st.expanded = !st.expanded;
      b.setAttribute('aria-pressed', st.expanded);
      b.textContent = st.expanded ? 'Show fewer columns' : 'Show all columns';
      document.querySelector('.odds-table').classList.toggle('expanded', st.expanded);
      renderTable();
    } else if (b.id === 'bk-clear') {
      st.bkPicks = {};
      renderBracket();
    } else if (b.id === 'bk-sim') {
      st.bkSim = !st.bkSim;
      renderBracket();
    } else if (b.dataset.open) {
      st.open[b.dataset.open] = !st.open[b.dataset.open]; renderTable();
    } else if (b.dataset.field || b.id === 'field-close') {
      var fieldId = b.dataset.field || st.fieldOpen;
      st.fieldOpen = st.fieldOpen === fieldId ? null : fieldId;
      renderField();
      // Redrawing replaces the buttons, so keyboard focus goes back to this team.
      var fieldBtn = $('seeds').querySelector('[data-field="' + fieldId + '"]');
      if (fieldBtn) fieldBtn.focus();
    }
  });
  document.addEventListener('change', function (e) {
    var id = e.target.id;
    if (id === 'conf') {
      var v = e.target.value;
      if (v.indexOf('group:') === 0) { st.view = v.slice(6); st.conf = ''; } else { st.view = 'all'; st.conf = v; }
      renderTable();
    }
    else if (id === 'sb-conf') { st.sbConf = e.target.value; renderLive(); }
    else if (id === 'sb-sort') { st.sbSort = e.target.value; renderLive(); }
    else if (id === 'sb-week') { st.sbWeek = +e.target.value === weekGames().wk ? null : +e.target.value; renderLive(); }
    else if (e.target.classList.contains('mode-select')) {
      st.mode = e.target.value;
      [].forEach.call(document.querySelectorAll('.mode-select'), function (s) { s.value = st.mode; });
      st.quiet = false;
      st.lockOrder = null;
      clearTimeout(pickTimer);
      refresh();
    }
  });

  showPage();
  renderModes();
  renderViewControls();
  renderScoreboardControls();
  renderAll();
  tryLive();
  // Dark and light logos differ, so redraw when the theme changes.
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll); } catch (x) {}
  try { WIDE.addEventListener('change', renderTable); } catch (x) {}
  // js/theme.js sets data-theme when the button is pressed.
  new MutationObserver(renderAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
