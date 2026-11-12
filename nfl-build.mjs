// Builds the NFL playoff odds: fetches the schedule, scores and FPI from ESPN, simulates the season and
// writes nfl-data.json. Usage: node nfl-build.mjs [sims], then node assemble.mjs
import { writeFileSync } from 'node:fs';
import { weekly, centered, loadSnaps, addSnap } from './hist.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const NFL = require('./nfl-engine.js');

const SIMS = +process.argv[2] || 20000;
const SEASON = +(process.env.NFL_SEASON || (new Date().getUTCMonth() < 2 ? new Date().getUTCFullYear() - 1 : new Date().getUTCFullYear()));
const DIVS = {
  'AFC East': ['BUF', 'MIA', 'NE', 'NYJ'], 'AFC North': ['BAL', 'CIN', 'CLE', 'PIT'],
  'AFC South': ['HOU', 'IND', 'JAX', 'TEN'], 'AFC West': ['DEN', 'KC', 'LV', 'LAC'],
  'NFC East': ['DAL', 'NYG', 'PHI', 'WSH'], 'NFC North': ['CHI', 'DET', 'GB', 'MIN'],
  'NFC South': ['ATL', 'CAR', 'NO', 'TB'], 'NFC West': ['ARI', 'LAR', 'SF', 'SEA']
};

async function get(url) {
  for (let tries = 1; ; tries++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'cfp-odds-board' } });
      if (!r.ok) throw new Error(r.status + ' ' + url);
      return await r.json();
    } catch (e) {
      if (tries >= 3) throw e;
      await new Promise((ok) => setTimeout(ok, 1000 * tries));
    }
  }
}

const tj = await get('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams');
const teams = tj.sports[0].leagues[0].teams.map(({ team: t }) => {
  const div = Object.keys(DIVS).find((d) => DIVS[d].includes(t.abbreviation));
  if (!div) throw new Error('No division for ' + t.abbreviation);
  const logo = (rel) => (t.logos.find((l) => rel.every((r) => l.rel.includes(r)) && l.rel.length === rel.length) || {}).href;
  return { espn: t.id, ab: t.abbreviation, name: t.displayName, short: t.shortDisplayName, conf: div.slice(0, 3), div,
    color: '#' + (t.color || '666666'), logo: logo(['full', 'default']), logoDark: logo(['full', 'dark']) };
}).sort((a, b) => a.div.localeCompare(b.div) || a.ab.localeCompare(b.ab));
const idx = {};
teams.forEach((t, i) => { idx[t.espn] = i; });

