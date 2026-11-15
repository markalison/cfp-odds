// One-off: learns how the CFP selection committee actually moves teams, by fitting a formula to every
// week-to-week change in its published rankings since 2014. For each team ranked in one committee ranking we
// look at what happened before the next one (idle / won / lost, the opponent's standing, the margin, P4 vs G5)
// and where the committee then placed it, and fit those by least squares. Writes cfp-proj-model.json (the
// coefficients) and prints a sanity report. Re-run to add finished seasons.
// Needs the free API key in .cfbd-key (not committed) or CFBD_KEY. Usage: node cfp-proj-seed.mjs [first] [last]
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const FIRST = +process.argv[2] || 2014, LAST = +process.argv[3] || 2024;
const keyFile = new URL('./.cfbd-key', import.meta.url);
const KEY = process.env.CFBD_KEY || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '');
if (!KEY) throw new Error('No CollegeFootballData key: put it in .cfbd-key or CFBD_KEY');
const API = 'https://api.collegefootballdata.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (path) => {
  for (let k = 0; k < 4; k++) {
    const r = await fetch(API + path, { headers: { authorization: 'Bearer ' + KEY, 'user-agent': 'cfp-odds-board' } });
    if (r.ok) return r.json();
    if (r.status === 401 || r.status === 403) throw new Error('key refused: ' + r.status);
    await sleep(1500 * (k + 1));
  }
  throw new Error('failed ' + path);
};

// Power-4 / Power-5 conferences across the era (G5 = everyone else among FBS).
const P4 = new Set(['SEC', 'Big Ten', 'Big 12', 'ACC', 'Pac-12']);

const cacheFile = new URL('./.cfp-proj-cache.json', import.meta.url);
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};

async function seasonData(year) {
  if (cache[year]) return cache[year];
  const ranks = await get('/rankings?year=' + year + '&seasonType=both');
  const games = await get('/games?year=' + year + '&seasonType=both');
  const out = { ranks, games: games.map((g) => ({ wk: g.week, st: g.seasonType, hId: g.homeId, aId: g.awayId, hp: g.homePoints, ap: g.awayPoints, neutral: g.neutralSite })) };
  cache[year] = out; writeFileSync(cacheFile, JSON.stringify(cache));
  return out;
}

// A committee ranking as {key, order: Map(teamId->rank), conf: Map(teamId->conf)}; key sorts chronologically.
function committee(ranks) {
  const out = [];
  ranks.forEach((w) => {
    const poll = (w.polls || []).find((p) => /playoff committee/i.test(p.poll));
    if (!poll) return;
    const order = new Map(), conf = new Map();
    poll.ranks.forEach((r) => { order.set(r.teamId, r.rank); conf.set(r.teamId, r.conference); });
    out.push({ st: w.seasonType, wk: w.week, order, conf });
  });
  // regular season weeks first, then postseason (final ranking)
  out.sort((a, b) => (a.st === b.st ? a.wk - b.wk : a.st === 'regular' ? -1 : 1));
  return out;
}

// Games a team played strictly after ranking A and up to/including ranking B's cutoff. The committee ranking
// released at a week reflects the prior weekend, so the change from ranking A to B covers the games in the
// weeks between them (usually exactly one game).
function gamesBetween(games, A, B) {
  const inRange = (g) => {
    if (A.st === 'regular' && B.st === 'regular') return g.st === 'regular' && g.wk >= A.wk && g.wk < B.wk;
    if (A.st === 'regular' && B.st === 'postseason') return (g.st === 'regular' && g.wk >= A.wk) || g.st === 'postseason';
    return g.st === 'postseason';
  };
  const by = new Map();
  games.forEach((g) => { if (!inRange(g) || g.hp == null || g.ap == null) return; by.set(g.hId, g); by.set(g.aId, g); });
  return by;
}

const rows = []; // each: { x:[...features], y:nextRank }
const OUT = 26; // "fell out of the top 25" target

