// Builds the NBA playoff odds: fetches teams, every team's schedule and scores, and the ratings models,
// simulates the season for each model and writes nba-data.json. Usage: node nba-build.mjs [sims]
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const NBA = require('./nba-engine.js');

const SIMS = +process.argv[2] || 20000;
// ESPN names a season by the year it ends: the 2026-27 season is 2027.
const now = new Date(), SEASON = now.getUTCMonth() >= 7 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const DIVS = {
  'Atlantic': ['BOS', 'BKN', 'NY', 'PHI', 'TOR'], 'Central': ['CHI', 'CLE', 'DET', 'IND', 'MIL'], 'Southeast': ['ATL', 'CHA', 'MIA', 'ORL', 'WSH'],
  'Northwest': ['DEN', 'MIN', 'OKC', 'POR', 'UTAH'], 'Pacific': ['GS', 'LAC', 'LAL', 'PHX', 'SAC'], 'Southwest': ['DAL', 'HOU', 'MEM', 'NO', 'SA']
};
const EAST = ['Atlantic', 'Central', 'Southeast'];
// National networks only; local channels (team networks) are left off the score cards.
const NATIONAL = ['ESPN', 'ESPN2', 'ABC', 'NBC', 'Peacock', 'Prime Video', 'NBA TV', 'TNT', 'truTV'];

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
const idx = {};
teams.forEach((t, i) => { idx[t.espn] = i; });

// Every team's regular-season schedule, merged by game.
const games = new Map();
for (const t of teams) {
  const s = await get(`${SITE}/teams/${t.espn}/schedule?season=${SEASON}&seasontype=2`);
  for (const e of s.events) {
    if (games.has(e.id)) continue;
    const c = e.competitions[0];
    const h = c.competitors.find((x) => x.homeAway === 'home'), a = c.competitors.find((x) => x.homeAway === 'away');
    if (idx[h.id] == null || idx[a.id] == null) continue;
    const st = c.status || e.status, done = st.type.completed;
    const sc = (x) => +(x.score && (x.score.value != null ? x.score.value : x.score)) || 0;
    games.set(e.id, { id: e.id, d: e.date, h: idx[h.id], a: idx[a.id], neutral: !!c.neutralSite,
      s: done ? 'post' : st.type.state === 'in' ? 'in' : 'pre', hs: done ? sc(h) : 0, as: done ? sc(a) : 0,
      tv: [...new Set((c.broadcasts || []).map((b) => (b.media && b.media.shortName) || b.names && b.names[0]).filter((n) => NATIONAL.includes(n)))].slice(0, 2) });
  }
}
const G = [...games.values()].sort((x, y) => (x.d < y.d ? -1 : 1));
if (G.length < 1100) throw new Error('Only ' + G.length + ' games found');