// Regular season, all 18 weeks.
const games = [];
const weeks = await Promise.all(Array.from({ length: 18 }, (_, k) =>
  get(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${k + 1}&dates=${SEASON}`)));
weeks.forEach((w, k) => {
  for (const e of w.events) {
    const c = e.competitions[0];
    const h = c.competitors.find((x) => x.homeAway === 'home'), a = c.competitors.find((x) => x.homeAway === 'away');
    if (idx[h.team.id] == null || idx[a.team.id] == null) continue;
    const st = c.status || e.status;
    // A canceled game (as Bills-Bengals in 2022) is never played: leave it out, so it isn't simulated.
    if (st.type.name === 'STATUS_CANCELED') continue;
    const s = st.type.completed ? 'post' : st.type.state === 'in' ? 'in' : 'pre';
    games.push({ id: e.id, wk: k + 1, d: e.date, h: idx[h.team.id], a: idx[a.team.id], neutral: !!c.neutralSite,
      s, hs: +h.score || 0, as: +a.score || 0,
      tv: [...new Set((c.broadcasts || []).flatMap((b) => b.names || []))].slice(0, 2) });
  }
});
if (games.length < 250) throw new Error('Only ' + games.length + ' games found');

// ESPN's FPI: expected margin against an average team on a neutral field.
try {
  const fj = await get(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${SEASON}/powerindex?limit=40`);
  for (const it of fj.items) {
    const id = (it.team.$ref.match(/teams\/(\d+)/) || [])[1];
    const v = (it.predictives || it.stats || []).find((p) => p.name === 'fpi');
    if (idx[id] != null && v) teams[idx[id]].fpi = +v.value;
  }
} catch (e) { console.warn('FPI unavailable, using points only:', e.message); }
const fpiCount = teams.filter((t) => typeof t.fpi === 'number').length;
const byAb = {};
teams.forEach((t, i) => { byAb[t.ab] = i; });
// nflverse and nfelo use LA and WAS where ESPN uses LAR and WSH.
const abOf = (x) => byAb[{ LA: 'LAR', WAS: 'WSH', OAK: 'LV', SD: 'LAC', STL: 'LAR' }[x] || x];

function csv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const out = []; let cur = '', q = false;
    for (let k = 0; k < line.length; k++) {
      const ch = line[k];
      if (q) { if (ch === '"' && line[k + 1] === '"') { cur += '"'; k++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); rows.push(out);
  }
  const head = rows.shift();
  return rows.map((r) => Object.fromEntries(head.map((h, k) => [h, r[k]])));
}
async function text(url) { const r = await fetch(url, { headers: { 'user-agent': 'cfp-odds-board' } }); if (!r.ok) throw new Error(r.status + ' ' + url); return r.text(); }
const center = (arr) => { const ok = arr.filter((v) => v != null), m = ok.reduce((s, v) => s + v, 0) / ok.length; return arr.map((v) => (v == null ? null : v - m)); };

// nfelo (open source, github.com/greerreNFL/nfelo): each team's Elo going into its latest game, in points
// (25 Elo points per point of spread).
const sources = {};
try {
  const rows = csv(await text('https://raw.githubusercontent.com/greerreNFL/nfelo/main/output_data/nfelo_games.csv'));
  const elo = new Array(teams.length).fill(null), thru = new Array(teams.length).fill('');
  for (const r of rows) {
    const m = /^(\d{4})_(\d+)_([A-Z]+)_([A-Z]+)$/.exec(r.game_id || '');
    if (!m || +m[1] !== SEASON) continue;
    for (const [ab, v] of [[m[3], r.starting_nfelo_away], [m[4], r.starting_nfelo_home]]) {
      const i = abOf(ab);
      if (i != null && v !== '' && r.game_id >= thru[i]) { elo[i] = +v / 25; thru[i] = r.game_id; }
    }
  }
  if (elo.every((v) => v != null)) sources.nfelo = { rating: center(elo), thru: 'week ' + Math.max(...thru.map((g) => +g.split('_')[1])) };
} catch (e) { console.warn('nfelo unavailable:', e.message); }

// Betting market (nflverse open data): ratings that best explain this season's point spreads, recent weeks
// counting more (each week back counts 0.8 as much).
try {
  const rows = csv(await text('https://github.com/nflverse/nfldata/raw/master/data/games.csv')).filter((r) => +r.season === SEASON && r.game_type === 'REG' && r.spread_line !== '');
  const n = teams.length, A = [], b = new Array(n).fill(0), maxWk = Math.max(...rows.map((r) => +r.week));
  for (let i = 0; i < n; i++) { A.push(new Array(n).fill(0)); A[i][i] = 0.5; }
  for (const r of rows) {
    const h = abOf(r.home_team), a = abOf(r.away_team);
    if (h == null || a == null) continue;
    const w = Math.pow(0.8, maxWk - +r.week), y = +r.spread_line - (r.location === 'Neutral' ? 0 : NFL.M.hfa);
    A[h][h] += w; A[a][a] += w; A[h][a] -= w; A[a][h] -= w; b[h] += w * y; b[a] -= w * y;
  }
  for (let c = 0; c < n; c++) for (let r2 = c + 1; r2 < n; r2++) { const f = A[r2][c] / A[c][c]; if (!f) continue; for (let k = c; k < n; k++) A[r2][k] -= f * A[c][k]; b[r2] -= f * b[c]; }
  const x = new Array(n).fill(0);
  for (let r2 = n - 1; r2 >= 0; r2--) { let s = b[r2]; for (let k = r2 + 1; k < n; k++) s -= A[r2][k] * x[k]; x[r2] = s / A[r2][r2]; }
  sources.market = { rating: center(x), thru: 'week ' + maxWk + ' lines' };
} catch (e) { console.warn('nflverse lines unavailable:', e.message); }

// Sagarin: the overall RATING and its three parts, PREDICTOR (pure points), GOLDEN_MEAN and RECENT.
try {
  const html = await text('http://sagarin.com/sports/nflsend.htm');
  const cols = { sagarin: [], sagpred: [], saggold: [], sagrecent: [] };
  Object.values(cols).forEach((a) => { for (let i = 0; i < teams.length; i++) a.push(null); });
  const names = teams.map((t) => t.name);
  for (const line of html.split('\n')) {
    const m = /^\s*\d+\s+([A-Za-z0-9 .]+?)\s*=\s*(-?[\d.]+)/.exec(line);
    if (!m) continue;
    const nm = m[1].trim(), k = names.indexOf({ 'Washington Redskins': 'Washington Commanders', 'Washington Football Team': 'Washington Commanders' }[nm] || nm);
    if (k < 0 || cols.sagarin[k] != null) continue;
    const parts = line.split('|');
    cols.sagarin[k] = +m[2];
    cols.sagpred[k] = parseFloat(parts[2]); cols.saggold[k] = parseFloat(parts[3]); cols.sagrecent[k] = parseFloat(parts[4]);
  }
  const thru = ((html.match(/ratings through games of ([^-\n]+)/) || [])[1] || '').trim().replace(/ [A-Z][a-z]+day$/, '');
  for (const k in cols) if (cols[k].every((v) => v != null && !isNaN(v))) sources[k] = { rating: center(cols[k]), thru };
} catch (e) { console.warn('Sagarin unavailable:', e.message); }

// TeamRankings: Predictive and Last 5 Games, by city name ("LA Rams", "NY Jets").
async function teamRankings(path) {
  const html = await text('https://www.teamrankings.com/nfl/ranking/' + path);
  const city = {};
  teams.forEach((t, i) => { city[t.name.slice(0, t.name.length - t.short.length).trim()] = i; });
  Object.assign(city, { 'LA Rams': byAb.LAR, 'LA Chargers': byAb.LAC, 'NY Giants': byAb.NYG, 'NY Jets': byAb.NYJ });
  const v = new Array(teams.length).fill(null);
  for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const c = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => x[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim());
    if (c.length < 3 || !/^\d+$/.test(c[0])) continue;
    const i = city[c[1].replace(/\s*\(\d+-\d+(-\d+)?\)\s*$/, '')];
    if (i != null) v[i] = parseFloat(c[2]);
  }
  if (!v.every((x) => x != null)) throw new Error('missing teams on ' + path);
  return center(v);
}
try { sources.tr = { rating: await teamRankings('predictive-by-other'), thru: 'daily' }; } catch (e) { console.warn('TeamRankings Predictive unavailable:', e.message); }
try { sources.trlast5 = { rating: await teamRankings('last-5-games-by-other'), thru: 'daily' }; } catch (e) { console.warn('TeamRankings Last 5 unavailable:', e.message); }

