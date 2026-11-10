// NFL season simulator: plays out the rest of the regular season, applies the NFL's tiebreakers, seeds
// seven teams per conference and plays the playoffs. Used by nfl-build.mjs (Node) and, for picks, by the
// NFL page in a Web Worker (as self.NFLSIM).
(function () {
'use strict';

const M = {
  hfa: 1.5,        // home-field edge, points
  gameSD: 13,      // spread of one game's margin around the rating gap, points
  teamSD: 1.5,     // how much each team's strength wanders over a simulated season, points
  ridge: 4,        // pull of the points-based rating toward average, in games
  capMargin: 24,   // blowouts count as this many points
  wFpi: 0.5        // share of ESPN's FPI in the rating; the rest is the points-based rating
};

// Small fast random numbers with a fixed seed, so a rebuild with the same data gives the same odds.
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

// Points-based rating from this season's finished games: least squares on capped margins with home field,
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
  // Gaussian elimination (the matrix is small and well conditioned thanks to the ridge term).
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  const mean = x.reduce((s, v) => s + v, 0) / n;
  return x.map((v) => v - mean);
}

function ratings(D) {
  const pts = pointsRating(D);
  const hasFpi = D.teams.every((t) => typeof t.fpi === 'number');
  return D.teams.map((t, i) => (hasFpi ? M.wFpi * t.fpi + (1 - M.wFpi) * pts[i] : pts[i]));
}

// ---------- Standings and tiebreakers for one simulated season ----------
// res[i] is a list of [opponent, result] with result 1 win, 0 loss, 0.5 tie.
function Season(D, res) {
  const n = D.teams.length;
  const T = D.teams;
  const pctCache = new Array(n);
  function pct(i, keep) {
    let w = 0, g = 0;
    for (const [o, r] of res[i]) if (!keep || keep(o)) { w += r; g++; }
    return g ? w / g : 0;
  }
  function overall(i) { return pctCache[i] != null ? pctCache[i] : (pctCache[i] = pct(i)); }
  const sameDiv = (i) => (o) => T[o].div === T[i].div;
  const sameConf = (i) => (o) => T[o].conf === T[i].conf;
  function h2h(set) {
    const inSet = new Set(set);
    return set.map((i) => { let w = 0, g = 0; for (const [o, r] of res[i]) if (inSet.has(o)) { w += r; g++; } return g ? w / g : null; });
  }
  function common(set, minGames) {
    let opps = null;
    for (const i of set) {
      const mine = new Set(res[i].map(([o]) => o).filter((o) => !set.includes(o)));
      opps = opps ? new Set([...opps].filter((o) => mine.has(o))) : mine;
    }
    let ok = true;
    const vals = set.map((i) => { let w = 0, g = 0; for (const [o, r] of res[i]) if (opps.has(o)) { w += r; g++; } if (g < minGames) ok = false; return g ? w / g : 0; });
    return ok ? vals : null;
  }
  function sov(i) { let s = 0, g = 0; for (const [o, r] of res[i]) if (r > 0) { s += overall(o) * r; g += r; } return g ? s / g : 0; }
  function sos(i) { let s = 0; for (const [o] of res[i]) s += overall(o); return res[i].length ? s / res[i].length : 0; }

  // Applies the steps in order; whenever a step separates the group, the leaders start over from step one.
  function best(set, steps, rand) {
    let cur = set.slice();
    outer: while (cur.length > 1) {
      for (const step of steps) {
        const v = step(cur);
        if (!v) continue;
        const top = Math.max(...v.map((x) => (x == null ? -Infinity : x)));
        const next = cur.filter((_, k) => v[k] != null && Math.abs(v[k] - top) < 1e-9);
        if (next.length && next.length < cur.length) { cur = next; continue outer; }
      }
      return cur[Math.floor(rand() * cur.length)]; // coin toss
    }
    return cur[0];
  }
  const DIV_STEPS = [
    (s) => h2h(s),
    (s) => s.map((i) => pct(i, sameDiv(i))),
    (s) => common(s, 0),
    (s) => s.map((i) => pct(i, sameConf(i))),
    (s) => s.map(sov),
    (s) => s.map(sos)
  ];
  const WC_STEPS = [
    (s) => {
      if (s.length === 2) { const v = h2h(s); return v[0] == null ? null : v; }
      // Three or more: only a sweep counts, one team beat all the others or lost to all of them.
      return s.map((i) => {
        let beat = 0, lost = 0;
        for (const j of s) {
          if (j === i) continue;
          const games = res[i].filter(([o]) => o === j);
          if (!games.length) return 0;
          if (games.every(([, r]) => r === 1)) beat++;
          if (games.every(([, r]) => r === 0)) lost++;
        }
        return beat === s.length - 1 ? 1 : lost === s.length - 1 ? -1 : 0;
      });
    },
    (s) => s.map((i) => pct(i, sameConf(i))),
    (s) => common(s, 4),
    (s) => s.map(sov),
    (s) => s.map(sos)
  ];
  function divBest(set, rand) { return best(set, DIV_STEPS, rand); }
  // Teams from different divisions: first only the top team of each division stays in. Repeated for each
  // wild card spot, this keeps the NFL's "original seeding within a division": the division tiebreaker sends
  // the teams left back to step 1 after each winner, which is the same order as re-breaking them here.
  function wcBest(set, rand) {
    const byDiv = {};
    for (const i of set) (byDiv[T[i].div] = byDiv[T[i].div] || []).push(i);
    const reps = Object.values(byDiv).map((g) => divBest(g, rand));
    return best(reps, WC_STEPS, rand);
  }
  // Orders a list best first: by win percentage, ties broken one place at a time.
  function order(list, pick, rand) {
    const left = list.slice(), out = [];
    while (left.length) {
      const top = Math.max(...left.map(overall));
      const tied = left.filter((i) => Math.abs(overall(i) - top) < 1e-9);
      const w = tied.length === 1 ? tied[0] : pick(tied, rand);
      out.push(w);
      left.splice(left.indexOf(w), 1);
    }
    return out;
  }
  return { overall, divBest, wcBest, order };
}

// ---------- The simulation ----------
// picks: { gameId: index of the team picked to win, or 'T' for a tie }. A picked game is decided in every simulated season.
function simulate(D, sims, seed, picks, ratingList) {
  picks = picks || {};
  const n = D.teams.length, T = D.teams, rand = rng(seed || 20261108);
  const rating = ratingList || ratings(D);
  const base = T.map(() => []);
  const open = [];
  for (const g of D.games) {
    if (g.s === 'post') {
      const r = g.hs > g.as ? 1 : g.hs < g.as ? 0 : 0.5;
      base[g.h].push([g.a, r]); base[g.a].push([g.h, 1 - r]);
    } else if (picks[g.id] === g.h || picks[g.id] === g.a || picks[g.id] === 'T') {
      // A picked tie ('T') counts half a win for each team, as a real tie does.
      const r = picks[g.id] === 'T' ? 0.5 : picks[g.id] === g.h ? 1 : 0;
      base[g.h].push([g.a, r]); base[g.a].push([g.h, 1 - r]);
    } else open.push(g);
  }
  // Each team's next game, for the "if win / if loss" odds.
  const nextGame = T.map(() => null);
  for (const g of open.slice().sort((x, y) => (x.d < y.d ? -1 : 1))) {
    if (nextGame[g.h] == null) nextGame[g.h] = g.id;
    if (nextGame[g.a] == null) nextGame[g.a] = g.id;
  }
  // Games that are some team's next game. Those are played on the ratings alone (see below).
  const isNext = new Set(nextGame.filter((id) => id != null));
  const divs = [...new Set(T.map((t) => t.div))], confs = ['AFC', 'NFC'];
  const z = () => new Float64Array(n);
  const tally = { wins: z(), div: z(), playoff: z(), bye: z(), conf: z(), sb: z(), seed: confs.map(() => null), seeds: T.map(() => new Float64Array(8)),
    nextW: z(), nextWin: z(), nextWinPO: z(), nextLossPO: z() };
  const winP = {}; // home win share per open game

  function play(h, a, sH, sA, neutral) {
    const m = sH - sA + (neutral ? 0 : M.hfa) + M.gameSD * normal(rand);
    return m > 0 ? h : m < 0 ? a : (rand() < 0.5 ? h : a);
  }

  for (let s = 0; s < sims; s++) {
    const str = rating.map((r) => r + M.teamSD * normal(rand));
    const res = base.map((l) => l.slice());
    const wonNext = new Int8Array(n);
    for (const g of open) {
      // A team's next game uses the ratings, not this season's drifted strengths, so "If win" and "If loss"
      // are what locking that result in gives.
      const w = isNext.has(g.id) ? play(g.h, g.a, rating[g.h], rating[g.a], g.neutral) : play(g.h, g.a, str[g.h], str[g.a], g.neutral);
      res[g.h].push([g.a, w === g.h ? 1 : 0]); res[g.a].push([g.h, w === g.a ? 1 : 0]);
      winP[g.id] = (winP[g.id] || 0) + (w === g.h ? 1 : 0);
      if (nextGame[w] === g.id) wonNext[w] = 1;
    }
    const S = Season(D, res);
    for (let i = 0; i < n; i++) tally.wins[i] += res[i].reduce((x, [, r]) => x + r, 0);

    const seedsByConf = {};
    for (const c of confs) {
      const winners = divs.filter((d) => T.find((t) => t.div === d).conf === c).map((d) => {
        const members = T.map((_, i) => i).filter((i) => T[i].div === d);
        const top = Math.max(...members.map(S.overall));
        const tied = members.filter((i) => Math.abs(S.overall(i) - top) < 1e-9);
        return tied.length === 1 ? tied[0] : S.divBest(tied, rand);
      });
      const dw = S.order(winners, S.wcBest, rand);
      const rest = T.map((_, i) => i).filter((i) => T[i].conf === c && !winners.includes(i));
      const wc = S.order(rest, S.wcBest, rand).slice(0, 3);
      const seeds = dw.concat(wc);
      seedsByConf[c] = seeds;
      seeds.forEach((i, k) => { tally.playoff[i]++; tally.seeds[i][k + 1]++; });
      winners.forEach((i) => tally.div[i]++);
      tally.bye[seeds[0]]++;
    }
    // Playoffs: 2v7, 3v6, 4v5, then the top seed meets the lowest one left; higher seed at home.
    const champs = confs.map((c) => {
      const sd = seedsByConf[c];
      const seedOf = (i) => sd.indexOf(i);
      const game = (x, y) => (seedOf(x) < seedOf(y) ? play(x, y, str[x], str[y], false) : play(y, x, str[y], str[x], false));
      let alive = [sd[0], game(sd[1], sd[6]), game(sd[2], sd[5]), game(sd[3], sd[4])].sort((x, y) => seedOf(x) - seedOf(y));
      alive = [game(alive[0], alive[3]), game(alive[1], alive[2])];
      const champ = game(alive[0], alive[1]);
      tally.conf[champ]++;
      return champ;
    });
    tally.sb[play(champs[0], champs[1], str[champs[0]], str[champs[1]], true)]++;

    for (let i = 0; i < n; i++) {
      if (nextGame[i] == null) continue;
      const po = seedsByConf[T[i].conf].includes(i) ? 1 : 0;
      if (wonNext[i]) { tally.nextWin[i]++; tally.nextWinPO[i] += po; } else tally.nextLossPO[i] += po;
    }
  }

  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const teams = T.map((t, i) => {
    const nw = tally.nextWin[i], nl = sims - nw;
    return {
      rating: Math.round(rating[i] * 10) / 10,
      wins: Math.round((tally.wins[i] / sims) * 10) / 10,
      div: r4(tally.div[i] / sims), playoff: r4(tally.playoff[i] / sims), bye: r4(tally.bye[i] / sims),
      conf: r4(tally.conf[i] / sims), sb: r4(tally.sb[i] / sims),
      seeds: Array.from(tally.seeds[i]).slice(1).map((x) => r4(x / sims)),
      next: nextGame[i],
      nextP: nextGame[i] == null ? null : r4(nw / sims),
      ifWin: nextGame[i] == null || !nw ? null : r4(tally.nextWinPO[i] / nw),
      ifLoss: nextGame[i] == null || !nl ? null : r4(tally.nextLossPO[i] / nl)
    };
  });
  const games = {};
  for (const g of open) games[g.id] = r4(winP[g.id] / sims);
  for (const id in picks) { const g = D.games.find((x) => x.id === id); if (g && g.s !== 'post') games[id] = picks[id] === 'T' ? 0.5 : picks[id] === g.h ? 1 : 0; }
  return { teams, homeWin: games, model: M };
}

const NFLSIM = { M, simulate, ratings, pointsRating };
if (typeof module !== 'undefined' && module.exports) module.exports = NFLSIM;
else self.NFLSIM = NFLSIM;
})();
