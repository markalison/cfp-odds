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
  function ratingFor(team, mode, align) {
    var r = team.r || {};
    if (mode === 'massey') return r.massey;
    if (mode === 'sagarin') return r.sagarin;
    if (mode === 'predictor') return r.predictor;
    return 0.5 * (r.massey + (r.predictor - align)); // Massey + Sagarin blend on Massey's scale
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

  // ---------- Prepare one rating mode ----------
  function prep(D, mode) {
    var T = D.teams, n = T.length, fbs = D.fbs, R = new Float64Array(n), hfa = D.sources.hfa[mode] || 2.5;
    var masThru = D.sources.massey.thru, sagThru = D.sources.sagarin.thru;
    var total = Math.sqrt(M.gameSD * M.gameSD + 2 * M.teamSD * M.teamSD), i;
    for (i = 0; i < n; i++) R[i] = ratingFor(T[i], mode, D.sources.align);
    // Games finished after the ratings were published still move the rating.
    // Kickoffs are UTC, so shift back 8 hours to get the US calendar day the sources use.
    D.games.forEach(function (g) {
      if (g.s !== 'post') return;
      var day = new Date(Date.parse(g.d) - 288e5).toISOString().slice(0, 10);
      var newM = day > masThru, newS = day > sagThru;
      var share = mode === 'massey' ? (newM ? 1 : 0) : mode === 'blend' ? ((newM ? 0.5 : 0) + (newS ? 0.5 : 0)) : (newS ? 1 : 0);
      if (!share) return;
      var p = phi((R[g.h] - R[g.a] + (g.n ? 0 : hfa)) / total), res = g.w === g.h ? 1 : 0;
      R[g.h] += share * M.surprise * (res - p); R[g.a] -= share * M.surprise * (res - p);
    });
    var W0 = new Int16Array(n), L0 = new Int16Array(n), CW0 = new Int16Array(n), CL0 = new Int16Array(n);
    var H0 = new Int8Array(n * n), sosSum = new Float64Array(n), sosN = new Int16Array(n);
    var maxPairs = D.games.length + 40, pw = new Int16Array(maxPairs), pl = new Int16Array(maxPairs), np = 0;
    var todoH = [], todoA = [], todoS = [], todoP = [], todoC = [], todoCur = [], todoF = [], todoLive = [], nextGame = new Int32Array(n).fill(-1), remainCount = new Int16Array(n), gameIdx = [];
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
      pw: pw, pl: pl, np: np, tH: Int16Array.from(todoH), tA: Int16Array.from(todoA), tS: Float64Array.from(todoS), tP: Float64Array.from(todoP), tC: Uint8Array.from(todoC), tCur: Float64Array.from(todoCur), tF: Float64Array.from(todoF), tRootF: Float64Array.from(todoF.map(Math.sqrt)), tLive: Float64Array.from(todoLive), gameIdx: gameIdx,
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
    this.lostRemaining = new Uint8Array(n);
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

  // forced: team index that must win. forceMode: 1 = next game only, 2 = every game until the playoff.
  Sim.prototype.run = function (forced, forceMode) {
    var P = this.P, n = P.n, fbs = P.fbs, m = P.tH.length, i, eps = this.eps, post = this.post, L = this.L, CW = this.CW, CL = this.CL, H = this.H, R = P.R;
    for (i = 0; i < n; i++) { eps[i] = P.R[i] === 0 ? 0 : this.g() * M.teamSD; post[i] = R[i]; }
    L.set(P.L0); CW.set(P.CW0); CL.set(P.CL0); H.set(P.H0);
    this.tL.fill(0); this.champ.fill(0); this.lostRemaining.fill(0);
    var np = P.np, pw = this.pw, pl = this.pl, nextOfForced = forced >= 0 ? P.nextGame[forced] : -1;
    for (var k = 0; k < m; k++) {
      var h = P.tH[k], a = P.tA[k], w;
      if (forced >= 0 && (h === forced || a === forced) && (forceMode === 2 || k === nextOfForced)) {
        w = forced;
      } else {
        w = P.tCur[k] + P.tF[k] * (P.tS[k] + eps[h] - eps[a]) + P.tRootF[k] * this.g() * M.gameSD > 0 ? h : a;
      }
      var l = w === h ? a : h;
      this.res[k] = w;
      L[l]++; H[w * n + l]++;
      if (P.tC[k]) { CW[w]++; CL[l]++; }
      pw[np] = w; pl[np] = l; np++;
      this.lostRemaining[l] = 1;
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
        if (forced >= 0 && forceMode === 2 && (x === forced || y === forced)) wt = forced;
        else wt = spr + eps[x] - eps[y] + this.g() * M.gameSD > 0 ? x : y;
        var pe = phi(spr / P.total), sr = M.surprise * ((wt === x ? 1 : 0) - pe);
        post[x] += sr; post[y] -= sr;
        var lt = wt === x ? y : x;
        L[lt]++; this.tL[lt]++; H[wt * n + lt]++;
        pw[np] = wt; pl[np] = lt; np++;
        this.lostRemaining[lt] = 1;
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
      title: new Int32Array(n), seedSum: new Float64Array(n), seedHist: new Int32Array(n * 12), nextW: new Int32Array(n), cfpNextW: new Int32Array(n),
      out: new Int32Array(n), cfpOut: new Int32Array(n)
    };
  }
  function baseBatch(sim, tally, count) {
    var P = sim.P, n = P.n, inField = sim.inField || (sim.inField = new Uint8Array(n)), res = sim.res, i, t, c;
    for (c = 0; c < count; c++) {
      var sd = sim.run(-1, 0);
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
        if (!sim.lostRemaining[t]) { tally.out[t]++; if (inField[t]) tally.cfpOut[t]++; }
      }
      tally.title[sim.bracket()]++;
    }
  }
  // Teams a filtered sample cannot answer get their own forced runs.
  function forcedJobs(P, tally, minSample) {
    var jobs = [], T = P.D.teams;
    for (var t = 0; t < P.fbs; t++) {
      if (P.L0[t] > (P.isG6[t] ? 5 : 4)) continue;
      if (P.nextGame[t] >= 0 && tally.nextW[t] < minSample) jobs.push({ t: t, m: 1 });
      if (tally.out[t] < minSample) jobs.push({ t: t, m: 2 });
    }
    jobs.sort(function (a, b) { return (T[a.t].rank || 99) - (T[b.t].rank || 99); });
    return jobs;
  }
  function forcedRun(sim, job, count) {
    var hits = 0, c, i;
    for (c = 0; c < count; c++) {
      var sd = sim.run(job.t, job.m);
      for (i = 0; i < 12; i++) if (sd[i] === job.t) { hits++; break; }
    }
    return hits / count;
  }
  function summarize(P, tally, forced, minSample) {
    var out = [], N = tally.sims, T = P.D.teams;
    for (var t = 0; t < P.fbs; t++) {
      var ng = P.nextGame[t], nw = tally.nextW[t], ow = tally.out[t], f = forced[t] || {}, hist = [];
      for (var i = 0; i < 12; i++) hist.push(tally.seedHist[t * 12 + i]);
      var nl = N - nw;
      out.push({
        cfp: tally.cfp[t] / N, bye: tally.bye[t] / N, host: tally.host[t] / N, aq: tally.aq[t] / N, champ: tally.champ[t] / N, ccg: tally.ccg[t] / N, title: tally.title[t] / N,
        seed: tally.cfp[t] ? tally.seedSum[t] / tally.cfp[t] : null, hist: hist,
        pNext: ng >= 0 ? nw / N : null,
        ifNext: ng < 0 ? null : nw >= minSample ? tally.cfpNextW[t] / nw : f.next != null ? f.next : 0,
        ifLose: ng < 0 ? null : nl >= 200 ? (tally.cfp[t] - tally.cfpNextW[t]) / nl : null,
        pOut: ow / N,
        ifOut: ow >= minSample ? tally.cfpOut[t] / ow : f.out != null ? f.out : 0,
        forcedNext: nw < minSample && f.next != null, forcedOut: ow < minSample && f.out != null
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
  function runAll(D, mode, sims, seed, forcedN, onProgress) {
    var P = prep(D, mode), sim = new Sim(P, seed), tally = emptyTally(P.n), minSample = 800;
    baseBatch(sim, tally, sims);
    var jobs = forcedJobs(P, tally, minSample), forced = {};
    jobs.forEach(function (j) {
      var v = forcedRun(sim, j, forcedN);
      (forced[j.t] = forced[j.t] || {})[j.m === 1 ? 'next' : 'out'] = v;
    });
    if (onProgress) onProgress(1);
    return { sims: sims, mode: mode, teams: summarize(P, tally, forced, minSample), schedule: nextGames(P), rating: Array.prototype.slice.call(P.R.subarray(0, P.fbs)) };
  }

  return {
    M: M, P4: P4, G6: G6, CONF_NAME: CONF_NAME, parseEspn: parseEspn, prep: prep, Sim: Sim, emptyTally: emptyTally, baseBatch: baseBatch,
    forcedJobs: forcedJobs, forcedRun: forcedRun, summarize: summarize, nextGames: nextGames, runAll: runAll, phi: phi
  };
})();
if (typeof module !== 'undefined') module.exports = CFP;
