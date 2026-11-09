// NBA season simulator: plays out the rest of the 82-game season, seeds each conference (1-6 straight in,
// 7-10 to the play-in), runs the play-in and four best-of-7 rounds. Used by nba-build.mjs (Node) and, for
// picks, by the NBA page in a Web Worker (as self.NBASIM). Same result shape as nfl-engine.js.
(function () {
'use strict';

const M = {
  hfa: 2.2,       // home-court edge, points
  gameSD: 12,     // spread of one game's margin around the rating gap, points
  teamSD: 2.6,    // how much each team's strength wanders over a simulated season, points
  ridge: 6,       // pull of the points rating toward average, in games
  capMargin: 25,  // blowouts count as this many points
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

// Points rating from this season's finished games: least squares on capped margins with home court,
// pulled toward average by `ridge` games' worth of a 0 margin.
function pointsRating(D) {
  const n = D.teams.length, A = [], b = new Array(n).fill(0);
  for (let i = 0; i < n; i++) { A.push(new Array(n).fill(0)); A[i][i] = M.ridge; }
  for (const g of D.games) {
    if (g.s !== 'post') continue;
    const m = Math.max(-M.capMargin, Math.min(M.capMargin, g.hs - g.as)) - (g.neutral ? 0 : M.hfa);
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

// picks: { gameId: index of the team picked to win }. ratingList: points better than average, per team.
function simulate(D, sims, seed, picks, ratingList) {
  picks = picks || {};
  const n = D.teams.length, T = D.teams, rand = rng(seed || 20270411);
  const rating = ratingList || pointsRating(D);
  const w0 = new Int32Array(n), gp = new Int32Array(n), h2h0 = new Float64Array(n * n), open = [];
  for (const g of D.games) {
    gp[g.h]++; gp[g.a]++;
    let wnr = null;
    if (g.s === 'post') wnr = g.hs > g.as ? g.h : g.a;
    else if (picks[g.id] === g.h || picks[g.id] === g.a) wnr = picks[g.id];
    if (wnr == null) { open.push(g); continue; }
    w0[wnr]++; h2h0[wnr * n + (wnr === g.h ? g.a : g.h)]++;
  }
  // Games not on the schedule yet (rare) are played against an average team.
  const extra = T.map((_, i) => Math.max(0, M.games - gp[i]));
  const nextGame = T.map(() => null);
  for (const g of open.slice().sort((x, y) => (x.d < y.d ? -1 : 1))) {
    if (nextGame[g.h] == null) nextGame[g.h] = g.id;
    if (nextGame[g.a] == null) nextGame[g.a] = g.id;
  }
  // Games that are some team's next game. Those are played on the ratings alone (see below).
  const isNext = new Set(nextGame.filter((id) => id != null));
  const confs = [...new Set(T.map((t) => t.conf))].sort();
  const byConf = confs.map((c) => T.map((_, i) => i).filter((i) => T[i].conf === c));
  const z = () => new Float64Array(n);
  const tally = { wins: z(), playoff: z(), top6: z(), playin: z(), bye: z(), r2: z(), cf: z(), conf: z(), title: z(),
    seeds: T.map(() => new Float64Array(16)), winsHist: T.map(() => new Float64Array(M.games + 1)), nextWin: z(), nextWinPO: z(), nextLossPO: z() };
  const winP = {};
  const str = new Float64Array(n), w = new Int32Array(n), h2h = new Float64Array(n * n), tb = new Float64Array(n);

  const game = (hi, lo, home) => (rand() < phi((str[hi] - str[lo] + (home ? M.hfa : 0)) / M.gameSD) ? hi : lo);
  // Best of 7, 2-2-1-1-1: the better seed (hi) is home in games 1, 2, 5 and 7.
  const HOME = [1, 1, 0, 0, 1, 0, 1];
  function series(hi, lo) {
    let a = 0, b = 0, k = 0;
    while (a < 4 && b < 4) { const hw = HOME[k++] ? game(hi, lo, true) === hi : game(lo, hi, true) !== lo; if (hw) a++; else b++; }
    return a === 4 ? hi : lo;
  }
  // Seeding: win percentage, then head-to-head among the tied teams, then a coin toss (the NBA's further
  // tiebreakers, like division and conference record, aren't modeled).
  function order(list) {
    return list.slice().sort((x, y) => (w[y] - w[x]) || (h2h[y * n + x] - h2h[x * n + y]) || (tb[y] - tb[x]));
  }

  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < n; i++) { str[i] = rating[i] + M.teamSD * normal(rand); w[i] = w0[i]; tb[i] = rand(); }
    h2h.set(h2h0);
    const wonNext = new Int8Array(n);
    for (const g of open) {
      // A team's next game uses the ratings, not this season's drifted strengths, so the odds after a win
      // or loss ("If win", "If loss") are what locking that result in gives.
      const win = isNext.has(g.id)
        ? (rand() < phi((rating[g.h] - rating[g.a] + (g.neutral ? 0 : M.hfa)) / Math.sqrt(M.gameSD * M.gameSD + 2 * M.teamSD * M.teamSD)) ? g.h : g.a)
        : game(g.h, g.a, !g.neutral);
      w[win]++; h2h[win * n + (win === g.h ? g.a : g.h)]++;
      winP[g.id] = (winP[g.id] || 0) + (win === g.h ? 1 : 0);
      if (nextGame[win] === g.id) wonNext[win] = 1;
    }
    for (let i = 0; i < n; i++) for (let x = 0; x < extra[i]; x++) if (rand() < phi(str[i] / M.gameSD)) w[i]++;
    const inPO = new Int8Array(n), champs = [];
    for (const C of byConf) {
      const o = order(C);
      o.forEach((t, k) => { tally.seeds[t][k]++; });
      tally.bye[o[0]]++;
      for (let k = 0; k < 6; k++) tally.top6[o[k]]++;
      for (let k = 6; k < 10; k++) tally.playin[o[k]]++;
      // Play-in: 7 hosts 8 for the 7 seed; 9 hosts 10; the 7/8 loser hosts the 9/10 winner for the 8 seed.
      const s7 = game(o[6], o[7], true), l78 = s7 === o[6] ? o[7] : o[6];
      const s8 = game(l78, game(o[8], o[9], true), true);
      const seeds = [o[0], o[1], o[2], o[3], o[4], o[5], s7, s8];
      seeds.forEach((t) => { tally.playoff[t]++; inPO[t] = 1; });
      const pos = {}; seeds.forEach((t, k) => { pos[t] = k; });
      const ser = (a, b) => (pos[a] < pos[b] ? series(a, b) : series(b, a));
      const r1 = [ser(seeds[0], seeds[7]), ser(seeds[3], seeds[4]), ser(seeds[2], seeds[5]), ser(seeds[1], seeds[6])];
      r1.forEach((t) => tally.r2[t]++);
      const sf = [ser(r1[0], r1[1]), ser(r1[2], r1[3])];
      sf.forEach((t) => tally.cf[t]++);
      const champ = ser(sf[0], sf[1]);
      tally.conf[champ]++;
      champs.push(champ);
    }
    // Finals: the better record has home court.
    const [x, y] = champs, hi = (w[x] - w[y] || tb[x] - tb[y]) >= 0 ? x : y;
    tally.title[series(hi, hi === x ? y : x)]++;
    for (let i = 0; i < n; i++) {
      tally.wins[i] += w[i];
      tally.winsHist[i][Math.min(M.games, w[i])]++;
      if (nextGame[i] == null) continue;
      if (wonNext[i]) { tally.nextWin[i]++; tally.nextWinPO[i] += inPO[i]; } else tally.nextLossPO[i] += inPO[i];
    }
  }

  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  // Win total at a percentile of the simulated seasons (0.1: one in ten seasons ends with fewer).
  const winsAt = (i, q) => { let acc = 0; const h = tally.winsHist[i]; for (let k = 0; k < h.length; k++) { acc += h[k]; if (acc >= q * sims) return k; } return M.games; };
  const teams = T.map((t, i) => {
    const nw = tally.nextWin[i], nl = sims - nw;
    return {
      rating: Math.round(rating[i] * 10) / 10,
      wins: Math.round((tally.wins[i] / sims) * 10) / 10,
      winsLo: winsAt(i, 0.1), winsHi: winsAt(i, 0.9),
      playoff: r4(tally.playoff[i] / sims), top6: r4(tally.top6[i] / sims), playin: r4(tally.playin[i] / sims),
      bye: r4(tally.bye[i] / sims), r2: r4(tally.r2[i] / sims), cf: r4(tally.cf[i] / sims),
      conf: r4(tally.conf[i] / sims), title: r4(tally.title[i] / sims),
      seeds: Array.from(tally.seeds[i]).slice(0, 15).map((v) => r4(v / sims)),
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

const NBASIM = { M, simulate, pointsRating, phi };
if (typeof module !== 'undefined' && module.exports) module.exports = NBASIM;
else self.NBASIM = NBASIM;
})();