// Classic Elo (FiveThirtyEight's method) run over every game in nflverse since 1999: K 20, a margin-of-
// victory multiplier, 48 Elo points of home field, a third of the way back to average each offseason.
try {
  const all = csv(await text('https://github.com/nflverse/nfldata/raw/master/data/games.csv')).filter((r) => r.home_score !== '' && r.away_score !== '');
  const E = {};
  let season = null;
  for (const r of all) {
    if (r.season !== season) { for (const k in E) E[k] = E[k] * 2 / 3 + 1505 / 3; season = r.season; }
    const mv = (x) => ({ OAK: 'LV', SD: 'LAC', STL: 'LA' }[x] || x), h = mv(r.home_team), a = mv(r.away_team);
    if (E[h] == null) E[h] = 1505; if (E[a] == null) E[a] = 1505;
    const diff = E[h] - E[a] + (r.location === 'Neutral' ? 0 : 48), exp = 1 / (1 + Math.pow(10, -diff / 400));
    const mov = +r.home_score - +r.away_score, res = mov > 0 ? 1 : mov < 0 ? 0 : 0.5;
    const winDiff = mov > 0 ? diff : mov < 0 ? -diff : 0, mult = Math.log(Math.abs(mov) + 1) * 2.2 / (winDiff * 0.001 + 2.2);
    const shift = 20 * mult * (res - exp);
    E[h] += shift; E[a] -= shift;
  }
  const el = new Array(teams.length).fill(null);
  for (const k in E) { const i = abOf(k); if (i != null) el[i] = E[k] / 25; }
  if (el.every((v) => v != null)) sources.elo = { rating: center(el), thru: 'through last night' };
} catch (e) { console.warn('Elo unavailable:', e.message); }