const sources = {};
// ESPN's BPI: points better than an average team on a neutral floor.
try {
  const bj = await get(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${SEASON}/powerindex?limit=40`);
  const v = new Array(teams.length).fill(null);
  for (const it of bj.items) {
    const id = (it.team.$ref.match(/teams\/(\d+)/) || [])[1];
    const b = (it.stats || []).find((x) => x.name === 'bpi');
    if (idx[id] != null && b) v[idx[id]] = +b.value;
  }
  if (v.every((x) => x != null)) sources.bpi = { rating: center(v) };
} catch (e) { console.warn('BPI unavailable:', e.message); }

// Sagarin: the overall RATING and its parts, PREDICTOR, GOLDEN_MEAN and RECENT, matched by nickname.
try {
  const html = await text('http://sagarin.com/sports/nbasend.htm');
  const cols = { sagarin: [], sagpred: [], saggold: [], sagrecent: [] };
  Object.values(cols).forEach((a) => { for (let i = 0; i < teams.length; i++) a.push(null); });
  for (const line of html.split('\n')) {
    const m = /^\s*\d+\s+([A-Za-z0-9 .]+?)\s*=\s*(-?[\d.]+)/.exec(line);
    if (!m) continue;
    const k = teams.findIndex((t) => m[1].trim().endsWith(t.nick));
    if (k < 0 || cols.sagarin[k] != null) continue;
    const parts = line.split('|');
    cols.sagarin[k] = +m[2]; cols.sagpred[k] = parseFloat(parts[2]); cols.saggold[k] = parseFloat(parts[3]); cols.sagrecent[k] = parseFloat(parts[4]);
  }
  for (const k in cols) if (cols[k].every((v) => v != null && !isNaN(v))) sources[k] = { rating: center(cols[k]) };
} catch (e) { console.warn('Sagarin unavailable:', e.message); }

// TeamRankings: Predictive and Last 5 Games, by city ("LA Lakers", "Okla City").
async function teamRankings(path) {
  const html = await text('https://www.teamrankings.com/nba/ranking/' + path);
  const city = {};
  teams.forEach((t, i) => { city[t.city] = i; });
  Object.assign(city, { 'LA Lakers': idx[teams.find((t) => t.ab === 'LAL').espn], 'LA Clippers': idx[teams.find((t) => t.ab === 'LAC').espn],
    'Okla City': idx[teams.find((t) => t.ab === 'OKC').espn], 'Golden State': idx[teams.find((t) => t.ab === 'GS').espn] });
  const v = new Array(teams.length).fill(null);
  for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const c = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => x[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim());
    if (c.length < 3 || !/^\d+$/.test(c[0])) continue;
    const i = city[c[1].replace(/\s*\(\d+-\d+\)\s*$/, '')];
    if (i != null) v[i] = parseFloat(c[2]);
  }
  const miss = teams.filter((_, i) => v[i] == null).map((t) => t.city);
  if (miss.length) throw new Error('missing ' + miss.join(', '));
  return center(v);
}
try { sources.tr = { rating: await teamRankings('predictive-by-other') }; } catch (e) { console.warn('TeamRankings Predictive unavailable:', e.message); }
try { sources.trlast5 = { rating: await teamRankings('last-5-games-by-other') }; } catch (e) { console.warn('TeamRankings Last 5 unavailable:', e.message); }

const D = { season: SEASON, asOf: new Date().toISOString(), teams, games: G };
const simD = { ...D, games: G.map((g) => (g.s === 'in' ? { ...g, s: 'pre' } : g)) };
sources.points = { rating: NBA.pointsRating(simD) };
const AVG = ['bpi', 'sagarin', 'tr', 'points'].filter((k) => sources[k]);
sources.all = { rating: teams.map((_, i) => AVG.reduce((s, k) => s + sources[k].rating[i], 0) / AVG.length) };

// The menu groups models by how they calculate, as on the NFL page.
const MODELS = [
  { k: 'all', label: 'All models average', group: 'Averages' },
  { k: 'bpi', label: 'ESPN BPI', group: 'Point-based' },
  { k: 'sagarin', label: 'Sagarin Rating', group: 'Point-based' },
  { k: 'sagpred', label: 'Sagarin Predictor', group: 'Point-based' },
  { k: 'saggold', label: 'Sagarin Golden Mean', group: 'Point-based' },
  { k: 'tr', label: 'TeamRankings Predictive', group: 'Point-based' },
  { k: 'points', label: 'Points rating (this site)', group: 'Point-based' },
  { k: 'trlast5', label: 'TeamRankings Last 5 Games', group: 'Recent form' },
  { k: 'sagrecent', label: 'Sagarin Recent', group: 'Recent form' }
].filter((m) => sources[m.k]);
const AVG_LABELS = AVG.map((k) => MODELS.find((m) => m.k === k).label);

const t0 = Date.now(), results = {};
for (const m of MODELS) results[m.k] = NBA.simulate(simD, SIMS, undefined, undefined, sources[m.k].rating);
const played = G.filter((g) => g.s === 'post').length;
console.log(`NBA ${SEASON}: ${played}/${G.length} games played; models ${MODELS.map((m) => m.k).join(', ')}; ${SIMS} seasons each in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
writeFileSync(new URL('./nba-data.json', import.meta.url), JSON.stringify({ D, models: MODELS, results,
  ratings: Object.fromEntries(MODELS.map((m) => [m.k, sources[m.k].rating.map((v) => Math.round(v * 100) / 100)])), sims: SIMS, avg: AVG_LABELS }));
