// Men's college basketball simulator: plays out the rest of the regular season, every conference tournament
// (champions take the automatic bids), a simulated selection committee for the at-large bids, and the 68-team
// NCAA tournament: First Four, S-curve seeding into four regions and six rounds on neutral courts.
// Used by ncaab-build.mjs (Node) and, for picks, by the NCAAB page in a Web Worker (as self.NCAABSIM).
// Teams 0 .. D.nD1 - 1 are Division I; the rest are non-D1 opponents with a fixed low rating.
(function () {
'use strict';

const M = {
  hfa: 3.2,          // home-court edge, points
  gameSD: 11,        // spread of one game's margin around the rating gap, points
  teamSD: 3,         // how much each team's strength wanders over a simulated season, points
  ridge: 4,          // pull of the points rating toward average, in games
  capMargin: 25,     // blowouts count as this many points
  nonD1: -22,        // a non-Division I opponent, points against an average D-I team
  wWP: 8,            // committee points per unit of winning percentage (0.1 = 0.8 points)
  committeeSD: 1.5,  // per-simulation committee disagreement, points
  field: 68
};
// Conference tournaments that don't take every team (by ESPN's conference key); the rest take all.
const TOURNEY_SIZE = { ivy: 4, big10: 15, acc: 15 };
// Region order of a 16-team bracket, top to bottom: 1v16, 8v9, 5v12, 4v13, 6v11, 3v14, 7v10, 2v15.
const REGION_ORDER = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];

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
// Single-elimination seed order for a bracket of size p (a power of 2): [1, 8, 4, 5, 2, 7, 3, 6] for 8.
function seedOrder(p) {
  let o = [1];
  while (o.length < p) { const s = o.length * 2 + 1; o = o.flatMap((x) => [x, s - x]); }
  return o;
}

// Points rating from this season's finished D-I games: least squares on capped margins with home court,
// non-D1 opponents fixed at M.nonD1, pulled toward average by `ridge` games' worth of a 0 margin.
function pointsRating(D) {
  const n = D.nD1, A = [], b = new Array(n).fill(0);
  for (let i = 0; i < n; i++) { A.push(new Float64Array(n)); A[i][i] = M.ridge; }
  for (const g of D.games) {
    if (g.s !== 'post') continue;
    const m = Math.max(-M.capMargin, Math.min(M.capMargin, g.hs - g.as)) - (g.n ? 0 : M.hfa);
    const hD = g.h < n, aD = g.a < n;
    if (hD && aD) { A[g.h][g.h] += 1; A[g.a][g.a] += 1; A[g.h][g.a] -= 1; A[g.a][g.h] -= 1; b[g.h] += m; b[g.a] -= m; }
    else if (hD) { A[g.h][g.h] += 1; b[g.h] += m + M.nonD1; }
    else if (aD) { A[g.a][g.a] += 1; b[g.a] += -m + M.nonD1; }
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

// picks: { gameId: index of the team picked to win }. ratingList: D-I teams' points better than average.
function simulate(D, sims, seed, picks, ratingList) {
  picks = picks || {};
  const n = D.teams.length, n1 = D.nD1, T = D.teams, rand = rng(seed || 20270405);
  const base = ratingList || pointsRating(D);
  const rating = new Float64Array(n);
  for (let i = 0; i < n; i++) rating[i] = i < n1 ? base[i] : M.nonD1;
  const W0 = new Int16Array(n), L0 = new Int16Array(n), CW0 = new Int16Array(n), CL0 = new Int16Array(n), open = [];
  for (const g of D.games) {
    let wnr = null;
    if (g.s === 'post') wnr = g.hs > g.as ? g.h : g.a;
    else if (picks[g.id] === g.h || picks[g.id] === g.a) wnr = picks[g.id];
    if (wnr == null) { open.push(g); continue; }
    const lsr = wnr === g.h ? g.a : g.h;
    W0[wnr]++; L0[lsr]++;
    if (g.c) { CW0[wnr]++; CL0[lsr]++; }
  }
  open.sort((x, y) => (x.d < y.d ? -1 : 1));
  const nextGame = new Array(n1).fill(null);
  for (const g of open) {
    if (g.h < n1 && nextGame[g.h] == null) nextGame[g.h] = g.id;
    if (g.a < n1 && nextGame[g.a] == null) nextGame[g.a] = g.id;
  }
  const isNext = new Set(nextGame.filter((id) => id != null));
  const oH = Int32Array.from(open.map((g) => g.h)), oA = Int32Array.from(open.map((g) => g.a));
  const oHfa = Float64Array.from(open.map((g) => (g.n ? 0 : M.hfa))), oC = Uint8Array.from(open.map((g) => (g.c ? 1 : 0)));
  const oNext = Uint8Array.from(open.map((g) => (isNext.has(g.id) ? 1 : 0)));
  const total = Math.sqrt(M.gameSD * M.gameSD + 2 * M.teamSD * M.teamSD);
  const oNextP = Float64Array.from(open.map((g) => phi((rating[g.h] - rating[g.a] + (g.n ? 0 : M.hfa)) / total)));
  const winP = new Float64Array(open.length);

  // Conferences with an automatic bid: two or more D-I members.
  const confMap = {};
  for (let i = 0; i < n1; i++) (confMap[T[i].conf] = confMap[T[i].conf] || []).push(i);
  const confs = Object.keys(confMap).filter((k) => k !== 'ind' && confMap[k].length > 1).map((k) => {
    const size = Math.min(confMap[k].length, TOURNEY_SIZE[k] || 99), p = 1 << Math.ceil(Math.log2(size));
    return { k, members: confMap[k], size, p, order: seedOrder(p) };
  });

  const z = () => new Float64Array(n1);
  const tally = { wins: z(), losses: z(), make: z(), auto: z(), regTitle: z(), r32: z(), s16: z(), e8: z(), f4: z(), final: z(), title: z(),
    seedSum: z(), seeds: Array.from({ length: n1 }, () => new Float64Array(16)), nextWin: z(), nextWinIn: z(), nextLossIn: z() };
  const str = new Float64Array(n), w = new Int16Array(n), l = new Int16Array(n), cw = new Int16Array(n), cl = new Int16Array(n), tb = new Float64Array(n), cs = new Float64Array(n1);
  const game = (x, y) => (rand() < phi((str[x] - str[y]) / M.gameSD) ? x : y); // neutral court
  const isAuto = new Uint8Array(n1), inField = new Uint8Array(n1), reached = new Uint8Array(n1);

  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < n; i++) { str[i] = rating[i] + M.teamSD * normal(rand); w[i] = W0[i]; l[i] = L0[i]; cw[i] = CW0[i]; cl[i] = CL0[i]; tb[i] = rand(); }
    const wonNext = new Uint8Array(n1);
    for (let k = 0; k < open.length; k++) {
      const h = oH[k], a = oA[k];
      // A team's next game uses the ratings alone, so "If win" / "If loss" are what locking that result in gives.
      const hw = oNext[k] ? rand() < oNextP[k] : rand() < phi((str[h] - str[a] + oHfa[k]) / M.gameSD);
      const wn = hw ? h : a, ls = hw ? a : h;
      w[wn]++; l[ls]++;
      if (oC[k]) { cw[wn]++; cl[ls]++; }
      if (hw) winP[k]++;
      if (wn < n1 && oNext[k]) wonNext[wn] = 1;
    }
    // Conference tournaments: seeded by conference winning percentage, single elimination on a neutral court
    // with byes for the top seeds.
    isAuto.fill(0); inField.fill(0); reached.fill(0);
    const autos = [];
    for (const C of confs) {
      const cwp = (i) => { const g = cw[i] + cl[i]; return g ? cw[i] / g : 0.5; };
      const ord = C.members.slice().sort((x, y) => cwp(y) - cwp(x) || (w[y] - l[y]) - (w[x] - l[x]) || tb[y] - tb[x]);
      tally.regTitle[ord[0]]++;
      let round = C.order.map((sd) => (sd <= C.size ? ord[sd - 1] : -1));
      while (round.length > 1) {
        const next = [];
        for (let k = 0; k < round.length; k += 2) { const x = round[k], y = round[k + 1]; next.push(x < 0 ? y : y < 0 ? x : game(x, y)); }
        round = next;
      }
      isAuto[round[0]] = 1; autos.push(round[0]); tally.auto[round[0]]++;
    }
    // The committee: each team's strength as its results show it, plus its winning percentage, with some
    // disagreement each simulation. The best non-champions take the at-large bids.
    for (let i = 0; i < n1; i++) { const g = w[i] + l[i]; cs[i] = str[i] + M.wWP * ((g ? w[i] / g : 0.5) - 0.5) + M.committeeSD * normal(rand); }
    const atLarge = [];
    for (let i = 0; i < n1; i++) if (!isAuto[i]) atLarge.push(i);
    atLarge.sort((x, y) => cs[y] - cs[x]);
    const bids = atLarge.slice(0, M.field - autos.length);
    autos.sort((x, y) => cs[y] - cs[x]);
    // First Four: the four lowest at-large teams and the four lowest automatic qualifiers, in pairs.
    const ffL = bids.slice(-4), ffA = autos.slice(-4);
    const solo = bids.slice(0, -4).concat(autos.slice(0, -4));
    const slots = solo.map((t) => ({ v: cs[t], teams: [t] }));
    [[ffL[0], ffL[3]], [ffL[1], ffL[2]], [ffA[0], ffA[3]], [ffA[1], ffA[2]]].forEach((pr) => slots.push({ v: (cs[pr[0]] + cs[pr[1]]) / 2, teams: pr }));
    slots.sort((x, y) => y.v - x.v);
    // S-curve: seed lines of four, snaking across the regions.
    const regions = [[], [], [], []];
    slots.forEach((sl, k) => {
      const line = (k >> 2) + 1, pos = k & 3, reg = line % 2 ? pos : 3 - pos;
      sl.teams.forEach((t) => { inField[t] = 1; tally.make[t]++; tally.seeds[t][line - 1]++; tally.seedSum[t] += line; });
      regions[reg][line] = sl.teams.length === 2 ? game(sl.teams[0], sl.teams[1]) : sl.teams[0];
    });
    const four = regions.map((R) => {
      let round = REGION_ORDER.map((sd) => R[sd]);
      let depth = 0;
      while (round.length > 1) {
        const next = [];
        for (let k = 0; k < round.length; k += 2) next.push(game(round[k], round[k + 1]));
        round = next; depth++;
        const tk = depth === 1 ? tally.r32 : depth === 2 ? tally.s16 : depth === 3 ? tally.e8 : tally.f4;
        round.forEach((t) => tk[t]++);
      }
      return round[0];
    });
    const f1 = game(four[0], four[1]), f2 = game(four[2], four[3]);
    tally.final[f1]++; tally.final[f2]++;
    tally.title[game(f1, f2)]++;
    for (let i = 0; i < n1; i++) {
      tally.wins[i] += w[i]; tally.losses[i] += l[i];
      if (nextGame[i] == null) continue;
      if (wonNext[i]) { tally.nextWin[i]++; tally.nextWinIn[i] += inField[i]; } else tally.nextLossIn[i] += inField[i];
    }
  }

  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const teams = [];
  for (let i = 0; i < n1; i++) {
    const nw = tally.nextWin[i], nl = sims - nw;
    teams.push({
      rating: Math.round(rating[i] * 10) / 10,
      w: Math.round((tally.wins[i] / sims) * 10) / 10, l: Math.round((tally.losses[i] / sims) * 10) / 10,
      make: r4(tally.make[i] / sims), auto: r4(tally.auto[i] / sims), regTitle: r4(tally.regTitle[i] / sims),
      seed: tally.make[i] ? Math.round((tally.seedSum[i] / tally.make[i]) * 10) / 10 : null,
      seeds: Array.from(tally.seeds[i]).map((v) => r4(v / sims)),
      r32: r4(tally.r32[i] / sims), s16: r4(tally.s16[i] / sims), e8: r4(tally.e8[i] / sims), f4: r4(tally.f4[i] / sims),
      final: r4(tally.final[i] / sims), title: r4(tally.title[i] / sims),
      next: nextGame[i],
      nextP: nextGame[i] == null ? null : r4(nw / sims),
      ifWin: nextGame[i] == null || !nw ? null : r4(tally.nextWinIn[i] / nw),
      ifLoss: nextGame[i] == null || !nl ? null : r4(tally.nextLossIn[i] / nl)
    });
  }
  const homeWin = {};
  open.forEach((g, k) => { homeWin[g.id] = r4(winP[k] / sims); });
  for (const id in picks) { const g = D.games.find((v) => v.id === id); if (g && g.s !== 'post') homeWin[id] = picks[id] === g.h ? 1 : 0; }
  return { teams, homeWin, model: M };
}

const NCAABSIM = { M, simulate, pointsRating, phi, seedOrder, REGION_ORDER };
if (typeof module !== 'undefined' && module.exports) module.exports = NCAABSIM;
else self.NCAABSIM = NCAABSIM;
})();