if (fpiCount === teams.length) sources.fpi = { rating: center(teams.map((t) => t.fpi)), thru: 'live' };
const D = { season: SEASON, asOf: new Date().toISOString(), teams, games };
// A game under way is simulated from its start, like the rest still to play.
const simD = { ...D, games: games.map((g) => (g.s === 'in' ? { ...g, s: 'pre' } : g)) };
sources.points = { rating: NFL.pointsRating(simD), thru: 'this season' };
// The default averages one rating from each source (recent-form and partial columns left out).
const AVG = ['fpi', 'sagarin', 'tr', 'nfelo', 'elo', 'market', 'points'].filter((k) => sources[k]);
sources.all = { rating: teams.map((_, i) => AVG.reduce((s, k) => s + sources[k].rating[i], 0) / AVG.length), thru: '' };

// The menu groups models by how they calculate.
const MODELS = [
  { k: 'all', label: 'All models average', group: 'Averages' },
  { k: 'fpi', label: 'ESPN FPI', group: 'Point-based', url: 'https://www.espn.com/nfl/fpi' },
  { k: 'sagarin', label: 'Sagarin Rating', group: 'Point-based', url: 'http://sagarin.com/sports/nflsend.htm' },
  { k: 'sagpred', label: 'Sagarin Predictor', group: 'Point-based', url: 'http://sagarin.com/sports/nflsend.htm' },
  { k: 'saggold', label: 'Sagarin Golden Mean', group: 'Point-based', url: 'http://sagarin.com/sports/nflsend.htm' },
  { k: 'tr', label: 'TeamRankings Predictive', group: 'Point-based', url: 'https://www.teamrankings.com/nfl/ranking/predictive-by-other' },
  { k: 'points', label: 'Points rating (this site)', group: 'Point-based' },
  { k: 'nfelo', label: 'nfelo', group: 'Elo', url: 'https://www.nfeloapp.com/' },
  { k: 'elo', label: 'Classic Elo', group: 'Elo', url: 'https://github.com/nflverse/nfldata' },
  { k: 'market', label: 'Point spreads', group: 'Betting market', url: 'https://github.com/nflverse/nfldata' },
  { k: 'trlast5', label: 'TeamRankings Last 5 Games', group: 'Recent form', url: 'https://www.teamrankings.com/nfl/ranking/last-5-games-by-other' },
  { k: 'sagrecent', label: 'Sagarin Recent', group: 'Recent form', url: 'http://sagarin.com/sports/nflsend.htm' }
].filter((m) => sources[m.k]).map((m) => ({ ...m, thru: sources[m.k].thru }));
const AVG_LABELS = AVG.map((k) => MODELS.find((m) => m.k === k).label);

