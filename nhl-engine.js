// NHL season simulator: plays out the rest of the 82-game season (2 points a win, 1 for an overtime or
// shootout loss), takes the top three in each division plus two wild cards per conference, and plays four
// best-of-7 rounds. Used by nhl-build.mjs (Node) and, for picks, by the NHL page in a Web Worker (as
// self.NHLSIM). Same result shape as nba-engine.js, with hockey's columns.
(function () {
'use strict';

const M = {
  hfa: 0.2,       // home-ice edge, goals
  gameSD: 2.3,    // spread of one game's goal margin around the rating gap
  teamSD: 0.25,   // how much each team's strength wanders over a simulated season, goals
  otRate: 0.22,   // share of games tied after regulation (the loser still gets a point)
  ridge: 20,      // pull of the goals rating toward average, in games
  capMargin: 4,   // blowouts count as this many goals
  games: 82
};

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function phi(x) {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  const e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + e) : 0.5 * (1 - e);
}

// Goals rating from this season's finished games: least squares on capped goal margins with home ice (an
// overtime or shootout game counts as a one-goal game), pulled toward average by `ridge` games of a 0 margin.
function goalsRating(D) {
  const n = D.teams.length, A = [], b = new Array(n).fill(0);
  for (let i = 0; i < n; i++) { A.push(new Array(n).fill(0)); A[i][i] = M.ridge; }
  for (const g of D.games) {
    if (g.s !== 'post') continue;
    const raw = g.ot ? Math.sign(g.hs - g.as) : g.hs - g.as;
    const m = Math.max(-M.capMargin, Math.min(M.capMargin, raw)) - (g.neutral ? 0 : M.hfa);
    A[g.h][g.h] += 1; A[g.a][g.a] += 1; A[g.h][g.a] -= 1; A[g.a][g.h] -= 1;
    b[g.h] += m; b[g.a] -= m;
  }
  for (let c = 0; c < n; c++) for (let r = c + 1; r < n; r++) {
    const f = A[r][c] / A[c][c];
    if (!f) continue;
    for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
    b[r] -= f * b[c];
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  const mean = x.reduce((s, v) => s + v, 0) / n;
  return x.map((v) => v - mean);
}

// picks: { gameId: index of the team picked to win (in regulation) }. ratingList: goals better than average.
function simulate(D, sims, seed, picks, ratingList) {
  picks = picks || {};
  const n = D.teams.length, T = D.teams, rand = rng(seed || 20270601);
  const rating = ratingList || goalsRating(D);
  const w0 = new Int32Array(n), l0 = new Int32Array(n), otl0 = new Int32Array(n), rw0 = new Int32Array(n), gp = new Int32Array(n), h2h0 = new Float64Array(n * n), open = [];
  for (const g of D.games) {
    gp[g.h]++; gp[g.a]++;
    let wnr = null, ot = false;
    if (g.s === 'post') { wnr = g.hs > g.as ? g.h : g.a; ot = !!g.ot; }
    else if (picks[g.id] === g.h || picks[g.id] === g.a) wnr = picks[g.id];
    if (wnr == null) { open.push(g); continue; }
    const lsr = wnr === g.h ? g.a : g.h;
    w0[wnr]++; if (ot) otl0[lsr]++; else { l0[lsr]++; rw0[wnr]++; }
    h2h0[wnr * n + lsr] += 2; if (ot) h2h0[lsr * n + wnr] += 1;
  }
  const extra = T.map((_, i) => Math.max(0, M.games - gp[i]));
  const nextGame = T.map(() => null);
  for (const g of open.slice().sort((x, y) => (x.d < y.d ? -1 : 1))) {
    if (nextGame[g.h] == null) nextGame[g.h] = g.id;
    if (nextGame[g.a] == null) nextGame[g.a] = g.id;
  }
  const isNext = new Set(nextGame.filter((id) => id != null));
  const confs = [...new Set(T.map((t) => t.conf))].sort();
  const divsOf = (c) => [...new Set(T.filter((t) => t.conf === c).map((t) => t.div))].sort();
  const members = (key, v) => T.map((_, i) => i).filter((i) => T[i][key] === v);
  const z = () => new Float64Array(n);
  const tally = { pts: z(), w: z(), l: z(), otl: z(), playoff: z(), div: z(), top3: z(), wc: z(), pres: z(), r2: z(), cf: z(), conf: z(), title: z(),
    divRank: T.map(() => new Float64Array(8)), ptsHist: T.map(() => new Float64Array(2 * M.games + 1)), nextWin: z(), nextWinPO: z(), nextLossPO: z() };
  const winP = {};
  const str = new Float64Array(n), w = new Int32Array(n), l = new Int32Array(n), otl = new Int32Array(n), rw = new Int32Array(n), h2h = new Float64Array(n * n), tb = new Float64Array(n);
  const pts = (i) => 2 * w[i] + otl[i];
  const game = (hi, lo, home) => (rand() < phi((str[hi] - str[lo] + (home ? M.hfa : 0)) / M.gameSD) ? hi : lo);
  // Best of 7, 2-2-1-1-1: the better seed (hi) is home in games 1, 2, 5 and 7.
  const HOME = [1, 1, 0, 0, 1, 0, 1];
  function series(hi, lo) {
    let a = 0, b = 0, k = 0;
    while (a < 4 && b < 4) { const hw = HOME[k++] ? game(hi, lo, true) === hi : game(lo, hi, true) !== lo; if (hw) a++; else b++; }
    return a === 4 ? hi : lo;
  }
  // Standings: points, then regulation wins, then all wins, then head-to-head points among the tied teams,
  // then a coin toss (points percentage is the same with every team at 82 games).
  function order(list) {
    return list.slice().sort((x, y) => (pts(y) - pts(x)) || (rw[y] - rw[x]) || (w[y] - w[x]) || (h2h[y * n + x] - h2h[x * n + y]) || (tb[y] - tb[x]));
  }
  // One game: the winner from the strength gap; some games go to overtime or a shootout, and that loser
  // still gets a point.
  function play(h, a, p, k) {
    const hw = rand() < p, wn = hw ? h : a, ls = hw ? a : h, ot = rand() < M.otRate;
    w[wn]++; if (ot) otl[ls]++; else { l[ls]++; rw[wn]++; }
    h2h[wn * n + ls] += 2; if (ot) h2h[ls * n + wn] += 1;
    return wn;
  }

  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < n; i++) { str[i] = rating[i] + M.teamSD * normal(rand); w[i] = w0[i]; l[i] = l0[i]; otl[i] = otl0[i]; rw[i] = rw0[i]; tb[i] = rand(); }
    h2h.set(h2h0);
    const wonNext = new Int8Array(n);
    for (const g of open) {
      // A team's next game uses the ratings, not this season's drifted strengths, so the odds after a win or
      // loss ("If win", "If loss") are what locking that result in gives.
      const p = isNext.has(g.id)
        ? phi((rating[g.h] - rating[g.a] + (g.neutral ? 0 : M.hfa)) / Math.sqrt(M.gameSD * M.gameSD + 2 * M.teamSD * M.teamSD))
        : phi((str[g.h] - str[g.a] + (g.neutral ? 0 : M.hfa)) / M.gameSD);
      const wn = play(g.h, g.a, p);
      winP[g.id] = (winP[g.id] || 0) + (wn === g.h ? 1 : 0);
      if (nextGame[wn] === g.id) wonNext[wn] = 1;
    }
    for (let i = 0; i < n; i++) for (let x = 0; x < extra[i]; x++) { const r = rand(); if (r < phi(str[i] / M.gameSD)) w[i]++; else if (rand() < M.otRate) otl[i]++; else l[i]++; }
    const inPO = new Int8Array(n), champs = [];
    tally.pres[order(T.map((_, i) => i))[0]]++;
    for (const c of confs) {
      const [dA, dB] = divsOf(c);
      const A = order(members('div', dA)), B = order(members('div', dB));
      A.forEach((t, k) => tally.divRank[t][k]++); B.forEach((t, k) => tally.divRank[t][k]++);
      tally.div[A[0]]++; tally.div[B[0]]++;
      const top = A.slice(0, 3).concat(B.slice(0, 3));
      top.forEach((t) => tally.top3[t]++);
      const wc = order(A.slice(3).concat(B.slice(3))).slice(0, 2);
      wc.forEach((t) => tally.wc[t]++);
      top.concat(wc).forEach((t) => { tally.playoff[t]++; inPO[t] = 1; });
      // The division winner with more points plays the second wild card; the other plays the first.
      const aFirst = order([A[0], B[0]])[0] === A[0];
      const ser = (x, y) => (order([x, y])[0] === x ? series(x, y) : series(y, x));
      const pathA = [ser(A[0], aFirst ? wc[1] : wc[0]), ser(A[1], A[2])], pathB = [ser(B[0], aFirst ? wc[0] : wc[1]), ser(B[1], B[2])];
      pathA.concat(pathB).forEach((t) => tally.r2[t]++);
      const fa = ser(pathA[0], pathA[1]), fb = ser(pathB[0], pathB[1]);
      tally.cf[fa]++; tally.cf[fb]++;
      const champ = ser(fa, fb);
      tally.conf[champ]++;
      champs.push(champ);
    }
    // Stanley Cup Final: more points has home ice.
    const [x, y] = champs, hi = order([x, y])[0];
    tally.title[series(hi, hi === x ? y : x)]++;
    for (let i = 0; i < n; i++) {
      tally.pts[i] += pts(i); tally.w[i] += w[i]; tally.l[i] += l[i]; tally.otl[i] += otl[i];
      tally.ptsHist[i][Math.min(2 * M.games, pts(i))]++;
      if (nextGame[i] == null) continue;
      if (wonNext[i]) { tally.nextWin[i]++; tally.nextWinPO[i] += inPO[i]; } else tally.nextLossPO[i] += inPO[i];
    }
  }

  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const ptsAt = (i, q) => { let acc = 0; const h = tally.ptsHist[i]; for (let k = 0; k < h.length; k++) { acc += h[k]; if (acc >= q * sims) return k; } return 2 * M.games; };
  const teams = T.map((t, i) => {
    const nw = tally.nextWin[i], nl = sims - nw;
    return {
      rating: Math.round(rating[i] * 100) / 100,
      pts: Math.round((tally.pts[i] / sims) * 10) / 10, ptsLo: ptsAt(i, 0.1), ptsHi: ptsAt(i, 0.9),
      w: Math.round((tally.w[i] / sims) * 10) / 10, l: Math.round((tally.l[i] / sims) * 10) / 10, otl: Math.round((tally.otl[i] / sims) * 10) / 10,
      playoff: r4(tally.playoff[i] / sims), div: r4(tally.div[i] / sims), top3: r4(tally.top3[i] / sims), wc: r4(tally.wc[i] / sims), pres: r4(tally.pres[i] / sims),
      r2: r4(tally.r2[i] / sims), cf: r4(tally.cf[i] / sims), conf: r4(tally.conf[i] / sims), title: r4(tally.title[i] / sims),
      divRank: Array.from(tally.divRank[i]).map((v) => r4(v / sims)),
      next: nextGame[i],
      nextP: nextGame[i] == null ? null : r4(nw / sims),
      ifWin: nextGame[i] == null || !nw ? null : r4(tally.nextWinPO[i] / nw),
      ifLoss: nextGame[i] == null || !nl ? null : r4(tally.nextLossPO[i] / nl)
    };
  });
  const homeWin = {};
  for (const g of open) homeWin[g.id] = r4(winP[g.id] / sims);
  for (const id in picks) { const g = D.games.find((v) => v.id === id); if (g && g.s !== 'post') homeWin[id] = picks[id] === g.h ? 1 : 0; }
  return { teams, homeWin, model: M };
}

const NHLSIM = { M, simulate, goalsRating, phi };
if (typeof module !== 'undefined' && module.exports) module.exports = NHLSIM;
else self.NHLSIM = NHLSIM;
})();
