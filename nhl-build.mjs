// Builds the NHL playoff odds: fetches teams, every team's schedule and scores, and the ratings models,
// simulates the season for each model and writes nhl-data.json. Usage: node nhl-build.mjs [sims]
import { writeFileSync } from 'node:fs';
import { byDate, centered, REGRESS, priorFit, loadSnaps, addSnap } from './hist.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const NHL = require('./nhl-engine.js');

const SIMS = +process.argv[2] || 20000;
// ESPN names a season by the year it ends: the 2026-27 season is 2027 (MoneyPuck by the year it starts).
const now = new Date(), SEASON = now.getUTCMonth() >= 7 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl';
const DIVS = {
  Atlantic: ['BOS', 'BUF', 'DET', 'FLA', 'MTL', 'OTT', 'TB', 'TOR'], Metropolitan: ['CAR', 'CBJ', 'NJ', 'NYI', 'NYR', 'PHI', 'PIT', 'WSH'],
  Central: ['CHI', 'COL', 'DAL', 'MIN', 'NSH', 'STL', 'UTAH', 'WPG'], Pacific: ['ANA', 'CGY', 'EDM', 'LA', 'SEA', 'SJ', 'VAN', 'VGK']
};
const EAST = ['Atlantic', 'Metropolitan'];
// Major national networks only (as on the other score pages).
// National TV first, then the national streams (ESPN calls NHL Network 'NHL Net'). Listed in this order.
const NATIONAL = ['ESPN', 'ESPN2', 'ABC', 'TNT', 'truTV', 'TBS', 'NHL Net', 'NHL Network', 'NBC', 'Prime Video', 'Peacock', 'ESPN+', 'Disney+'];
function networks(list) {
  const name = (b) => (b.media && b.media.shortName) || (b.names && b.names[0]) || '';
  return [...new Set(list.map(name).filter((n) => NATIONAL.includes(n)))].sort((x, y) => NATIONAL.indexOf(x) - NATIONAL.indexOf(y)).slice(0, 3);
}

async function get(url) {
  for (let tries = 1; ; tries++) {
    try { const r = await fetch(url, { headers: { 'user-agent': 'cfp-odds-board' } }); if (!r.ok) throw new Error(r.status + ' ' + url); return await r.json(); }
    catch (e) { if (tries >= 3) throw e; await new Promise((ok) => setTimeout(ok, 800 * tries)); }
  }
}
async function text(url) { const r = await fetch(url, { headers: { 'user-agent': 'cfp-odds-board' } }); if (!r.ok) throw new Error(r.status + ' ' + url); return r.text(); }
const center = (arr) => { const m = arr.reduce((s, v) => s + v, 0) / arr.length; return arr.map((v) => v - m); };

const tj = await get(`${SITE}/teams`);
const teams = tj.sports[0].leagues[0].teams.map(({ team: t }) => {
  const div = Object.keys(DIVS).find((d) => DIVS[d].includes(t.abbreviation));
  if (!div) throw new Error('No division for ' + t.abbreviation);
  const logo = (rel) => (t.logos.find((l) => rel.every((r) => l.rel.includes(r)) && l.rel.length === rel.length) || {}).href;
  return { espn: t.id, ab: t.abbreviation, name: t.displayName, short: t.shortDisplayName, nick: t.name, city: t.location,
    conf: EAST.includes(div) ? 'East' : 'West', div, color: '#' + (t.color || '666666'), logo: logo(['full', 'default']), logoDark: logo(['full', 'dark']) };
}).sort((a, b) => a.conf.localeCompare(b.conf) || a.div.localeCompare(b.div) || a.ab.localeCompare(b.ab));
const idx = {}, byAb = {};
teams.forEach((t, i) => { idx[t.espn] = i; byAb[t.ab] = i; });

// Every team's regular-season schedule, merged by game. An overtime or shootout final is marked ot.
const games = new Map();
for (const t of teams) {
  const s = await get(`${SITE}/teams/${t.espn}/schedule?season=${SEASON}&seasontype=2`);
  for (const e of s.events) {
    if (games.has(e.id)) continue;
    const c = e.competitions[0];
    const h = c.competitors.find((x) => x.homeAway === 'home'), a = c.competitors.find((x) => x.homeAway === 'away');
    if (idx[h.id] == null || idx[a.id] == null) continue;
    const st = c.status || e.status, done = st.type.completed;
    if (/CANCEL|POSTPONE/.test(st.type.name)) continue;
    const sc = (x) => +(x.score && (x.score.value != null ? x.score.value : x.score)) || 0;
    const g = { id: e.id, d: e.date, h: idx[h.id], a: idx[a.id], s: done ? 'post' : st.type.state === 'in' ? 'in' : 'pre', hs: done ? sc(h) : 0, as: done ? sc(a) : 0, tv: networks(c.broadcasts || []) };
    if (c.neutralSite) g.neutral = true;
    if (done && (st.period > 3 || /OT|SO/.test(st.type.detail || st.type.shortDetail || ''))) g.ot = 1;
    games.set(e.id, g);
  }
}
const G = [...games.values()].sort((x, y) => (x.d < y.d ? -1 : 1));
if (G.length < 1250) throw new Error('Only ' + G.length + ' games found');