const t0 = Date.now(), results = {};
for (const m of MODELS) results[m.k] = NFL.simulate(simD, SIMS, undefined, undefined, sources[m.k].rating);
const played = games.filter((g) => g.s === 'post').length;
console.log(`NFL ${SEASON}: ${played}/${games.length} games played; models ${MODELS.map((m) => m.k).join(', ')}; ${SIMS} seasons each in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
// Playoff odds over time for the team panels: this refresh's odds are saved to a snapshot file kept in the repo,
// and the chart uses saved odds where it has them, otherwise the season re-run with the ratings of that time.
{
  const t0 = Date.now();
// Preseason: ESPN's FPI as of its last preseason update.
  let pre = null;
  try {
    const CORE = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${SEASON}/types/1/weeks`;
    const wks = (await get(`${CORE}?limit=20`)).items.map((w) => +(w.$ref.match(/weeks\/(\d+)/) || [])[1]).sort((a, b) => b - a);
    for (const w of wks) {
      const pj = await get(`${CORE}/${w}/powerindex?limit=40`);
      if (!pj.count) continue;
      const v = teams.map(() => null);
      for (const it of pj.items) {
        const id = (it.team.$ref.match(/teams\/(\d+)/) || [])[1], f = (it.predictives || it.stats || []).find((p) => p.name === 'fpi');
        if (idx[id] != null && f) v[idx[id]] = +f.value;
      }
      if (v.some((x) => x == null)) throw new Error('preseason FPI missing teams');
      const rating = centered(v), day = new Date(pj.items[0].lastUpdated || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      pre = { rating, run: (games) => NFL.simulate({ ...D, games }, 4000, undefined, undefined, rating).teams, note: `ESPN's preseason FPI (${day})` };
      break;
    }
  } catch (e) { console.warn('Preseason FPI unavailable:', e.message); }
  const sim = (games, rating) => NFL.simulate({ ...D, games }, 4000, undefined, undefined, rating).teams;
  if (!pre) pre = { rating: sources.all.rating, run: (games) => sim(games, sources.all.rating), note: "today's ratings (preseason FPI was unavailable)" };
  const HF = new URL('./nfl-hist.json', import.meta.url), store = loadSnaps(HF), ids = D.teams.map((t) => t.espn);
  addSnap(HF, store, D.asOf, ids, results.all.teams.map((t) => t.playoff));
  // ESPN's FPI as it stood after each regular-season week (ESPN keeps every week's version).
  const fpiWeek = {};
  const lastWk = Math.max(0, ...D.games.filter((g) => g.s === 'post').map((g) => g.wk));
  for (let k = 1; k < lastWk; k++) {
    try {
      const pj = await get(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${SEASON}/types/2/weeks/${k}/powerindex?limit=40`);
      const v = teams.map(() => null);
      for (const it of pj.items || []) {
        const id = (it.team.$ref.match(/teams\/(\d+)/) || [])[1], f = (it.predictives || it.stats || []).find((p) => p.name === 'fpi');
        if (idx[id] != null && f) v[idx[id]] = +f.value;
      }
      if (v.every((x) => x != null)) fpiWeek[k] = centered(v);
    } catch (e) { /* that week falls back to preseason */ }
  }
  const past = (k, games) => sim(games, fpiWeek[k] || pre.rating);
  D.hist = weekly(D, { ids, store, value: (t) => t.playoff, nowTeams: results.all.teams, pre, past, note: "ESPN's FPI as it stood after that week" });
  console.log('NFL odds history:', D.hist.labels.map((l, k) => l + (D.hist.src[k] === 'saved' ? '*' : '')).join(' '), '(* saved), FPI weeks', Object.keys(fpiWeek).length, 'snapshots', store.snaps.length, 'in', ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
writeFileSync(new URL('./nfl-data.json', import.meta.url), JSON.stringify({ D, models: MODELS, results, ratings: Object.fromEntries(MODELS.map((m) => [m.k, sources[m.k].rating.map((v) => Math.round(v * 100) / 100)])), sims: SIMS, fpi: fpiCount === 32, avg: AVG_LABELS }));
