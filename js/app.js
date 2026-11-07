// Odds and Scoreboard views: simulation runs, live ESPN updates and rendering.
(function () {
  'use strict';
  // data.js sets CFP_DATA: teams, games, ratings and the default simulation.
  var embedded = window.CFP_DATA;
  // 40,000 seasons gives about +/-0.5 points at 50% odds in roughly a second. More adds wait for little precision.
  var SIMS = 40000;
  var D = embedded.D, results = embedded.results, simsNote = {};
  var st = { mode: 'blend', picks: {}, sort: 'team', dir: 1, open: {}, conf: '', view: 'all', q: '', live: 'pending', running: false };
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
    for (var i = 0; i < D.fbs; i++) {
      var t = D.teams[i], r = R.teams[i], next = sc[i][0] || null;
      rows.push({ i: i, t: t, r: r, rec: record(i), next: next, rating: R.rating[i], base: results[st.mode] && results[st.mode].teams[i] });
    }
    return rows;
  }
  var COLS = {
    team: function (x) { return x.t.rank || 200 - x.r.cfp; }, rating: function (x) { return x.rating; }, next: function (x) { return x.r.pNext == null ? -1 : x.r.pNext; },
    cfp: function (x) { return x.r.cfp; }, bye: function (x) { return x.r.bye; }, champ: function (x) { return x.r.champ; },
    seed: function (x) { return x.r.seed == null ? 99 : x.r.seed; }, title: function (x) { return x.r.title; }
  };
  // Notre Dame sits with the power conferences and UConn with the G5.
  function inView(t) {
    if (st.view === 'all') return true;
    var power = CFP.P4.indexOf(t.conf) >= 0 || t.ab === 'ND';
    return st.view === 'p4' ? power : !power;
  }
  function renderViewControls() {
    $('view').innerHTML = [['all', 'All'], ['p4', 'Power 4'], ['g5', 'G5']].map(function (v) {
      return '<button type="button" data-view="' + v[0] + '" aria-pressed="' + (st.view === v[0]) + '">' + v[1] + '</button>';
    }).join('');
    var confs = {};
    for (var i = 0; i < D.fbs; i++) if (inView(D.teams[i])) confs[D.teams[i].conf] = 1;
    if (st.conf && !confs[st.conf]) st.conf = '';
    $('conf').innerHTML = '<option value="">All conferences</option>' + Object.keys(confs).sort(function (a, b) { return CFP.CONF_NAME[a] < CFP.CONF_NAME[b] ? -1 : 1; }).map(function (c) {
      return '<option value="' + c + '"' + (st.conf === c ? ' selected' : '') + '>' + esc(CFP.CONF_NAME[c] || c) + '</option>';
    }).join('');
  }
  function visible(rows) {
    var q = st.q.trim().toLowerCase();
    var out = rows.filter(function (x) {
      if (!inView(x.t)) return false;
      if (st.conf && x.t.conf !== st.conf) return false;
      return !q || (x.t.full + ' ' + x.t.ab).toLowerCase().indexOf(q) >= 0;
    });
    var f = COLS[st.sort], d = st.dir;
    out.sort(function (a, b) { return d * (f(a) - f(b)) || b.r.cfp - a.r.cfp; });
    return out;
  }
  function head() {
    function th(key, label, cls) {
      var s = st.sort === key ? (st.dir < 0 ? 'descending' : 'ascending') : 'none';
      return '<th class="' + (cls || '') + '" aria-sort="' + s + '"><button type="button" data-sort="' + key + '">' + label + '</button>';
    }
    // Fixed column widths live on these header classes. Columns marked sec are hidden on phones.
    $('head').innerHTML =
      th('team', 'CFP rank / team', 'first c-team') + '</th>' +
      th('rating', 'Rating', 'c-rating sec') + '</th>' +
      th('next', 'Next game', 'l c-next sec') + '</th>' +
      '<th class="pick c-pick">Pick</th>' +
      th('cfp', 'Make CFP', 'c-cfp') + '</th>' +
      th('bye', 'First-round bye', 'c-bye sec') + '</th>' +
      th('seed', 'Avg seed', 'c-seed sec') + '</th>' +
      th('champ', 'Win conf.', 'c-conf sec') + '</th>' +
      th('title', 'Win title', 'c-title sec') + '</th>';
  }
  function nextChance(g, t) {
    var pk = st.picks[g.id];
    if (!pk) return Math.round(g.p * 100) + '% to win';
    return '<b>' + (pk === t.id ? 'picked to win' : 'picked to lose') + '</b>';
  }
  function nextCell(x) {
    if (!x.next) return '<span class="next">Done<small>Regular season over</small></span>';
    var opp = D.teams[x.next.o], where = x.next.home === 1 ? 'vs' : x.next.home === -1 ? 'at' : 'vs';
    var isLive = x.next.s === 'in';
    var flag = isLive ? ' <span class="live-pill"><i></i>LIVE</span> <span class="score-now">' + (x.next.us > x.next.them ? 'Up ' : x.next.us < x.next.them ? 'Down ' : 'Tied ') + x.next.us + '-' + x.next.them + '</span>' : '';
    var day = new Date(x.next.d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
    return '<span class="next">' + where + ' ' + logo(opp, 18) + esc(opp.ab || opp.name) + flag + '<small>' + esc(isLive ? x.next.st : day) + ' · ' + nextChance(x.next, x.t) + '</small></span>';
  }
  // Phones hide the Next game column, so a short version sits under the team name.
  function shortNext(x) {
    if (!x.next) return '';
    var opp = D.teams[x.next.o], where = x.next.home === -1 ? 'at ' : 'vs ';
    if (x.next.s === 'in') return '<span class="tnext"><span class="live-pill"><i></i>LIVE</span> ' + (x.next.us > x.next.them ? 'Up ' : x.next.us < x.next.them ? 'Down ' : 'Tied ') + x.next.us + '-' + x.next.them + ' ' + where + esc(opp.ab || opp.name) + '</span>';
    return '<span class="tnext">' + where + esc(opp.ab || opp.name) + ' · ' + new Date(x.next.d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }) + '</span>';
  }
  // The headline numbers for one team. The field panel always shows them; table details show them on phones.
  function statsList(x, cls) {
    var R = x.r, delta = hasPicks() && x.base ? R.cfp - x.base.cfp : 0;
    function stat(label, value) { return '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>'; }
    return '<dl class="field-stats' + (cls ? ' ' + cls : '') + '">' +
      stat('Make CFP', pct(R.cfp) + (Math.abs(delta) >= 0.005 ? pts(delta) : '')) +
      stat('First-round bye', pct(R.bye)) +
      stat('Avg seed', R.seed ? R.seed.toFixed(1) : '—') +
      stat('Win conf.', x.t.conf === 'ind' ? '—' : pct(R.champ)) +
      stat('Win title', pct(R.title)) +
      stat('Rating', x.rating.toFixed(1)) +
    '</dl>';
  }
  function pts(delta) {
    return '<small class="' + (delta > 0 ? 'up' : 'down') + '">' + (delta > 0 ? '+' : '\u2212') + Math.abs(delta * 100).toFixed(0) + ' pts</small>';
  }
  function pickCell(x) {
    if (!x.next) return '\u2014';
    var pk = st.picks[x.next.id], won = pk === x.t.id, lost = !!pk && !won;
    var label = won ? x.t.name + ' picked to win. Press to pick a loss' : lost ? x.t.name + ' picked to lose. Press to clear the pick' : 'No pick for ' + x.t.name + '. Press to pick a win';
    return '<div class="mini"><button type="button" class="pick-box' + (won ? ' pick-w' : lost ? ' pick-l' : '') + '" data-pick="' + esc(x.next.id) + '" data-team="' + x.t.id + '" data-opp="' + esc(D.teams[x.next.o].id) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + (won ? 'W' : lost ? 'L' : '') + '</button></div>';
  }
  // Phones show three columns (styles.css hides the rest below 900px). A full-width row must span
  // exactly the visible columns, or the fixed table layout adds empty columns and squeezes the team name.
  var WIDE = matchMedia('(min-width: 900px)');
  function visibleColumns() { return WIDE.matches ? 9 : 3; }
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
      return '<span>' + (g.home === 1 ? 'vs ' : g.home === -1 ? 'at ' : 'vs ') + logo(o, 18) + esc(o.name) + (g.s === 'in' ? ' <span class="live">LIVE ' + g.us + '-' + g.them + '</span>' : '') + '</span><span>' + (st.picks[g.id] ? (st.picks[g.id] === x.t.id ? 'Picked win' : 'Picked loss') : Math.round(g.p * 100) + '%') + '</span>';
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
  function renderTable() {
    head();
    var rows = visible(buildRows());
    if (!rows.length) { $('body').innerHTML = '<tr><td class="empty" colspan="' + visibleColumns() + '">No teams match. Clear the search or pick another conference.</td></tr>'; return; }
    $('body').innerHTML = rows.map(function (x) {
      var conf = CFP.CONF_NAME[x.t.conf] || x.t.conf;
      var r = '<tr' + (x.next && x.next.s === 'in' ? ' class="live-row"' : '') + '><td class="first"><div class="teamcell"><span class="rk">' + (x.t.rank || '') + '</span>' + logo(x.t, 30) +
        '<span><button class="tname" type="button" data-open="' + x.t.id + '" aria-expanded="' + !!st.open[x.t.id] + '">' + esc(x.t.name) + '</button><span class="tmeta">' + x.rec.text + ' · ' + esc(conf) + '</span>' + shortNext(x) + '</span></div></td>' +
        '<td class="sec">' + x.rating.toFixed(1) + '</td><td class="l sec">' + nextCell(x) + '</td>' +
        '<td class="pick">' + pickCell(x) + '</td>' +
        '<td><div class="odds"><span class="v" style="--p:' + x.r.cfp.toFixed(3) + '">' + pct(x.r.cfp) + '</span>' + (hasPicks() && x.base && Math.abs(x.r.cfp - x.base.cfp) >= 0.005 ? pts(x.r.cfp - x.base.cfp) : '') + '</div></td>' +
        '<td class="sec">' + pct(x.r.bye) + '</td><td class="sec">' + (x.r.seed ? x.r.seed.toFixed(1) : '—') + '</td>' +
        '<td class="sec">' + (x.t.conf === 'ind' ? '—' : pct(x.r.champ)) + '</td><td class="sec">' + pct(x.r.title) + '</td></tr>';
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
  function renderField() {
    var all = buildRows().sort(function (a, b) { return b.r.cfp - a.r.cfp; });
    var field = all.slice(0, 12).sort(function (a, b) { return a.r.seed - b.r.seed; });
    $('seeds').innerHTML = field.map(function (x, i) {
      var isOpen = st.fieldOpen === x.t.id;
      return '<button type="button" class="seed' + (i < 4 ? ' bye' : '') + '" data-field="' + x.t.id + '" aria-expanded="' + isOpen + '" aria-controls="field-detail" aria-label="Seed ' + (i + 1) + ', ' + esc(x.t.name) + ', ' + pct(x.r.cfp) + ' to make the playoff. ' + (isOpen ? 'Hide' : 'Show') + ' details"><span class="n">' + (i + 1) + '</span><span class="ab">' + logo(x.t, 22) + esc(x.t.ab) + '</span><span class="pc">' + pct(x.r.cfp) + '</span></button>';
    }).join('');
    // A pick can drop the open team out of the 12, so it is looked up in all teams.
    var opened = all.filter(function (x) { return x.t.id === st.fieldOpen; })[0];
    $('field-detail').hidden = !opened;
    $('field-detail').innerHTML = opened ? fieldPanel(opened) : '';
    $('out').innerHTML = '<b>Next in line:</b> ' + all.slice(12, 16).map(function (x) { return esc(x.t.name) + ' ' + pct(x.r.cfp); }).join(', ');
    $('field-note').textContent = 'The 12 highest odds, ordered by average seed. Shaded teams hold first-round byes.';
  }
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
    var win = '';
    if (g.s !== 'post') {
      if (st.picks[g.id]) win = st.picks[g.id] === t.id ? 'Pick' : '';
      else if (nx && nx.id === g.id) win = Math.round(nx.p * 100) + '%';
      else win = '—';
    }
    return '<div class="lg-team">' + logo(t, 22) + '<span>' + esc(t.ab || t.name) + (t.rank ? ' <small>No. ' + t.rank + '</small>' : '') + '</span></div>' +
      '<div class="lg-score' + (score >= other ? ' lead' : '') + '">' + score + '</div>' +
      '<div class="lg-num">' + win + '</div>' +
      (r ? '<div class="lg-cfp" style="--p:' + r.cfp.toFixed(3) + '">' + pct(r.cfp) + '</div>' : '<div class="lg-num">—</div>');
  }
  function liveCard(g) {
    var isLive = g.s === 'in', isPre = g.s === 'pre', stakes = gameStakes(g), why = '';
    if (!isPre && !isLive) why = '';
    else if (st.picks[g.id]) why = 'Your pick is locked in, so these odds assume <b>' + esc(st.picks[g.id] === D.teams[g.h].id ? D.teams[g.h].ab : D.teams[g.a].ab) + '</b> wins.';
    else if (stakes && stakes.swing >= 0.01) why = '<b>' + esc(D.teams[stakes.i].ab) + '</b> is the most affected: <b>' + pct(stakes.win) + '</b> with a win, <b>' + pct(stakes.lose) + '</b> with a loss.';
    else if (stakes) why = 'Little effect on the playoff race.';
    else why = 'One team is a heavy favorite' + (isLive ? ' right now' : '') + ', so this barely moves the odds.';
    var top = isLive ? '<span class="live-pill"><i></i>LIVE</span><b>' + esc(g.st) + '</b>' :
      isPre ? '<span>Kickoff</span><b>' + etTime(g.d) + ' ET</b>' : '<span class="final-pill">FINAL</span><span>Today</span>';
    return '<article class="lg' + (isLive ? ' on' : '') + '">' +
      '<div class="lg-top">' + top + '</div>' +
      '<div class="lg-rows"><span></span><span class="h"></span><span class="h">' + (isPre || isLive ? 'Win' : '') + '</span><span class="h">Make CFP</span>' +
        liveRow(g, g.a, isPre ? '' : g.as, isPre ? '' : g.hs) + liveRow(g, g.h, isPre ? '' : g.hs, isPre ? '' : g.as) +
      '</div>' + (why ? '<p class="lg-why">' + why + '</p>' : '') +
    '</article>';
  }
  // Live games with the most playoff impact come first, then today's finished games.
  function renderLive() {
    var today = etDay(Date.now());
    var counts = function (g) { return g.h < D.fbs || g.a < D.fbs; };
    var R = res();
    var best = function (g) { return Math.max(g.h < D.fbs ? R.teams[g.h].cfp : 0, g.a < D.fbs ? R.teams[g.a].cfp : 0); };
    var stake = function (g) { var s = gameStakes(g); return s ? s.swing : 0; };
    var live = D.games.filter(function (g) { return g.s === 'in' && counts(g); }).sort(function (a, b) { return (st.picks[b.id] ? 1 : 0) - (st.picks[a.id] ? 1 : 0) || stake(b) - stake(a) || best(b) - best(a); });
    var done = D.games.filter(function (g) { return g.s === 'post' && counts(g) && etDay(g.d) === today; }).sort(function (a, b) { return best(b) - best(a); });
    var later = D.games.filter(function (g) { return g.s === 'pre' && counts(g) && etDay(g.d) === today; }).sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : stake(b) - stake(a); });
    function group(title, games, note) {
      return games.length ? '<div class="live-group"><h3>' + title + ' (' + games.length + ')</h3>' + (note ? '<p class="live-note">' + note + '</p>' : '') + '<div class="live-grid">' + games.map(liveCard).join('') + '</div></div>' : '';
    }
    var checked = st.live === 'blocked' ? '<b>Couldn’t reach ESPN.</b> Scores are from ' + etTime(D.asOf) + ' ET.' :
      'Scores from <b>' + etTime(D.asOf) + ' ET</b>' + (live.length ? ', checked every minute while this page is open.' : '.');
    var next = D.games.filter(function (g) { return g.s === 'pre' && counts(g); })[0];
    $('live-board').innerHTML = '<p class="live-note">' + checked + ' Win and Make CFP odds use the current score and clock.</p>' +
      (live.length || later.length || done.length ?
        group('In progress', live, 'Your picks first, then the biggest playoff impact.') + group('Later today', later) + group('Final today', done) :
        '<p class="live-empty">No games today.' + (next ? ' Next kickoff: ' + new Date(next.d).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET.' : '') + '</p>');
  }
  // Views: Odds (default) and Scoreboard, chosen by the address's #. About is its own page.
  var PAGES = { odds: 'CFP Odds Board', scoreboard: 'Scoreboard · CFP Odds Board' };
  function showPage() {
    var hash = location.hash.replace('#', ''), p = hash === 'live' ? 'scoreboard' : hash; // #live was the old name
    if (hash === 'about') { location.replace('about.html'); return hash; } // older links
    if (!PAGES[p]) p = $('page-scoreboard').hidden ? 'odds' : 'scoreboard';
    Object.keys(PAGES).forEach(function (k) { $('page-' + k).hidden = k !== p; });
    [].forEach.call(document.querySelectorAll('.tabs a'), function (a) {
      if (a.dataset.page === p) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = PAGES[p];
    // Each view gets its own title and intro, so the Scoreboard leads with scores.
    $('page-title').textContent = p === 'scoreboard' ? 'Scoreboard' : 'College Football Playoff odds';
    $('page-lede').textContent = p === 'scoreboard' ? 'Today’s games, with each team’s win chance and what the result means for its playoff odds.' : 'Each team’s chance of making the 12-team playoff, from simulating every remaining game, conference title game and committee ranking.';
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
      ? '<span><b>' + n + (n === 1 ? ' game' : ' games') + ' picked.</b> All odds assume ' + (n === 1 ? 'that result' : 'those results') + '; +/\u2212 shows the change.</span><button class="btn" id="clear-picks" type="button">Clear picks</button>'
      : '<span>Press a team\u2019s box to cycle its next game through <b>W</b>, <b>L</b> and blank. Its opponent gets the opposite result, and all odds update.</span>';
  }
  function renderAll() { renderPicksBar(); renderStatus(); renderLive(); renderField(); renderTable(); }

  function renderModes() {
    function option(k, label) { return '<option value="' + k + '"' + (st.mode === k ? ' selected' : '') + '>' + esc(label) + '</option>'; }
    var groups = '<optgroup label="Averages">' + option('blend', 'Massey + Sagarin') + option('all', 'All models average') + '</optgroup>';
    ['Point-based', 'Recent form', 'Results only'].forEach(function (g) {
      groups += '<optgroup label="' + g + '">' + D.sources.models.filter(function (m) { return m.group === g; }).map(function (m) { return option(m.k, m.label); }).join('') + '</optgroup>';
    });
    $('mode').innerHTML = groups;
  }
  function setProgress(p, text) {
    // Minute-by-minute score checks update quietly, without dimming the table.
    if (p == null) st.quiet = false;
    else if (st.quiet) return;
    $('progress').hidden = p == null;
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
    var sims = SIMS, seed =(Date.now() % 2147483647) | 1, id = ++jobId;
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
    kept(auto && liveRaw.rankings, API + '/rankings').then(function (rankings) {
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

  // Controls
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sort) {
      var k = b.dataset.sort;
      if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = k === 'seed' || k === 'team' ? 1 : -1; }
      renderTable();
    } else if (b.dataset.view) {
      st.view = b.dataset.view;
      renderViewControls();
      renderTable();
    } else if (b.dataset.pick) {
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
      clearTimeout(pickTimer);
      refresh();
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
    if (id === 'conf') { st.conf = e.target.value; renderTable(); }
    else if (id === 'mode') {
      st.mode = e.target.value;
      st.quiet = false;
      clearTimeout(pickTimer);
      refresh();
    }
  });
  $('q').addEventListener('input', function (e) { st.q = e.target.value; renderTable(); });

  showPage();
  renderModes();
  renderViewControls();
  renderAll();
  tryLive();
  // Dark and light logos differ, so redraw when the theme changes.
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll); } catch (x) {}
  try { WIDE.addEventListener('change', renderTable); } catch (x) {}
  // js/theme.js sets data-theme when the button is pressed.
  new MutationObserver(renderAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