const sources = {};
const fullName = {}; teams.forEach((t, i) => { fullName[t.name.toLowerCase().replace(/[^a-z]/g, '')] = i; });
// Sagarin: the overall RATING and its parts, PREDICTOR, GOLDEN_MEAN and RECENT, matched by full team name.
try {
  const html = (await text('http://sagarin.com/sports/nhlsend.htm')).replace(/<[^>]+>/g, '');
  const cols = { sagarin: [], sagpred: [], saggold: [], sagrecent: [] };
  Object.values(cols).forEach((a) => { for (let i = 0; i < teams.length; i++) a.push(null); });
  for (const line of html.split('\n')) {
    const m = /^\s*\d+\s+([A-Za-z. ]+?)\s*=\s*(-?[\d.]+)/.exec(line);
    if (!m) continue;
    const k = fullName[m[1].toLowerCase().replace(/[^a-z]/g, '')];
    if (k == null || cols.sagarin[k] != null) continue;
    const parts = line.split('|');
    cols.sagarin[k] = +m[2]; cols.sagpred[k] = parseFloat(parts[2]); cols.saggold[k] = parseFloat(parts[3]); cols.sagrecent[k] = parseFloat(parts[4]);
  }
  for (const k in cols) if (cols[k].every((v) => v != null && !isNaN(v))) sources[k] = { rating: center(cols[k]) };
  if (!sources.sagarin) throw new Error('teams missing');
} catch (e) { console.warn('Sagarin unavailable:', e.message); }

// MoneyPuck: expected goals for minus against per game, all situations (its season is named by its first year).
try {
  const csv = await text(`https://moneypuck.com/moneypuck/playerData/seasonSummary/${SEASON - 1}/regular/teams.csv`);
  const [head, ...rows] = csv.trim().split('\n').map((r) => r.split(','));
  const col = (k) => head.indexOf(k), MP = { TBL: 'TB', SJS: 'SJ', NJD: 'NJ', LAK: 'LA', UTA: 'UTAH' };
  const v = new Array(teams.length).fill(null);
  for (const r of rows) {
    if (r[col('situation')] !== 'all') continue;
    const i = byAb[MP[r[0]] || r[0]], gp = +r[col('games_played')];
    if (i != null && gp) v[i] = (+r[col('xGoalsFor')] - +r[col('xGoalsAgainst')]) / gp;
  }
  if (v.some((x) => x == null)) throw new Error('missing ' + teams.filter((_, i) => v[i] == null).map((t) => t.ab).join(', '));
  sources.mp = { rating: center(v) };
} catch (e) { console.warn('MoneyPuck unavailable:', e.message); }

// Expected-goal gaps run wider than the other ratings' (they aren't pulled toward average), so MoneyPuck is put
// on Sagarin's spread when both are in.
const sd = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0) / v.length);
if (sources.mp && sources.sagarin) { const f = sd(sources.sagarin.rating) / sd(sources.mp.rating); sources.mp.rating = sources.mp.rating.map((x) => x * f); }

const D = { season: SEASON, asOf: new Date().toISOString(), teams, games: G };
const simD = { ...D, games: G.map((g) => (g.s === 'in' ? { ...g, s: 'pre' } : g)) };
sources.goals = { rating: NHL.goalsRating(simD) };
const AVG = ['sagarin', 'mp', 'goals'].filter((k) => sources[k]);
sources.all = { rating: teams.map((_, i) => AVG.reduce((s, k) => s + sources[k].rating[i], 0) / AVG.length) };