for (let year = FIRST; year <= LAST; year++) {
  let sd;
  try { sd = await seasonData(year); } catch (e) { console.error(year, 'skip:', e.message); continue; }
  const comms = committee(sd.ranks);
  for (let i = 0; i + 1 < comms.length; i++) {
    const A = comms[i], B = comms[i + 1];
    const games = gamesBetween(sd.games, A, B);
    A.order.forEach((cur, id) => {
      const g = games.get(id);
      let lost = 0, idle = 0, won = 0, lossOpp = 0, winOpp = 0, margin = 0;
      if (!g) { idle = 1; }
      else {
        const home = g.hId === id, mine = home ? g.hp : g.ap, opp = home ? g.ap : g.hp, oppId = home ? g.aId : g.hId;
        const oppRank = A.order.get(oppId) || OUT;
        margin = Math.max(-28, Math.min(28, mine - opp)) / 28;
        if (mine > opp) { won = 1; winOpp = oppRank <= 25 ? (26 - oppRank) / 25 : 0; }
        else if (mine < opp) { lost = 1; lossOpp = oppRank / OUT; } // losing to a highly ranked team (low rank number) hurts least
      }
      const g5 = P4.has(A.conf.get(id)) ? 0 : 1;
      const next = B.order.get(id) || OUT;
      void won; // winning is the baseline (lost = idle = 0); keeping it as a feature too would be collinear
      rows.push({ x: [1, cur / 25, lost, idle, lossOpp, winOpp, g5, margin], y: next });
    });
  }
}

const FN = ['intercept', 'cur', 'lost', 'idle', 'lossOppRank', 'winOppRank', 'g5', 'margin'];
console.log('training rows:', rows.length);

// Ordinary least squares: solve (XtX) b = Xty by Gaussian elimination.
const p = FN.length, XtX = Array.from({ length: p }, () => new Array(p).fill(0)), Xty = new Array(p).fill(0);
rows.forEach((r) => { for (let a = 0; a < p; a++) { Xty[a] += r.x[a] * r.y; for (let b = 0; b < p; b++) XtX[a][b] += r.x[a] * r.x[b]; } });
function solve(Araw, bRaw) {
  const A = Araw.map((r) => r.slice()), b = bRaw.slice(), m = b.length;
  for (let c = 0; c < m; c++) {
    let piv = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = 0; r < m; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < m; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  return b.map((v, r) => v / A[r][r]);
}
const beta = solve(XtX, Xty);

// Fit quality and a behaviour sanity check.
let ssr = 0, sst = 0; const ymean = rows.reduce((s, r) => s + r.y, 0) / rows.length;
const pred = (x) => x.reduce((s, v, k) => s + v * beta[k], 0);
rows.forEach((r) => { const e = r.y - pred(r.x); ssr += e * e; sst += (r.y - ymean) * (r.y - ymean); });
console.log('coefficients:'); FN.forEach((f, k) => console.log('  ' + f.padEnd(12), beta[k].toFixed(3)));
console.log('R^2:', (1 - ssr / sst).toFixed(3), ' RMSE:', Math.sqrt(ssr / rows.length).toFixed(2), 'spots');
const feat = (o) => [1, (o.cur || 10) / 25, o.lost || 0, o.idle || 0, o.lossOpp || 0, o.winOpp || 0, o.g5 || 0, o.margin || 0];
console.log('sanity (predicted next rank):');
console.log('  #10 idle         ->', pred(feat({ cur: 10, idle: 1 })).toFixed(1));
console.log('  #10 win (unrk)   ->', pred(feat({ cur: 10, won: 1, margin: 0.5 })).toFixed(1));
console.log('  #10 win vs #3    ->', pred(feat({ cur: 10, won: 1, winOpp: (26 - 3) / 25, margin: 0.3 })).toFixed(1));
console.log('  #10 loss vs #3   ->', pred(feat({ cur: 10, lost: 1, lossOpp: 3 / 26, margin: -0.3 })).toFixed(1));
console.log('  #10 loss vs unrk ->', pred(feat({ cur: 10, lost: 1, lossOpp: 26 / 26, margin: -0.2 })).toFixed(1));
console.log('  #24 idle (G5)    ->', pred(feat({ cur: 24, idle: 1, g5: 1 })).toFixed(1));

writeFileSync(new URL('./cfp-proj-model.json', import.meta.url), JSON.stringify({ features: FN, beta, n: rows.length, seasons: [FIRST, LAST], out: OUT }, null, 0));
console.log('wrote cfp-proj-model.json');
