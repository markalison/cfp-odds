// CFP odds engine. Shared by build.mjs (Node), the page and its Web Worker.
// No DOM or Node APIs. Exposes one global: CFP.
var CFP = (function () {
  'use strict';

  var P4 = ['sec', 'big10', 'big12', 'acc'];
  var G6 = ['american', 'usa', 'midam', 'mwest', 'pac12', 'belt'];
  var CONF_NAME = {
    sec: 'SEC', big10: 'Big Ten', big12: 'Big 12', acc: 'ACC', american: 'American', usa: 'C-USA',
    midam: 'MAC', mwest: 'Mountain West', pac12: 'Pac-12', belt: 'Sun Belt', ind: 'Independent', fcs: 'FCS'
  };
  // Short codes for narrow screens.
  var CONF_ABBR = {
    sec: 'SEC', big10: 'B1G', big12: 'B12', acc: 'ACC', american: 'AAC', usa: 'CUSA',
    midam: 'MAC', mwest: 'MW', pac12: 'P12', belt: 'SBC', ind: 'IND', fcs: 'FCS'
  };
  var TITLE_RX = [
    [/\bSEC\b/, 'sec'], [/Big Ten/, 'big10'], [/Big 12/, 'big12'], [/\bACC\b/, 'acc'], [/American/, 'american'],
    [/Conference USA|C-USA/, 'usa'], [/\bMAC\b|Mid-American/, 'midam'], [/Mountain West/, 'mwest'],
    [/Pac-12/, 'pac12'], [/Sun Belt/, 'belt']
  ];

  // Model constants. Everything shown on the page's method section comes from here.
  var M = {
    gameSD: 14,        // points of single-game randomness around the spread
    teamSD: 3,         // per-simulation uncertainty in a team's true rating
    surprise: 3,       // rating points per unit of (result - expected) after each game
    wRating: 0.65,       // weight on the power rating itself
    wLoss: 7,          // committee points per loss
    wLoss3: 2,         // extra points per loss beyond the second
    wTitleLoss: 0.5,   // share of a loss charged for a title-game defeat
    wSos: 0.5,         // per point of average opponent rating
    wTop10: 2.5,       // per win over a final top-10 team
    wTop25: 1.25,      // per win over a final 11-25 team
    wBadLoss: 3,       // extra per loss to a team outside the top 60
    wChampP4: 4,       // power-conference champion
    wChampG6: 2,       // other-conference champion
    wG6: -2,           // non-power schedule discount
    wAnchor: 0.6,      // how much of the current CFP ranking's opinion carries forward
    committeeSD: 2.2,  // per-simulation committee disagreement
    h2hWindow: 3       // a head-to-head winner jumps a team within this many points
  };

  // ---------- ESPN parsing ----------
  function parseEspn(raw) {
    var teams = [], byId = {};
    function addTeam(t, conf, div) {
      if (byId[t.id] != null) return byId[t.id];
      byId[t.id] = teams.length;
      teams.push({
        id: String(t.id), ab: t.abbreviation || '', name: t.location || t.displayName || t.shortDisplayName || t.name,
        full: t.displayName || t.name, color: t.color || null, conf: conf, div: div || null, rank: null
      });
      return byId[t.id];
    }
    var confKey = { american: 'american', acc: 'acc', big12: 'big12', big10: 'big10', usa: 'usa', ind: 'ind', midam: 'midam', mwest: 'mwest', pac12: 'pac12', sec: 'sec', belt: 'belt' };
    (raw.standings.children || []).forEach(function (c) {
      var key = confKey[c.abbreviation] || String(c.abbreviation).toLowerCase();
      if (c.standings && c.standings.entries && c.standings.entries.length) {
        c.standings.entries.forEach(function (e) { addTeam(e.team, key); });
      }
      (c.children || []).forEach(function (sub) {
        ((sub.standings && sub.standings.entries) || []).forEach(function (e) { addTeam(e.team, key, sub.name); });
      });
    });
    var fbsCount = teams.length, games = [], titles = [], seen = {};
    (raw.weeks || []).forEach(function (wk) {
      (wk.events || []).forEach(function (ev) {
        if (seen[ev.id]) return;
        seen[ev.id] = 1;
        var c = ev.competitions && ev.competitions[0];
        if (!c) return;
        var st = (ev.status && ev.status.type) || (c.status && c.status.type) || {};
        if (/CANCEL|POSTPONED|FORFEIT/i.test(st.name || '')) return;
        var note = (c.notes && c.notes[0] && c.notes[0].headline) || '';
        var hc = null, ac = null;
        (c.competitors || []).forEach(function (x) { if (x.homeAway === 'home') hc = x; else ac = x; });
        if (!hc || !ac) return;
        var state = st.state === 'post' || st.completed ? 'post' : st.state === 'in' ? 'in' : 'pre';
        var titleConf = null;
        if (/Championship/i.test(note)) TITLE_RX.forEach(function (r) { if (!titleConf && r[0].test(note)) titleConf = r[1]; });
        var known = +hc.id > 0 && +ac.id > 0;
        if (titleConf) {
          var tg = { conf: titleConf, n: c.neutralSite ? 1 : 0, d: ev.date, s: state, h: -1, a: -1, w: -1 };
          if (known) {
            tg.h = addTeam(hc.team, 'fcs'); tg.a = addTeam(ac.team, 'fcs');
            if (state === 'post') tg.w = +hc.score > +ac.score ? tg.h : tg.a;
          }
          titles.push(tg);
          return;
        }
        if (!known) return;
        var h = addTeam(hc.team, 'fcs'), a = addTeam(ac.team, 'fcs');
        var g = { id: String(ev.id), d: ev.date, h: h, a: a, n: c.neutralSite ? 1 : 0, c: c.conferenceCompetition ? 1 : 0, s: state, w: -1, wk: ev.week ? ev.week.number : null };
        // TV networks, national first, e.g. ["ABC"] or ["ESPN+", "SECN+"].
        var tv = [];
        (c.broadcasts || []).slice().sort(function (x, y) { return (x.market === 'national' ? 0 : 1) - (y.market === 'national' ? 0 : 1); })
          .forEach(function (b) { (b.names || []).forEach(function (nm) { if (nm && tv.indexOf(nm) < 0) tv.push(nm); }); });
        if (tv.length) g.tv = tv.slice(0, 2);
        if (state === 'post') {
          g.hs = +hc.score; g.as = +ac.score;
          g.w = (hc.winner === true || (hc.winner !== false && g.hs > g.as)) ? h : a;
        } else if (state === 'in') {
          // Share of regulation left: 4 quarters of 900 seconds. Overtime counts as a sliver.
          var es = ev.status || {}, per = +es.period || 1, clk = es.clock == null ? 900 : +es.clock;
          g.hs = +hc.score || 0; g.as = +ac.score || 0;
          g.frac = per > 4 ? 0.03 : Math.min(1, Math.max(0.003, ((4 - per) * 900 + clk) / 3600));
          g.st = st.shortDetail || st.detail || '';
        }
        games.push(g);
      });
    });
    games.sort(function (x, y) { return x.d < y.d ? -1 : x.d > y.d ? 1 : 0; });
    var rankDate = null, rankings = raw.rankings && raw.rankings.rankings;
    var cfp = rankings && rankings.filter(function (r) { return r.type === 'cfp'; })[0];
    if (cfp) {
      rankDate = cfp.date;
      cfp.ranks.forEach(function (r) { var i = byId[r.team.id]; if (i != null) teams[i].rank = r.current; });
    }
    return { teams: teams, fbs: fbsCount, games: games, titles: titles, rankDate: rankDate, rankLabel: cfp ? cfp.headline : null, hasCfp: !!cfp };
  }

  // Ratings are aligned by the build step to ESPN team order.
  // Every model sits on Sagarin Predictor's scale (it covers FBS and FCS), and a team a model doesn't cover,
  // such as an FCS opponent, falls back to Sagarin Predictor.
  function ratingFor(team, mode, sources) {
    var r = team.r || {};
    if (mode === 'blend') return r.fpi == null ? r.predictor : 0.5 * (r.fpi + r.predictor); // FPI + Sagarin
    if (mode === 'all') {
      var sum = 0;
      sources.consensus.forEach(function (k) { sum += r[k] == null ? r.predictor : r[k]; });
      return sum / sources.consensus.length;
    }
    return r[mode] == null ? r.predictor : r[mode];
  }

  // Puts ESPN's FPI on Sagarin Predictor's scale. FPI is already in points, so only the average shifts.
  function applyFpi(D, json) {
    var byId = {}, sumF = 0, sumM = 0, n = 0, i;
    (json.teams || []).forEach(function (x) {
      var c = (x.categories || []).filter(function (k) { return k.name === 'fpi'; })[0];
      if (c && typeof c.values[0] === 'number') byId[String(x.team.id)] = c.values[0];
    });
    for (i = 0; i < D.fbs; i++) {
      var f = byId[D.teams[i].id];
      if (f != null) { sumF += f; sumM += D.teams[i].r.predictor; n++; }
    }
    if (n < D.fbs - 8) return false;
    var shift = (sumM - sumF) / n;
    D.teams.forEach(function (t, idx) {
      var v = byId[t.id];
      t.r.fpi = idx < D.fbs && v != null ? Math.round((v + shift) * 100) / 100 : null;
    });
    // ESPN's update time falls after that day's games, so results run through the day before.
    var updated = Date.parse(json.lastUpdated);
    D.sources.thru.fpi = new Date((isNaN(updated) ? Date.now() : updated) - 864e5).toISOString().slice(0, 10);
    return true;
  }

  function phi(x) {
    // Normal CDF (Abramowitz & Stegun 26.2.17)
    var a = Math.abs(x), t = 1 / (1 + 0.2316419 * a);
    var p = Math.exp(-0.5 * a * a) * 0.39894228 * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x > 0 ? 1 - p : p;
  }

  var GN = null;
  function gaussTable() {
    if (GN) return GN;
    GN = new Float64Array(65536);
    for (var i = 0; i < 65536; i += 2) {
      var u = (i + 0.5) / 65536, v = ((i * 40503) % 65536 + 0.5) / 65536;
      var m = Math.sqrt(-2 * Math.log(u));
      GN[i] = m * Math.cos(6.283185307 * v);
      GN[i + 1] = m * Math.sin(6.283185307 * v);
    }
    return GN;
  }

  // ---------- CFP ranking fallback ----------
  // The site API's rankings feed only lists the newest polls. From Sunday, when the new AP and Coaches polls
  // come out, until the committee's Tuesday release, it has no CFP ranking at all. ESPN's core API keeps every
  // week's CFP ranking (ranking type 21), so the latest one is read from there and added to the feed.
  function withCfp(rankings, season, get) {
    var list = (rankings && rankings.rankings) || [];
    if (list.some(function (r) { return r.type === 'cfp'; })) return Promise.resolve(rankings);
    var https = function (u) { return String(u).replace(/^http:/, 'https:'); };
    return get('https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/' + season + '/rankings/21').then(function (idx) {
      var weeks = (idx && idx.rankings) || [];
      if (!weeks.length) return rankings;
      return get(https(weeks[weeks.length - 1].$ref)).then(function (wk) {
        if (!wk || !wk.ranks || !wk.ranks.length) return rankings;
        var cfp = { type: 'cfp', name: wk.name, headline: wk.headline, date: wk.date, ranks: wk.ranks.map(function (r) {
          var id = ((r.team && r.team.$ref) || '').match(/teams\/(\d+)/);
          return { current: r.current, team: { id: id ? id[1] : null } };
        }).filter(function (r) { return r.team.id; }) };
        return Object.assign({}, rankings, { rankings: list.concat([cfp]) });
      });
    }).catch(function () { return rankings; });
  }

  // ---------- Playoff impact of single games ----------
  // Total swing in Make CFP odds across every team, for each game in ids. All of those games go back to
  // unplayed (a pre-game view): a final compares its real result with the game left open; any other game
  // compares a home win with an away win. Every run shares one seed and one game list (finals become locked
  // games), so each difference comes from that one game.
  function measureSwings(D, mode, seed, sims, ids) {
    var set = {}, lock = {}, done = [], open = [], out = {};
    ids.forEach(function (id) { set[id] = 1; });
    D.games.forEach(function (g) {
      if (!set[g.id]) return;
      if (g.s === 'post') { lock[g.id] = D.teams[g.w].id; done.push(g.id); }
      else open.push({ id: g.id, h: D.teams[g.h].id, a: D.teams[g.a].id });
    });
    var data = Object.assign({}, D, { games: D.games.map(function (g) { return set[g.id] ? Object.assign({}, g, { s: 'pre', hs: 0, as: 0, w: null }) : g; }) });
    function cfp(lk) {
      var P = prep(data, mode, lk), sim = new Sim(P, seed), t = emptyTally(P.n), r = [];
      baseBatch(sim, t, sims);
      for (var i = 0; i < P.fbs; i++) r.push(t.cfp[i] / sims);
      return r;
    }
    function diff(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return Math.round(s * 1e4) / 1e4; }
    function withPick(id, v) { var pk = {}; for (var k in lock) if (k !== id) pk[k] = lock[k]; if (v) pk[id] = v; return pk; }
    var base = done.length ? cfp(lock) : null;
    done.forEach(function (id) { out[id] = diff(cfp(withPick(id, null)), base); });
    open.forEach(function (o) { out[o.id] = diff(cfp(withPick(o.id, o.h)), cfp(withPick(o.id, o.a))); });
    return out;
  }

  // ---------- Prepare one rating mode ----------
  // picks: { gameId: ESPN id of the team picked to win }
  function prep(D, mode, picks) {
    var T = D.teams, n = T.length, fbs = D.fbs, R = new Float64Array(n), hfa = D.sources.hfa[mode] || 2.5;
    var thru = D.sources.thru, used = mode === 'blend' ? ['fpi', 'predictor'] : mode === 'all' ? D.sources.consensus : [mode];
    var total = Math.sqrt(M.gameSD * M.gameSD + 2 * M.teamSD * M.teamSD), i;
    for (i = 0; i < n; i++) R[i] = ratingFor(T[i], mode, D.sources);
    // Games finished after the ratings were published still move the rating.
    // Kickoffs are UTC, so shift back 8 hours to get the US calendar day the sources use.
    D.games.forEach(function (g) {
      if (g.s !== 'post') return;
      var day = new Date(Date.parse(g.d) - 288e5).toISOString().slice(0, 10);
      // The share of the models in use that haven't seen this result yet.
      var share = used.filter(function (k) { return day > thru[k]; }).length / used.length;
      if (!share) return;
      var p = phi((R[g.h] - R[g.a] + (g.n ? 0 : hfa)) / total), res = g.w === g.h ? 1 : 0;
      R[g.h] += share * M.surprise * (res - p); R[g.a] -= share * M.surprise * (res - p);
    });
    var W0 = new Int16Array(n), L0 = new Int16Array(n), CW0 = new Int16Array(n), CL0 = new Int16Array(n);
    var H0 = new Int8Array(n * n), sosSum = new Float64Array(n), sosN = new Int16Array(n);
    var maxPairs = D.games.length + 40, pw = new Int16Array(maxPairs), pl = new Int16Array(maxPairs), np = 0;
    var todoH = [], todoA = [], todoS = [], todoP = [], todoC = [], todoCur = [], todoF = [], todoLive = [], todoLock = [], nextGame = new Int32Array(n).fill(-1), remainCount = new Int16Array(n), gameIdx = [];
    D.games.forEach(function (g) {
      sosSum[g.h] += R[g.a]; sosN[g.h]++; sosSum[g.a] += R[g.h]; sosN[g.a]++;
      if (g.s === 'post') {
        var w = g.w, l = w === g.h ? g.a : g.h;
        W0[w]++; L0[l]++;
        if (g.c) { CW0[w]++; CL0[l]++; }
        H0[w * n + l]++; pw[np] = w; pl[np] = l; np++;
      } else {
        var k = todoH.length, sp = R[g.h] - R[g.a] + (g.n ? 0 : hfa);
        todoH.push(g.h); todoA.push(g.a); todoS.push(sp); todoP.push(phi(sp / total)); todoC.push(g.c); gameIdx.push(g.id);
        var f = g.s === 'in' ? g.frac : 1, cur = g.s === 'in' ? g.hs - g.as : 0;
        todoCur.push(cur); todoF.push(f);
        var pk = picks ? picks[g.id] : null;
        todoLock.push(pk == null ? -1 : T[g.h].id === pk ? g.h : T[g.a].id === pk ? g.a : -1);
        todoLive.push(phi((cur + f * sp) / Math.sqrt(f * M.gameSD * M.gameSD + f * f * 2 * M.teamSD * M.teamSD)));
        if (nextGame[g.h] < 0) nextGame[g.h] = k;
        if (nextGame[g.a] < 0) nextGame[g.a] = k;
        remainCount[g.h]++; remainCount[g.a]++;
      }
    });
    var sos = new Float64Array(n), sosAll = 0, sosCt = 0;
    for (i = 0; i < n; i++) { sos[i] = sosN[i] ? sosSum[i] / sosN[i] : 0; if (i < fbs) { sosAll += sos[i]; sosCt++; } }
    var sosMean = sosAll / sosCt;

    // Conferences and title games
    var confs = {};
    for (i = 0; i < fbs; i++) { var c = T[i].conf; (confs[c] = confs[c] || []).push(i); }
    var titles = D.titles.filter(function (t) { return confs[t.conf]; }).map(function (t) {
      var divs = null;
      if (confs[t.conf].some(function (x) { return T[x].div; })) {
        var m = {};
        confs[t.conf].forEach(function (x) { (m[T[x].div] = m[T[x].div] || []).push(x); });
        divs = Object.keys(m).map(function (k) { return m[k]; });
      }
      return { conf: t.conf, members: confs[t.conf], divs: divs, n: t.n, h: t.h, a: t.a, w: t.w, s: t.s };
    });
    var isP4 = new Uint8Array(n), isG6 = new Uint8Array(n), ND = -1;
    for (i = 0; i < fbs; i++) {
      isP4[i] = P4.indexOf(T[i].conf) >= 0 ? 1 : 0;
      isG6[i] = G6.indexOf(T[i].conf) >= 0 ? 1 : 0;
      if (T[i].ab === 'ND') ND = i;
    }
    var P = {
      D: D, mode: mode, n: n, fbs: fbs, R: R, hfa: hfa, total: total, W0: W0, L0: L0, CW0: CW0, CL0: CL0, H0: H0, sos: sos, sosMean: sosMean,
      pw: pw, pl: pl, np: np, tH: Int16Array.from(todoH), tA: Int16Array.from(todoA), tS: Float64Array.from(todoS), tP: Float64Array.from(todoP), tC: Uint8Array.from(todoC), tCur: Float64Array.from(todoCur), tF: Float64Array.from(todoF), tRootF: Float64Array.from(todoF.map(Math.sqrt)), tLive: Float64Array.from(todoLive), tLock: Int16Array.from(todoLock), gameIdx: gameIdx,
      nextGame: nextGame, remainCount: remainCount, titles: titles, isP4: isP4, isG6: isG6, ND: ND, anchor: new Float64Array(n)
    };
    computeAnchor(P);
    return P;
  }

  // Model score from a resume. Shared by the anchor fit and each simulation.
  var SCR = {};
  function scoreInto(P, S, post, L, tL, pw, pl, np, champ) {
    var fbs = P.fbs, n = P.n, i, q = SCR.q && SCR.q.length === fbs ? SCR.q : (SCR.q = new Float64Array(fbs));
    var qv = SCR.qv && SCR.qv.length === n ? SCR.qv : (SCR.qv = new Float64Array(n));
    for (i = 0; i < fbs; i++) { qv[i] = post[i] - 4 * L[i]; q[i] = qv[i]; }
    for (i = fbs; i < n; i++) qv[i] = -1e9;
    q.sort();
    var t10 = q[fbs - 10], t25 = q[fbs - 25], t60 = q[fbs - 60];
    for (i = 0; i < fbs; i++) {
      var effL = L[i] - (1 - M.wTitleLoss) * tL[i];
      S[i] = M.wRating * post[i] - M.wLoss * effL - (effL > 2 ? M.wLoss3 * (effL - 2) : 0) + M.wSos * (P.sos[i] - P.sosMean) + (P.isP4[i] ? 0 : (P.isG6[i] ? M.wG6 : 0));
      if (champ[i]) S[i] += P.isP4[i] ? M.wChampP4 : M.wChampG6;
    }
    for (i = 0; i < np; i++) {
      var w = pw[i], l = pl[i];
      if (w < fbs) { var qq = qv[l]; if (qq >= t10) S[w] += M.wTop10; else if (qq >= t25) S[w] += M.wTop25; }
      if (l < fbs && qv[w] < t60) S[l] -= M.wBadLoss;
    }
  }

  // The next CFP ranking as we expect it: every final so far (including games since the last ranking),
  // scored like the committee, plus each team's full committee bias from computeAnchor. With no games since
  // the last ranking this gives back that ranking exactly. Returns ranks (1 = first) for FBS teams, the
  // number of finals since the last ranking, or null without a ranking.
  function projectRanking(P) {
    var D = P.D, n = P.n, fbs = P.fbs, i;
    if (!D.rankDate) return null;
    var L = new Int16Array(n), tL = new Int16Array(n), champ = new Uint8Array(n), pw = new Int16Array(D.games.length), pl = new Int16Array(D.games.length), np = 0, since = 0;
    D.games.forEach(function (g) {
      if (g.s !== 'post') return;
      var w = g.w, l = w === g.h ? g.a : g.h;
      L[l]++; pw[np] = w; pl[np] = l; np++;
      if (g.d >= D.rankDate && (g.h < fbs || g.a < fbs)) since++;
    });
    var S = new Float64Array(n);
    scoreInto(P, S, P.R, L, tL, pw, pl, np, champ);
    var order = [];
    for (i = 0; i < fbs; i++) order.push(i);
    order.sort(function (a, b) { return (S[b] + P.anchor[b]) - (S[a] + P.anchor[a]); });
    var rank = new Int16Array(n);
    order.forEach(function (t, k) { rank[t] = k + 1; });
    return { rank: rank, since: since };
  }

  // Compare the model with the committee's latest ranking and carry part of the difference forward.
  function computeAnchor(P) {
    var D = P.D, T = D.teams, n = P.n, fbs = P.fbs, i;
    if (!D.rankDate) return;
    var L = new Int16Array(n), tL = new Int16Array(n), champ = new Uint8Array(n), pw = new Int16Array(P.pw.length), pl = new Int16Array(P.pw.length), np = 0;
    D.games.forEach(function (g) {
      if (g.s !== 'post' || g.d >= D.rankDate) return;
      var w = g.w, l = w === g.h ? g.a : g.h;
      L[l]++; pw[np] = w; pl[np] = l; np++;
    });
    var S = new Float64Array(n);
    scoreInto(P, S, P.R, L, tL, pw, pl, np, champ);
    var sorted = Array.prototype.slice.call(S.subarray(0, fbs)).sort(function (a, b) { return b - a; });
    P.scoreNow = S;
    for (i = 0; i < fbs; i++) {
      if (T[i].rank) P.anchor[i] = sorted[T[i].rank - 1] - S[i];
      else P.anchor[i] = Math.min(0, sorted[25] - S[i]);
    }
  }

  // ---------- Simulator ----------
  function Sim(P, seed) {
    var n = P.n, fbs = P.fbs, m = P.tH.length;
    this.P = P;
    this.s = (seed >>> 0) || 88172645;
    this.G = gaussTable();
    this.eps = new Float64Array(n); this.post = new Float64Array(n); this.score = new Float64Array(n);
    this.L = new Int16Array(n); this.W = new Int16Array(n); this.CW = new Int16Array(n); this.CL = new Int16Array(n); this.tL = new Int16Array(n);
    this.H = new Int8Array(n * n); this.champ = new Uint8Array(n);
    this.pw = new Int16Array(P.pw); this.pl = new Int16Array(P.pl);
    this.res = new Int16Array(m); this.order = new Int16Array(fbs); this.seeds = new Int16Array(12);
    this.titleWin = new Int16Array(P.titles.length); this.inTitle = new Uint8Array(n);
    this.titleLoss = new Int16Array(n);
    this.orderArr = []; for (var i = 0; i < fbs; i++) this.orderArr.push(i);
  }
  Sim.prototype.g = function () {
    var x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x;
    return this.G[(x >>> 8) & 65535];
  };

  // Rank tied teams: head-to-head inside the group, then overall losses, then rating.
  Sim.prototype.pickFrom = function (list, exclude) {
    var P = this.P, n = P.n, CW = this.CW, CL = this.CL, best = -1, tied = [], i;
    for (i = 0; i < list.length; i++) {
      var t = list[i];
      if (t === exclude) continue;
      var gp = CW[t] + CL[t], pct = gp ? CW[t] / gp : 0;
      if (pct > best + 1e-9) { best = pct; tied = [t]; }
      else if (Math.abs(pct - best) <= 1e-9) tied.push(t);
    }
    if (tied.length === 1) return tied[0];
    var bestT = -1, bestV = -1e9;
    for (i = 0; i < tied.length; i++) {
      var a = tied[i], hw = 0, hl = 0;
      for (var j = 0; j < tied.length; j++) {
        if (j === i) continue;
        hw += this.H[a * n + tied[j]]; hl += this.H[tied[j] * n + a];
      }
      var v = (hw + hl ? (hw - hl) / (hw + hl) : 0) * 1000 - this.L[a] * 10 + (P.R[a] + this.eps[a]) * 0.01;
      if (v > bestV) { bestV = v; bestT = a; }
    }
    return bestT;
  };

  // Picked games always go to the picked team. forced: team that must win its next game, or -1.
  Sim.prototype.run = function (forced) {
    var P = this.P, n = P.n, fbs = P.fbs, m = P.tH.length, i, eps = this.eps, post = this.post, L = this.L, CW = this.CW, CL = this.CL, H = this.H, R = P.R;
    for (i = 0; i < n; i++) { eps[i] = P.R[i] === 0 ? 0 : this.g() * M.teamSD; post[i] = R[i]; }
    L.set(P.L0); CW.set(P.CW0); CL.set(P.CL0); H.set(P.H0);
    this.tL.fill(0); this.champ.fill(0);
    var np = P.np, pw = this.pw, pl = this.pl, nextOfForced = forced >= 0 ? P.nextGame[forced] : -1;
    for (var k = 0; k < m; k++) {
      // Every game takes its random draw, even when a pick decides it. That keeps the rest of the season on
      // the same random numbers, so a pick only changes the seasons it affects (common random numbers).
      var h = P.tH[k], a = P.tA[k], w, z = this.g();
      if (P.tLock[k] >= 0) {
        w = P.tLock[k];
      } else if (k === nextOfForced) {
        w = forced;
      } else {
        w = P.tCur[k] + P.tF[k] * (P.tS[k] + eps[h] - eps[a]) + P.tRootF[k] * z * M.gameSD > 0 ? h : a;
      }
      var l = w === h ? a : h;
      this.res[k] = w;
      L[l]++; H[w * n + l]++;
      if (P.tC[k]) { CW[w]++; CL[l]++; }
      pw[np] = w; pl[np] = l; np++;
      var sur = M.surprise * ((w === h ? 1 : 0) - P.tP[k]);
      post[h] += sur; post[a] -= sur;
    }
    // Conference title games
    var champs = this.champ, g6Champs = [], inT = this.inTitle;
    inT.fill(0);
    for (i = 0; i < P.titles.length; i++) {
      var tg = P.titles[i], x, y, wt;
      if (tg.h >= 0 && tg.a >= 0) { x = tg.h; y = tg.a; }
      else if (tg.divs) { x = this.pickFrom(tg.divs[0], -1); y = this.pickFrom(tg.divs[1], -1); }
      else { x = this.pickFrom(tg.members, -1); y = this.pickFrom(tg.members, x); }
      inT[x] = 1; inT[y] = 1;
      if (tg.w >= 0) wt = tg.w;
      else {
        // Non-neutral title games are hosted by the better conference record.
        var xh = tg.n ? 0 : ((CW[x] - CL[x]) >= (CW[y] - CL[y]) ? P.hfa : -P.hfa);
        var spr = R[x] - R[y] + xh;
        wt = spr + eps[x] - eps[y] + this.g() * M.gameSD > 0 ? x : y;
        var pe = phi(spr / P.total), sr = M.surprise * ((wt === x ? 1 : 0) - pe);
        post[x] += sr; post[y] -= sr;
        var lt = wt === x ? y : x;
        L[lt]++; this.tL[lt]++; H[wt * n + lt]++;
        pw[np] = wt; pl[np] = lt; np++;
      }
      champs[wt] = 1;
      this.titleWin[i] = wt;
      if (P.isG6[wt]) g6Champs.push(wt);
    }
    // Committee ranking
    var S = this.score;
    scoreInto(P, S, post, L, this.tL, pw, pl, np, champs);
    for (i = 0; i < fbs; i++) S[i] += M.wAnchor * P.anchor[i] + this.g() * M.committeeSD;
    var ord = this.orderArr;
    ord.sort(function (p, q) { return S[q] - S[p]; });
    for (i = 0; i < 18; i++) {
      var hi = ord[i], lo = ord[i + 1];
      if (H[lo * n + hi] > H[hi * n + lo] && S[hi] - S[lo] < M.h2hWindow) { ord[i] = lo; ord[i + 1] = hi; }
    }
    // Field: P4 champions, best other champion, Notre Dame if top 12, then at-large by rank. Seeds follow the ranking.
    var rankOf = this.rankOf || (this.rankOf = new Int16Array(n));
    rankOf.fill(999);
    for (i = 0; i < fbs; i++) rankOf[ord[i]] = i;
    var aq = this.aq || (this.aq = new Uint8Array(n));
    aq.fill(0);
    var nAq = 0;
    for (i = 0; i < P.titles.length; i++) {
      var ch = this.titleWin[i];
      if (P.isP4[ch] && !aq[ch]) { aq[ch] = 1; nAq++; }
    }
    if (g6Champs.length) {
      var bestG = g6Champs[0];
      for (i = 1; i < g6Champs.length; i++) if (rankOf[g6Champs[i]] < rankOf[bestG]) bestG = g6Champs[i];
      if (!aq[bestG]) { aq[bestG] = 1; nAq++; }
    }
    if (P.ND >= 0 && rankOf[P.ND] < 12 && !aq[P.ND]) { aq[P.ND] = 1; nAq++; }
    var open = 12 - nAq, sd = this.seeds, sc = 0;
    for (i = 0; i < fbs && sc < 12; i++) {
      var t = ord[i];
      if (aq[t]) sd[sc++] = t;
      else if (open > 0) { sd[sc++] = t; open--; }
    }
    this.aqFlags = aq;
    return sd;
  };

  // Plays the bracket: 5v12, 8v9, 6v11, 7v10; then 1,4,2,3 enter. No reseeding.
  Sim.prototype.bracket = function () {
    var P = this.P, sd = this.seeds, R = P.R, e = this.eps, self = this;
    function pick(a, b, home) { return R[a] - R[b] + e[a] - e[b] + (home ? P.hfa : 0) + self.g() * M.gameSD > 0 ? a : b; }
    var a512 = pick(sd[4], sd[11], 1), a89 = pick(sd[7], sd[8], 1), a611 = pick(sd[5], sd[10], 1), a710 = pick(sd[6], sd[9], 1);
    var q1 = pick(sd[0], a89, 0), q4 = pick(sd[3], a512, 0), q2 = pick(sd[1], a710, 0), q3 = pick(sd[2], a611, 0);
    return pick(pick(q1, q4, 0), pick(q2, q3, 0), 0);
  };

  // ---------- Runs ----------
  function emptyTally(n) {
    return {
      sims: 0, cfp: new Int32Array(n), bye: new Int32Array(n), host: new Int32Array(n), aq: new Int32Array(n), champ: new Int32Array(n), ccg: new Int32Array(n),
      title: new Int32Array(n), seedSum: new Float64Array(n), seedHist: new Int32Array(n * 12), nextW: new Int32Array(n), cfpNextW: new Int32Array(n)
    };
  }
  function baseBatch(sim, tally, count) {
    var P = sim.P, n = P.n, inField = sim.inField || (sim.inField = new Uint8Array(n)), res = sim.res, i, t, c;
    for (c = 0; c < count; c++) {
      var sd = sim.run(-1);
      inField.fill(0);
      tally.sims++;
      for (i = 0; i < 12; i++) {
        t = sd[i]; inField[t] = 1;
        tally.cfp[t]++; tally.seedSum[t] += i + 1; tally.seedHist[t * 12 + i]++;
        if (i < 4) tally.bye[t]++; else if (i < 8) tally.host[t]++;
        if (sim.aqFlags[t]) tally.aq[t]++;
      }
      for (i = 0; i < P.titles.length; i++) tally.champ[sim.titleWin[i]]++;
      for (t = 0; t < n; t++) {
        if (sim.inTitle[t]) tally.ccg[t]++;
        var ng = P.nextGame[t];
        if (ng >= 0 && res[ng] === t) { tally.nextW[t]++; if (inField[t]) tally.cfpNextW[t]++; }
      }
      tally.title[sim.bracket()]++;
    }
  }
  // Teams a filtered sample cannot answer get their own forced runs.
  function forcedJobs(P, tally, minSample) {
    var jobs = [], T = P.D.teams;
    for (var t = 0; t < P.fbs; t++) {
      if (P.L0[t] > (P.isG6[t] ? 5 : 4)) continue;
      var ng = P.nextGame[t];
      if (ng >= 0 && P.tLock[ng] < 0 && tally.nextW[t] < minSample) jobs.push({ t: t });
    }
    jobs.sort(function (a, b) { return (T[a.t].rank || 99) - (T[b.t].rank || 99); });
    return jobs;
  }
  function forcedRun(sim, job, count) {
    var hits = 0, c, i;
    for (c = 0; c < count; c++) {
      var sd = sim.run(job.t);
      for (i = 0; i < 12; i++) if (sd[i] === job.t) { hits++; break; }
    }
    return hits / count;
  }
  function summarize(P, tally, forced, minSample) {
    var out = [], N = tally.sims, T = P.D.teams;
    for (var t = 0; t < P.fbs; t++) {
      var ng = P.nextGame[t], nw = tally.nextW[t], f = forced[t], hist = [];
      for (var i = 0; i < 12; i++) hist.push(tally.seedHist[t * 12 + i]);
      var nl = N - nw;
      out.push({
        cfp: tally.cfp[t] / N, bye: tally.bye[t] / N, host: tally.host[t] / N, aq: tally.aq[t] / N, champ: tally.champ[t] / N, ccg: tally.ccg[t] / N, title: tally.title[t] / N,
        seed: tally.cfp[t] ? tally.seedSum[t] / tally.cfp[t] : null, hist: hist,
        pNext: ng >= 0 ? nw / N : null,
        ifNext: ng < 0 ? null : nw >= minSample ? tally.cfpNextW[t] / nw : f != null ? f : 0,
        ifLose: ng < 0 ? null : nl >= 200 ? (tally.cfp[t] - tally.cfpNextW[t]) / nl : null,
        forcedNext: nw < minSample && f != null
      });
      void T;
    }
    return out;
  }
  function nextGames(P) {
    // Per team: remaining opponents, site and win probability, in date order.
    var out = [];
    for (var t = 0; t < P.fbs; t++) out.push([]);
    for (var k = 0; k < P.tH.length; k++) {
      var h = P.tH[k], a = P.tA[k], g = P.tLive[k];
      var neutral = P.D.games.filter(function (x) { return x.id === P.gameIdx[k]; })[0];
      if (h < P.fbs) out[h].push({ o: a, home: neutral.n ? 0 : 1, p: g, id: neutral.id, s: neutral.s, d: neutral.d, us: neutral.hs, them: neutral.as, st: neutral.st });
      if (a < P.fbs) out[a].push({ o: h, home: neutral.n ? 0 : -1, p: 1 - g, id: neutral.id, s: neutral.s, d: neutral.d, us: neutral.as, them: neutral.hs, st: neutral.st });
    }
    return out;
  }
  // One fixed seed per ratings model, shared by the build and the page, so every run with the same data uses
  // the same random numbers. Picks and live updates then move only the odds they actually affect.
  function seedFor(mode) {
    var h = 2166136261;
    for (var i = 0; i < mode.length; i++) { h ^= mode.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) || 1;
  }
  function runAll(D, mode, sims, seed, forcedN, picks) {
    var P = prep(D, mode, picks), sim = new Sim(P, seed), tally = emptyTally(P.n), minSample = 800;
    baseBatch(sim, tally, sims);
    var jobs = forcedJobs(P, tally, minSample), forced = {};
    jobs.forEach(function (j) {
      forced[j.t] = forcedRun(sim, j, forcedN);
    });
    return { sims: sims, mode: mode, teams: summarize(P, tally, forced, minSample), schedule: nextGames(P), rating: Array.prototype.slice.call(P.R.subarray(0, P.fbs)) };
  }

  return {
    M: M, P4: P4, G6: G6, CONF_NAME: CONF_NAME, CONF_ABBR: CONF_ABBR, parseEspn: parseEspn, applyFpi: applyFpi, seedFor: seedFor, prep: prep, projectRanking: projectRanking, Sim: Sim, emptyTally: emptyTally, baseBatch: baseBatch,
    forcedJobs: forcedJobs, forcedRun: forcedRun, summarize: summarize, nextGames: nextGames, runAll: runAll, phi: phi, ratingFor: ratingFor, withCfp: withCfp, measureSwings: measureSwings
  };
})();
if (typeof module !== 'undefined') module.exports = CFP;