const MODELS = [
  { k: 'all', label: 'All models average', group: 'Averages' },
  { k: 'sagarin', label: 'Sagarin Rating', group: 'Goal-based' },
  { k: 'sagpred', label: 'Sagarin Predictor', group: 'Goal-based' },
  { k: 'saggold', label: 'Sagarin Golden Mean', group: 'Goal-based' },
  { k: 'mp', label: 'MoneyPuck expected goals', group: 'Goal-based' },
  { k: 'goals', label: 'Goals rating (this site)', group: 'Goal-based' },
  { k: 'sagrecent', label: 'Sagarin Recent', group: 'Recent form' }
].filter((m) => sources[m.k]);
const AVG_LABELS = AVG.map((k) => MODELS.find((m) => m.k === k).label);

const t0 = Date.now(), results = {};
for (const m of MODELS) results[m.k] = NHL.simulate(simD, SIMS, undefined, undefined, sources[m.k].rating);
const played = G.filter((g) => g.s === 'post').length;
console.log(`NHL ${SEASON}: ${played}/${G.length} games played (${G.filter((g) => g.ot).length} to OT/SO); models ${MODELS.map((m) => m.k).join(', ')}; ${SIMS} seasons each in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
// Playoff odds over time for the team panels: this refresh's odds are saved to a snapshot file kept in the repo,
// and the chart uses saved odds where it has them, otherwise the season re-run with the ratings of that time.
{
  const t0 = Date.now();
// Preseason: last season's MoneyPuck expected-goal margin per game, on the current ratings' spread and
  // pulled a third of the way to average.
  let pre = null;
  try {
    const csv = await text(`https://moneypuck.com/moneypuck/playerData/seasonSummary/${SEASON - 2}/regular/teams.csv`);
    const [head, ...rows] = csv.trim().split('\n').map((r) => r.split(','));
    const col = (k) => head.indexOf(k), MP = { TBL: 'TB', SJS: 'SJ', NJD: 'NJ', LAK: 'LA', UTA: 'UTAH', ARI: 'UTAH' };
    const v = new Array(teams.length).fill(null);
    for (const r of rows) {
      if (r[col('situation')] !== 'all') continue;
      const i = byAb[MP[r[0]] || r[0]], gp = +r[col('games_played')];
      if (i != null && gp) v[i] = (+r[col('xGoalsFor')] - +r[col('xGoalsAgainst')]) / gp;
    }
    if (v.some((x) => x == null)) throw new Error('missing ' + teams.filter((_, i) => v[i] == null).map((t) => t.ab).join(', '));
    const c = centered(v), f = sd(sources.all.rating) / sd(c), rating = c.map((x) => x * f * REGRESS);
    pre = { rating, run: (games) => NHL.simulate({ ...D, games }, 4000, undefined, undefined, rating).teams, note: "last season's MoneyPuck expected goals, pulled a third of the way to average" };
  } catch (e) { console.warn('Last season MoneyPuck unavailable:', e.message); }
  const sim = (games, rating) => NHL.simulate({ ...D, games }, 4000, undefined, undefined, rating).teams;
  if (!pre) pre = { rating: sources.all.rating, run: (games) => sim(games, sources.all.rating), note: "today's ratings (last season's were unavailable)" };
  const HF = new URL('./nhl-hist.json', import.meta.url), store = loadSnaps(HF), ids = D.teams.map((t) => t.espn);
  addSnap(HF, store, D.asOf, ids, results.all.teams.map((t) => t.playoff));
  // Ratings as of a past time: the preseason ratings, updated with the results played by then (25 games' worth of pull back toward preseason).
  const nR = pre.rating.length;
  const past = (t, games) => sim(games, priorFit(nR, D.games.filter((g) => g.s === 'post' && Date.parse(g.d) < t).map((g) => ({ h: g.h, a: g.a, m: Math.max(-NHL.M.capMargin, Math.min(NHL.M.capMargin, g.ot ? Math.sign(g.hs - g.as) : g.hs - g.as)) - (g.neutral ? 0 : NHL.M.hfa) })), pre.rating, 25));
  D.hist = byDate(D, { ids, store, value: (t) => t.playoff, nowTeams: results.all.teams, pre, past, note: 'the preseason ratings updated with the results played by then' });
  console.log('NHL odds history:', D.hist.labels.map((l, k) => l + (D.hist.src[k] === 'saved' ? '*' : '')).join(' '), '(* saved), snapshots', store.snaps.length, 'in', ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
writeFileSync(new URL('./nhl-data.json', import.meta.url), JSON.stringify({ D, models: MODELS, results,
  ratings: Object.fromEntries(MODELS.map((m) => [m.k, sources[m.k].rating.map((v) => Math.round(v * 1000) / 1000)])), sims: SIMS, avg: AVG_LABELS }));
